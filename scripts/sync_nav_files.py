"""
Sync nav files: ensure every fund in funds.json has a public/nav/{code}.json.
==============================================================================
Runs in CI or locally. For any fund code in the committed dataset that LACKS
a self-hosted nav file, fetches its full NAV history from AMFI's mfapi.in and
writes the compact JSON. Does NOT touch existing files (the daily updater owns
append-only updates). Also validates alignment and reports gaps.

Usage:
  python scripts/sync_nav_files.py          # create missing nav files
  python scripts/sync_nav_files.py --check  # dry-run: report gaps without fetching

In CI, add this as a step BEFORE the daily NAV update, or run manually after
expanding the fund universe. Idempotent — safe to run repeatedly.
"""
import os, json, sys, time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

# Resolve paths (CI-safe, same strategy as capture_holdings_snapshot)
_FUNDS_CANDIDATES = [
    os.path.join(ROOT, "src", "data", "funds.json"),
    os.path.join(HERE, "..", "src", "data", "funds.json"),
]
FUNDS_JSON = next((p for p in _FUNDS_CANDIDATES if os.path.exists(p)), _FUNDS_CANDIDATES[0])
NAV_DIR = os.path.abspath(os.path.join(ROOT, "public", "nav"))

MFAPI = "https://api.mfapi.in/mf/"
H = {"User-Agent": "Mozilla/5.0"}
CHECK_ONLY = "--check" in sys.argv


def fetch_nav(code):
    """Fetch full NAV history from mfapi.in with retries + backoff."""
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{MFAPI}{code}", headers=H)
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status == 200:
                    return json.loads(r.read().decode("utf-8", errors="replace"))
        except Exception:
            pass
        time.sleep(1 * (2 ** attempt))
    return None


def compact(data_points):
    """Convert mfapi response data to compact {d:[],v:[],u:''} format."""
    d, v = [], []
    for p in data_points:
        try:
            dd, mm, yyyy = p["date"].split("-")
            nav = round(float(p["nav"]), 4)
        except Exception:
            continue
        if nav <= 0:
            continue
        d.append(f"{yyyy}-{mm}-{dd}")
        v.append(nav)
    # oldest -> newest
    if d and d[0] > d[-1]:
        d.reverse()
        v.reverse()
    return d, v


def main():
    if not os.path.exists(FUNDS_JSON):
        print(f"ERROR: funds.json not found at {FUNDS_JSON}")
        sys.exit(1)
    os.makedirs(NAV_DIR, exist_ok=True)

    funds = json.load(open(FUNDS_JSON, encoding="utf-8"))["funds"]
    codes = [int(f["code"]) for f in funds]
    existing = {fn[:-5] for fn in os.listdir(NAV_DIR) if fn.endswith(".json") and fn != "_manifest.json"}
    missing = [c for c in codes if str(c) not in existing]

    print(f"Funds in dataset: {len(codes)}")
    print(f"Existing nav files: {len(existing)}")
    print(f"Missing nav files: {len(missing)}")

    if not missing:
        print("All funds have nav files. Nothing to do.")
        return

    if CHECK_ONLY:
        print("\n--check mode: listing missing codes (no fetch):")
        for c in missing[:20]:
            print(f"  {c}")
        if len(missing) > 20:
            print(f"  ... and {len(missing) - 20} more")
        # Emit CI annotation
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::warning::{len(missing)} funds in funds.json lack a self-hosted nav file. "
                  "Run `python scripts/sync_nav_files.py` to create them.")
        sys.exit(0)

    print(f"\nFetching NAV for {len(missing)} missing funds...")
    created = 0
    failed = 0
    for i, code in enumerate(missing):
        raw = fetch_nav(code)
        if not raw or not raw.get("data"):
            failed += 1
            continue
        d, v = compact(raw["data"])
        if len(d) < 30:
            failed += 1
            continue
        rec = {"d": d, "v": v, "u": d[-1]}
        json.dump(rec, open(os.path.join(NAV_DIR, f"{code}.json"), "w"), separators=(",", ":"))
        created += 1
        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{len(missing)} (created {created}, failed {failed})")
        time.sleep(0.3)  # throttle to avoid mfapi rate-limiting

    print(f"\nDone. Created: {created} | Failed: {failed} | Already existed: {len(existing)}")
    if os.environ.get("GITHUB_ACTIONS") == "true" and failed > 0:
        print(f"::warning::{failed} funds could not be fetched from mfapi.in")


if __name__ == "__main__":
    main()
