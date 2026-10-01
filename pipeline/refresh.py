"""Refresh source data and rebuild a coherent, checked publication snapshot.

Daily mode appends NAV. Monthly mode also refreshes regimes, fund discovery,
managers and holdings. --analytics-only rebuilds all derived dependencies from
cached NAV; --holdings-only captures holdings before rebuilding. Every mode
fails immediately when a required step fails. No commit or deployment is made.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

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
    subprocess.run(cmd, cwd=str(ROOT), check=True)


def rebuild_derived():
    for relative, args in (
        ("pipeline/compute_metrics.py", []),
        ("pipeline/compute_rankings.py", []),
        ("scripts/build_analytics.py", []),
        ("migrations/split-analytics/split_funds.py", []),
        ("scripts/quarantine_nav.py", ["--apply"]),
        ("scripts/sync_analytics_to_shells.py", []),
        ("scripts/build_rolling_alpha.py", []),
        ("scripts/build_category_median.py", []),
        ("scripts/quarantine_nav.py", ["--check"]),
        ("scripts/sync_analytics_to_shells.py", ["--check"]),
        ("tests/smoke.py", []),
    ):
        run_script(ROOT / relative, args=args)


def daily_refresh():
    run_script(SCRIPTS_DIR / "update_nav_daily.py", description="Update daily NAV")
    rebuild_derived()


def monthly_refresh():
    run_script(PIPELINE_DIR / "detect_regimes.py", description="Detect market regimes")
    run_script(PIPELINE_DIR / "discover_new_funds.py", description="Discover new funds & lifecycle detection")
    run_script(SCRIPTS_DIR / "sync_nav_files.py", description="Sync NAV files")
    run_script(SCRIPTS_DIR / "fetch_managers.py", args=["--refresh-all"], description="Refresh fund managers")
    run_script(SCRIPTS_DIR / "capture_holdings_snapshot.py", description="Capture holdings snapshot")
    run_script(SCRIPTS_DIR / "enrich_fund_data.py", description="Refresh disclosed AUM and expense ratio")
    run_script(SCRIPTS_DIR / "build_aum_index.py", description="Build AUM index")
    daily_refresh()


def analytics_only():
    run_script(PIPELINE_DIR / "detect_regimes.py", description="Detect market regimes")
    rebuild_derived()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Refresh FairFund data")
    parser.add_argument("--monthly", "--full", action="store_true",
                        help="Full monthly rebuild (regimes, managers, holdings, analytics)")
    parser.add_argument("--add-fund", type=int, help="Add a single new fund by AMFI code")
    parser.add_argument("--analytics-only", action="store_true",
                        help="Rebuild metrics, rankings and analytics from cached NAV")
    parser.add_argument("--holdings-only", action="store_true",
                        help="Only refresh holdings")
    args = parser.parse_args(argv)

    # Load existing data
    funds_path = DATA_DIR / "funds.json"
    with open(funds_path, encoding="utf-8") as f:
        data = json.load(f)

    print(f"FairFund Pipeline | {len(data['funds'])} funds | anchor: {data.get('anchor', '?')}")

    if args.analytics_only:
        analytics_only()
    elif args.add_fund:
        print(f"Adding fund {args.add_fund}...")
        # Import inline to avoid circular deps
        sys.path.insert(0, str(PIPELINE_DIR))
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
        rebuild_derived()
        print("Run --monthly to integrate a newly discovered fund into the universe.")
    elif args.holdings_only:
        run_script(SCRIPTS_DIR / "capture_holdings_snapshot.py",
                   description="Capture holdings snapshot")
        run_script(SCRIPTS_DIR / "enrich_fund_data.py", description="Refresh disclosed AUM and expense ratio")
        rebuild_derived()
    elif args.monthly:
        monthly_refresh()
    else:
        daily_refresh()

    # Producers own the snapshot and validated dates; never write the pre-run copy.
    with open(funds_path, encoding="utf-8") as f:
        refreshed = json.load(f)
    print(f"\nDone. Validated {len(refreshed['funds'])} funds | anchor: {refreshed.get('anchor', '?')}")


if __name__ == "__main__":
    main()
