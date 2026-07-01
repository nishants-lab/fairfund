"""Enrich fund-data JSONs with AUM (from holdings-history) and expense_ratio (when available)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HISTORY_DIR = ROOT / "public" / "holdings-history"
DETAIL_DIR = ROOT / "public" / "fund-data"

updated = 0

for hist_file in HISTORY_DIR.glob("*.json"):
    if hist_file.name.startswith("_"):
        continue
    code = hist_file.stem
    detail_path = DETAIL_DIR / f"{code}.json"
    if not detail_path.exists():
        continue

    hist = json.loads(hist_file.read_text(encoding="utf-8"))
    snapshots = hist.get("snapshots", {})
    if not snapshots:
        continue

    dates = sorted(snapshots.keys())
    latest = snapshots[dates[-1]]

    detail = json.loads(detail_path.read_text(encoding="utf-8"))

    changed = False

    # AUM (in crores)
    aum = latest.get("aum")
    if aum is not None:
        aum_data = {"current": round(aum, 1), "asOf": dates[-1]}
        # Add trend if 2+ snapshots
        if len(dates) >= 2:
            prev_aum = snapshots[dates[-2]].get("aum")
            if prev_aum and prev_aum > 0:
                aum_data["previous"] = round(prev_aum, 1)
                aum_data["prevDate"] = dates[-2]
                aum_data["changePct"] = round((aum - prev_aum) / prev_aum * 100, 1)
        if detail.get("aum") != aum_data:
            detail["aum"] = aum_data
            changed = True

    # Expense ratio (always store as float)
    er = latest.get("expense_ratio")
    if er is not None:
        try:
            er = round(float(er), 2)
        except (ValueError, TypeError):
            er = None
        if er is not None and detail.get("expenseRatio") != er:
            detail["expenseRatio"] = er
            changed = True

    # Investment info (exit load, SIP/lumpsum, availability)
    invest_info = {}
    for key in ("exit_load", "min_sip", "min_lumpsum", "stamp_duty",
                "sip_allowed", "lumpsum_allowed", "available_for_investment", "lock_in"):
        val = latest.get(key)
        if val is not None:
            invest_info[key] = val
    if invest_info and detail.get("investInfo") != invest_info:
        detail["investInfo"] = invest_info
        changed = True

    if changed:
        detail_path.write_text(json.dumps(detail, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        updated += 1

print(f"Enriched {updated} fund-data files with AUM/expense data")
