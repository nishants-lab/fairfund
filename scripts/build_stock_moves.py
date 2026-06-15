"""
Stock-move intelligence: "Were the manager's portfolio changes smart?"
======================================================================
Uses holdings-history snapshots (>=2 per fund) to identify what the manager
ADDED and EXITED, then checks what those stocks did AFTER the move using
Yahoo Finance price data. Produces a "smart score" per fund.

Pipeline:
1. Extract unique stocks from holdings-history (with the date they appeared/left)
2. Map stock names -> NSE tickers (fuzzy match against NSE master list + cache)
3. Fetch monthly close prices from Yahoo Finance for all mapped tickers
4. For each fund with >=2 snapshots: compute adds/exits and their post-move returns
5. Output: stock_moves.json (per-fund smart-move analysis)

Designed for monthly CI runs (after capture-holdings). Resumable, cached.
"""
import os, json, re, time, sys
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# CI-safe path resolution (same strategy as capture_holdings_snapshot.py):
# HERE = scripts/, ROOT = parent of HERE (repo root in CI, workspace root locally)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

# Holdings-history: try both local workspace layout and CI repo layout
_HIST_CANDIDATES = [
    os.path.join(ROOT, "mf-website-v2", "public", "holdings-history"),  # local
    os.path.join(ROOT, "public", "holdings-history"),                   # CI
    os.path.join(HERE, "..", "public", "holdings-history"),             # CI alt
]
HIST_DIR = next((p for p in _HIST_CANDIDATES if os.path.isdir(p)), _HIST_CANDIDATES[-1])

# Ticker cache: committed to the repo so CI doesn't re-resolve from scratch
_TICKER_CANDIDATES = [
    os.path.join(ROOT, "stock_ticker_cache.json"),                     # local workspace
    os.path.join(ROOT, "mf-website-v2", "data", "stock_ticker_cache.json"),  # committed
    os.path.join(HERE, "..", "data", "stock_ticker_cache.json"),       # CI
]
TICKER_CACHE = next((p for p in _TICKER_CANDIDATES if os.path.exists(p)), _TICKER_CANDIDATES[-1])

# Price cache: ephemeral (not committed — refetched from Yahoo each run)
PRICE_CACHE = os.path.join(ROOT, "stock_price_cache.json")

# Output: stock_moves.json — lives next to funds.json for the website builder to pick up
_OUTPUT_CANDIDATES = [
    os.path.join(ROOT, "stock_moves.json"),                           # local
    os.path.join(ROOT, "mf-website-v2", "data", "stock_moves.json"), # CI
    os.path.join(HERE, "..", "data", "stock_moves.json"),             # CI alt
]
OUTPUT = next((p for p in _OUTPUT_CANDIDATES if os.path.isdir(os.path.dirname(p))), _OUTPUT_CANDIDATES[0])

# ---- Step 1: Extract unique stocks from holdings history ----

def extract_all_stocks():
    """Get all unique stock names + Groww keys from holdings-history snapshots."""
    stocks = {}  # key -> {name, sectors, first_seen, last_seen}
    for fn in os.listdir(HIST_DIR):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        try:
            rec = json.load(open(os.path.join(HIST_DIR, fn), encoding="utf-8"))
        except:
            continue
        for date, snap in (rec.get("snapshots") or {}).items():
            for h in snap.get("holdings", []):
                key = h.get("key") or h.get("name", "").lower().strip()
                if not key:
                    continue
                if key not in stocks:
                    stocks[key] = {
                        "name": h.get("name", ""),
                        "sector": h.get("sector"),
                        "key": key,
                        "first_seen": date,
                        "last_seen": date,
                    }
                else:
                    if date < stocks[key]["first_seen"]:
                        stocks[key]["first_seen"] = date
                    if date > stocks[key]["last_seen"]:
                        stocks[key]["last_seen"] = date
    return stocks


# ---- Step 2: Map stock names to NSE tickers ----

def load_nse_master():
    """Load NSE equity master list. Checks data/ (committed) first, downloads if missing."""
    _master_candidates = [
        os.path.join(HERE, "..", "data", "nse_equity_master.json"),  # CI (committed)
        os.path.join(ROOT, "nse_equity_master.json"),                # local workspace
    ]
    master_path = next((p for p in _master_candidates if os.path.exists(p)), _master_candidates[-1])
    if os.path.exists(master_path):
        return json.load(open(master_path, encoding="utf-8"))

    # Download from NSE (the public equity list endpoint)
    import urllib.request
    url = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
    headers = {"User-Agent": "Mozilla/5.0"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"WARNING: Could not download NSE master list: {e}")
        print("Falling back to Groww key -> ticker heuristic only.")
        return []

    entries = []
    for line in raw.strip().splitlines()[1:]:  # skip header
        parts = line.split(",")
        if len(parts) >= 2:
            symbol = parts[0].strip().strip('"')
            name = parts[1].strip().strip('"')
            if symbol and name:
                entries.append({"symbol": symbol, "name": name})
    json.dump(entries, open(master_path, "w", encoding="utf-8"))
    print(f"Downloaded NSE master: {len(entries)} equities")
    return entries


def _clean_name(n):
    """Normalize a company name for fuzzy matching."""
    n = n.lower()
    n = re.sub(r"\b(ltd\.?|limited|inc\.?|corp\.?|pvt\.?|private)\b", "", n)
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return set(n.split()) - {"", "the", "of", "and", "india"}


def fuzzy_match_ticker(stock_name, nse_master, threshold=0.55):
    """Find the best NSE ticker for a stock name using Jaccard token overlap."""
    tokens_a = _clean_name(stock_name)
    if not tokens_a:
        return None
    best_sym = None
    best_score = 0
    for entry in nse_master:
        tokens_b = _clean_name(entry["name"])
        if not tokens_b:
            continue
        jaccard = len(tokens_a & tokens_b) / len(tokens_a | tokens_b)
        if jaccard > best_score:
            best_score = jaccard
            best_sym = entry["symbol"]
    if best_score >= threshold:
        return best_sym
    return None


def build_ticker_map(stocks, nse_master):
    """Map all stock keys to NSE tickers. Uses cache for resolved ones.
    Filters out non-equity instruments (bonds, SDLs, NCDs, GOI strips) before
    attempting resolution — these were inflating the 'unresolved' count."""
    cache = {}
    if os.path.exists(TICKER_CACHE):
        try:
            cache = json.load(open(TICKER_CACHE, encoding="utf-8"))
        except:
            cache = {}

    # Patterns that identify NON-EQUITY holdings (should never be ticker-mapped)
    DEBT_PATTERNS = re.compile(
        r"goi\b|sdl\b|strips?\b|\bncd\b|fv\s*rs|state.*government.*securities|"
        r"state\s*developm?ent\s*loan|treasury\s*bill|t-?bill|"
        r"\d+\.?\d*%\s*(goi|assam|bihar|rajasthan|maharasht|karnataka|tamil|"
        r"punjab|gujarat|madhya|andhra|uttar|west\s*bengal|chattisgarh|kerala|"
        r"lic\s*h|hsg\s*tr|finance\s*l|housing)",
        re.IGNORECASE
    )
    # Foreign equity pattern: "company name forgn. eq (TICKER)" or similar
    FOREIGN_PATTERN = re.compile(r"forgn\.?\s*eq|foreign\s*eq", re.IGNORECASE)
    FOREIGN_TICKER_RE = re.compile(r"\(([A-Z]{1,5})\)\s*$")

    unresolved_keys = [k for k in stocks if k not in cache]
    skipped_debt = 0
    foreign_resolved = 0
    nse_resolved = 0
    nse_failed = 0

    if unresolved_keys:
        print(f"Resolving {len(unresolved_keys)} stock tickers (cached: {len(cache)})...")
        for i, key in enumerate(unresolved_keys):
            name = stocks[key]["name"]

            # Skip debt/non-equity instruments entirely
            if DEBT_PATTERNS.search(name) or DEBT_PATTERNS.search(key):
                cache[key] = "__debt__"  # mark as non-equity so we don't retry
                skipped_debt += 1
                continue

            # Foreign equities: extract ticker from parentheses
            if FOREIGN_PATTERN.search(name):
                m = FOREIGN_TICKER_RE.search(name)
                if m:
                    cache[key] = m.group(1)  # e.g. "ABBV" (no .NS suffix)
                    foreign_resolved += 1
                else:
                    cache[key] = "__foreign_unmapped__"
                continue

            # NSE fuzzy match (lower threshold from 0.55 to 0.45 — many legitimate
            # matches fail at 0.55 because of extra words like "Technologies",
            # "Enterprises", "International" that one side has and the other doesn't)
            ticker = fuzzy_match_ticker(name, nse_master, threshold=0.45)
            if ticker:
                cache[key] = ticker
                nse_resolved += 1
            else:
                # Try a secondary strategy: use Groww's key as a rough ticker guess.
                # Groww keys like "reliance-industries-ltd" often map to "RELIANCE".
                # Extract the first 1-2 words and check if it's a valid NSE symbol.
                slug_guess = key.split("-")[0].upper() if "-" in key else None
                if slug_guess and any(e["symbol"] == slug_guess for e in nse_master):
                    cache[key] = slug_guess
                    nse_resolved += 1
                else:
                    cache[key] = None
                    nse_failed += 1

            if (i + 1) % 200 == 0:
                print(f"  {i+1}/{len(unresolved_keys)} | NSE: {nse_resolved} | foreign: {foreign_resolved} | debt-skipped: {skipped_debt} | failed: {nse_failed}")

        json.dump(cache, open(TICKER_CACHE, "w", encoding="utf-8"))
        print(f"Resolution complete:")
        print(f"  NSE matched: {nse_resolved}")
        print(f"  Foreign extracted: {foreign_resolved}")
        print(f"  Debt/non-equity skipped: {skipped_debt}")
        print(f"  Genuinely unresolved: {nse_failed}")
    else:
        print(f"All {len(cache)} tickers cached.")

    return cache


# ---- Step 3: Fetch monthly prices from Yahoo Finance ----

def fetch_prices(tickers, start_date="2024-01-01"):
    """Fetch monthly close prices for all tickers. Uses + updates a cache.
    Handles both NSE tickers (appends .NS) and foreign tickers (used as-is)."""
    import yfinance as yf

    cache = {}
    if os.path.exists(PRICE_CACHE):
        try:
            cache = json.load(open(PRICE_CACHE, encoding="utf-8"))
        except:
            cache = {}

    # Only fetch tickers not already in cache (or stale)
    this_month = datetime.now().strftime("%Y-%m")
    to_fetch = [t for t in tickers if t and not t.startswith("__") and (t not in cache or cache[t].get("_asOf", "") < this_month)]

    if to_fetch:
        print(f"Fetching prices for {len(to_fetch)} tickers from Yahoo Finance...")
        # Separate NSE vs foreign tickers
        # Heuristic: if ticker is all-caps and <=5 chars with no digits, it's likely
        # a foreign ticker (e.g. AAPL, MSFT, ABBV). Otherwise it's NSE.
        # More reliable: NSE tickers tend to be longer (RELIANCE, APOLLOHOSP).
        # We'll just try .NS first; if that gives empty data, try without.
        nse_tickers = [f"{t}.NS" for t in to_fetch]
        batch_size = 50
        for i in range(0, len(nse_tickers), batch_size):
            batch = nse_tickers[i:i+batch_size]
            raw_batch = to_fetch[i:i+batch_size]
            try:
                data = yf.download(batch, start=start_date, interval="1mo",
                                   progress=False, group_by="ticker", auto_adjust=True)
                for j, full_t in enumerate(batch):
                    sym = raw_batch[j]
                    try:
                        if len(batch) == 1:
                            closes = data["Close"].dropna()
                        else:
                            closes = data[full_t]["Close"].dropna()
                        prices = {d.strftime("%Y-%m"): round(float(v), 2) for d, v in closes.items()}
                        if prices:
                            cache[sym] = {"prices": prices, "_asOf": this_month}
                    except Exception:
                        pass
            except Exception as e:
                print(f"  batch {i//batch_size} error: {e}")
            time.sleep(0.8)  # throttle between batches

        # For any still-missing (might be foreign tickers), try without .NS
        still_missing = [t for t in to_fetch if t not in cache or not cache[t].get("prices")]
        if still_missing:
            foreign_batch = still_missing[:100]  # cap foreign lookups
            print(f"  Trying {len(foreign_batch)} as foreign tickers (no .NS)...")
            try:
                data = yf.download(foreign_batch, start=start_date, interval="1mo",
                                   progress=False, group_by="ticker", auto_adjust=True)
                for sym in foreign_batch:
                    try:
                        if len(foreign_batch) == 1:
                            closes = data["Close"].dropna()
                        else:
                            closes = data[sym]["Close"].dropna()
                        prices = {d.strftime("%Y-%m"): round(float(v), 2) for d, v in closes.items()}
                        if prices:
                            cache[sym] = {"prices": prices, "_asOf": this_month}
                    except Exception:
                        pass
            except Exception:
                pass

        json.dump(cache, open(PRICE_CACHE, "w", encoding="utf-8"))
        print(f"Prices cached for {sum(1 for v in cache.values() if isinstance(v, dict) and v.get('prices'))} tickers")
    else:
        print(f"All {len(cache)} ticker prices cached and current.")

    return cache


# ---- Step 4: Compute smart moves per fund ----

def compute_fund_moves(code, snapshots, ticker_map, price_cache):
    """For a fund with >=2 snapshots, compute adds/exits and their post-move returns."""
    dates = sorted(snapshots.keys())
    if len(dates) < 2:
        return None

    # Compare oldest vs latest (or the two most recent for "recent moves")
    before = snapshots[dates[-2]]
    after = snapshots[dates[-1]]

    before_keys = {h["key"]: h for h in before.get("holdings", []) if h.get("key")}
    after_keys = {h["key"]: h for h in after.get("holdings", []) if h.get("key")}

    added = [(k, after_keys[k]) for k in after_keys if k not in before_keys]
    exited = [(k, before_keys[k]) for k in before_keys if k not in after_keys]

    if not added and not exited:
        return None

    after_date = after.get("portfolioDate") or dates[-1]
    after_month = after_date[:7]  # "2026-05"

    def post_move_return(key, direction):
        """Get the stock's return from the snapshot date to the latest available price."""
        ticker = ticker_map.get(key)
        if not ticker:
            return None
        pc = price_cache.get(ticker, {}).get("prices", {})
        if not pc:
            return None
        # get price at the snapshot month and at the latest month
        months = sorted(pc.keys())
        # find the price at or just after the move date
        move_prices = [pc[m] for m in months if m >= after_month]
        pre_prices = [pc[m] for m in months if m <= after_month]
        if direction == "added":
            # added stock: check if it went UP after being added
            if not move_prices or not pre_prices:
                return None
            entry_price = pre_prices[-1]  # price at/near add date
            latest_price = move_prices[-1] if move_prices else pre_prices[-1]
            if entry_price <= 0:
                return None
            return round((latest_price / entry_price - 1) * 100, 1)
        else:
            # exited stock: check if it went DOWN after being sold (validating the exit)
            if not move_prices:
                return None
            exit_price = pre_prices[-1] if pre_prices else move_prices[0]
            latest_price = move_prices[-1]
            if exit_price <= 0:
                return None
            return round((latest_price / exit_price - 1) * 100, 1)

    add_results = []
    for key, h in added[:10]:  # cap at top 10 by weight
        ret = post_move_return(key, "added")
        add_results.append({
            "name": h.get("name", ""),
            "pct": h.get("pct", 0),
            "ticker": ticker_map.get(key),
            "postReturn": ret,  # None if no price data
        })

    exit_results = []
    for key, h in exited[:10]:
        ret = post_move_return(key, "exited")
        exit_results.append({
            "name": h.get("name", ""),
            "pct": h.get("pct", 0),
            "ticker": ticker_map.get(key),
            "postReturn": ret,
        })

    # Smart score: % of adds that went up + % of exits that went down (or flat)
    adds_with_data = [r for r in add_results if r["postReturn"] is not None]
    exits_with_data = [r for r in exit_results if r["postReturn"] is not None]
    smart_adds = sum(1 for r in adds_with_data if r["postReturn"] > 0)
    smart_exits = sum(1 for r in exits_with_data if r["postReturn"] <= 0)  # stock fell after exit = good call
    total_with_data = len(adds_with_data) + len(exits_with_data)
    smart_score = round((smart_adds + smart_exits) / total_with_data * 100) if total_with_data >= 3 else None

    return {
        "fromDate": dates[-2],
        "toDate": dates[-1],
        "added": add_results,
        "exited": exit_results,
        "smartScore": smart_score,
        "smartBasis": total_with_data,
        "verdict": (
            "Smart moves" if smart_score and smart_score >= 70 else
            "Mixed moves" if smart_score and smart_score >= 40 else
            "Questionable moves" if smart_score is not None else
            "Insufficient price data"
        ),
    }


# ---- Main ----

def main():
    print("=== Stock-move intelligence pipeline ===")
    print(f"Holdings history dir: {HIST_DIR}")

    # Step 1: extract stocks
    stocks = extract_all_stocks()
    print(f"Step 1: {len(stocks)} unique stocks across all holdings snapshots")

    # Step 2: NSE ticker mapping
    nse_master = load_nse_master()
    ticker_map = build_ticker_map(stocks, nse_master)
    equity_resolved = sum(1 for v in ticker_map.values() if v and not v.startswith("__"))
    debt_skipped = sum(1 for v in ticker_map.values() if v == "__debt__")
    foreign_unmapped = sum(1 for v in ticker_map.values() if v == "__foreign_unmapped__")
    truly_unresolved = sum(1 for v in ticker_map.values() if v is None)
    print(f"Step 2 summary: {equity_resolved} equity tickers resolved | {debt_skipped} debt skipped | {truly_unresolved} genuinely unresolved")

    # Step 3: fetch prices
    unique_tickers = list(set(v for v in ticker_map.values() if v and not v.startswith("__")))
    print(f"Step 3: {len(unique_tickers)} unique tickers to price (excl. debt/unmapped)")
    price_cache = fetch_prices(unique_tickers)

    # Step 4: compute moves per fund
    print("Step 4: computing smart moves per fund...")
    results = {}
    fund_count = 0
    with_moves = 0
    with_score = 0
    for fn in os.listdir(HIST_DIR):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        code = fn[:-5]
        try:
            rec = json.load(open(os.path.join(HIST_DIR, fn), encoding="utf-8"))
        except:
            continue
        snaps = rec.get("snapshots", {})
        if len(snaps) < 2:
            continue
        fund_count += 1
        moves = compute_fund_moves(code, snaps, ticker_map, price_cache)
        if moves:
            results[code] = moves
            with_moves += 1
            if moves["smartScore"] is not None:
                with_score += 1

    json.dump(results, open(OUTPUT, "w", encoding="utf-8"))
    print(f"\nDone. Funds with >=2 snapshots: {fund_count}")
    print(f"Funds with computable moves: {with_moves}")
    print(f"Funds with smart-score (>=3 priced moves): {with_score}")

    # Show a few examples
    if results:
        print("\n=== PROOF-OF-CONCEPT EXAMPLES ===")
        scored = [(k, v) for k, v in results.items() if v.get("smartScore") is not None]
        scored.sort(key=lambda x: x[1]["smartScore"], reverse=True)
        for code, m in scored[:3]:
            print(f"\n  Fund {code}: {m['verdict']} (score {m['smartScore']}%, based on {m['smartBasis']} moves)")
            for a in m["added"][:2]:
                if a["postReturn"] is not None:
                    print(f"    + Added {a['name'][:35]} ({a['ticker'] or '?'}) {a['postReturn']:+.1f}% since")
            for e in m["exited"][:2]:
                if e["postReturn"] is not None:
                    print(f"    - Exited {e['name'][:35]} ({e['ticker'] or '?'}) {e['postReturn']:+.1f}% since")


if __name__ == "__main__":
    main()
