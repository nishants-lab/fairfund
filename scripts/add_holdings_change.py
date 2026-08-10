"""Promote the latest holdings snapshot into each fund's displayed portfolio, with
month-over-month % change.

WHY (fixed 2026-08-10): the previous version only *annotated* whatever holdings were
already in fund-data with a change %, matching by key. It never replaced the list, so
the served portfolio (holdings table, count, portfolioDate) stayed frozen at the month
a fund was onboarded even though capture_holdings_snapshot.py kept adding newer months
to holdings-history. Result: every fund displayed a portfolio a month or more stale, and
brand-new positions never appeared. This now makes the LATEST snapshot the source of
truth for the displayed portfolio and keeps holdingsMeta (portfolioDate/count/coverage)
in step, so the site shows what was actually captured.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HISTORY_DIR = ROOT / "public" / "holdings-history"
DETAIL_DIR = ROOT / "public" / "fund-data"

updated = 0
skipped = 0

for hist_file in HISTORY_DIR.glob("*.json"):
    if hist_file.name.startswith("_"):
        continue
    code = hist_file.stem
    detail_path = DETAIL_DIR / f"{code}.json"
    if not detail_path.exists():
        continue

    hist = json.loads(hist_file.read_text(encoding="utf-8"))
    snapshots = hist.get("snapshots", {})
    dates = sorted(snapshots.keys())
    if not dates:
        skipped += 1
        continue

    curr_date = dates[-1]
    curr = snapshots[curr_date]
    curr_holdings = curr.get("holdings", [])
    if not curr_holdings:
        skipped += 1
        continue

    # Month-over-month change vs the previous snapshot, when we have one.
    if len(dates) >= 2:
        prev_by_key = {}
        for h in snapshots[dates[-2]].get("holdings", []):
            prev_by_key[h.get("key", h["name"].lower())] = h["pct"]
        for h in curr_holdings:
            prev_pct = prev_by_key.get(h.get("key", h["name"].lower()))
            h["change"] = round(h["pct"] - prev_pct, 3) if prev_pct is not None else None
    else:
        for h in curr_holdings:
            h["change"] = None

    detail = json.loads(detail_path.read_text(encoding="utf-8"))

    # Promote the latest snapshot to be the displayed portfolio.
    detail["holdings"] = curr_holdings
    meta = detail.get("holdingsMeta") or {}
    meta["portfolioDate"] = curr_date
    meta["count"] = len(curr_holdings)
    snap_cov = curr.get("coverage")
    if snap_cov:
        meta["coverage"] = snap_cov
    detail["holdingsMeta"] = meta

    detail_path.write_text(json.dumps(detail, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    updated += 1

print(f"Done: {updated} funds promoted to latest snapshot with MoM change, {skipped} skipped")
