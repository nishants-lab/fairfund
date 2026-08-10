"""
Fetch portfolio HOLDINGS for every fund in our universe, from Groww's public API.
====================================================================================
Groww exposes look-through stock-level holdings for most equity funds (incl. many
FoFs that disclose underlying stocks). Pure feeders show a single line into an
underlying fund; we attempt recursive look-through for DOMESTIC underlyings and
flag FOREIGN feeders honestly.

Endpoints (require a browser User-Agent header):
  - resolve slug : https://groww.in/v1/api/search/v3/query/global/st_query?query=<name>
  - holdings     : https://groww.in/v1/api/data/mf/web/v2/scheme/search/<slug>

Holding entry fields used: company_name, sector_name, instrument_name,
corpus_per (% of portfolio), stock_search_id, portfolio_date.

Strategy per fund:
  1. Resolve Groww slug by scheme_code match (preferred) or name.
  2. Pull holdings.
  3. Classify holdings:
       - stock-level (Equity / Forgn. Eq / etc.) -> use directly.
       - single feeder line (Mutual Fund / Foreign MF, ~>85%) -> attempt look-through:
           * if underlying maps to a DOMESTIC groww scheme -> fetch its holdings.
           * else -> mark feeder_unresolved with the underlying name.
  4. Record portfolio_date and a coverage flag.

Caching: holdings_cache/{groww_slug}.json (raw groww payload) so re-runs are cheap.
Output:  fund_holdings.json  { code: {slug, portfolio_date, coverage, holdings:[...], note} }

Resumable & idempotent. Run repeatedly; only fetches what is missing.
"""
import requests, json, os, time, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
HOLD_CACHE = os.path.join(ROOT, "holdings_cache")
SLUG_CACHE = os.path.join(ROOT, "holdings_cache", "_slugs")
os.makedirs(HOLD_CACHE, exist_ok=True)
os.makedirs(SLUG_CACHE, exist_ok=True)

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}
SEARCH = "https://groww.in/v1/api/search/v3/query/global/st_query?query="
SCHEME = "https://groww.in/v1/api/data/mf/web/v2/scheme/search/"


def safe_filename(s):
    """Make a string safe for a Windows filename (slugs can contain : / etc.)."""
    import re as _re
    return _re.sub(r'[<>:"/\\|?*]', "_", s)

# instrument_name values that indicate a FEEDER line (not a real stock)
FEEDER_INSTR = {"mutual fund", "foreign mf", "fund", "exchange traded fund", "etf"}
# instrument_name values that are real equities we count for overlap
EQUITY_INSTR = {"equity", "forgn. eq", "foreign equity", "equity shares", "fgn equity"}


def _get(url, timeout=20):
    for _ in range(3):
        try:
            r = requests.get(url, headers=H, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            time.sleep(0.3)
        except Exception:
            time.sleep(0.4)
    return None


def _tokens(s):
    import re
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    stop = {"fund", "direct", "growth", "plan", "the", "of", "and", "scheme",
            "option", "regular", "in", "india", "formerly", "known", "as", "ltd"}
    return set(t for t in s.split() if t not in stop and len(t) > 2)


def _name_overlap(our_name, cand_title):
    """Symmetric token similarity (Jaccard). Penalizes BOTH missing and extra
    tokens, so 'Nippon Large Cap' does not tie with 'Nippon Vision Large & Mid Cap'."""
    tn = _tokens(our_name)
    tc = _tokens(cand_title)
    if not tn or not tc:
        return 0.0
    inter = len(tn & tc)
    union = len(tn | tc)
    return inter / union if union else 0.0


def _clean_query(name):
    """Normalize a fund name into a Groww-search-friendly query.
    Verbose AMFI names like 'HDFC Flexi Cap Fund - Growth Option - Direct Plan'
    confuse Groww search (returns stocks). Strip plan/option noise and reorder."""
    import re
    n = name
    # drop bracketed 'formerly known as ...'
    n = re.sub(r"\(formerly[^)]*\)", " ", n, flags=re.IGNORECASE)
    n = re.sub(r"formerly known as[^-]*", " ", n, flags=re.IGNORECASE)
    # remove plan/option/dividend noise words
    for w in ["growth option", "growth plan", "idcw", "dividend", "payout",
              "reinvestment", "bonus option", "bonus", "- growth", "growth",
              "regular plan", "option"]:
        n = re.sub(re.escape(w), " ", n, flags=re.IGNORECASE)
    n = re.sub(r"[-–|]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    # ensure 'direct growth' present so Groww returns the direct-growth plan
    base = n.lower()
    if "direct" not in base:
        n = n + " Direct"
    n = n + " Growth"
    n = re.sub(r"\s+", " ", n).strip()
    return n


def resolve_slug(code, name):
    """Resolve a Groww scheme slug for a given MFAPI scheme_code + name.

    Accept a match ONLY if it is trustworthy:
      1. exact scheme_code match, OR
      2. name-token overlap >= 0.5 with a Scheme-type result.
    Otherwise return None (better to show 'no holdings' than WRONG holdings).
    """
    cf = os.path.join(SLUG_CACHE, f"{code}.json")
    if os.path.exists(cf):
        try:
            return json.load(open(cf)).get("slug")
        except:
            pass
    import urllib.parse
    query = _clean_query(name)
    d = _get(SEARCH + urllib.parse.quote(query), timeout=15)
    slug = None
    best_overlap = 0.0
    if d and d.get("data", {}).get("content"):
        content = d["data"]["content"]
        # 1) exact scheme_code match (most reliable)
        for c in content:
            if str(c.get("scheme_code")) == str(code) and c.get("search_id"):
                slug = c["search_id"]
                best_overlap = 1.0
                break
        # 2) otherwise pick the BEST name-token (Jaccard) match among Scheme
        #    results, and accept only if it is both strong and unambiguous.
        if not slug:
            best_slug = None
            second = 0.0
            for c in content:
                if c.get("entity_type") != "Scheme" or not c.get("search_id"):
                    continue
                ov = _name_overlap(name, c.get("title", ""))
                if ov > best_overlap:
                    second = best_overlap
                    best_overlap = ov
                    best_slug = c["search_id"]
                elif ov > second:
                    second = ov
            # accept best match if it clears the bar and is clearly ahead of #2
            if best_slug and best_overlap >= 0.6 and (best_overlap - second) >= 0.1:
                slug = best_slug
            elif best_slug and best_overlap >= 0.8:
                slug = best_slug
    with open(cf, "w") as fh:
        json.dump({"slug": slug, "best_overlap": round(best_overlap, 2)}, fh)
    return slug


def fetch_scheme(slug):
    cf = os.path.join(HOLD_CACHE, f"{safe_filename(slug)}.json")
    if os.path.exists(cf):
        try:
            with open(cf) as fh:
                return json.load(fh)
        except:
            pass
    d = _get(SCHEME + slug, timeout=25)
    if d:
        # keep only what we need to keep the cache lean
        slim = {
            "scheme_code": d.get("scheme_code"),
            "scheme_name": d.get("scheme_name") or d.get("fund_name"),
            "sub_category": d.get("sub_category"),
            "super_category": d.get("super_category"),
            "aum": d.get("aum"),
            "expense_ratio": d.get("expense_ratio"),
            "holdings": d.get("holdings") or [],
        }
        with open(cf, "w") as fh:
            json.dump(slim, fh)
        return slim
    return None


def norm_holdings(raw_holdings):
    out = []
    for h in raw_holdings:
        cp = h.get("corpus_per")
        if cp is None:
            continue
        out.append({
            "name": (h.get("company_name") or "").strip(),
            "pct": round(float(cp), 4),
            "sector": h.get("sector_name"),
            "instrument": (h.get("instrument_name") or "").strip(),
            "key": h.get("stock_search_id") or (h.get("company_name") or "").strip().lower(),
        })
    out.sort(key=lambda x: -x["pct"])
    return out


def is_feeder_singleline(holdings):
    """True if holdings is essentially one line into another fund."""
    if not holdings:
        return False
    eq = [h for h in holdings if h["instrument"].lower() in EQUITY_INSTR]
    feeders = [h for h in holdings if h["instrument"].lower() in FEEDER_INSTR]
    if not eq and feeders and feeders[0]["pct"] >= 80:
        return True
    return False


def process_fund(code, name):
    slug = resolve_slug(code, name)
    if not slug:
        return code, {"slug": None, "coverage": "unresolved", "holdings": [], "note": "No trustworthy Groww match"}
    sc = fetch_scheme(slug)
    if not sc:
        return code, {"slug": slug, "coverage": "fetch_failed", "holdings": [], "note": "Holdings fetch failed"}

    # POST-FETCH VALIDATION: the fetched scheme's own name must match ours.
    # Guards against fuzzy-search resolving to a different fund.
    fetched_name = sc.get("scheme_name") or ""
    ov = _name_overlap(name, fetched_name)
    code_match = str(sc.get("scheme_code")) == str(code)
    if not code_match and ov < 0.45:
        return code, {"slug": slug, "coverage": "unresolved", "holdings": [],
                      "note": "Resolved fund did not match (name mismatch); holdings withheld to avoid wrong data",
                      "resolved_to": fetched_name}

    holds = norm_holdings(sc.get("holdings", []))
    pdate = None
    raw = sc.get("holdings", [])
    if raw:
        pdate = raw[0].get("portfolio_date")

    rec = {"slug": slug, "portfolio_date": pdate, "aum": sc.get("aum"),
           "sub_category": sc.get("sub_category")}

    if not holds:
        rec.update({"coverage": "no_disclosure", "holdings": [], "note": "No holdings disclosed"})
        return code, rec

    if is_feeder_singleline(holds):
        feeder = holds[0]
        # attempt domestic look-through: search the underlying name on groww
        under_slug = None
        try:
            import urllib.parse
            dd = _get(SEARCH + urllib.parse.quote(feeder["name"]), timeout=12)
            if dd and dd.get("data", {}).get("content"):
                for c in dd["data"]["content"]:
                    if c.get("entity_type") == "Scheme" and c.get("search_id") and \
                       _name_overlap(feeder["name"], c.get("title", "")) >= 0.5:
                        under_slug = c["search_id"]; break
        except Exception:
            pass
        if under_slug and under_slug != slug:
            usc = fetch_scheme(under_slug)
            if usc:
                uholds = norm_holdings(usc.get("holdings", []))
                if uholds and not is_feeder_singleline(uholds):
                    rec.update({"coverage": "lookthrough_domestic", "holdings": uholds,
                                "note": f"Look-through via {feeder['name']}",
                                "underlying": feeder["name"]})
                    return code, rec
        # could not resolve -> foreign feeder
        rec.update({"coverage": "feeder_unresolved", "holdings": holds,
                    "note": f"Feeder into {feeder['name']}; stock-level look-through unavailable",
                    "underlying": feeder["name"]})
        return code, rec

    # normal stock-level disclosure
    rec.update({"coverage": "stock_level", "holdings": holds, "note": ""})
    return code, rec


def main():
    # Universe = funds present in v6 universe (preferred) else current funds.json.
    # Use the AUTHORITATIVE current scheme name (from scheme_meta_cache) for search,
    # so renamed funds (e.g. L&T -> HSBC) resolve correctly.
    META_CACHE = os.path.join(ROOT, "scheme_meta_cache")

    def auth_name(code, fallback):
        f = os.path.join(META_CACHE, f"{code}.json")
        if os.path.exists(f):
            try:
                nm = json.load(open(f)).get("scheme_name")
                if nm:
                    return nm
            except:
                pass
        return fallback

    universe = {}
    upath = os.path.join(ROOT, "mf_v6_universe.json")
    if os.path.exists(upath):
        u = json.load(open(upath, encoding="utf-8"))
        for f in u["funds"]:
            c = int(f["code"])
            universe[c] = auth_name(c, f["name"])
    else:
        _fp = os.path.join(ROOT, "src", "data", "funds.json")
        if not os.path.exists(_fp):
            _fp = os.path.join(ROOT, "mf-website-v2", "src", "data", "funds.json")
        fj = json.load(open(_fp, encoding="utf-8"))
        for f in fj["funds"]:
            c = int(f["code"])
            universe[c] = auth_name(c, f["fullName"])
    print(f"Universe size: {len(universe)}")

    out_path = os.path.join(ROOT, "fund_holdings.json")
    existing = {}
    if os.path.exists(out_path):
        try:
            existing = json.load(open(out_path, encoding="utf-8"))
        except:
            existing = {}
    print(f"Already have holdings for: {len(existing)}")

    todo = [(c, n) for c, n in universe.items() if str(c) not in existing]
    print(f"To fetch: {len(todo)}")

    results = dict(existing)
    done = 0
    t0 = time.time()
    SAVE_EVERY = 100
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(process_fund, c, n): c for c, n in todo}
        for fut in as_completed(futures):
            code, rec = fut.result()
            results[str(code)] = rec
            done += 1
            if done % 50 == 0:
                rate = done / (time.time() - t0)
                eta = (len(todo) - done) / rate if rate > 0 else 0
                cov = {}
                for r in results.values():
                    cov[r["coverage"]] = cov.get(r["coverage"], 0) + 1
                print(f"  {done}/{len(todo)} | {rate:.1f}/s | ETA {eta:.0f}s | {cov}")
            if done % SAVE_EVERY == 0:
                with open(out_path, "w", encoding="utf-8") as fh:
                    json.dump(results, fh)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(results, fh)

    cov = {}
    for r in results.values():
        cov[r["coverage"]] = cov.get(r["coverage"], 0) + 1
    print(f"\nDone. {len(results)} funds. Coverage breakdown:")
    for k, v in sorted(cov.items(), key=lambda x: -x[1]):
        print(f"  {v:5d}  {k}")


if __name__ == "__main__":
    main()
