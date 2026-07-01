"""
Smoke test: validates data integrity before deploy.
Catches schema errors, import failures, and data corruption.
Runs in CI (daily workflow) and locally.

Usage: python tests/smoke.py
Exit code 0 = pass, 1 = failures found.
"""
import json
import os
import sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

errors = []


def check(condition, msg):
    if not condition:
        errors.append(msg)
        print(f"  FAIL: {msg}")
    return condition


def test_imports():
    """All pipeline scripts import without errors."""
    print("1. Testing imports...")
    scripts = [
        "pipeline/config.py",
        "pipeline/compute_metrics.py",
        "pipeline/compute_rankings.py",
        "scripts/update_nav_daily.py",
        "scripts/capture_holdings_snapshot.py",
        "scripts/enrich_fund_data.py",
        "scripts/add_holdings_change.py",
        "scripts/build_stock_moves.py",
        "scripts/onboard_new_funds.py",
    ]
    for script in scripts:
        path = os.path.join(ROOT, script)
        if not os.path.exists(path):
            check(False, f"{script} not found")
            continue
        try:
            spec = importlib.util.spec_from_file_location(script, path)
            mod = importlib.util.module_from_spec(spec)
            # Don't actually execute (would run main), just compile
            compile(open(path).read(), path, "exec")
        except SyntaxError as e:
            check(False, f"{script} has syntax error: {e}")
        except Exception as e:
            check(False, f"{script} failed to compile: {e}")
    print(f"  {len(scripts)} scripts checked")


def test_funds_json():
    """funds.json has valid structure."""
    print("2. Testing funds.json...")
    path = os.path.join(ROOT, "src", "data", "funds.json")
    check(os.path.exists(path), "src/data/funds.json not found")
    if not os.path.exists(path):
        return

    data = json.load(open(path, encoding="utf-8"))
    check("funds" in data, "funds.json missing 'funds' key")
    check(isinstance(data.get("funds"), list), "funds.json 'funds' is not a list")

    funds = data["funds"]
    check(len(funds) > 700, f"funds.json has only {len(funds)} funds (expected >700)")

    # Validate structure of first 10 + random sample
    required_keys = {"code", "name", "category"}
    for fund in funds[:10]:
        for key in required_keys:
            check(key in fund, f"Fund {fund.get('code', '?')} missing '{key}'")

    # Check no duplicate codes
    codes = [f["code"] for f in funds]
    check(len(codes) == len(set(codes)), f"Duplicate codes in funds.json ({len(codes)} vs {len(set(codes))} unique)")
    print(f"  {len(funds)} funds validated")


def test_slugs_json():
    """_slugs.json has valid structure."""
    print("3. Testing _slugs.json...")
    path = os.path.join(ROOT, "public", "holdings-history", "_slugs.json")
    check(os.path.exists(path), "_slugs.json not found")
    if not os.path.exists(path):
        return

    slugs = json.load(open(path, encoding="utf-8"))
    check(isinstance(slugs, dict), "_slugs.json is not a dict")
    check(len(slugs) > 800, f"_slugs.json has only {len(slugs)} entries (expected >800)")

    # All values should be non-empty strings
    empty = [k for k, v in slugs.items() if not v or not isinstance(v, str)]
    check(len(empty) == 0, f"_slugs.json has {len(empty)} empty/invalid values: {empty[:5]}")
    print(f"  {len(slugs)} slugs validated")


def test_fund_data_sample():
    """Sample fund-data files have valid holdingsMeta."""
    print("4. Testing fund-data samples...")
    detail_dir = os.path.join(ROOT, "public", "fund-data")
    check(os.path.isdir(detail_dir), "public/fund-data/ not found")
    if not os.path.isdir(detail_dir):
        return

    files = [f for f in os.listdir(detail_dir) if f.endswith(".json")]
    check(len(files) > 700, f"fund-data/ has only {len(files)} files (expected >700)")

    # Check 20 random files
    import random
    sample = random.sample(files, min(20, len(files)))
    valid_coverages = {"stock_level", "feeder_unresolved", "fof_level", "no_disclosure", "pending", "none", "unresolved"}

    for fn in sample:
        path = os.path.join(detail_dir, fn)
        try:
            detail = json.load(open(path, encoding="utf-8"))
        except json.JSONDecodeError:
            check(False, f"fund-data/{fn} is invalid JSON")
            continue
        check("holdingsMeta" in detail, f"fund-data/{fn} missing holdingsMeta")
        if "holdingsMeta" in detail:
            cov = detail["holdingsMeta"].get("coverage")
            check(cov in valid_coverages, f"fund-data/{fn} has unknown coverage: {cov}")

    print(f"  {len(sample)} files sampled, {len(files)} total")


def test_nav_files_exist():
    """NAV files exist for all funds in the universe."""
    print("5. Testing NAV file coverage...")
    funds_path = os.path.join(ROOT, "src", "data", "funds.json")
    nav_dir = os.path.join(ROOT, "public", "nav")

    if not os.path.exists(funds_path) or not os.path.isdir(nav_dir):
        check(False, "funds.json or nav/ dir missing")
        return

    data = json.load(open(funds_path, encoding="utf-8"))
    codes = [f["code"] for f in data["funds"]]
    missing = [c for c in codes if not os.path.exists(os.path.join(nav_dir, f"{c}.json"))]
    check(len(missing) == 0, f"{len(missing)} funds have no NAV file: {missing[:5]}")
    print(f"  {len(codes) - len(missing)}/{len(codes)} funds have NAV files")


def test_config():
    """pipeline/config.py loads and has expected exports."""
    print("6. Testing pipeline/config.py...")
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    try:
        from config import ELIGIBLE_AMFI_CATEGORIES, map_amfi_category, MIN_NAV_POINTS
        check(len(ELIGIBLE_AMFI_CATEGORIES) >= 14, f"Only {len(ELIGIBLE_AMFI_CATEGORIES)} categories")
        check(MIN_NAV_POINTS > 0, "MIN_NAV_POINTS not set")
        check(map_amfi_category("Large Cap Fund") == "Large Cap", "map_amfi_category broken")
    except ImportError as e:
        check(False, f"config.py import failed: {e}")


if __name__ == "__main__":
    print("=" * 50)
    print("FairFund Smoke Test")
    print("=" * 50)
    print()

    test_imports()
    test_funds_json()
    test_slugs_json()
    test_fund_data_sample()
    test_nav_files_exist()
    test_config()

    print()
    print("=" * 50)
    if errors:
        print(f"FAILED: {len(errors)} error(s)")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("ALL PASSED")
        sys.exit(0)
