"""
Daily NAV updater (CI copy) — appends each market day's NAV to public/nav/{code}.json
using AMFI's consolidated NAVAll.txt (authoritative, updated every market day).

Runs in GitHub Actions on weekday evenings. Idempotent and safe: aborts if AMFI
data looks incomplete, never deletes points, only appends strictly-newer dates.
"""
import os, json, sys
import urllib.request
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
# repo root = parent of this scripts/ dir; nav lives in public/nav
NAV_DIR = os.path.abspath(os.path.join(HERE, "..", "public", "nav"))
if not os.path.isdir(NAV_DIR):
    print(f"ERROR: {NAV_DIR} not found")
    sys.exit(1)
print(f"NAV dir: {NAV_DIR}")

# Staleness ledger: which fund codes could not be updated, and for how many
# consecutive runs. Lets a silently-frozen fund surface between monthly discovery
# runs instead of hiding inside an aggregate "not in AMFI" count.
LEDGER_PATH = os.path.abspath(os.path.join(HERE, "..", "src", "data", "nav_staleness.json"))
# Mirror of pipeline/config.DAILY_STALE_GAP_DAYS (kept local so this CI script has
# no import dependency). A fund AMFI still lists but has not repriced within this
# many calendar days is treated as stale, filtering out weekend/holiday gaps.
DAILY_STALE_GAP_DAYS = 7

AMFI_URL = "https://portal.amfiindia.com/spages/NAVAll.txt"

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
            # NAV and date are the last two fields in both the legacy 6-field
            # and the 2026 portal 8-field (...;Plan;Option;NAV;Date) layouts.
            nav = float(parts[-2].strip())
            if nav <= 0:
                continue
            iso = datetime.strptime(parts[-1].strip(), "%d-%b-%Y").strftime("%Y-%m-%d")
        except Exception:
            continue
        latest[code] = (iso, round(nav, 4))
    return latest

def load_ledger():
    try:
        return json.load(open(LEDGER_PATH))
    except Exception:
        return {}


def main():
    print("Fetching AMFI NAVAll...")
    latest = fetch_amfi()
    print(f"AMFI rows parsed: {len(latest)}")
    if len(latest) < 1000:
        print("ERROR: AMFI data incomplete; aborting.")
        sys.exit(1)

    today = datetime.now().strftime("%Y-%m-%d")
    stale_gap_cutoff = (datetime.now() - timedelta(days=DAILY_STALE_GAP_DAYS)).strftime("%Y-%m-%d")
    prev_ledger = load_ledger()
    ledger = {}

    files = [f for f in os.listdir(NAV_DIR) if f.endswith(".json") and f != "_manifest.json"]
    updated = uptodate = nodata = amfi_stale = 0
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
        last_have = j["d"][-1]
        manifest[code] = last_have
        amfi = latest.get(code)

        if not amfi:
            # AMFI no longer publishes any NAV for this code: strongest stall signal.
            nodata += 1
            _flag(ledger, prev_ledger, code, "not_in_amfi", last_have, today)
            continue

        new_date, new_nav = amfi
        if new_date > last_have:
            j["d"].append(new_date)
            j["v"].append(new_nav)
            j["u"] = new_date
            json.dump(j, open(path, "w"), separators=(",", ":"))
            updated += 1
            manifest[code] = new_date
            continue

        uptodate += 1
        # AMFI lists the code but has not repriced it beyond what we already hold,
        # and its latest date is older than the gap window -> the fund appears to
        # have stopped pricing (possible closure/merger). Weekend/holiday gaps are
        # shorter than the window and are ignored.
        if new_date < stale_gap_cutoff:
            amfi_stale += 1
            _flag(ledger, prev_ledger, code, "amfi_stale", new_date, today)

    json.dump(manifest, open(os.path.join(NAV_DIR, "_manifest.json"), "w"), separators=(",", ":"))
    json.dump(ledger, open(LEDGER_PATH, "w"), indent=1)
    print(f"Updated: {updated} | current: {uptodate} | not in AMFI: {nodata} | amfi-stale: {amfi_stale}")
    print(f"Staleness ledger: {len(ledger)} code(s) flagged -> {LEDGER_PATH}")


def _flag(ledger, prev_ledger, code, reason, last_nav, today):
    """Record/increment a stale code in the ledger, carrying forward the
    consecutive-run miss count and the date it was first flagged."""
    prev = prev_ledger.get(code, {})
    misses = prev.get("misses", 0) + 1 if prev.get("reason") == reason else 1
    ledger[code] = {
        "reason": reason,
        "misses": misses,
        "last_nav": last_nav,
        "first_flagged": prev.get("first_flagged", today) if prev.get("reason") == reason else today,
    }

if __name__ == "__main__":
    main()
