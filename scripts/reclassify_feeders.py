"""Re-apply holdings_class.fund_of_funds_coverage to stored portfolios.

One-off repair for funds captured before the shared rule knew Groww's
"Foreign Mutual Funds" instrument, and safe to re-run: it only moves a
portfolio from stock_level to a fund-of-funds coverage, never the other way.

Usage: python scripts/reclassify_feeders.py [--dry-run]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from holdings_class import fund_of_funds_coverage, underlying_name  # noqa: E402

HISTORY_DIR = os.path.join(ROOT, "public", "holdings-history")
DETAIL_DIR = os.path.join(ROOT, "public", "fund-data")
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save(path, data):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)


def main(dry_run=False):
    snaps_fixed, details_fixed = 0, []
    for name in sorted(os.listdir(HISTORY_DIR)):
        if not name.endswith(".json") or name.startswith("_"):
            continue
        path = os.path.join(HISTORY_DIR, name)
        hist = load(path)
        changed = False
        for snap in (hist.get("snapshots") or {}).values():
            cov = fund_of_funds_coverage(snap.get("holdings") or [])
            if cov and snap.get("coverage") == "stock_level":
                snap["coverage"] = cov
                snaps_fixed += 1
                changed = True
        if changed and not dry_run:
            save(path, hist)

    for name in sorted(os.listdir(DETAIL_DIR)):
        if not name.endswith(".json") or name.startswith("_"):
            continue
        path = os.path.join(DETAIL_DIR, name)
        detail = load(path)
        holds = detail.get("holdings") or []
        meta = detail.get("holdingsMeta") or {}
        cov = fund_of_funds_coverage(holds) if isinstance(holds, list) else None
        if cov and meta.get("coverage") == "stock_level":
            meta["coverage"] = cov
            if cov == "feeder_unresolved" and not meta.get("underlying"):
                meta["underlying"] = underlying_name(holds)
            detail["holdingsMeta"] = meta
            details_fixed.append(name[:-5])
            if not dry_run:
                save(path, detail)

    # Same aggregate prune_pending.py writes, from the corrected detail files.
    data = load(FUNDS_JSON)
    counts = {}
    for f in data.get("funds", []):
        p = os.path.join(DETAIL_DIR, f"{f['code']}.json")
        cov = (load(p).get("holdingsMeta") or {}).get("coverage", "missing") if os.path.exists(p) else "missing"
        counts[cov] = counts.get(cov, 0) + 1
    before = data.get("holdingsCoverage")
    data["holdingsCoverage"] = counts
    if not dry_run and before != counts:
        with open(FUNDS_JSON, "w", encoding="utf-8", newline="") as fh:
            json.dump(data, fh, separators=(",", ":"))
    print(f"{'Would fix' if dry_run else 'Fixed'}: {snaps_fixed} snapshots, {len(details_fixed)} fund-data files")
    print(f"holdingsCoverage {before} -> {counts}")
    return details_fixed


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
