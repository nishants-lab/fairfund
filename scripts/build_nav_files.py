"""
Self-host NAV: write compact per-fund NAV JSON into the site's public/ folder.
=============================================================================
Makes the site ROCK SOLID: the browser fetches NAV from the SAME ORIGIN
(GitHub Pages) instead of the flaky, CORS-less mfapi.in at view time.

Output: mf-website-v2/public/nav/{code}.json
Format (compact, parallel arrays, oldest->newest):
  {"d": ["2013-01-01", ...], "v": [10.08, ...], "u": "2026-05-29"}
    d = ISO dates, v = NAV values, u = last updated (latest date)

Only writes funds in the v6 universe. Reuses nav_cache/*.pkl; downloads any
missing. Resumable (skips files already written unless --force).
"""
import os, pickle, json, glob, sys, time, requests

ROOT = r"c:\Users\nisan\Documents\1. Work Related\1. Fresh\Kiro"
NAV_CACHE = os.path.join(ROOT, "nav_cache")
OUT_DIR = os.path.join(ROOT, "mf-website-v2", "public", "nav")
os.makedirs(OUT_DIR, exist_ok=True)

FORCE = "--force" in sys.argv

def fetch_nav_cached(code):
    f = os.path.join(NAV_CACHE, f"{code}.pkl")
    if os.path.exists(f):
        try:
            return pickle.load(open(f, "rb"))
        except:
            pass
    for _ in range(3):
        try:
            r = requests.get(f"https://api.mfapi.in/mf/{code}", timeout=20)
            if r.status_code == 200 and r.json().get("data"):
                d = r.json()
                pickle.dump(d, open(f, "wb"))
                return d
        except:
            time.sleep(0.4)
    return None

def compact(pts):
    d, v = [], []
    for p in pts:
        try:
            dd, mm, yyyy = p["date"].split("-")
            nav = round(float(p["nav"]), 4)
        except:
            continue
        if nav <= 0:
            continue
        d.append(f"{yyyy}-{mm}-{dd}")
        v.append(nav)
    # oldest -> newest
    if d and d[0] > d[-1]:
        d.reverse(); v.reverse()
    return d, v

def main():
    universe = json.load(open(os.path.join(ROOT, "mf_v6_universe.json"), encoding="utf-8"))
    codes = [int(f["code"]) for f in universe["funds"]]
    print(f"Universe: {len(codes)} funds")

    written = 0
    skipped = 0
    missing = 0
    manifest = {}
    for i, code in enumerate(codes):
        out = os.path.join(OUT_DIR, f"{code}.json")
        if os.path.exists(out) and not FORCE:
            skipped += 1
            try:
                manifest[code] = json.load(open(out))["u"]
            except:
                pass
            continue
        raw = fetch_nav_cached(code)
        if not raw or not raw.get("data"):
            missing += 1
            continue
        d, v = compact(raw["data"])
        if len(d) < 30:
            missing += 1
            continue
        rec = {"d": d, "v": v, "u": d[-1]}
        json.dump(rec, open(out, "w"), separators=(",", ":"))
        manifest[code] = d[-1]
        written += 1
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(codes)} (written {written}, skipped {skipped}, missing {missing})")

    # small manifest of code -> last-updated date (for cache busting / freshness)
    json.dump(manifest, open(os.path.join(OUT_DIR, "_manifest.json"), "w"), separators=(",", ":"))
    print(f"\nDone. Written {written}, skipped {skipped}, missing {missing}")
    print(f"Output: {OUT_DIR}")
    # total size
    tot = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR))
    print(f"Total size: {tot/1024/1024:.1f} MB across {len(os.listdir(OUT_DIR))} files")

if __name__ == "__main__":
    main()
