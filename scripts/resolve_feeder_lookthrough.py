"""
Feeder look-through: for feeder_unresolved funds whose underlying is a DOMESTIC
Indian ETF, resolve the ETF on Groww and adopt ITS stock-level holdings.
Foreign-fund feeders (JPMorgan/PGIM SICAVs etc.) remain flagged honestly.

Updates fund_holdings.json in place:
  coverage -> "lookthrough_etf" with the underlying ETF's holdings + a note.
"""
import json, os, sys, time, urllib.parse, requests

ROOT = r"c:\Users\nisan\Documents\1. Work Related\1. Fresh\Kiro"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import fetch_holdings as fh  # reuse resolver, cleaner, validators

HOLD = os.path.join(ROOT, "fund_holdings.json")
d = json.load(open(HOLD, encoding="utf-8"))

feeders = [(k, v) for k, v in d.items() if v.get("coverage") == "feeder_unresolved" and v.get("underlying")]
print(f"Feeder funds to attempt look-through: {len(feeders)}")

resolved = 0
foreign = 0
for code, rec in feeders:
    underlying = rec["underlying"]
    # Foreign funds won't be on Groww as Indian schemes; skip to honest flag.
    low = underlying.lower()
    is_foreign = any(x in low for x in ["jpmorgan", "jp morgan", "jennison", "sicav",
                                        "u18", "usd", "off-shore", "offshore",
                                        "luxembourg", "ucits", "accumulation"]) and "etf" not in low
    if is_foreign:
        foreign += 1
        rec["note"] = f"Feeder into {underlying} (overseas fund); stock-level holdings not publicly disclosed in India."
        continue

    # Resolve the underlying ETF on Groww with the robust resolver.
    slug = None
    try:
        q = fh._clean_query(underlying)
        resp = fh._get(fh.SEARCH + urllib.parse.quote(q), timeout=15)
        best_ov, best_slug, second = 0.0, None, 0.0
        if resp and resp.get("data", {}).get("content"):
            for c in resp["data"]["content"]:
                if c.get("entity_type") != "Scheme" or not c.get("search_id"):
                    continue
                ov = fh._name_overlap(underlying, c.get("title", ""))
                if ov > best_ov:
                    second = best_ov; best_ov = ov; best_slug = c["search_id"]
                elif ov > second:
                    second = ov
        if best_slug and ((best_ov >= 0.6 and best_ov - second >= 0.1) or best_ov >= 0.8):
            slug = best_slug
    except Exception:
        pass

    if not slug:
        rec["note"] = f"Feeder into {underlying}; underlying ETF holdings could not be resolved."
        continue

    sc = fh.fetch_scheme(slug)
    if not sc:
        rec["note"] = f"Feeder into {underlying}; underlying fetch failed."
        continue
    # validate the ETF we fetched actually matches the underlying name
    if fh._name_overlap(underlying, sc.get("scheme_name", "")) < 0.45 and \
       str(sc.get("scheme_code")) not in (rec.get("slug") or ""):
        rec["note"] = f"Feeder into {underlying}; underlying match not confident, withheld."
        continue
    uholds = fh.norm_holdings(sc.get("holdings", []))
    if not uholds or fh.is_feeder_singleline(uholds):
        rec["note"] = f"Feeder into {underlying}; underlying disclosed no stock-level holdings."
        continue

    raw = sc.get("holdings", [])
    rec["coverage"] = "lookthrough_etf"
    rec["holdings"] = uholds
    rec["portfolio_date"] = raw[0].get("portfolio_date") if raw else rec.get("portfolio_date")
    rec["note"] = f"Look-through to underlying ETF: {underlying}"
    resolved += 1
    print(f"  OK {code}: -> {underlying[:45]} ({len(uholds)} holdings)")
    time.sleep(0.1)

json.dump(d, open(HOLD, "w", encoding="utf-8"))
from collections import Counter
print(f"\nResolved via ETF look-through: {resolved} | foreign (kept flagged): {foreign}")
print("New coverage:", Counter(v["coverage"] for v in d.values()))
