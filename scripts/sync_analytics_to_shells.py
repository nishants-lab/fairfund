"""Push freshly built analytics into the per-fund data shells.

Why this exists
---------------
`scripts/build_analytics.py` writes `src/data/fund_analytics.json` and merges it
into `src/data/funds.json`, but it does NOT touch `public/fund-data/<code>.json`.
The fund detail page lazy-loads that shell and `mergeFundDetail()` in
`src/lib/data.ts` does `fund.analytics = detail.analytics`, so the shell's copy
OVERRIDES the bundled one. If the shells are not refreshed, the site keeps
serving whatever analytics were baked in last time (this is how a stale regime
list survived an analytics rebuild).

Run this immediately after build_analytics.py.

A shell is only rewritten when fund_analytics.json holds a non-empty record for
that code, so debt/cash funds (which build_analytics deliberately emits as `{}`)
keep whatever their shell already had.

Usage:
  python scripts/sync_analytics_to_shells.py
  python scripts/sync_analytics_to_shells.py --dry-run
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FA_PATH = os.path.join(ROOT, "src", "data", "fund_analytics.json")
SHELL_GLOB = os.path.join(ROOT, "public", "fund-data", "*.json")


def main():
    dry_run = "--dry-run" in sys.argv

    if not os.path.exists(FA_PATH):
        print(f"ERROR: {FA_PATH} not found - run build_analytics.py first")
        sys.exit(1)

    with open(FA_PATH, encoding="utf-8") as f:
        fa = json.load(f)

    shells = sorted(glob.glob(SHELL_GLOB))
    if not shells:
        print("ERROR: no fund-data shells found")
        sys.exit(1)

    updated = already = no_record = empty_record = no_analytics = 0

    for path in shells:
        code = os.path.splitext(os.path.basename(path))[0]
        rec = fa.get(code)
        if rec is None:
            no_record += 1
            continue
        if not rec:
            empty_record += 1
            continue

        with open(path, encoding="utf-8") as f:
            shell = json.load(f)
        if not isinstance(shell.get("analytics"), dict):
            no_analytics += 1
            continue
        if shell["analytics"] == rec:
            already += 1
            continue

        shell["analytics"] = rec
        if not dry_run:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(shell, f, separators=(",", ":"), ensure_ascii=False)
        updated += 1

    verb = "would update" if dry_run else "updated"
    print(f"Shells: {len(shells)} total, {verb} {updated}, {already} already current")
    print(f"  skipped: {no_record} not in fund_analytics, {empty_record} empty record (debt/cash), "
          f"{no_analytics} no analytics object")
    if dry_run:
        print("--dry-run: nothing written.")


if __name__ == "__main__":
    main()
