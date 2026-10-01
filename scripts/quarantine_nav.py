"""Quarantine unverified NAV-derived values without modifying source observations.

Run --apply after regeneration and before analytics synchronization. --check is
read-only and blocks publication until every flagged fund's derived values are
cleared. Flags require source investigation; no rescaling is inferred here.

Holds are sticky in both index and detail files. After source verification,
explicitly remove both markers and rebuild all metrics and analytics before
publishing. Merely editing raw NAV must not release a hold.
"""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import sys

from market_date import ist_today, is_usable_nav_date
from nav_quality import nav_quality_issues

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
from compute_rankings import ARBITRAGE_CATS, DEBT_CATS, HORIZONS, SCORE_METRICS, finite_number


def read_object(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def source_issues(raw, today):
    dates, values = raw.get("d"), raw.get("v")
    if not isinstance(dates, list) or not isinstance(values, list) or len(dates) != len(values):
        return [{"reason": "invalid_nav_shape"}]
    points = [(day, value) for day, value in zip(dates, values)
              if is_usable_nav_date(day, today)]
    return nav_quality_issues(points)


def clear_derived(record, issues):
    record["metrics"] = {}
    record.pop("si", None)
    record["analytics"] = {}
    record["dataQuality"] = {"status": "quarantined", "issues": issues}


def plan_updates(root=ROOT, today=None):
    root = Path(root)
    today = today or ist_today()
    index_path = root / "src/data/funds.json"
    producer_path = root / "src/data/fund_analytics.json"
    index = read_object(index_path)
    producer = read_object(producer_path)
    details = {path.stem: (path, read_object(path))
               for path in sorted((root / "public/fund-data").glob("*.json"))}
    flagged = {}
    for path in sorted((root / "public/nav").glob("*.json")):
        if not path.stem.isdigit():
            continue
        issues = source_issues(read_object(path), today)
        if issues:
            flagged[path.stem] = issues
    funds = index["funds"]
    seen = set()
    for fund in funds:
        code = str(fund["code"])
        if not code.isdigit() or code in seen:
            raise ValueError(f"Invalid or duplicate index code: {code}")
        seen.add(code)
    for code, record in [(str(f["code"]), f) for f in funds] + [
            (code, detail) for code, (_, detail) in details.items()]:
        quality = record.get("dataQuality") or {}
        if quality.get("status") == "quarantined":
            # Only a clean producer recomputation may release an existing hold.
            flagged.setdefault(code, quality.get("issues") or [])
    pending = []
    updated_index = deepcopy(index)
    updated_producer = deepcopy(producer)
    for fund in updated_index["funds"]:
        code = str(fund["code"])
        if code in flagged:
            clear_derived(fund, flagged[code])
    for code, issues in flagged.items():
        if code in updated_producer:
            updated_producer[code] = {}
        if code in details:
            path, detail = details[code]
            updated = deepcopy(detail)
            clear_derived(updated, issues)
            if updated != detail:
                pending.append((path, updated))
        elif code in seen:
            raise ValueError(f"Missing detail shell for quarantined fund {code}")
    if updated_index != index:
        pending.append((index_path, updated_index))
    if updated_producer != producer:
        pending.append((producer_path, updated_producer))
    return flagged, pending


def window_issues(funds, today=None):
    today = today or ist_today()
    cohorts = {}
    issues = []
    for fund in funds:
        category = fund.get("category", "")
        required = ["cagr"] if category in DEBT_CATS | ARBITRAGE_CATS else SCORE_METRICS
        for horizon in HORIZONS:
            metrics = fund.get("metrics", {}).get(horizon)
            if not isinstance(metrics, dict) or not all(finite_number(metrics.get(key)) for key in required):
                continue
            start, end = metrics.get("windowStart"), metrics.get("windowEnd")
            if not is_usable_nav_date(start, today) or not is_usable_nav_date(end, today) or start >= end:
                issues.append(f"{fund['code']} {horizon}: missing or invalid dated window; recompute metrics")
                continue
            key = (category, horizon)
            window = (start, end)
            if key in cohorts and cohorts[key] != window:
                issues.append(f"{fund['code']} {category}/{horizon}: window {window} differs from {cohorts[key]}")
            else:
                cohorts[key] = window
    return issues


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    flagged, pending = plan_updates(args.root)
    for code, issues in sorted(flagged.items()):
        print(f"NAV quarantine {code}: {json.dumps(issues, separators=(',', ':'))}")
    print(f"NAV quarantine: {len(flagged)} flagged funds; {len(pending)} files need clearing")
    if args.check:
        windows = window_issues(read_object(args.root / "src/data/funds.json")["funds"])
        for issue in windows:
            print(f"Metric window: {issue}")
        print("No files written. Investigate flagged source observations before releasing a hold.")
        return int(bool(pending or windows))
    for path, value in pending:
        temporary = path.with_suffix(".json.tmp")
        try:
            temporary.write_text(json.dumps(value, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    print("Quarantined derived values cleared; raw NAV retained unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
