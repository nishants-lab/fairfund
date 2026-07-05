"""
FairFund Pipeline: Refresh rankings and NAV data.

Called by GitHub Actions. Supports daily and monthly modes:

DAILY (weekday evenings):
  1. Fetch latest NAV for all tracked funds
  2. Recompute 1Y/3Y/5Y metrics and cross-category rankings
  3. Write updated funds.json

MONTHLY (1st of month):
  1. Detect market regimes from Nifty 50 data
  2. Discover new funds + detect closed/merged/renamed
  3. Refresh fund managers
  4. Capture holdings snapshot
  5. Rebuild forward-looking analytics (regimes, rank trajectory, etc.)
  6. Full daily refresh (NAV + metrics + rankings)

Usage:
  python pipeline/refresh.py                # daily refresh
  python pipeline/refresh.py --monthly      # full monthly rebuild
  python pipeline/refresh.py --full         # same as monthly
  python pipeline/refresh.py --add-fund CODE
  python pipeline/refresh.py --analytics-only
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from datetime import date

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "src" / "data"
NAV_DIR = ROOT / "public" / "nav"
SCRIPTS_DIR = ROOT / "scripts"
PIPELINE_DIR = ROOT / "pipeline"


def run_script(script_path, args=None, description=None):
    """Run a Python script as a subprocess, printing output."""
    cmd = [sys.executable, str(script_path)] + (args or [])
    desc = description or script_path.name
    print(f"\n{'='*60}")
    print(f"  Running: {desc}")
    print(f"  Command: {' '.join(cmd)}")
    print(f"{'='*60}")
    result = subprocess.run(cmd, cwd=str(ROOT), capture_output=False)
    if result.returncode != 0:
        print(f"  WARNING: {desc} exited with code {result.returncode}")
    return result.returncode == 0


def daily_refresh(data):
    """Daily: fetch NAV, recompute metrics, recompute rankings."""
    print("\n--- Daily Refresh ---")

    # Step 1: Update NAV (append today's NAV to each fund file)
    run_script(SCRIPTS_DIR / "update_nav_daily.py", description="Update daily NAV")

    # Step 2: Recompute metrics
    run_script(PIPELINE_DIR / "compute_metrics.py", description="Recompute metrics")

    # Step 3: Recompute rankings
    run_script(PIPELINE_DIR / "compute_rankings.py", description="Recompute rankings")

    # Update timestamp
    data["anchor"] = date.today().isoformat()
    data["generatedAt"] = date.today().isoformat()


def monthly_refresh(data):
    """Monthly: regimes + lifecycle + managers + holdings + analytics + daily."""
    print("\n--- Monthly Refresh ---")

    # Step 1: Detect/update market regimes
    run_script(PIPELINE_DIR / "detect_regimes.py", description="Detect market regimes")

    # Step 2: Discover new funds + lifecycle (closed/merged/renamed)
    run_script(
        PIPELINE_DIR / "discover_new_funds.py",
        description="Discover new funds & lifecycle detection"
    )

    # Step 3: Sync NAV files (ensure new funds have NAV)
    run_script(SCRIPTS_DIR / "sync_nav_files.py", description="Sync NAV files")

    # Step 4: Refresh fund managers
    run_script(
        SCRIPTS_DIR / "fetch_managers.py",
        args=["--refresh-all"],
        description="Refresh fund managers"
    )

    # Step 5: Capture holdings snapshot
    run_script(
        SCRIPTS_DIR / "capture_holdings_snapshot.py",
        description="Capture holdings snapshot"
    )

    # Step 6: Rebuild forward-looking analytics
    run_script(
        SCRIPTS_DIR / "build_analytics.py",
        description="Build forward-looking analytics"
    )

    # Step 6b: Rolling alpha series (line behind the batting-average stat)
    run_script(
        SCRIPTS_DIR / "build_rolling_alpha.py",
        description="Build rolling alpha series"
    )

    # Step 6c: AUM index for the Fund Landscape scatter
    run_script(
        SCRIPTS_DIR / "build_aum_index.py",
        description="Build AUM index"
    )

    # Step 7: Regular daily refresh (metrics + rankings)
    daily_refresh(data)


def analytics_only():
    """Just rebuild analytics (after regime changes, etc.)."""
    print("\n--- Analytics Only ---")
    run_script(PIPELINE_DIR / "detect_regimes.py", description="Detect market regimes")
    run_script(SCRIPTS_DIR / "build_analytics.py", description="Build forward-looking analytics")
    run_script(SCRIPTS_DIR / "build_rolling_alpha.py", description="Build rolling alpha series")


def main():
    parser = argparse.ArgumentParser(description="Refresh FairFund data")
    parser.add_argument("--monthly", "--full", action="store_true",
                        help="Full monthly rebuild (regimes, managers, holdings, analytics)")
    parser.add_argument("--add-fund", type=int, help="Add a single new fund by AMFI code")
    parser.add_argument("--analytics-only", action="store_true",
                        help="Only rebuild analytics (regimes + forward signals)")
    parser.add_argument("--holdings-only", action="store_true",
                        help="Only refresh holdings")
    args = parser.parse_args()

    # Load existing data
    funds_path = DATA_DIR / "funds.json"
    with open(funds_path) as f:
        data = json.load(f)

    print(f"FairFund Pipeline | {len(data['funds'])} funds | anchor: {data.get('anchor', '?')}")

    if args.analytics_only:
        analytics_only()
    elif args.add_fund:
        print(f"Adding fund {args.add_fund}...")
        # Import inline to avoid circular deps
        sys.path.insert(0, str(PIPELINE_DIR))
        from compute_metrics import compute_fund_metrics_from_nav
        from discover_new_funds import fetch_nav_history, map_amfi_category, fetch_amfi_universe

        amfi = fetch_amfi_universe()
        if args.add_fund not in amfi:
            print(f"ERROR: Code {args.add_fund} not found in AMFI")
            sys.exit(1)
        scheme = amfi[args.add_fund]
        dates, navs = fetch_nav_history(args.add_fund)
        if not dates:
            print("ERROR: Could not fetch NAV")
            sys.exit(1)
        # Write NAV
        nav_file = {"d": dates, "v": navs, "u": dates[-1]}
        nav_path = NAV_DIR / f"{args.add_fund}.json"
        with open(nav_path, "w") as f:
            json.dump(nav_file, f, separators=(",", ":"))
        cat = map_amfi_category(scheme["amfi_category"])
        print(f"Added NAV ({len(dates)} points), category: {cat}")
        print("Run --monthly to fully integrate.")
    elif args.holdings_only:
        run_script(SCRIPTS_DIR / "capture_holdings_snapshot.py",
                   description="Capture holdings snapshot")
    elif args.monthly:
        monthly_refresh(data)
    else:
        daily_refresh(data)

    # Write back
    with open(funds_path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"\nDone. Wrote {funds_path}")


if __name__ == "__main__":
    main()
