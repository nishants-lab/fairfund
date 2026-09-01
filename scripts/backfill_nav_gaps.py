"""
Backfill NAV history holes in existing public/nav/{code}.json files.

The daily updater (update_nav_daily.py) only ever APPENDS AMFI's single latest
date. So any day the scheduled run was skipped or failed (e.g. the 19-25 Aug
2026 AMFI endpoint outage) leaves a permanent hole in the series - those market
days are never recovered, which corrupts returns / day-change / rolling calcs.

This healer closes those holes. For each existing nav file it fetches the full
history from mfapi.in (authoritative, complete) and inserts any dates mfapi has
that we lack, from our earliest point onward. Existing values are preserved
(mfapi only fills missing dates), so it is idempotent and safe to run anytime.

Usage:
  python scripts/backfill_nav_gaps.py            # heal all files
  python scripts/backfill_nav_gaps.py --check    # dry-run: report holes, no writes
  python scripts/backfill_nav_gaps.py --code 120594   # single fund
"""
import os, json, sys, time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
NAV_DIR = os.path.abspath(os.path.join(HERE, "..", "public", "nav"))
MFAPI = "https://api.mfapi.in/mf/"
H = {"User-Agent": "Mozilla/5.0"}
CHECK_ONLY = "--check" in sys.argv
ONE_CODE = None
if "--code" in sys.argv:
    ONE_CODE = sys.argv[sys.argv.index("--code") + 1]


def fetch_history(code):
    """Full NAV history from mfapi.in as {date_iso: nav}, with retries."""
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{MFAPI}{code}", headers=H)
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status != 200:
                    raise RuntimeError(r.status)
                data = json.loads(r.read().decode("utf-8", errors="replace"))
            out = {}
            for p in data.get("data", []):
                try:
                    dd, mm, yyyy = p["date"].split("-")
                    nav = round(float(p["nav"]), 4)
                except Exception:
                    continue
                if nav > 0:
                    out[f"{yyyy}-{mm}-{dd}"] = nav
            return out
        except Exception:
            time.sleep(1 * (2 ** attempt))
    return None


def main():
    if not os.path.isdir(NAV_DIR):
        print(f"ERROR: {NAV_DIR} not found")
        sys.exit(1)

    files = sorted(f for f in os.listdir(NAV_DIR)
                   if f.endswith(".json") and f != "_manifest.json")
    if ONE_CODE:
        files = [f"{ONE_CODE}.json"]

    scanned = healed = holes_filled = failed = 0
    worst = []
    for i, fn in enumerate(files):
        path = os.path.join(NAV_DIR, fn)
        code = fn[:-5]
        try:
            j = json.load(open(path))
        except Exception:
            continue
        d, v = j.get("d") or [], j.get("v") or []
        if not d:
            continue
        scanned += 1
        have = dict(zip(d, v))
        first = d[0]

        hist = fetch_history(code)
        if hist is None:
            failed += 1
            continue

        # dates mfapi has, at/after our earliest, that we are missing
        missing = sorted(dt for dt in hist if dt >= first and dt not in have)
        if not missing:
            time.sleep(0.15)
            continue

        worst.append((len(missing), code))
        holes_filled += len(missing)
        healed += 1
        if CHECK_ONLY:
            time.sleep(0.15)
            continue

        for dt in missing:
            have[dt] = hist[dt]
        merged = sorted(have.items())          # chronological
        j["d"] = [dt for dt, _ in merged]
        j["v"] = [nav for _, nav in merged]
        j["u"] = j["d"][-1]
        json.dump(j, open(path, "w"), separators=(",", ":"))
        time.sleep(0.3)  # throttle mfapi
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(files)} scanned (healed {healed}, filled {holes_filled})")

    worst.sort(reverse=True)
    verb = "would fill" if CHECK_ONLY else "filled"
    print(f"\nScanned: {scanned} | files with holes: {healed} | "
          f"points {verb}: {holes_filled} | fetch-failed: {failed}")
    print("Worst 10:", worst[:10])
    if CHECK_ONLY and os.environ.get("GITHUB_ACTIONS") == "true" and healed:
        print(f"::warning::{healed} nav files have {holes_filled} missing points. "
              "Run `python scripts/backfill_nav_gaps.py` to heal them.")


if __name__ == "__main__":
    main()
