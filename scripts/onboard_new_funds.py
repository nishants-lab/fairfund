"""
Onboard new funds: resolve Groww slugs, validate, fetch initial holdings.
=========================================================================
Runs after discover_new_funds.py adds funds to funds.json. Processes any fund
that either:
  - Has holdingsMeta.coverage == "pending" (newly discovered)
  - Is missing from _slugs.json (no Groww slug resolved yet)

For each fund:
  1. Search Groww for the slug
  2. VALIDATE: confirm the API response's scheme_code matches our AMFI code
  3. If valid: fetch holdings, write to holdings-history and fund-data
  4. If invalid: log to report, skip (requires manual review)

Outputs a markdown summary to stdout (piped into PR body by the workflow).

Usage:
  python scripts/onboard_new_funds.py             # onboard pending funds
  python scripts/onboard_new_funds.py --dry-run   # show what would be onboarded
"""
import os
import json
import sys
import re
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

from config import GROWW_SEARCH_URL, GROWW_SCHEME_URL, GROWW_HEADERS

FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
HIST_DIR = os.path.join(ROOT, "public", "holdings-history")
DETAIL_DIR = os.path.join(ROOT, "public", "fund-data")
SLUG_MAP_PATH = os.path.join(HIST_DIR, "_slugs.json")

# Instruments that indicate real stock-level holdings
EQUITY_INSTR = {"equity", "forgn. eq", "foreign equity", "equity shares", "fgn equity"}
FEEDER_INSTR = {"mutual fund", "foreign mf", "fund", "exchange traded fund", "etf"}


def _get(url, timeout=20):
    """HTTP GET with retries and rate-limit awareness."""
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=GROWW_HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 200:
                    return json.loads(r.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            if e.code in (429, 403):
                time.sleep(min(2 ** (attempt + 2), 30))
                continue
        except Exception:
            pass
        time.sleep(0.5 * (2 ** attempt))
    return None


def _tokens(s):
    """Tokenize a fund name for overlap comparison."""
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    stop = {"fund", "direct", "growth", "plan", "the", "of", "and", "scheme",
            "option", "regular", "in", "india", "formerly", "known", "as", "ltd"}
    return set(t for t in s.split() if t not in stop and len(t) > 2)


def _name_overlap(a, b):
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _clean_query(name):
    n = re.sub(r"\(formerly[^)]*\)", " ", name, flags=re.IGNORECASE)
    n = re.sub(r"formerly known as[^-]*", " ", n, flags=re.IGNORECASE)
    for w in ["growth option", "growth plan", "idcw", "dividend", "payout",
              "reinvestment", "bonus option", "bonus", "- growth", "growth",
              "regular plan", "option"]:
        n = re.sub(re.escape(w), " ", n, flags=re.IGNORECASE)
    n = re.sub(r"[-\u2013|]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    if "direct" not in n.lower():
        n = n + " Direct"
    return re.sub(r"\s+", " ", n + " Growth").strip()


def resolve_and_validate(code, name):
    """Resolve Groww slug and validate scheme_code match.
    Returns (slug, validation_status, details_dict_or_None).
    validation_status: "exact_match" | "name_match" | "mismatch" | "not_found"
    """
    query = _clean_query(name)
    d = _get(GROWW_SEARCH_URL + urllib.parse.quote(query), timeout=15)
    if not d or not d.get("data", {}).get("content"):
        return None, "not_found", None

    content = d["data"]["content"]

    # Best case: exact scheme_code match
    for c in content:
        if str(c.get("scheme_code")) == str(code) and c.get("search_id"):
            return c["search_id"], "exact_match", None

    # Fallback: name overlap (but flag as needing verification)
    best_slug = None
    best_score = 0.0
    second_score = 0.0
    for c in content:
        if c.get("entity_type") != "Scheme" or not c.get("search_id"):
            continue
        ov = _name_overlap(name, c.get("title", ""))
        if ov > best_score:
            second_score = best_score
            best_score = ov
            best_slug = c["search_id"]
        elif ov > second_score:
            second_score = ov

    if best_slug and ((best_score >= 0.6 and best_score - second_score >= 0.1) or best_score >= 0.8):
        # Fetch the scheme and verify scheme_code
        sc = _get(GROWW_SCHEME_URL + best_slug, timeout=25)
        if sc and str(sc.get("scheme_code")) == str(code):
            return best_slug, "exact_match", sc
        elif sc:
            # Slug resolved but scheme_code doesn't match: MISMATCH
            return best_slug, "mismatch", {
                "expected_code": code,
                "got_code": sc.get("scheme_code"),
                "got_name": sc.get("scheme_name", ""),
            }
        return best_slug, "name_match", None

    return None, "not_found", None


def fetch_holdings(slug):
    """Fetch holdings from Groww for a resolved slug."""
    sc = _get(GROWW_SCHEME_URL + slug, timeout=25)
    if not sc:
        return None, None, None

    raw = sc.get("holdings") or []
    pdate_raw = raw[0].get("portfolio_date") if raw else None

    # Parse portfolio date (IST)
    pdate = None
    if pdate_raw:
        try:
            from datetime import timedelta
            dt = datetime.fromisoformat(pdate_raw.replace("Z", "+00:00"))
            ist = dt.astimezone(timezone.utc) + timedelta(hours=5, minutes=30)
            pdate = ist.strftime("%Y-%m-%d")
        except Exception:
            pdate = pdate_raw[:10] if pdate_raw else None

    # Normalize holdings
    holdings = []
    seen = set()
    for h in raw:
        cp = h.get("corpus_per")
        if cp is None:
            continue
        pct = round(float(cp), 4)
        if pct <= 0:
            continue
        hname = (h.get("company_name") or "").strip()
        low = hname.lower()
        if any(k in low for k in ("net payable", "net receivable", "net current asset",
                                   "treps", "reverse repo", "cash", "cblo", "margin", "triparty")):
            continue
        instr = (h.get("instrument_name") or "").strip().lower()
        if instr in {"futures", "options", "index derivatives", "repo", "reverse repo",
                     "treasury bills", "treasury bill", "cblo", "tri-party repo"}:
            continue
        key = h.get("stock_search_id") or low
        if key in seen:
            continue
        seen.add(key)
        holdings.append({
            "name": hname,
            "pct": pct,
            "sector": h.get("sector_name"),
            "instrument": (h.get("instrument_name") or "").strip(),
            "key": key,
        })
    holdings.sort(key=lambda x: -x["pct"])

    # Classify coverage
    eq = [h for h in holdings if h["instrument"].lower() in EQUITY_INSTR]
    feeders = [h for h in holdings if h["instrument"].lower() in FEEDER_INSTR]
    if eq:
        coverage = "stock_level"
    elif feeders and feeders[0]["pct"] >= 80:
        coverage = "feeder_unresolved"
    elif holdings:
        # FoF with disclosed underlying funds
        coverage = "fof_level"
    else:
        coverage = "no_disclosure"

    snap = {
        "portfolioDate": pdate,
        "capturedOn": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "coverage": coverage,
        "aum": sc.get("aum"),
        "expense_ratio": sc.get("expense_ratio"),
        "exit_load": sc.get("exit_load"),
        "min_sip": sc.get("min_sip_investment"),
        "min_lumpsum": sc.get("min_investment_amount"),
        "stamp_duty": sc.get("stamp_duty"),
        "sip_allowed": sc.get("sip_allowed"),
        "lumpsum_allowed": sc.get("lumpsum_allowed"),
        "available_for_investment": sc.get("available_for_investment"),
        "lock_in": sc.get("lock_in"),
        "holdings": holdings,
    }
    return snap, coverage, sc


def write_holdings_history(code, name, slug, snap):
    """Write snapshot to holdings-history/{code}.json."""
    hist_path = os.path.join(HIST_DIR, f"{code}.json")
    if os.path.exists(hist_path):
        rec = json.load(open(hist_path, encoding="utf-8"))
    else:
        rec = {"code": code, "slug": slug, "name": name, "snapshots": {}}

    rec["slug"] = slug
    rec["name"] = name
    pdate = snap["portfolioDate"]
    if pdate:
        rec["snapshots"][pdate] = snap
    with open(hist_path, "w", encoding="utf-8") as f:
        json.dump(rec, f, separators=(",", ":"))


def write_fund_data(code, snap, coverage):
    """Update fund-data/{code}.json with holdings from the snapshot."""
    detail_path = os.path.join(DETAIL_DIR, f"{code}.json")
    if not os.path.exists(detail_path):
        return

    detail = json.load(open(detail_path, encoding="utf-8"))
    detail["holdings"] = snap["holdings"][:30]  # top 30 for frontend
    detail["holdingsMeta"] = {
        "coverage": coverage,
        "portfolioDate": snap["portfolioDate"],
        "count": len(snap["holdings"]),
    }
    # AUM
    if snap.get("aum"):
        detail["aum"] = {"current": round(snap["aum"], 1), "asOf": snap["portfolioDate"]}
    # Expense ratio
    if snap.get("expense_ratio"):
        try:
            detail["expenseRatio"] = round(float(snap["expense_ratio"]), 2)
        except (ValueError, TypeError):
            pass

    with open(detail_path, "w", encoding="utf-8") as f:
        json.dump(detail, f, separators=(",", ":"), ensure_ascii=False)


def refresh_history_manifest():
    """Regenerate holdings-history/_manifest.json to match files on disk.
    Onboarding adds new history files, so the manifest must be rebuilt or it drifts."""
    from datetime import date
    files = [f for f in os.listdir(HIST_DIR)
             if f.endswith(".json") and not f.startswith("_")]
    man = {"updatedAt": date.today().isoformat(), "funds": 0, "totalSnapshots": 0, "multiSnapshot": 0}
    for fn in files:
        try:
            rec = json.load(open(os.path.join(HIST_DIR, fn), encoding="utf-8"))
        except Exception:
            continue
        ns = len(rec.get("snapshots", {}))
        man["funds"] += 1
        man["totalSnapshots"] += ns
        if ns >= 2:
            man["multiSnapshot"] += 1
    json.dump(man, open(os.path.join(HIST_DIR, "_manifest.json"), "w", encoding="utf-8"), indent=2)
    print(f"Refreshed history manifest: {man['funds']} funds, {man['totalSnapshots']} snapshots")


def main():
    dry_run = "--dry-run" in sys.argv

    with open(FUNDS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Load slug map
    smap = {}
    if os.path.exists(SLUG_MAP_PATH):
        smap = json.load(open(SLUG_MAP_PATH, encoding="utf-8"))

    # Find funds that need onboarding:
    # 1. holdingsMeta.coverage == "pending" in funds.json
    # 2. Missing from _slugs.json
    pending = []
    for fund in data["funds"]:
        code = str(fund["code"])
        name = fund.get("fullName") or fund["name"]

        needs_onboard = False
        # Check if coverage is pending
        if fund.get("holdingsMeta", {}).get("coverage") == "pending":
            needs_onboard = True
        # Check if missing from slug map
        if code not in smap or not smap[code]:
            needs_onboard = True

        if needs_onboard:
            pending.append((int(code), name))

    print(f"## Onboarding Report")
    print(f"")
    print(f"Funds needing onboarding: **{len(pending)}**")
    print(f"")

    if not pending:
        print("Nothing to onboard. All funds have slugs and holdings.")
        return

    # Results tracking
    results = {
        "onboarded": [],
        "mismatch": [],
        "not_found": [],
        "no_holdings": [],
    }

    for i, (code, name) in enumerate(pending):
        time.sleep(0.5)  # throttle

        # Step 1: Resolve slug
        slug, status, details = resolve_and_validate(code, name)

        if status == "mismatch":
            results["mismatch"].append({
                "code": code, "name": name, "slug": slug,
                "details": details,
            })
            print(f"- :warning: **{code}** {name[:45]}: slug mismatch "
                  f"(expected code {code}, got {details.get('got_code')} = {details.get('got_name', '')[:30]})")
            continue

        if status == "not_found" or not slug:
            results["not_found"].append({"code": code, "name": name})
            print(f"- :x: **{code}** {name[:45]}: not found on Groww")
            continue

        # Step 2: Fetch holdings
        snap, coverage, sc_data = fetch_holdings(slug)

        if not snap or not snap.get("portfolioDate") or not snap.get("holdings"):
            results["no_holdings"].append({"code": code, "name": name, "slug": slug})
            # Still save the slug even if no holdings
            smap[str(code)] = slug
            print(f"- :grey_question: **{code}** {name[:45]}: slug resolved but no holdings disclosed")
            continue

        # Step 3: Write data
        if not dry_run:
            smap[str(code)] = slug
            write_holdings_history(code, name, slug, snap)
            write_fund_data(code, snap, coverage)

        results["onboarded"].append({
            "code": code, "name": name, "slug": slug,
            "coverage": coverage, "holdings_count": len(snap["holdings"]),
            "portfolio_date": snap["portfolioDate"],
        })
        print(f"- :white_check_mark: **{code}** {name[:45]}: {coverage} "
              f"({len(snap['holdings'])} holdings, {snap['portfolioDate']})")

        if (i + 1) % 20 == 0:
            # Periodic save
            if not dry_run:
                json.dump(smap, open(SLUG_MAP_PATH, "w", encoding="utf-8"),
                          indent=None, separators=(",", ":"))

    # Final save
    if not dry_run:
        json.dump(smap, open(SLUG_MAP_PATH, "w", encoding="utf-8"),
                  indent=None, separators=(",", ":"))
        refresh_history_manifest()

        # Prune funds that failed onboarding (still coverage:pending = no holdings data).
        # These would show as empty entries on the live site.
        import sys; sys.path.insert(0, os.path.join(ROOT, "pipeline"))
        funds_json_path = os.path.join(ROOT, "src", "data", "funds.json")
        fdata = json.load(open(funds_json_path, encoding="utf-8"))
        before = len(fdata["funds"])
        fdata["funds"] = [f for f in fdata["funds"]
                          if not (f.get("holdingsMeta", {}).get("coverage") == "pending")]
        pruned = before - len(fdata["funds"])
        if pruned:
            fdata["totalFunds"] = len(fdata["funds"])
            json.dump(fdata, open(funds_json_path, "w", encoding="utf-8"), separators=(",", ":"))
            # Also remove their NAV + fund-data files
            nav_dir = os.path.join(ROOT, "public", "nav")
            fd_dir = os.path.join(ROOT, "public", "fund-data")
            index_codes = {str(f["code"]) for f in fdata["funds"]}
            for d in (nav_dir, fd_dir):
                for fn in os.listdir(d):
                    if fn.endswith(".json") and fn[:-5].isdigit() and fn[:-5] not in index_codes:
                        os.remove(os.path.join(d, fn))
            print(f"Pruned {pruned} funds that failed onboarding (still pending)")

    # Summary
    print(f"")
    print(f"### Summary")
    print(f"| Status | Count |")
    print(f"|--------|-------|")
    print(f"| Onboarded | {len(results['onboarded'])} |")
    print(f"| Slug mismatch (needs manual review) | {len(results['mismatch'])} |")
    print(f"| Not found on Groww | {len(results['not_found'])} |")
    print(f"| No holdings disclosed | {len(results['no_holdings'])} |")

    if results["mismatch"]:
        print(f"")
        print(f"### Requires Manual Review")
        print(f"These funds matched a Groww slug but the scheme_code didn't match.")
        print(f"Likely a name collision. Needs manual slug correction in `_slugs.json`.")
        print(f"")
        for m in results["mismatch"]:
            print(f"- `{m['code']}`: {m['name'][:50]} (got code {m['details'].get('got_code')})")

    if dry_run:
        print(f"")
        print(f"*Dry run: no files written.*")


if __name__ == "__main__":
    main()
