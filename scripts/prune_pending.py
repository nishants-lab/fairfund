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
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
FUND_DATA_DIR = os.path.join(ROOT, "public", "fund-data")
NAV_DIR = os.path.join(ROOT, "public", "nav")


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


def main():
    data = json.load(open(FUNDS_JSON, encoding="utf-8"))
    before = len(data["funds"])

    # --- Step 1: Prune funds with placeholder/missing fund-data ---
    keep = []
    pruned_codes = []
    for f in data["funds"]:
        cov = get_fund_data_coverage(f["code"])
        if cov in ("none", "missing", "error"):
            pruned_codes.append(f["code"])
        else:
            # Strip transient fields from index (they live in fund-data)
            f.pop("holdingsMeta", None)
            f.pop("holdings", None)
            keep.append(f)

    data["funds"] = keep

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

    # --- Step 4: Write final funds.json ---
    with open(FUNDS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))

    print(f"Finalize: {before} -> {len(keep)} funds ({len(pruned_codes)} pruned)")
    if pruned_codes:
        print(f"  Removed: {pruned_codes[:10]}{'...' if len(pruned_codes) > 10 else ''}")
    else:
        print("  Nothing to prune (all funds have real holdings data)")


if __name__ == "__main__":
    main()
