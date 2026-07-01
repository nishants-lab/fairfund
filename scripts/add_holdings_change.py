"""Add month-over-month % change to holdings in fund-data JSONs using holdings-history."""
import json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HISTORY_DIR = ROOT / "public" / "holdings-history"
DETAIL_DIR = ROOT / "public" / "fund-data"

updated = 0
skipped = 0

for hist_file in HISTORY_DIR.glob("*.json"):
    code = hist_file.stem
    detail_path = DETAIL_DIR / f"{code}.json"
    if not detail_path.exists():
        continue

    hist = json.loads(hist_file.read_text(encoding="utf-8"))
    snapshots = hist.get("snapshots", {})
    dates = sorted(snapshots.keys())

    if len(dates) < 2:
        skipped += 1
        continue

    curr_date = dates[-1]
    prev_date = dates[-2]
    curr_holdings = snapshots[curr_date].get("holdings", [])
    prev_holdings = snapshots[prev_date].get("holdings", [])

    # Build lookup by key for previous month
    prev_by_key = {}
    for h in prev_holdings:
        k = h.get("key", h["name"].lower())
        prev_by_key[k] = h["pct"]

    # Compute change for each current holding
    for h in curr_holdings:
        k = h.get("key", h["name"].lower())
        prev_pct = prev_by_key.get(k)
        if prev_pct is not None:
            h["change"] = round(h["pct"] - prev_pct, 3)
        else:
            h["change"] = None  # new position

    # Update the fund-data file
    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    if detail.get("holdings"):
        # Match by key and add change
        curr_by_key = {h.get("key", h["name"].lower()): h.get("change") for h in curr_holdings}
        for h in detail["holdings"]:
            k = h.get("key", h["name"].lower())
            if k in curr_by_key:
                h["change"] = curr_by_key[k]
            else:
                # Holding in fund-data but not in latest history snapshot
                h["change"] = None

        detail_path.write_text(json.dumps(detail, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
        updated += 1
    else:
        skipped += 1

print(f"Done: {updated} funds updated with change data, {skipped} skipped")
