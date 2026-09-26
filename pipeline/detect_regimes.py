"""
Auto-detect market regimes from Nifty 50 index fund NAV data.
==============================================================
Analyses the NAV of a Nifty 50 index fund to identify bull/bear/correction
phases automatically. Historical events (COVID, the 2026 correction, etc.) are
annotated with human-readable names; recent phases get auto-generated names.

Output: src/data/regimes.json
  [
    {"name": "COVID crash", "start": "2020-02-19", "end": "2020-03-23",
     "market": "down", "desc": "...", "auto": false},
    ...
  ]

Runs monthly via CI. Uses a drawdown-based regime detection algorithm:
- A CORRECTION starts when the index falls >8% from its rolling peak
- A RALLY starts when the index makes a new all-time high after a correction
- Short dips (<15 trading days) are merged into the surrounding phase

Usage:
  python pipeline/detect_regimes.py              # detect and write
  python pipeline/detect_regimes.py --dry-run    # print without writing
"""
import json
import os
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
NAV_DIR = os.path.join(ROOT, "public", "nav")
OUT_PATH = os.path.join(ROOT, "src", "data", "regimes.json")

# UTI Nifty 50 Index Fund (well-established, long history)
BENCHMARK_CODE = 120716
# Fallback codes if primary is unavailable
FALLBACK_CODES = [118741, 147794, 118482]  # Nippon, Motilal, Bandhan

# Detection parameters
CORRECTION_THRESHOLD = -0.08   # -8% from peak = start of correction
RALLY_THRESHOLD = 0.0          # new high = rally confirmed
MIN_PHASE_DAYS = 15            # phases shorter than this get merged
MIN_CORRECTION_DEPTH = -0.06   # ignore corrections shallower than 6%

# Known historical regimes (human-curated names + descriptions)
# These override auto-detected boundaries for well-known events
KNOWN_REGIMES = [
    {
        "name": "COVID crash",
        "start": "2020-02-19", "end": "2020-03-23",
        "market": "down", "auto": False,
        "desc": "The fastest crash in history when COVID hit. A pure stress test of downside protection."
    },
    {
        "name": "COVID recovery",
        "start": "2020-03-24", "end": "2021-10-18",
        "market": "up", "auto": False,
        "desc": "The liquidity-fuelled V-shaped rebound and bull run."
    },
    {
        "name": "2022 correction",
        "start": "2021-10-19", "end": "2022-06-17",
        "market": "down", "auto": False,
        "desc": "Rate hikes and foreign outflows dragged markets down."
    },
    {
        "name": "2022-24 bull run",
        "start": "2022-06-18", "end": "2024-09-27",
        "market": "up", "auto": False,
        "desc": "A strong, broad-based bull led by mid and small caps."
    },
    {
        "name": "2024-25 correction",
        "start": "2024-09-28", "end": "2025-03-31",
        "market": "down", "auto": False,
        "desc": "Heavy FII outflows and stretched valuations drove a domestic correction before the global shocks of 2025."
    },
    {
        "name": "2025 recovery rally",
        "start": "2025-04-01", "end": "2026-01-02",
        "market": "up", "auto": False,
        "desc": "A long climb out of the 2024-25 correction. Trump's April tariffs and the 90-day pause caused only a brief wobble in India, and strong domestic flows carried the Nifty 50 about 15% higher to an all-time high on 2 January 2026."
    },
    {
        "name": "2026 correction",
        "start": "2026-01-03", "end": "2026-03-31",
        "market": "down", "auto": False,
        "desc": "A peak-to-trough fall of about 15% from the January high. Stretched valuations unwound through January and February, then US strikes on Iran in late February accelerated the selloff as crude spiked above $95 and foreign selling intensified."
    },
    {
        "name": "Post-correction drift",
        "start": "2026-04-01", "end": "2026-09-25",
        "market": "mixed", "auto": False,
        "desc": "A rebound that stalled. Markets recovered through the second quarter on ceasefire signals and cooling crude, then gave much of it back and drifted sideways into late September, finishing about 3% above where April began and still roughly 11% under the January peak."
    },
]

# After this date, regimes are auto-detected from NAV data
AUTO_DETECT_FROM = "2026-09-26"


def load_nav(code):
    """Load NAV from public/nav/{code}.json. Returns list of (date_str, nav)."""
    path = os.path.join(NAV_DIR, f"{code}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r") as f:
        data = json.load(f)
    dates = data.get("d", [])
    values = data.get("v", [])
    if len(dates) != len(values) or len(dates) < 100:
        return None
    return list(zip(dates, values))


def detect_phases(nav_points, from_date):
    """
    Detect bull/bear phases from NAV data starting from from_date.
    Returns list of {"name", "start", "end", "market", "auto", "desc"}.
    """
    # Filter to points after from_date
    filtered = [(d, v) for d, v in nav_points if d >= from_date]
    if len(filtered) < 10:
        return []

    # Also need some lookback for peak calculation
    lookback = [(d, v) for d, v in nav_points if d >= "2025-01-01"]

    # Find the rolling peak and drawdown
    peak = 0
    peak_date = lookback[0][0]
    phases = []
    current_phase = None  # {"start", "market", "depth"}

    for date, nav in lookback:
        if nav >= peak:
            peak = nav
            peak_date = date
            if current_phase and current_phase["market"] == "down" and date >= from_date:
                # Correction ended, new high reached
                current_phase["end"] = date
                phases.append(current_phase)
                current_phase = {"start": date, "market": "up", "depth": 0}
        else:
            dd = (nav - peak) / peak
            if dd < CORRECTION_THRESHOLD and (current_phase is None or current_phase["market"] == "up"):
                # New correction starting
                if current_phase and date >= from_date:
                    current_phase["end"] = date
                    phases.append(current_phase)
                current_phase = {"start": peak_date, "market": "down", "depth": dd}
            elif current_phase and current_phase["market"] == "down":
                current_phase["depth"] = min(current_phase.get("depth", 0), dd)

    # Close the last phase
    if current_phase:
        current_phase["end"] = lookback[-1][0]
        if current_phase["start"] >= from_date or current_phase["end"] >= from_date:
            phases.append(current_phase)

    # Filter to only phases that start on or after from_date
    phases = [p for p in phases if p["end"] >= from_date]
    # Adjust start dates that are before from_date
    for p in phases:
        if p["start"] < from_date:
            p["start"] = from_date

    # Merge very short phases
    merged = []
    for p in phases:
        start = datetime.strptime(p["start"], "%Y-%m-%d")
        end = datetime.strptime(p["end"], "%Y-%m-%d")
        if (end - start).days < MIN_PHASE_DAYS and merged:
            # Merge into previous
            merged[-1]["end"] = p["end"]
        else:
            merged.append(p)

    # Generate names for auto-detected phases
    result = []
    for p in merged:
        start_dt = datetime.strptime(p["start"], "%Y-%m-%d")
        end_dt = datetime.strptime(p["end"], "%Y-%m-%d")
        month_start = start_dt.strftime("%b %Y")
        month_end = end_dt.strftime("%b %Y")

        if p["market"] == "down":
            depth_pct = abs(p.get("depth", 0) * 100)
            name = f"{month_start} correction"
            desc = f"A {depth_pct:.0f}% drawdown from peak, {month_start} to {month_end}."
        else:
            name = f"{month_start} rally"
            desc = f"A recovery/rally phase from {month_start} to {month_end}."

        result.append({
            "name": name,
            "start": p["start"],
            "end": p["end"],
            "market": p["market"],
            "auto": True,
            "desc": desc,
        })

    return result


MIN_NET_MOVE = 8.0        # a regime must move the index at least this much (%)
MIN_DRAWDOWN = -8.0       # ...or draw down at least this much (%) within the window


def validate_regimes(regimes, nav_points):
    """Reject regimes that are too small to carry signal, or whose `market` label
    contradicts what the benchmark actually did. A 'mixed' regime is exempt from
    the magnitude bar, because flat-and-choppy is the point of that label.

    Returns a list of error strings (empty == all good)."""
    pts = dict(nav_points)
    keys = sorted(pts)
    errors = []
    for r in regimes:
        seg = [pts[k] for k in keys if r["start"] <= k <= r["end"]]
        if len(seg) < 2:
            errors.append(f"{r['name']}: fewer than 2 NAV points in window")
            continue
        net = (seg[-1] / seg[0] - 1) * 100
        peak = seg[0]
        dd = 0.0
        for v in seg:
            peak = max(peak, v)
            dd = min(dd, (v / peak - 1) * 100)
        mkt = r.get("market")
        if mkt == "down" and net > 0:
            errors.append(f"{r['name']}: labelled 'down' but index rose {net:+.1f}%")
        if mkt == "up" and net < 0:
            errors.append(f"{r['name']}: labelled 'up' but index fell {net:+.1f}%")
        if mkt != "mixed" and abs(net) < MIN_NET_MOVE and dd > MIN_DRAWDOWN:
            errors.append(
                f"{r['name']}: too small to be a regime (net {net:+.1f}%, maxDD {dd:.1f}%) "
                f"- needs |net| >= {MIN_NET_MOVE}% or maxDD <= {MIN_DRAWDOWN}%, or label it 'mixed'"
            )
    return errors


def main():
    dry_run = "--dry-run" in sys.argv

    # Load benchmark NAV
    nav_points = load_nav(BENCHMARK_CODE)
    if not nav_points:
        for code in FALLBACK_CODES:
            nav_points = load_nav(code)
            if nav_points:
                print(f"Using fallback benchmark: {code}")
                break
    if not nav_points:
        print("ERROR: No benchmark NAV available")
        sys.exit(1)

    print(f"Benchmark NAV: {len(nav_points)} points, {nav_points[0][0]} to {nav_points[-1][0]}")

    # Auto-detect recent phases
    auto_phases = detect_phases(nav_points, AUTO_DETECT_FROM)

    # Combine: known historical + auto-detected recent
    all_regimes = KNOWN_REGIMES.copy()

    # Only add auto-detected phases that don't overlap with known ones
    known_end = max(r["end"] for r in KNOWN_REGIMES)
    for phase in auto_phases:
        if phase["start"] > known_end:
            all_regimes.append(phase)
        elif phase["end"] > known_end:
            phase["start"] = known_end
            all_regimes.append(phase)

    # Sort by start date
    all_regimes.sort(key=lambda r: r["start"])

    # Guard: no undersized regimes, no label that contradicts the index
    errors = validate_regimes(all_regimes, nav_points)
    if errors:
        print("\nREGIME VALIDATION FAILED:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("\nRegime validation passed (magnitude + label direction).")

    print(f"\nRegimes ({len(all_regimes)} total):")
    for r in all_regimes:
        marker = "[auto]" if r.get("auto") else "[fixed]"
        print(f"  {marker} {r['name']:35s} {r['start']} to {r['end']}  ({r['market']})")

    if dry_run:
        print("\n--dry-run: not writing.")
        return

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(all_regimes, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {OUT_PATH}")


if __name__ == "__main__":
    main()
