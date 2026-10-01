"""
Recompute fund metrics (CAGR, Sharpe, Sortino, Calmar, MaxDrawdown, Alpha, Volatility)
from self-hosted NAV files for all funds.
=======================================================================================
Called by the daily refresh pipeline after update_nav_daily.py has appended fresh NAV.

This reads each fund's public/nav/{code}.json, slices to 1Y/3Y/5Y windows from
a shared observed date, computes risk-adjusted metrics, then writes them back to funds.json.

After this runs, compute_rankings.py should be called to re-rank based on fresh metrics.

Usage:
  python pipeline/compute_metrics.py            # recompute all
  python pipeline/compute_metrics.py --dry-run  # show what would change
  python pipeline/compute_metrics.py --fund 122639  # recompute this fund and its category peers
"""
import json
import sys
import os
from math import sqrt, pow as mpow
from datetime import date, datetime, timedelta
from bisect import bisect_left, bisect_right
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
NAV_DIR = os.path.join(ROOT, "public", "nav")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from market_date import ist_today, is_usable_nav_date
from nav_quality import nav_quality_issues, sticky_nav_holds
sys.path.insert(0, HERE)
from config import MIN_ANCHOR_FUNDS

RF_ANNUAL = 0.07  # risk-free rate (India 10Y ~7%)
RF_DAILY = RF_ANNUAL / 252
HORIZONS = {"1Y": 1, "3Y": 3, "5Y": 5}
NAV_QUALITY_BY_CODE = {}


def load_nav(code):
    """Load NAV series from self-hosted file. Returns list of (date_str, nav_float) oldest-first."""
    NAV_QUALITY_BY_CODE.pop(code, None)
    path = os.path.join(NAV_DIR, f"{code}.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            j = json.load(f)
        if not j.get("d") or not j.get("v") or len(j["d"]) != len(j["v"]):
            return None
        today = ist_today()
        points = [(day, value) for day, value in zip(j["d"], j["v"])
                  if is_usable_nav_date(day, today)]
        issues = nav_quality_issues(points)
        if issues:
            NAV_QUALITY_BY_CODE[code] = issues
            return None
        return points or None
    except Exception:
        return None


def calendar_start(end, years):
    day = date.fromisoformat(end)
    try:
        return day.replace(year=day.year - years).isoformat()
    except ValueError:
        return day.replace(year=day.year - years, day=28).isoformat()


def slice_nav(points, years, window_start=None, window_end=None):
    """Require a full calendar horizon and exact observed endpoints."""
    if not points:
        return None
    end = window_end or points[-1][0]
    target = calendar_start(end, years)
    stop = bisect_right(points, (end, float("inf")))
    if not stop or points[stop - 1][0] != end:
        return None
    if window_start is None:
        start = bisect_right(points, (target, float("inf"))) - 1
    else:
        if window_start > target:
            return None
        start = bisect_left(points, (window_start,))
        if start == len(points) or points[start][0] != window_start:
            return None
    if start < 0 or stop - start < 60:
        return None
    earliest = (date.fromisoformat(target) - timedelta(days=7)).isoformat()
    if points[start][0] < earliest:
        return None
    return points[start:stop]


def observed_anchor(nav_cache):
    # Match config.robust_latest_nav_date without rereading every NAV file.
    counts = Counter(points[-1][0] for points in nav_cache.values() if points)
    shared = [day for day, count in counts.items() if count >= MIN_ANCHOR_FUNDS]
    return max(shared or counts, default=None)


def shared_observation(histories, target):
    earliest = (date.fromisoformat(target) - timedelta(days=7)).isoformat()
    counts = Counter()
    for points in histories:
        left = bisect_left(points, (earliest,))
        right = bisect_right(points, (target, float("inf")))
        counts.update(day for day, _ in points[left:right])
    if not counts:
        return None
    majority = [day for day, count in counts.items() if count > len(histories) / 2]
    return max(majority) if majority else max(counts, key=lambda day: (counts[day], day))


def category_windows(funds, nav_cache):
    anchor = observed_anchor(nav_cache)
    if anchor is None:
        return {}
    by_cat = {}
    for fund in funds:
        by_cat.setdefault(fund["category"], []).append(fund["code"])
    windows = {}
    recent = (date.fromisoformat(anchor) - timedelta(days=7)).isoformat()
    for codes in by_cat.values():
        current = [nav_cache[code] for code in codes
                   if nav_cache[code] and nav_cache[code][-1][0] >= recent]
        end = shared_observation(current, anchor)
        if end is None:
            continue
        for horizon, years in HORIZONS.items():
            candidates = {}
            target = calendar_start(end, years)
            for code in codes:
                points = nav_cache[code]
                if not points:
                    continue
                stop = bisect_left(points, (end,))
                if stop < len(points) and points[stop][0] == end and points[0][0] <= target:
                    candidates[code] = points
            start = shared_observation(list(candidates.values()), target)
            if start is None:
                continue
            cohort = {}
            cagrs = []
            for code in candidates:
                sliced = slice_nav(nav_cache[code], years, start, end)
                computed = compute_metrics(sliced)
                if computed is None:
                    continue
                cagr = actual_duration_cagr(sliced)
                if cagr is None:
                    continue
                computed.update(windowStart=start, windowEnd=end,
                                targetStart=target, targetHorizon=horizon,
                                startOffsetDays=(date.fromisoformat(target) - date.fromisoformat(start)).days,
                                endOffsetDays=(date.fromisoformat(anchor) - date.fromisoformat(end)).days)
                cohort[code] = (computed, cagr)
                cagrs.append(cagr)
            if not cagrs:
                continue
            cagrs.sort()
            mid = len(cagrs) // 2
            median = cagrs[mid] if len(cagrs) % 2 else (cagrs[mid - 1] + cagrs[mid]) / 2
            for code, (computed, cagr) in cohort.items():
                computed["alpha"] = round(cagr - median, 2)
                computed["catMedianCagr"] = round(median, 2)
                windows[(code, horizon)] = computed
    return windows


def actual_duration_cagr(points):
    """Annualized percentage return using the NAV endpoints' actual elapsed days.

    This is shared by the displayed fund return, its peer returns and alpha.
    A nominal horizon label is never the annualization denominator.
    Window selection / eligibility remain the responsibility of slice_nav.
    """
    if not points or len(points) < 2:
        return None
    start_date, start_nav = points[0]
    end_date, end_nav = points[-1]
    days = (datetime.strptime(end_date, "%Y-%m-%d") - datetime.strptime(start_date, "%Y-%m-%d")).days
    if days <= 0 or start_nav <= 0 or end_nav <= 0:
        return None
    return (mpow(end_nav / start_nav, 365.25 / days) - 1) * 100


def compute_metrics(points):
    """Compute full metrics from a NAV slice. Returns dict or None if insufficient data."""
    if not points or len(points) < 60 or nav_quality_issues(points):
        return None

    navs = [v for _, v in points]
    dates = [d for d, _ in points]
    start_nav = navs[0]
    end_nav = navs[-1]
    start_date = dates[0]
    end_date = dates[-1]

    ms_per_day = 86400000
    days = (datetime.strptime(end_date, "%Y-%m-%d") - datetime.strptime(start_date, "%Y-%m-%d")).days
    years = days / 365.25

    if years < 0.1 or start_nav <= 0:
        return None

    # Total return and CAGR
    total_return = (end_nav / start_nav - 1) * 100
    cagr = actual_duration_cagr(points)
    if cagr is None:
        return None

    # Daily returns (filter out obvious data errors > 50% daily move)
    daily_returns = []
    for i in range(1, len(navs)):
        if navs[i-1] > 0:
            r = navs[i] / navs[i-1] - 1
            if abs(r) < 0.5:
                daily_returns.append(r)

    if len(daily_returns) < 30:
        return None

    # Volatility (annualized)
    mean_r = sum(daily_returns) / len(daily_returns)
    variance = sum((r - mean_r) ** 2 for r in daily_returns) / (len(daily_returns) - 1)
    std_dev = sqrt(variance)
    volatility = std_dev * sqrt(252) * 100

    # Sharpe ratio
    sharpe = ((mean_r - RF_DAILY) / std_dev) * sqrt(252) if std_dev > 0 else 0

    # RMS shortfall over all observations, matching the browser definition.
    down_var = sum(min(r - RF_DAILY, 0) ** 2 for r in daily_returns) / len(daily_returns)
    down_dev = sqrt(down_var * 252)
    sortino = (cagr / 100 - RF_ANNUAL) / down_dev if down_dev > 0 else None

    # Max Drawdown
    peak = navs[0]
    max_dd = 0
    for nav in navs:
        if nav > peak:
            peak = nav
        dd = (nav - peak) / peak
        if dd < max_dd:
            max_dd = dd
    max_drawdown = max_dd * 100  # negative percentage

    # Calmar ratio
    calmar = (cagr / 100 - RF_ANNUAL) / abs(max_drawdown / 100) if max_drawdown != 0 else 0

    return {
        "cagr": round(cagr, 2),
        "volatility": round(volatility, 2),
        "sharpe": round(sharpe, 2),
        "sortino": round(sortino, 2) if sortino is not None else None,
        "maxDrawdown": round(max_drawdown, 2),
        "calmar": round(calmar, 2),
    }


def compute_alpha(fund_points, category_funds_cagrs, years):
    """Alpha = actual-duration fund CAGR minus the supplied category median.

    `years` is retained for call compatibility and labels only. All supplied
    category CAGRs must use actual_duration_cagr on their selected NAV slices.
    Common dated-window eligibility is a separate contract from annualization.
    """
    if not fund_points or len(fund_points) < 60:
        return None, None
    fund_cagr = actual_duration_cagr(fund_points)
    if fund_cagr is None:
        return None, None
    if not category_funds_cagrs:
        return None, None
    sorted_cagrs = sorted(category_funds_cagrs)
    mid = len(sorted_cagrs) // 2
    median = sorted_cagrs[mid] if len(sorted_cagrs) % 2 else (sorted_cagrs[mid-1] + sorted_cagrs[mid]) / 2
    alpha = fund_cagr - median
    return round(alpha, 2), round(median, 2)


def main():
    dry_run = "--dry-run" in sys.argv
    single_fund = None
    if "--fund" in sys.argv:
        idx = sys.argv.index("--fund")
        if idx + 1 < len(sys.argv):
            single_fund = int(sys.argv[idx + 1])

    if not os.path.exists(FUNDS_JSON):
        print(f"ERROR: {FUNDS_JSON} not found")
        sys.exit(1)
    if not os.path.isdir(NAV_DIR):
        print(f"ERROR: {NAV_DIR} not found")
        sys.exit(1)

    with open(FUNDS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    funds = data["funds"]
    print(f"Loaded {len(funds)} funds")
    print(f"NAV dir: {NAV_DIR}")

    selected_category = None
    if single_fund is not None:
        selected_category = next((f["category"] for f in funds if f["code"] == single_fund), None)
        if selected_category is None:
            raise SystemExit(f"ERROR: fund {single_fund} not found")
        print(f"Recomputing category peers for {selected_category}; global anchor unchanged")

    # Read validated histories once. A quarantined history can return None.
    holds = sticky_nav_holds(ROOT, funds)
    nav_cache = {f["code"]: load_nav(f["code"]) for f in funds}
    for code in nav_cache:
        if str(code) in holds:
            nav_cache[code] = None
    if selected_category is None:
        data["anchor"] = observed_anchor(nav_cache)
    windows = category_windows(funds, nav_cache)
    updated = 0
    skipped = 0
    no_nav = 0

    for f in funds:
        code = f["code"]
        if selected_category is not None and f["category"] != selected_category:
            continue

        nav_points = nav_cache[code]
        f["metrics"] = {}
        f.pop("si", None)
        previous_quality = f.pop("dataQuality", None)
        if not nav_points:
            issues = NAV_QUALITY_BY_CODE.get(code)
            if not issues and isinstance(previous_quality, dict) and previous_quality.get("status") == "quarantined":
                issues = previous_quality.get("issues")
            if str(code) in holds:
                f["dataQuality"] = holds[str(code)]
                f.pop("analytics", None)
            elif issues:
                f["dataQuality"] = {"status": "quarantined", "issues": issues}
                f.pop("analytics", None)
            no_nav += 1
            f["navPoints"] = 0
            f["isYoung"] = True
            f.pop("inceptionDate", None)
            continue

        # Always stamp history depth, inception, and a since-inception return so
        # young funds (which lack a full 1Y/3Y/5Y window) still have honest,
        # non-empty analytics to show. isYoung => no full 3Y track record yet.
        first_d, first_v = nav_points[0]
        last_d, last_v = nav_points[-1]
        f["navPoints"] = len(nav_points)
        f["inceptionDate"] = first_d
        f["isYoung"] = first_d > calendar_start(last_d, 3)
        si_days = (datetime.strptime(last_d, "%Y-%m-%d") - datetime.strptime(first_d, "%Y-%m-%d")).days
        if first_v > 0 and si_days >= 1 and last_v > 0:
            si = {"totalReturn": round((last_v / first_v - 1) * 100, 2), "days": si_days, "since": first_d}
            if si_days >= 90:
                si_years = si_days / 365.25
                si["cagr"] = round((mpow(last_v / first_v, 1 / si_years) - 1) * 100, 2)
            f["si"] = si

        for horizon_key in HORIZONS:
            metrics = windows.get((code, horizon_key))
            if metrics is None:
                skipped += 1
                continue
            f["metrics"][horizon_key] = metrics
            updated += 1

    print(f"\nMetrics recomputed: {updated} fund-horizons")
    print(f"Skipped (insufficient NAV): {skipped}")
    print(f"No NAV file: {no_nav}")

    if dry_run:
        print("\n--dry-run: no file written.")
        return

    with open(FUNDS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Wrote {FUNDS_JSON}")


if __name__ == "__main__":
    main()
