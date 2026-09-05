"""
Finalize the fund universe after all pipeline scripts have run.

This is the LAST script to touch funds.json before the QA gate. It:
1. Prunes funds whose fund-data has placeholder coverage ("none") — these failed onboarding
2. Strips transient fields (holdingsMeta, holdings) from the index
3. Recomputes all derived aggregates so they match the final fund set:
   - totalFunds
   - per-fund categorySize
   - per-category fundCount
   - holdingsCoverage aggregate

Runs after: compute_metrics, compute_rankings, build_analytics, split_funds.
Runs before: smoke tests.
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
FUND_DATA_DIR = os.path.join(ROOT, "public", "fund-data")
NAV_DIR = os.path.join(ROOT, "public", "nav")
HIST_DIR = os.path.join(ROOT, "public", "holdings-history")
FUND_ANALYTICS = os.path.join(ROOT, "src", "data", "fund_analytics.json")

# Re-rank on the final universe after pruning (compute_rankings ran earlier over
# the pre-prune set, so survivors would otherwise keep stale catRank/catSize).
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from compute_rankings import recompute_rankings, update_category_metadata

# NAV-only benchmark series consumed by pipeline/detect_regimes.py. They are
# not in the fund universe and must never be swept. Keep in sync with tests/smoke.py.
BENCHMARK_CODES = {"120716", "118741", "147794", "118482"}


def get_fund_data_coverage(code):
    """Read the authoritative coverage from fund-data/{code}.json."""
    fp = os.path.join(FUND_DATA_DIR, f"{code}.json")
    if not os.path.exists(fp):
        return "missing"
    try:
        d = json.load(open(fp, encoding="utf-8"))
        return (d.get("holdingsMeta") or {}).get("coverage", "missing")
    except Exception:
        return "error"


def write_young_stub(f):
    """Write a no_disclosure fund-data stub for a newly-launched fund that AMFI
    lists but our holdings source (Groww) has not indexed yet. We never hide new
    funds: the stub gives them the honest reduced surface (NAV chart + since-
    inception return) with a clear 'holdings not yet available' note."""
    fp = os.path.join(FUND_DATA_DIR, f"{f['code']}.json")
    stub = {
        "holdingsMeta": {
            "coverage": "no_disclosure",
            "portfolioDate": None,
            "note": (
                "This is a cash-equivalent debt fund; stock-level holdings are "
                "not applicable and it is judged on cost, not portfolio."
                if f.get("isDebt")
                else "This fund is new; its monthly stock-level holdings are not "
                     "yet available from the public Groww disclosure. It will fill "
                     "in as the fund builds a track record."
            ),
            "underlying": None,
            "count": 0,
        },
        "category": f.get("category"),
        "categoryDisplay": f.get("categoryDisplay"),
        "categorySize": f.get("categorySize"),
    }
    with open(fp, "w", encoding="utf-8") as fh:
        json.dump(stub, fh, separators=(",", ":"))


def get_fund_data_aum(code):
    """Read the authoritative, correctly-dated AUM object from fund-data/{code}.json.
    The detail file's aum.asOf is the real monthly-disclosure date (portfolio
    date) and carries the previous-month trend; the index entry historically
    held a stale, mislabeled copy. Returns the aum dict or None."""
    fp = os.path.join(FUND_DATA_DIR, f"{code}.json")
    if not os.path.exists(fp):
        return None
    try:
        d = json.load(open(fp, encoding="utf-8"))
        aum = d.get("aum")
        return aum if isinstance(aum, dict) and aum.get("current") is not None else None
    except Exception:
        return None


def main():
    data = json.load(open(FUNDS_JSON, encoding="utf-8"))
    before = len(data["funds"])

    # --- Step 1: Prune funds with placeholder/missing fund-data ---
    keep = []
    pruned_codes = []
    young_stubbed = []
    for f in data["funds"]:
        cov = get_fund_data_coverage(f["code"])
        if cov in ("none", "missing", "error"):
            # Never hide funds that legitimately have no stock-level holdings:
            #  - young funds: AMFI lists them but our holdings source (Groww)
            #    has not indexed them yet.
            #  - debt funds (Liquid / Money Market): cash-equivalent books that
            #    show a reduced cost-focused surface, no holdings needed.
            # Keep them with a no_disclosure stub so they show up with an honest
            # reduced surface instead of vanishing from the universe.
            if f.get("isYoung") or f.get("isDebt"):
                write_young_stub(f)
                young_stubbed.append(f["code"])
                f.pop("holdingsMeta", None)
                f.pop("holdings", None)
                keep.append(f)
            else:
                pruned_codes.append(f["code"])
        else:
            # Strip transient fields from index (they live in fund-data)
            f.pop("holdingsMeta", None)
            f.pop("holdings", None)
            keep.append(f)

    data["funds"] = keep

    # --- Step 1b: Re-rank on the final universe ---
    # Pruning changed category membership; recompute per-horizon catRank/catSize
    # and category metadata so ranks are never stale relative to the final set.
    recompute_rankings(data)
    update_category_metadata(data)

    # --- Step 2: Recompute all derived aggregates ---
    data["totalFunds"] = len(keep)

    # Per-fund categorySize
    cat_counts = Counter(f["category"] for f in keep)
    for f in keep:
        f["categorySize"] = cat_counts[f["category"]]

    # Per-category fundCount
    cats = data.get("categories", {})
    for cat_key, cat_info in cats.items():
        cat_info["fundCount"] = cat_counts.get(cat_key, 0)

    # Sync authoritative, correctly-dated AUM from the detail files into the
    # index. The detail aum.asOf is the true monthly-disclosure date and carries
    # the month-over-month trend; the index copy was previously stale (asOf
    # stamped to the run date, trend fields dropped). Keeping them in sync fixes
    # the AUM date shown across the app and powers the AUM-shift view.
    aum_synced = 0
    aum_undated = 0
    for f in keep:
        det_aum = get_fund_data_aum(f["code"])
        if det_aum is not None:
            if f.get("aum") != det_aum:
                f["aum"] = det_aum
                aum_synced += 1
        else:
            # No detail-file AUM to date this value. The index copy (if any) was
            # stamped with the run date, which is a false disclosure date. Detail
            # files are the single source of truth for AUM dates, so keep the raw
            # size but drop the unverifiable date + trend rather than lie about it.
            idx_aum = f.get("aum")
            if isinstance(idx_aum, dict) and idx_aum.get("asOf") is not None:
                cur = idx_aum.get("current")
                if cur is not None:
                    f["aum"] = {"current": cur, "asOf": None}
                else:
                    f.pop("aum", None)
                aum_undated += 1
    if aum_synced:
        print(f"  Synced AUM from fund-data into index for {aum_synced} fund(s)")
    if aum_undated:
        print(f"  Cleared unverifiable AUM date on {aum_undated} fund(s) (no detail-file disclosure date)")

    # holdingsCoverage aggregate (from fund-data on disk)
    coverage_counts = {}
    for f in keep:
        cov = get_fund_data_coverage(f["code"])
        coverage_counts[cov] = coverage_counts.get(cov, 0) + 1
    data["holdingsCoverage"] = coverage_counts

    # --- Step 3: Clean up orphan files for pruned funds ---
    if pruned_codes:
        for code in pruned_codes:
            for d in (NAV_DIR, FUND_DATA_DIR):
                fp = os.path.join(d, f"{code}.json")
                if os.path.exists(fp):
                    os.remove(fp)

        # Update NAV manifest
        man_path = os.path.join(NAV_DIR, "_manifest.json")
        if os.path.exists(man_path):
            man = json.load(open(man_path, encoding="utf-8"))
            for code in pruned_codes:
                man.pop(str(code), None)
            json.dump(man, open(man_path, "w", encoding="utf-8"), separators=(",", ":"))

    # --- Step 3b: Self-heal orphan per-fund artifacts against final universe ---
    # These artifacts are keyed by fund code. Any key not in the final universe
    # (e.g. debt/FoF/merged funds removed in this or a past run) is a dead orphan.
    # The frontend serves everything by code-lookup, so orphans are never read;
    # we drop them so the data set matches the universe exactly.
    universe = {str(f["code"]) for f in keep}
    keep_key = universe | BENCHMARK_CODES

    # Orphan holdings-history files + manifest refresh
    if os.path.isdir(HIST_DIR):
        hist_files = 0
        total_snaps = 0
        removed_hist = 0
        for fn in os.listdir(HIST_DIR):
            if not fn.endswith(".json") or fn.startswith("_"):
                continue
            fp = os.path.join(HIST_DIR, fn)
            if fn[:-5] not in keep_key:
                os.remove(fp); removed_hist += 1; continue
            hist_files += 1
            try:
                total_snaps += len(json.load(open(fp, encoding="utf-8")).get("snapshots", {}))
            except Exception:
                pass
        json.dump({"funds": hist_files, "totalSnapshots": total_snaps},
                  open(os.path.join(HIST_DIR, "_manifest.json"), "w", encoding="utf-8"),
                  separators=(",", ":"))

        # Orphan _slugs.json keys
        slug_path = os.path.join(HIST_DIR, "_slugs.json")
        removed_slugs = 0
        if os.path.exists(slug_path):
            slugs = json.load(open(slug_path, encoding="utf-8"))
            kept = {k: v for k, v in slugs.items() if k in keep_key}
            removed_slugs = len(slugs) - len(kept)
            json.dump(kept, open(slug_path, "w", encoding="utf-8"), separators=(",", ":"))
        print(f"  Holdings-history: -{removed_hist} orphan files, -{removed_slugs} orphan slugs "
              f"({hist_files} files, {total_snaps} snapshots remain)")

    # Orphan fund_analytics.json keys (build intermediate, keyed by code)
    if os.path.exists(FUND_ANALYTICS):
        fa = json.load(open(FUND_ANALYTICS, encoding="utf-8"))
        if isinstance(fa, dict):
            kept = {k: v for k, v in fa.items() if k in keep_key}
            removed_fa = len(fa) - len(kept)
            json.dump(kept, open(FUND_ANALYTICS, "w", encoding="utf-8"), separators=(",", ":"))
            print(f"  fund_analytics.json: -{removed_fa} orphan entries ({len(kept)} remain)")

    # --- Step 4: Write final funds.json ---
    with open(FUNDS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))

    if young_stubbed:
        print(f"  Kept {len(young_stubbed)} new fund(s) with no_disclosure stub (no holdings yet): {young_stubbed[:10]}{'...' if len(young_stubbed) > 10 else ''}")
    print(f"Finalize: {before} -> {len(keep)} funds ({len(pruned_codes)} pruned)")
    if pruned_codes:
        print(f"  Removed: {pruned_codes[:10]}{'...' if len(pruned_codes) > 10 else ''}")
    else:
        print("  Nothing to prune (all funds have real holdings data)")


if __name__ == "__main__":
    main()
