"""Refresh SEBI riskometer levels from identity-verified Groww scheme pages.

Default: missing or at least 30 days old. --all refreshes every fund with a
slug; --missing-only is for daily intake. Failed lookups preserve prior values.
sebiRiskAsOf records the observation date, not the AMC disclosure date.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import json
import os
from pathlib import Path
import time

from groww_identity import fetch_scheme_verified

ROOT = Path(__file__).resolve().parents[1]
FUNDS_PATH = ROOT / "src/data/funds.json"
SLUGS_PATH = ROOT / "public/holdings-history/_slugs.json"
LEVELS = ("Low", "Low to Moderate", "Moderate", "Moderately High", "High", "Very High")
NORMALIZED_LEVELS = {level.lower(): level for level in LEVELS}
MAX_AGE_DAYS = 30


def normalize_risk(value):
    if not isinstance(value, str):
        return None
    return NORMALIZED_LEVELS.get(" ".join(value.lower().split()))


def needs_fetch(fund, today, refresh_all=False, missing_only=False):
    if not fund.get("sebiRisk"):
        return True
    if missing_only:
        return False
    if refresh_all:
        return True
    try:
        observed = date.fromisoformat(fund.get("sebiRiskAsOf") or "")
    except (ValueError, TypeError):
        return True
    return (today - observed).days >= MAX_AGE_DAYS


def fetch_one(fund, slug, fetch, throttle):
    if not slug:
        return None, None, "no slug"
    # Bound concurrency and pace each worker, in addition to groww_get retries.
    throttle(0.3)
    try:
        result = fetch(fund["code"], slug)
        if result["status"] not in ("ok", "renamed"):
            return None, None, result["status"]
        stats = result["payload"].get("return_stats")
        raw = stats[0].get("risk") if isinstance(stats, list) and stats and isinstance(stats[0], dict) else None
        level = normalize_risk(raw)
        return level, raw, None if level else f"unknown or missing risk: {raw!r}"
    except Exception as exc:
        # This optional external source must not roll back an otherwise valid intake.
        return None, None, f"fetch failed: {type(exc).__name__}: {exc}"


def refresh(funds, slugs, today, refresh_all=False, missing_only=False,
            fetch=None, throttle=None):
    fetch = fetch or fetch_scheme_verified
    throttle = throttle or time.sleep
    todo = [fund for fund in funds if needs_fetch(fund, today, refresh_all, missing_only)]
    counts = dict(filled=0, changed=0, unchanged=0, failed=0)
    print(f"SEBI risk: {len(todo)} selected of {len(funds)} funds")
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = pool.map(lambda fund: fetch_one(fund, slugs.get(str(fund["code"])), fetch, throttle), todo)
        for fund, (level, raw, reason) in zip(todo, results):
            code, name = fund["code"], fund.get("name", "")
            if reason:
                counts["failed"] += 1
                print(f"::warning::SEBI risk {code} {name}: {reason}; existing value retained")
                continue
            old = fund.get("sebiRisk")
            outcome = "filled" if not old else "unchanged" if old == level else "changed"
            counts[outcome] += 1
            if outcome == "changed":
                print(f"::warning::SEBI risk {code} {name}: {old!r} -> {level!r}")
            fund["sebiRisk"] = level
            fund["sebiRiskAsOf"] = today.isoformat()
            if outcome == "filled" and counts["filled"] <= 5:
                print(f"Spot-check {code} {name}: Groww raw={raw!r}, canonical={level!r}")
    print("SEBI risk: " + ", ".join(f"{key}={value}" for key, value in counts.items()))
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--all", action="store_true", help="refresh all funds with slugs")
    mode.add_argument("--missing-only", action="store_true", help="fetch only funds without sebiRisk")
    args = parser.parse_args(argv)
    try:
        data = json.loads(FUNDS_PATH.read_text(encoding="utf-8"))
        slugs = json.loads(SLUGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"::warning::SEBI risk inputs unavailable: {exc}; no data changed")
        return 0
    counts = refresh(data["funds"], slugs, date.today(), args.all, args.missing_only)
    if counts["filled"] + counts["changed"] + counts["unchanged"]:
        temporary = FUNDS_PATH.with_suffix(".json.tmp")
        try:
            temporary.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
            os.replace(temporary, FUNDS_PATH)
        finally:
            temporary.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
