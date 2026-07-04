"""
Sync fund-data detail files after metrics/rankings update.

Since funds.json is already the lightweight index (no holdings/management),
this script only UPDATES category/size fields in existing fund-data files
and creates placeholder files for any new funds that don't have one yet.

It does NOT overwrite existing rich data (analytics, holdings, management, stockMoves).
"""

import json
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent.parent  # repo root
FUNDS_SRC = PROJECT / "src" / "data" / "funds.json"
DETAIL_DIR = PROJECT / "public" / "fund-data"


def main():
    with open(FUNDS_SRC, "r", encoding="utf-8") as f:
        data = json.load(f)

    DETAIL_DIR.mkdir(parents=True, exist_ok=True)

    # Build category sizes
    cat_counts = {}
    for fund in data["funds"]:
        cat = fund["category"]
        cat_counts[cat] = cat_counts.get(cat, 0) + 1

    coverage_counts = {}

    updated = 0
    created = 0

    for fund in data["funds"]:
        code = fund["code"]
        out_path = DETAIL_DIR / f"{code}.json"

        if out_path.exists():
            # Update category/size fields in existing file (preserve all other data)
            with open(out_path, "r", encoding="utf-8") as f:
                detail = json.load(f)
            cov = (detail.get("holdingsMeta") or {}).get("coverage", "none")
            coverage_counts[cov] = coverage_counts.get(cov, 0) + 1
            changed = False
            if detail.get("category") != fund["category"]:
                detail["category"] = fund["category"]
                changed = True
            if detail.get("categoryDisplay") != fund.get("categoryDisplay"):
                detail["categoryDisplay"] = fund.get("categoryDisplay", "")
                changed = True
            new_size = cat_counts.get(fund["category"], 0)
            if detail.get("categorySize") != new_size:
                detail["categorySize"] = new_size
                changed = True
            if changed:
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(detail, f, separators=(",", ":"), ensure_ascii=False)
                updated += 1
        else:
            # Create placeholder for new funds
            detail = {
                "holdingsMeta": {"coverage": "none", "portfolioDate": None, "note": "Holdings not yet captured", "underlying": None, "count": 0},
                "analytics": {
                    "rankTrajectory": fund.get("analytics", {}).get("rankTrajectory", {"direction": "new", "currentRank": 0, "currentPeers": 0, "limited": True}),
                    "battingAverage": fund.get("analytics", {}).get("battingAverage", {"pct": 0, "n": 0, "windowM": 36, "limited": True}),
                    "capture": None,
                    "alpha": None,
                    "meanReversion": None,
                    "regimes": None,
                },
                "management": {"available": False, "managers": [], "leadManager": None, "avgTenureYears": None, "trackRecord": None, "signal": None, "tenureCaveat": None, "tenurePerf": None, "holdingsMoves": None, "note": "Manager data not yet fetched"},
                "holdings": [],
                "stockMoves": None,
                "category": fund["category"],
                "categoryDisplay": fund.get("categoryDisplay", ""),
                "categorySize": cat_counts.get(fund["category"], 0),
            }
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, separators=(",", ":"), ensure_ascii=False)
            coverage_counts["none"] = coverage_counts.get("none", 0) + 1
            created += 1

    # Clean up fund-data files for funds no longer in index
    index_codes = {str(f["code"]) for f in data["funds"]}
    removed = 0
    for fpath in DETAIL_DIR.glob("*.json"):
        if fpath.stem not in index_codes:
            fpath.unlink()
            removed += 1

    # Keep funds.json's holdingsCoverage aggregate accurate (used by the QA gate;
    # every fund maps to exactly one coverage bucket, so the sum == totalFunds).
    if data.get("holdingsCoverage") != coverage_counts:
        data["holdingsCoverage"] = coverage_counts
        with open(FUNDS_SRC, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        print(f"Updated holdingsCoverage aggregate: {coverage_counts}")

    print(f"Fund-data sync: {updated} updated, {created} created, {removed} removed")
    print(f"Total: {len(list(DETAIL_DIR.glob('*.json')))} files")


if __name__ == "__main__":
    main()
