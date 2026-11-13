"""
Tidy fund display names in src/data/funds.json with config.tidy_display_name.

AMFI spells some schemes in capitals ("BANDHAN MID CAP FUND") or leaves a stray
trailing dash ("ICICI Prudential Liquid Fund -"). New funds and renames are
tidied where they enter (discover_new_funds._clean_scheme_name); this applies the
same rule to funds already listed. Idempotent; matching never depends on case.

  python scripts/tidy_fund_names.py           # rewrite funds.json, list changes
  python scripts/tidy_fund_names.py --check   # exit 1 if any name is untidy

Run before split_funds so per-fund files and peer lists pick up the names.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from config import tidy_display_name  # noqa: E402

FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")


def tidy(funds):
    """Tidy names in place; return [(code, old, new)] for every change."""
    changes = []
    for fund in funds:
        new = tidy_display_name(fund["name"])
        if new != fund["name"]:
            changes.append((fund["code"], fund["name"], new))
            fund["name"] = new
    return changes


def main(argv=None):
    check = "--check" in (argv if argv is not None else sys.argv[1:])
    with open(FUNDS_JSON, encoding="utf-8") as fh:
        data = json.load(fh)
    changes = tidy(data["funds"])
    for code, old, new in changes:
        print(f"  {code}: {old!r} -> {new!r}")
    print(f"Fund names: {len(changes)} {'untidy' if check else 'tidied'} of {len(data['funds'])}")
    if check:
        return 1 if changes else 0
    if changes:
        with open(FUNDS_JSON, "w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
