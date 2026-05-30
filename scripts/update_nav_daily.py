"""
Daily NAV updater (CI copy) — appends each market day's NAV to public/nav/{code}.json
using AMFI's consolidated NAVAll.txt (authoritative, updated every market day).

Runs in GitHub Actions on weekday evenings. Idempotent and safe: aborts if AMFI
data looks incomplete, never deletes points, only appends strictly-newer dates.
"""
import os, json, sys
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
# repo root = parent of this scripts/ dir; nav lives in public/nav
NAV_DIR = os.path.abspath(os.path.join(HERE, "..", "public", "nav"))
if not os.path.isdir(NAV_DIR):
    print(f"ERROR: {NAV_DIR} not found")
    sys.exit(1)
print(f"NAV dir: {NAV_DIR}")

AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt"

def fetch_amfi():
    req = urllib.request.Request(AMFI_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode("utf-8", errors="replace")
    latest = {}
    for line in raw.splitlines():
        parts = line.split(";")
        if len(parts) < 6:
            continue
        code = parts[0].strip()
        if not code.isdigit():
            continue
        try:
            nav = float(parts[4].strip())
            if nav <= 0:
                continue
            iso = datetime.strptime(parts[5].strip(), "%d-%b-%Y").strftime("%Y-%m-%d")
        except Exception:
            continue
        latest[code] = (iso, round(nav, 4))
    return latest

def main():
    print("Fetching AMFI NAVAll...")
    latest = fetch_amfi()
    print(f"AMFI rows parsed: {len(latest)}")
    if len(latest) < 1000:
        print("ERROR: AMFI data incomplete; aborting.")
        sys.exit(1)

    files = [f for f in os.listdir(NAV_DIR) if f.endswith(".json") and f != "_manifest.json"]
    updated = uptodate = nodata = 0
    manifest = {}
    for fn in files:
        code = fn[:-5]
        path = os.path.join(NAV_DIR, fn)
        try:
            j = json.load(open(path))
        except Exception:
            continue
        if not j.get("d") or not j.get("v"):
            continue
        amfi = latest.get(code)
        if not amfi:
            nodata += 1
            manifest[code] = j["d"][-1]
            continue
        new_date, new_nav = amfi
        if new_date > j["d"][-1]:
            j["d"].append(new_date)
            j["v"].append(new_nav)
            j["u"] = new_date
            json.dump(j, open(path, "w"), separators=(",", ":"))
            updated += 1
        else:
            uptodate += 1
        manifest[code] = j["d"][-1]

    json.dump(manifest, open(os.path.join(NAV_DIR, "_manifest.json"), "w"), separators=(",", ":"))
    print(f"Updated: {updated} | current: {uptodate} | not in AMFI: {nodata}")

if __name__ == "__main__":
    main()
