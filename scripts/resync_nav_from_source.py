"""Re-derive one fund's stored NAV values from the corrected source history.

Used after adding a verified entry to src/data/nav_corrections.json. The source
(mfapi.in, mirroring AMFI) is fetched, the verified corrections are applied, and
every stored date the source also has takes the corrected source value. Dates the
source lacks are kept. Idempotent: a second run changes nothing.

Refuses to write when the corrected source still fails the NAV quality rule, so a
wrong or missing correction cannot be published as clean.

Usage: python scripts/resync_nav_from_source.py --code 120304 [--check]
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backfill_nav_gaps import fetch_history  # noqa: E402  (applies nav_corrections)
from market_date import ist_today, is_usable_nav_date  # noqa: E402
from nav_quality import nav_quality_issues  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def resync(stored, corrected):
    """Stored {d, v} and corrected {date: nav} -> (new {d, v}, changed dates)."""
    changed = []
    values = []
    for day, nav in zip(stored["d"], stored["v"]):
        new = corrected.get(day, nav)
        if new != nav:
            changed.append(day)
        values.append(new)
    return dict(stored, v=values), changed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--code", required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    path = args.root / "public" / "nav" / f"{args.code}.json"
    stored = json.loads(path.read_text(encoding="utf-8"))
    corrected = fetch_history(args.code)
    if not corrected:
        print(f"{args.code}: source fetch failed; nothing written")
        return 1
    new, changed = resync(stored, corrected)
    today = ist_today()
    issues = nav_quality_issues([(d, v) for d, v in zip(new["d"], new["v"]) if is_usable_nav_date(d, today)])
    print(f"{args.code}: {len(changed)} stored values differ from the corrected source"
          + (f" ({changed[0]} to {changed[-1]})" if changed else ""))
    if issues:
        print(f"{args.code}: corrected history still fails the quality rule: {json.dumps(issues)}; nothing written")
        return 1
    if args.check or not changed:
        return 0
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(new, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)
    print(f"{args.code}: wrote {path.relative_to(args.root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
