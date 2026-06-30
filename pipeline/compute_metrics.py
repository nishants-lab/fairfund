"""
Recompute fund metrics (CAGR, Sharpe, Sortino, Calmar, MaxDrawdown, Alpha, Volatility)
from self-hosted NAV files for all funds.
=======================================================================================
Called by the daily refresh pipeline after update_nav_daily.py has appended fresh NAV.

This reads each fund's public/nav/{code}.json, slices to 1Y/3Y/5Y windows from the
latest available date, computes risk-adjusted metrics, then writes them back to funds.json.

After this runs, compute_rankings.py should be called to re-rank based on fresh metrics.

Usage:
  python pipeline/compute_metrics.py            # recompute all
  python pipeline/compute_metrics.py --dry-run  # show what would change
  python pipeline/compute_metrics.py --fund 122639  # single fund only
"""
import json
import sys
import os
from math import sqrt, pow as mpow
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
NAV_DIR = os.path.join(ROOT, "public", "nav")

RF_ANNUAL = 0.07  # risk-free rate (India 10Y ~7%)
RF_DAILY = RF_ANNUAL / 252


def load_nav(code):
    """Load NAV series from self-hosted file. Returns list of (date_str, nav_float) oldest-first."""
    path = os.path.join(NAV_DIR, f"{code}.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            j = json.load(f)
        if not j.get("d") or not j.get("v") or len(j["d"]) != len(j["v"]):
            return None
        return list(zip(j["d"], j["v"]))
    except Exception:
        return None


def slice_nav(points, years):
    """Slice NAV points to the last N years from the latest date.
    Returns None if actual history covers less than 90% of the requested horizon."""
    if not points:
        return None
    latest_date = datetime.strptime(points[-1][0], "%Y-%m-%d")
    cutoff = latest_date - timedelta(days=int(years * 365.25))
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    sliced = [(d, v) for d, v in points if d >= cutoff_str]
    if len(sliced) < 60:
        return None
    # Require at least 90% coverage of the requested horizon
    actual_start = datetime.strptime(sliced[0][0], "%Y-%m-%d")
    actual_days = (latest_date - actual_start).days
    required_days = years * 365.25
    if actual_days < required_days * 0.90:
        return None
    return sliced


def compute_metrics(points):
    """Compute full metrics from a NAV slice. Returns dict or None if insufficient data."""
    if not points or len(points) < 60:
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
    cagr = (mpow(end_nav / start_nav, 1 / years) - 1) * 100

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

    # Sortino ratio (downside deviation)
    downside = [r for r in daily_returns if r < RF_DAILY]
    if len(downside) > 5:
        down_var = sum((r - RF_DAILY) ** 2 for r in downside) / (len(downside) - 1)
        down_dev = sqrt(down_var) * sqrt(252)
    else:
        down_dev = 0.0001
    sortino = (cagr / 100 - RF_ANNUAL) / down_dev if down_dev > 0 else 0

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
        "sortino": round(sortino, 2),
        "maxDrawdown": round(max_drawdown, 2),
        "calmar": round(calmar, 2),
    }


def compute_alpha(fund_points, category_funds_cagrs, years):
    """Alpha = fund CAGR - category median CAGR for the same window."""
    if not fund_points or len(fund_points) < 60:
        return None, None
    navs = [v for _, v in fund_points]
    start_nav = navs[0]
    end_nav = navs[-1]
    if start_nav <= 0:
        return None, None
    fund_cagr = (mpow(end_nav / start_nav, 1 / years) - 1) * 100
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

    # Group by category for alpha computation
    by_cat = {}
    for f in funds:
        cat = f["category"]
        if cat not in by_cat:
            by_cat[cat] = []
        by_cat[cat].append(f)

    horizons = {"1Y": 1, "3Y": 3, "5Y": 5}
    updated = 0
    skipped = 0
    no_nav = 0

    for f in funds:
        code = f["code"]
        if single_fund and code != single_fund:
            continue

        nav_points = load_nav(code)
        if not nav_points:
            no_nav += 1
            continue

        for horizon_key, years in horizons.items():
            sliced = slice_nav(nav_points, years)
            if not sliced:
                # Remove stale metrics for this horizon if fund lacks sufficient history
                if horizon_key in f.get("metrics", {}):
                    del f["metrics"][horizon_key]
                skipped += 1
                continue

            metrics = compute_metrics(sliced)
            if not metrics:
                skipped += 1
                continue

            # Compute alpha (need all category peers' CAGR for same window)
            cat_funds = by_cat.get(f["category"], [])
            cat_cagrs = []
            for peer in cat_funds:
                if peer["code"] == code:
                    continue
                peer_nav = load_nav(peer["code"])
                if peer_nav:
                    peer_sliced = slice_nav(peer_nav, years)
                    if peer_sliced and len(peer_sliced) >= 60:
                        peer_navs = [v for _, v in peer_sliced]
                        if peer_navs[0] > 0:
                            peer_cagr = (mpow(peer_navs[-1] / peer_navs[0], 1 / years) - 1) * 100
                            cat_cagrs.append(peer_cagr)

            alpha, cat_median = compute_alpha(sliced, cat_cagrs + [metrics["cagr"]], years)

            # Merge into existing metrics (preserve catRank, catSize, score - those come from compute_rankings)
            if horizon_key not in f["metrics"]:
                f["metrics"][horizon_key] = {}
            existing = f["metrics"][horizon_key]
            existing["cagr"] = metrics["cagr"]
            existing["volatility"] = metrics["volatility"]
            existing["sharpe"] = metrics["sharpe"]
            existing["sortino"] = metrics["sortino"]
            existing["maxDrawdown"] = metrics["maxDrawdown"]
            existing["calmar"] = metrics["calmar"]
            if alpha is not None:
                existing["alpha"] = alpha
            if cat_median is not None:
                existing["catMedianCagr"] = cat_median
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
