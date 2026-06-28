"""
Fast parallel fetch of AMFI authoritative scheme_category for every
Direct-Growth plan. Caches each result to scheme_meta_cache/{code}.json
so it is resumable and idempotent. Uses a thread pool since this is I/O bound.

Run repeatedly if interrupted; it only fetches what is missing.
"""
import requests
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = r"c:\Users\nisan\Documents\1. Work Related\1. Fresh\Kiro"
META_CACHE = os.path.join(ROOT, "scheme_meta_cache")
os.makedirs(META_CACHE, exist_ok=True)

def is_direct_growth(name):
    n = name.lower()
    return "direct" in n and "growth" in n

def cache_path(code):
    return os.path.join(META_CACHE, f"{code}.json")

def fetch_one(code):
    f = cache_path(code)
    if os.path.exists(f):
        return code, True  # already cached
    sess = requests.Session()
    for _ in range(3):
        try:
            r = sess.get(f"https://api.mfapi.in/mf/{code}/latest", timeout=15)
            if r.status_code == 200:
                d = r.json()
                meta = d.get("meta", {})
                rec = {
                    "scheme_category": meta.get("scheme_category"),
                    "scheme_type": meta.get("scheme_type"),
                    "fund_house": meta.get("fund_house"),
                    "scheme_name": meta.get("scheme_name"),
                    "has_nav": bool(d.get("data")),
                }
                with open(f, "w") as fh:
                    json.dump(rec, fh)
                return code, True
            time.sleep(0.2)
        except Exception:
            time.sleep(0.3)
    return code, False

def main():
    print("Fetching master list...")
    master = requests.get("https://api.mfapi.in/mf", timeout=60).json()
    dg = [m for m in master if is_direct_growth(m["schemeName"])]
    codes = [m["schemeCode"] for m in dg]
    print(f"Direct-Growth plans: {len(codes)}")

    already = sum(1 for c in codes if os.path.exists(cache_path(c)))
    print(f"Already cached: {already}")
    todo = [c for c in codes if not os.path.exists(cache_path(c))]
    print(f"To fetch: {len(todo)}")

    done = 0
    failed = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=16) as ex:
        futures = {ex.submit(fetch_one, c): c for c in todo}
        for i, fut in enumerate(as_completed(futures)):
            code, ok = fut.result()
            done += 1
            if not ok:
                failed += 1
            if done % 250 == 0:
                rate = done / (time.time() - t0)
                eta = (len(todo) - done) / rate if rate > 0 else 0
                print(f"  {done}/{len(todo)} fetched ({failed} failed) | {rate:.0f}/s | ETA {eta:.0f}s")

    total_cached = sum(1 for c in codes if os.path.exists(cache_path(c)))
    print(f"\nDone. Total cached: {total_cached}/{len(codes)} (failed this run: {failed})")

if __name__ == "__main__":
    main()
