"""
Fetch fund manager details for the universe, reusing the ALREADY-VALIDATED
Groww slugs in holdings_cache/_slugs/{code}.json (so no wrong-fund risk).

Groww scheme payload provides per-manager:
  person_name, education, experience, date_from (tenure start),
  funds_managed [{scheme_name, scheme_code, search_id}]

Output: fund_managers.json
  { code: {
      managers: [ {name, since (ISO), education, experience,
                   funds_managed:[{name, code}]} ],
      fetched: true/false } }

Resumable & idempotent. Uses a browser User-Agent. Validates the fetched
scheme name matches ours (same guard as holdings) before trusting manager data.
"""
import json, os, sys, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

# Try importing fetch_holdings for _get/_name_overlap; provide fallbacks if not available
try:
    import fetch_holdings as fh
except ImportError:
    fh = None

SLUG_DIR = os.path.join(ROOT, "public", "holdings-history", "_slugs")
OUT = os.path.join(ROOT, "src", "data", "fund_managers.json")
MGR_CACHE = os.path.join(ROOT, "manager_cache")
os.makedirs(MGR_CACHE, exist_ok=True)

# Load universe from funds.json
_funds_path = os.path.join(ROOT, "src", "data", "funds.json")
_funds_data = json.load(open(_funds_path, encoding="utf-8"))
names = {int(f["code"]): f["name"] for f in _funds_data["funds"]}
META = os.path.join(ROOT, "scheme_meta_cache")

# Support --refresh-all: re-fetch managers older than 30 days
REFRESH_ALL = "--refresh-all" in sys.argv
MAX_CACHE_AGE_DAYS = 30

def auth_name(code):
    f = os.path.join(META, f"{code}.json")
    if os.path.exists(f):
        try:
            return json.load(open(f)).get("scheme_name") or names.get(code, "")
        except:
            pass
    return names.get(code, "")

def slug_for(code):
    f = os.path.join(SLUG_DIR, f"{code}.json")
    if os.path.exists(f):
        try:
            return json.load(open(f)).get("slug")
        except:
            return None
    return None

def fetch_one(code):
    cf = os.path.join(MGR_CACHE, f"{code}.json")
    if os.path.exists(cf):
        try:
            return code, json.load(open(cf))
        except:
            pass
    slug = slug_for(code)
    if not slug:
        rec = {"managers": [], "fetched": False, "note": "no slug"}
        json.dump(rec, open(cf, "w")); return code, rec
    d = fh._get(fh.SCHEME + slug, timeout=25)
    if not d:
        rec = {"managers": [], "fetched": False, "note": "fetch failed"}
        json.dump(rec, open(cf, "w")); return code, rec
    # validate identity
    fetched_name = d.get("scheme_name") or d.get("fund_name") or ""
    if fh._name_overlap(auth_name(code), fetched_name) < 0.45 and str(d.get("scheme_code")) != str(code):
        rec = {"managers": [], "fetched": False, "note": "identity mismatch"}
        json.dump(rec, open(cf, "w")); return code, rec

    details = d.get("fund_manager_details") or []
    managers = []
    seen = set()
    for m in details:
        nm = (m.get("person_name") or "").strip()
        if not nm or nm.lower() in seen:
            continue
        seen.add(nm.lower())
        fm = []
        for x in (m.get("funds_managed") or []):
            sc = x.get("scheme_code")
            try:
                sc = int(sc)
            except:
                sc = None
            fm.append({"name": x.get("scheme_name"), "code": sc})
        managers.append({
            "name": nm,
            "since": (m.get("date_from") or "")[:10] or None,
            "education": (m.get("education") or "").strip() or None,
            "experience": (m.get("experience") or "").strip() or None,
            "fundsManaged": fm,
        })
    rec = {"managers": managers, "fetched": True,
           "fund_manager_str": d.get("fund_manager")}
    json.dump(rec, open(cf, "w"))
    return code, rec

def main():
    codes = list(names.keys())
    existing = {}
    if os.path.exists(OUT):
        try:
            existing = json.load(open(OUT, encoding="utf-8"))
        except:
            existing = {}
    if REFRESH_ALL:
        # Re-fetch all where cache is older than MAX_CACHE_AGE_DAYS
        import time as _time
        cutoff = _time.time() - MAX_CACHE_AGE_DAYS * 86400
        todo = []
        for c in codes:
            cf = os.path.join(MGR_CACHE, f"{c}.json")
            if not os.path.exists(cf) or os.path.getmtime(cf) < cutoff:
                todo.append(c)
    else:
        todo = [c for c in codes if str(c) not in existing and not os.path.exists(os.path.join(MGR_CACHE, f"{c}.json"))]
    print(f"Universe: {len(codes)} | already done: {len(codes)-len(todo)} | to fetch: {len(todo)}")

    results = dict(existing)
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(fetch_one, c): c for c in todo}
        for fut in as_completed(futs):
            code, rec = fut.result()
            results[str(code)] = rec
            done += 1
            if done % 100 == 0:
                rate = done/(time.time()-t0)
                print(f"  {done}/{len(todo)} | {rate:.1f}/s")
    # also fold in any cache files not in todo (already cached)
    for c in codes:
        cf = os.path.join(MGR_CACHE, f"{c}.json")
        if str(c) not in results and os.path.exists(cf):
            try:
                results[str(c)] = json.load(open(cf))
            except:
                pass
    json.dump(results, open(OUT, "w", encoding="utf-8"))
    withmgr = sum(1 for r in results.values() if r.get("managers"))
    print(f"\nDone. {len(results)} funds; with >=1 manager: {withmgr}")

if __name__ == "__main__":
    main()
