"""
Build a concise, human-readable summary of a monthly discovery run for the PR body.

Answers the only questions a reviewer actually has, in five seconds:
  - Did the served universe change (funds added / removed)?
  - What was flagged as closed, renamed, or stale (and what was kept anyway)?
  - Did holdings coverage improve?
  - Is any fund silently going stale in the daily NAV runs?

Reads:
  --before   snapshot of src/data/funds.json taken BEFORE the run (required for
             the added/removed/coverage diff; if missing, those lines say "n/a")
  --after    current src/data/funds.json (default)
  src/data/lifecycle_report.json   closed/renamed/stale findings (this run)
  src/data/nav_staleness.json      daily NAV staleness ledger (rolling)

Prints markdown to stdout.
"""
import os
import json
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "src", "data")


def _arg(flag, default):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _by_code(funds):
    return {f["code"]: f for f in funds}


def _bullet_list(items, limit=15):
    out = []
    for it in items[:limit]:
        out.append(f"  - {it}")
    if len(items) > limit:
        out.append(f"  - ... and {len(items) - limit} more")
    return "\n".join(out)


def main():
    after = _load(_arg("--after", os.path.join(DATA, "funds.json")))
    before = _load(_arg("--before", ""))
    lifecycle = _load(os.path.join(DATA, "lifecycle_report.json")) or {}
    ledger = _load(os.path.join(DATA, "nav_staleness.json")) or {}

    if not after:
        print("Discovery summary: funds.json not found.")
        return

    after_funds = _by_code(after["funds"])
    a_total = after.get("totalFunds", len(after["funds"]))
    lines = [f"## Discovery summary — {datetime.now():%Y-%m-%d}", ""]

    # Universe delta
    if before:
        before_funds = _by_code(before["funds"])
        b_total = before.get("totalFunds", len(before["funds"]))
        added = sorted(set(after_funds) - set(before_funds))
        removed = sorted(set(before_funds) - set(after_funds))
        delta = a_total - b_total
        change = "no change" if delta == 0 else (f"+{delta}" if delta > 0 else str(delta))
        lines.append(f"**Universe: {b_total} → {a_total} ({change})**")
        lines.append("")
        lines.append(f"- **Added to universe: {len(added)}**")
        if added:
            lines.append(_bullet_list([
                f"{c} {after_funds[c].get('name', '')} ({after_funds[c].get('category', '')})"
                for c in added
            ]))
        lines.append(f"- **Removed from universe: {len(removed)}**")
        if removed:
            lines.append(_bullet_list([
                f"{c} {before_funds[c].get('name', '')} ({before_funds[c].get('category', '')})"
                for c in removed
            ]))
    else:
        lines.append(f"**Universe: {a_total}** (no pre-run snapshot for add/remove diff)")
        lines.append("")

    # Lifecycle findings (this run)
    closed = [(c, v) for c, v in lifecycle.items() if v.get("status") == "closed"]
    renamed = [(c, v) for c, v in lifecycle.items() if v.get("status") == "renamed"]
    stale = [(c, v) for c, v in lifecycle.items() if v.get("status") == "stale"]

    lines.append(f"- **Confirmed closed (absent from AMFI + NAV stale): {len(closed)}**")
    if closed:
        lines.append(_bullet_list([f"{v.get('name', c)} — {v.get('note', '')}" for c, v in closed]))
    lines.append(f"- **Renamed: {len(renamed)}**")
    if renamed:
        lines.append(_bullet_list([f"{v.get('note', c)}" for c, v in renamed]))
    lines.append(f"- **Flagged / watch, retained (still has NAV): {len(stale)}**")
    if stale:
        lines.append(_bullet_list([f"{v.get('name', c)} — {v.get('note', '')}" for c, v in stale]))

    # Holdings coverage delta
    ac = after.get("holdingsCoverage", {})
    if before:
        bc = before.get("holdingsCoverage", {})
        def d(k):
            return ac.get(k, 0) - bc.get(k, 0)
        lines.append(
            f"- **Holdings coverage:** stock-level {bc.get('stock_level', 0)} → "
            f"{ac.get('stock_level', 0)} ({d('stock_level'):+d}), "
            f"unresolved {bc.get('unresolved', 0)} → {ac.get('unresolved', 0)} "
            f"({d('unresolved'):+d}), fof {bc.get('fof_level', 0)} → {ac.get('fof_level', 0)}"
        )
    elif ac:
        lines.append(
            f"- **Holdings coverage:** stock-level {ac.get('stock_level', 0)}, "
            f"unresolved {ac.get('unresolved', 0)}, fof {ac.get('fof_level', 0)}"
        )

    # Daily NAV staleness watchlist (rolling ledger)
    lines.append(f"- **Stale-NAV watchlist (daily runs): {len(ledger)} code(s)**")
    if ledger:
        reason_label = {"not_in_amfi": "not in AMFI NAVAll", "amfi_stale": "AMFI not repricing"}
        items = []
        for c, v in sorted(ledger.items(), key=lambda kv: -kv[1].get("misses", 0)):
            name = after_funds.get(int(c), {}).get("name", "") if str(c).isdigit() else ""
            items.append(
                f"{c} {name} — {reason_label.get(v.get('reason'), v.get('reason'))}, "
                f"missed {v.get('misses', 1)} run(s) since {v.get('first_flagged', '?')} "
                f"(last NAV {v.get('last_nav', '?')})"
            )
        lines.append(_bullet_list(items))

    print("\n".join(lines))


if __name__ == "__main__":
    main()
