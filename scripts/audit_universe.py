"""
AUDIT: old name-based categorizer vs AMFI authoritative scheme_category.
=========================================================================
Fetches the authoritative scheme_category (via the lightweight /latest endpoint)
for EVERY Direct-Growth plan in the AMFI master list, caches it, then reports:

  A. SILENT MISSES   - funds AMFI classifies as Equity that the old code DROPPED
  B. MISLABELS       - funds the old code put in a different bucket than AMFI implies
  C. FALSE POSITIVES - funds the old code KEPT that AMFI says are NOT equity

Output: cat_audit.json (authoritative categories) + printed report.
Cache: scheme_meta_cache/{code}.json so re-runs are instant.
"""
import requests
import json
import os
import time
from collections import Counter, defaultdict

ROOT = r"c:\Users\nisan\Documents\1. Work Related\1. Fresh\Kiro"
META_CACHE = os.path.join(ROOT, "scheme_meta_cache")
os.makedirs(META_CACHE, exist_ok=True)

# ---------- OLD v5 categorizer (verbatim) ----------
EXCLUDE = [
    "bonus", "idcw", "dividend", "-div", " div ", "payout", "reinvest",
    "debt", "liquid", "overnight", "money market", "gilt", " bond", "bond ",
    "duration", "credit risk", "banking & psu", "corporate bond", "psu debt",
    "floating", "fixed maturity", "fmp", "interval", "arbitrage",
    "savings", "ultra short", "low duration", "treasury", "income plus",
    "hybrid", "balanced", "asset alloc", "multi asset", "equity savings",
    "retirement", "children", "solution", "regular savings", "dynamic bond",
    "life stage", "capital protection", "target maturity", "nifty sdl",
    "nifty g-sec", "g-sec", "constant maturity", "income fund",
]
intl_kw = ["nasdaq", "s&p 500", "s & p 500", "us equity", "u.s. ", "u.s opportun",
           "us opportun", "us bluechip", "us blue chip", "us flexible", "us specific",
           "us tech", "global", "international", "world ", "world gold", "world mining",
           "china", "taiwan", "europe", "european", "emerging market", "fang",
           "overseas", "developed", "pan europe", "asean", "japan", "brazil",
           "greater china", "global brand", "global consumer", "global innovation",
           "global equity"]

def old_categorize(name):
    n = name.lower()
    if any(x in n for x in EXCLUDE): return None
    if "direct" not in n or "growth" not in n: return None
    if any(x in n for x in intl_kw): return "International"
    if any(x in n for x in ["index", "nifty", "sensex", "bse "]):
        if any(x in n for x in ["pharma","healthcare","bank"," it ","auto","fmcg","infra","energy","metal","psu","consumption","manufacturing","momentum","quality","esg","defence","digital","realty","media","commodit","private bank","financial"]):
            return "Sectoral/Thematic"
        if "midcap" in n or "mid cap" in n: return "Index-MidCap"
        if "smallcap" in n or "small cap" in n: return "Index-SmallCap"
        if "next 50" in n or "next50" in n: return "Index-Other"
        if any(x in n for x in ["nifty 50","sensex","nifty50","nifty 100","top 50","largecap","large cap"]): return "Index-LargeCap"
        return "Index-Other"
    if "small cap" in n or "smallcap" in n: return "Small Cap"
    if "mid cap" in n or "midcap" in n: return "Mid Cap"
    if "large & mid" in n or "large and mid" in n or "largemid" in n: return "Large & Mid Cap"
    if "large cap" in n or "largecap" in n or "bluechip" in n or "blue chip" in n or "top 100" in n: return "Large Cap"
    if "flexi" in n: return "Flexi Cap"
    if "multi cap" in n or "multicap" in n: return "Multi Cap"
    if "elss" in n or "tax saver" in n or "taxsaver" in n or "long term equity" in n: return "ELSS"
    if "focused" in n: return "Focused"
    if "value" in n or "contra" in n: return "Value/Contra"
    if "dividend yield" in n: return "Dividend Yield"
    if any(x in n for x in ["pharma","healthcare","health care"]): return "Sectoral/Thematic"
    if any(x in n for x in ["bank","financial services","fin services"]): return "Sectoral/Thematic"
    if any(x in n for x in ["technology","tech fund"," it fund","digital"]): return "Sectoral/Thematic"
    if any(x in n for x in ["energy","power","infrastructure","infra "]): return "Sectoral/Thematic"
    if any(x in n for x in ["fmcg","consumption","consumer"]): return "Sectoral/Thematic"
    if any(x in n for x in ["auto ","automobile","metal","commodit","realty","real estate","transportation","logistics","mnc","media","tourism"]): return "Sectoral/Thematic"
    if any(x in n for x in ["quantamental","business cycle","special situation","manufacturing","innovation","opportunit","rural","esg","quant ","psu ","defence","housing","play"]): return "Sectoral/Thematic"
    return None

def is_direct_growth(name):
    n = name.lower()
    return "direct" in n and "growth" in n

def fetch_meta(code):
    """Authoritative scheme_category via lightweight /latest. Cached."""
    f = os.path.join(META_CACHE, f"{code}.json")
    if os.path.exists(f):
        try:
            with open(f) as fh:
                return json.load(fh)
        except:
            pass
    for _ in range(3):
        try:
            r = requests.get(f"https://api.mfapi.in/mf/{code}/latest", timeout=15)
            if r.status_code == 200:
                d = r.json()
                meta = d.get("meta", {})
                has_nav = bool(d.get("data"))
                rec = {
                    "scheme_category": meta.get("scheme_category"),
                    "scheme_type": meta.get("scheme_type"),
                    "fund_house": meta.get("fund_house"),
                    "scheme_name": meta.get("scheme_name"),
                    "has_nav": has_nav,
                }
                with open(f, "w") as fh:
                    json.dump(rec, fh)
                return rec
        except:
            time.sleep(0.3)
    return None

def main():
    print("Fetching master list...")
    master = requests.get("https://api.mfapi.in/mf", timeout=60).json()
    dg = [m for m in master if is_direct_growth(m["schemeName"])]
    print(f"Direct-Growth plans: {len(dg)}")

    print("Fetching authoritative categories (cached /latest)...")
    audit = []
    for i, m in enumerate(dg):
        if i % 250 == 0:
            print(f"  {i}/{len(dg)}")
        code = m["schemeCode"]
        meta = fetch_meta(code)
        if not meta:
            continue
        old = old_categorize(m["schemeName"])
        cat = (meta.get("scheme_category") or "").strip()
        is_equity = cat.lower().startswith("equity")
        audit.append({
            "code": code,
            "name": m["schemeName"],
            "amfi_category": cat,
            "amfi_is_equity": is_equity,
            "has_nav": meta.get("has_nav", False),
            "old_bucket": old,
            "old_kept": old is not None,
        })

    with open(os.path.join(ROOT, "cat_audit.json"), "w") as fh:
        json.dump(audit, fh, indent=2)
    print(f"\nSaved cat_audit.json ({len(audit)} funds)\n")

    # ---------- REPORT ----------
    equity = [a for a in audit if a["amfi_is_equity"]]
    print("=" * 70)
    print(f"AMFI says EQUITY (Direct-Growth): {len(equity)}")
    print("=" * 70)

    # A. SILENT MISSES: AMFI equity, old code dropped, has NAV
    misses = [a for a in equity if not a["old_kept"] and a["has_nav"]]
    print(f"\n[A] SILENT MISSES (AMFI-equity but OLD code DROPPED): {len(misses)}")
    bycat = Counter(a["amfi_category"] for a in misses)
    for c, n in bycat.most_common():
        print(f"      {n:4d}  {c}")
    print("    Examples:")
    for a in misses[:25]:
        print(f"      {a['code']}  {a['name']}")

    # C. FALSE POSITIVES: old code kept, but AMFI says NOT equity
    fps = [a for a in audit if a["old_kept"] and not a["amfi_is_equity"]]
    print(f"\n[C] FALSE POSITIVES (OLD code KEPT but AMFI says NOT equity): {len(fps)}")
    bycat = Counter(a["amfi_category"] for a in fps)
    for c, n in bycat.most_common():
        print(f"      {n:4d}  {c or '(blank)'}")
    print("    Examples:")
    for a in fps[:15]:
        print(f"      {a['code']}  [{a['amfi_category']}]  {a['name']}")

    # Coverage summary
    kept_equity = [a for a in equity if a["old_kept"]]
    print("\n" + "=" * 70)
    print("COVERAGE SUMMARY")
    print("=" * 70)
    print(f"  AMFI equity Direct-Growth (with NAV): {len([a for a in equity if a['has_nav']])}")
    print(f"  OLD code kept & AMFI-equity:          {len(kept_equity)}")
    print(f"  OLD code MISSED (equity, has NAV):    {len(misses)}")
    print(f"  OLD code FALSE-kept (non-equity):     {len(fps)}")
    miss_rate = 100 * len(misses) / max(1, len([a for a in equity if a['has_nav']]))
    print(f"  --> Silent miss rate: {miss_rate:.1f}% of the true equity universe")

if __name__ == "__main__":
    main()
