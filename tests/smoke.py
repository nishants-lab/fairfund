"""
Smoke test: the single data-integrity gate for FairFund.

Runs in CI before every commit/deploy (daily, monthly, weekly, and discovery
workflows) and locally. Exit 0 = pass, 1 = failures found.

Each recurring bug class we have hit has a dedicated guard here:
  - debt/fixed-income funds leaking into the equity universe  -> test_no_debt_funds
  - broken ranks ("Ranked 46 of 45")                          -> test_rank_sanity
  - stale counts (totalFunds/fundCount/categorySize/coverage) -> test_count_consistency
  - orphan NAV/fund-data files after removals                 -> test_file_bijection
  - holdings-history corruption                               -> test_holdings_history

Usage: python tests/smoke.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

# NAV files that may exist without being in the fund index: regime benchmarks
# used by pipeline/detect_regimes.py. Keep in sync with that module.
BENCHMARK_CODES = {"120716", "118741", "147794", "118482"}

errors = []


def check(condition, msg):
    if not condition:
        errors.append(msg)
        print(f"  FAIL: {msg}")
    return condition


def load_funds():
    return json.load(open(os.path.join(ROOT, "src", "data", "funds.json"), encoding="utf-8"))


def test_imports():
    print("1. Testing imports...")
    scripts = [
        "pipeline/config.py", "pipeline/compute_metrics.py", "pipeline/compute_rankings.py",
        "pipeline/discover_new_funds.py", "scripts/update_nav_daily.py",
        "scripts/capture_holdings_snapshot.py", "scripts/enrich_fund_data.py",
        "scripts/add_holdings_change.py", "scripts/build_stock_moves.py",
        "scripts/onboard_new_funds.py",
    ]
    for script in scripts:
        path = os.path.join(ROOT, script)
        if not os.path.exists(path):
            check(False, f"{script} not found"); continue
        try:
            compile(open(path, encoding="utf-8").read(), path, "exec")
        except SyntaxError as e:
            check(False, f"{script} has syntax error: {e}")
    print(f"  {len(scripts)} scripts checked")


def test_funds_json():
    print("2. Testing funds.json structure...")
    data = load_funds()
    check("funds" in data and isinstance(data.get("funds"), list), "funds.json 'funds' missing/not a list")
    funds = data["funds"]
    check(len(funds) > 700, f"funds.json has only {len(funds)} funds (expected >700)")
    required = {"code", "name", "category"}
    missing = [f.get("code", "?") for f in funds if not required <= set(f)]
    check(not missing, f"{len(missing)} funds missing required fields: {missing[:5]}")
    codes = [f["code"] for f in funds]
    check(len(codes) == len(set(codes)), f"Duplicate codes ({len(codes)} vs {len(set(codes))} unique)")
    with_verdict = [f["code"] for f in funds if "verdict" in f]
    check(not with_verdict, f"{len(with_verdict)} funds carry a dead 'verdict' field: {with_verdict[:5]}")
    print(f"  {len(funds)} funds validated")


def test_no_debt_funds():
    print("3. Testing no debt funds in universe...")
    try:
        from config import is_excluded_by_name
    except ImportError as e:
        check(False, f"config.is_excluded_by_name import failed: {e}"); return
    funds = load_funds()["funds"]
    debt = [(f["code"], f["name"]) for f in funds if is_excluded_by_name(f["name"])]
    check(not debt, f"{len(debt)} debt/fixed-income funds in universe: {debt[:3]}")
    print(f"  0 debt funds (scanned {len(funds)})")


def test_no_pending_funds():
    print("3b. Testing no placeholder/pending funds remain...")
    funds = load_funds()["funds"]
    # Check funds.json holdingsMeta (transient field from discover; should be stripped)
    pending_idx = [f["code"] for f in funds
                   if (f.get("holdingsMeta") or {}).get("coverage") == "pending"]
    check(not pending_idx, f"{len(pending_idx)} funds still coverage:pending in index: {pending_idx[:5]}")
    # Check authoritative fund-data coverage (must not be placeholder "none")
    fd_dir = os.path.join(ROOT, "public", "fund-data")
    bad_fd = []
    for f in funds:
        fp = os.path.join(fd_dir, f"{f['code']}.json")
        if os.path.exists(fp):
            detail = json.load(open(fp, encoding="utf-8"))
            cov = (detail.get("holdingsMeta") or {}).get("coverage")
            if cov in ("none", None):
                bad_fd.append(f["code"])
    check(not bad_fd, f"{len(bad_fd)} funds with placeholder fund-data (failed onboarding): {bad_fd[:5]}")
    print(f"  0 pending/placeholder funds")


def test_count_consistency():
    print("4. Testing count consistency...")
    from collections import Counter
    data = load_funds()
    funds = data["funds"]
    n = len(funds)
    check(data.get("totalFunds") == n, f"totalFunds {data.get('totalFunds')} != {n}")
    actual = Counter(f["category"] for f in funds)
    size_bad = [f["code"] for f in funds if f.get("categorySize") != actual[f["category"]]]
    check(not size_bad, f"{len(size_bad)} funds have wrong categorySize: {size_bad[:5]}")
    cats = data.get("categories", {})
    fc_bad = [c for c, info in cats.items() if info.get("fundCount") != actual.get(c, 0)]
    check(not fc_bad, f"category fundCount mismatch: {fc_bad[:5]}")
    fc_sum = sum(info.get("fundCount", 0) for info in cats.values())
    check(fc_sum == n, f"sum of category fundCounts {fc_sum} != totalFunds {n}")
    hc = data.get("holdingsCoverage")
    if hc:
        check(sum(hc.values()) == n, f"holdingsCoverage sums to {sum(hc.values())} != {n}")
    print(f"  counts agree across {len(cats)} categories, {n} funds")


def test_rank_sanity():
    print("5. Testing rank sanity...")
    from collections import defaultdict
    funds = load_funds()["funds"]
    by_ch = defaultdict(list)
    for f in funds:
        for horizon, m in (f.get("metrics") or {}).items():
            if not isinstance(m, dict) or m.get("catRank") is None:
                continue
            by_ch[(f["category"], horizon)].append((f["code"], m["catRank"], m.get("catSize")))
    bad = []
    for (cat, horizon), rows in by_ch.items():
        size = len(rows)
        ranks = [r for _, r, _ in rows]
        for code, rank, csize in rows:
            if not (1 <= rank <= size):
                bad.append(f"{code} {cat}/{horizon}: rank {rank} of {size}")
            if csize != size:
                bad.append(f"{code} {cat}/{horizon}: catSize {csize} != {size}")
        if len(set(ranks)) != len(ranks):
            bad.append(f"{cat}/{horizon}: duplicate ranks")
    check(not bad, f"{len(bad)} rank issues: {bad[:3]}")
    print(f"  ranks valid across {len(by_ch)} category-horizon groups")


def test_slugs_json():
    print("6. Testing _slugs.json...")
    path = os.path.join(ROOT, "public", "holdings-history", "_slugs.json")
    if not check(os.path.exists(path), "_slugs.json not found"):
        return
    slugs = json.load(open(path, encoding="utf-8"))
    check(isinstance(slugs, dict), "_slugs.json is not a dict")
    check(len(slugs) > 700, f"_slugs.json has only {len(slugs)} entries (expected >700)")
    empty = [k for k, v in slugs.items() if not v or not isinstance(v, str)]
    check(not empty, f"_slugs.json has {len(empty)} empty/invalid values: {empty[:5]}")
    print(f"  {len(slugs)} slugs validated")


def test_fund_data_coverage():
    print("7. Testing fund-data coverage labels...")
    detail_dir = os.path.join(ROOT, "public", "fund-data")
    if not check(os.path.isdir(detail_dir), "public/fund-data/ not found"):
        return
    valid = {"stock_level", "feeder_unresolved", "fof_level", "no_disclosure",
             "pending", "none", "unresolved", "feeder_domestic", "feeder_foreign",
             "lookthrough_domestic", "lookthrough_etf"}
    files = [f for f in os.listdir(detail_dir) if f.endswith(".json")]
    bad = []
    for fn in files:
        try:
            detail = json.load(open(os.path.join(detail_dir, fn), encoding="utf-8"))
        except json.JSONDecodeError:
            bad.append(f"{fn}: invalid JSON"); continue
        if "holdingsMeta" not in detail:
            bad.append(f"{fn}: no holdingsMeta"); continue
        cov = detail["holdingsMeta"].get("coverage")
        if cov not in valid:
            bad.append(f"{fn}: coverage {cov}")
    check(not bad, f"{len(bad)} fund-data coverage issues: {bad[:3]}")
    print(f"  {len(files)} fund-data files validated")


def test_file_bijection():
    print("8. Testing file<->index bijection...")
    index = {str(f["code"]) for f in load_funds()["funds"]}
    nav_dir = os.path.join(ROOT, "public", "nav")
    nav = {fn[:-5] for fn in os.listdir(nav_dir) if fn.endswith(".json") and fn != "_manifest.json"}
    check(not (index - nav), f"{len(index - nav)} funds missing NAV: {list(index - nav)[:5]}")
    orphan_nav = nav - index - BENCHMARK_CODES
    check(not orphan_nav, f"{len(orphan_nav)} orphan NAV files: {list(orphan_nav)[:5]}")
    detail_dir = os.path.join(ROOT, "public", "fund-data")
    fd = {fn[:-5] for fn in os.listdir(detail_dir) if fn.endswith(".json")}
    check(not (index - fd), f"{len(index - fd)} funds missing fund-data: {list(index - fd)[:5]}")
    check(not (fd - index), f"{len(fd - index)} orphan fund-data files: {list(fd - index)[:5]}")
    man_path = os.path.join(nav_dir, "_manifest.json")
    if os.path.exists(man_path):
        man = set(json.load(open(man_path, encoding="utf-8")).keys())
        check(not (man - nav), f"{len(man - nav)} manifest entries without NAV: {list(man - nav)[:5]}")
    print(f"  {len(index)} funds <-> {len(nav)} NAV <-> {len(fd)} fund-data (clean)")


def test_holdings_history():
    print("9. Testing holdings-history...")
    hist_dir = os.path.join(ROOT, "public", "holdings-history")
    if not os.path.isdir(hist_dir):
        print("  (no holdings-history dir; skipped)"); return
    known_cov = {"stock_level", "feeder_unresolved", "fof_level", "no_disclosure"}
    files = [f for f in os.listdir(hist_dir) if f.endswith(".json") and not f.startswith("_")]
    bad = []
    total_snaps = 0
    for fn in files:
        try:
            rec = json.load(open(os.path.join(hist_dir, fn), encoding="utf-8"))
        except Exception as e:
            bad.append(f"{fn}: unreadable {str(e)[:20]}"); continue
        if rec.get("code") is None or "snapshots" not in rec:
            bad.append(f"{fn}: missing code/snapshots"); continue
        for pd, snap in rec["snapshots"].items():
            total_snaps += 1
            if snap.get("portfolioDate") != pd:
                bad.append(f"{fn}: key!=portfolioDate {pd}")
            if snap.get("coverage") not in known_cov:
                bad.append(f"{fn}: coverage {snap.get('coverage')}")
            hs = snap.get("holdings") or []
            if not hs:
                bad.append(f"{fn}: empty holdings {pd}"); continue
            s = 0.0
            broke = False
            for h in hs:
                p = h.get("pct")
                # small negatives are legit accounting line items (e.g. "Net Payables")
                if p is None or not (-20 <= p <= 100.5):
                    bad.append(f"{fn}: pct {p}"); broke = True; break
                s += p
            if not broke and snap.get("coverage") == "stock_level" and s > 115:
                bad.append(f"{fn}: pct sum {round(s, 1)}")
    check(not bad, f"{len(bad)} holdings-history issues: {bad[:3]}")
    man_path = os.path.join(hist_dir, "_manifest.json")
    if os.path.exists(man_path):
        man = json.load(open(man_path, encoding="utf-8"))
        check(man.get("funds") == len(files) and man.get("totalSnapshots") == total_snaps,
              f"history manifest funds={man.get('funds')}/{len(files)} snaps={man.get('totalSnapshots')}/{total_snaps}")
    print(f"  {len(files)} history files, {total_snaps} snapshots validated")


def test_config():
    print("10. Testing pipeline/config.py...")
    try:
        from config import (ELIGIBLE_AMFI_CATEGORIES, map_amfi_category,
                            MIN_NAV_POINTS, is_excluded_by_name)
        check(len(ELIGIBLE_AMFI_CATEGORIES) >= 14, f"Only {len(ELIGIBLE_AMFI_CATEGORIES)} categories")
        check(MIN_NAV_POINTS > 0, "MIN_NAV_POINTS not set")
        check(map_amfi_category("Large Cap Fund") == "Large Cap", "map_amfi_category broken")
        check(is_excluded_by_name("SBI CPSE Bond Plus SDL Sep 2026 Index Fund"), "debt guard not catching bond fund")
        check(not is_excluded_by_name("Parag Parikh Flexi Cap Fund"), "debt guard false-positive on equity fund")
    except ImportError as e:
        check(False, f"config.py import failed: {e}")


if __name__ == "__main__":
    print("=" * 52)
    print("FairFund Smoke Test")
    print("=" * 52)
    print()
    test_imports()
    test_funds_json()
    test_no_debt_funds()
    test_no_pending_funds()
    test_count_consistency()
    test_rank_sanity()
    test_slugs_json()
    test_fund_data_coverage()
    test_file_bijection()
    test_holdings_history()
    test_config()
    print()
    print("=" * 52)
    if errors:
        print(f"FAILED: {len(errors)} error(s)")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print("ALL PASSED")
    sys.exit(0)
