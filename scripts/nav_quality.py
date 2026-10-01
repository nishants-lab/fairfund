"""Conservative NAV quality flags. Never adjusts or deletes source observations."""
import json
from math import isfinite
from pathlib import Path

def nav_quality_issues(points):
    issues = []
    previous = None
    for day, value in points:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value <= 0:
            issues.append({"reason":"invalid_nav", "date":day})
            continue
        if previous:
            prev_day, prev_value = previous
            if day <= prev_day:
                issues.append({"reason":"unordered_or_duplicate_date", "date":day})
            move = value / prev_value - 1
            if abs(move) >= 0.5:
                issues.append({"reason":"unverified_nav_jump", "date":day, "previousDate":prev_day, "changePct":round(move*100,4)})
        previous = (day, value)
    return issues



def sticky_nav_holds(root, funds=None):
    """Read explicit holds from either published surface before forming cohorts."""
    root = Path(root)
    if funds is None:
        funds = json.loads((root / "src/data/funds.json").read_text(encoding="utf-8"))["funds"]
    holds = {}
    for fund in funds:
        quality = fund.get("dataQuality") or {}
        if quality.get("status") == "quarantined":
            holds[str(fund["code"])] = quality
    for path in sorted((root / "public/fund-data").glob("*.json")):
        detail = json.loads(path.read_text(encoding="utf-8"))
        quality = detail.get("dataQuality") or {}
        if quality.get("status") == "quarantined":
            holds.setdefault(path.stem, quality)
    return holds
