"""Apply source-verified NAV corrections (src/data/nav_corrections.json).

Corrections apply to raw source responses only (mfapi.in / AMFI), never to a
stored public/nav file, which already holds corrected values. Applying them to a
stored file would divide it twice. The app applies the same file to its live
mfapi fetch (src/lib/navCorrections.ts).

Two kinds, each needing a citation:
- splits: a unit split; every NAV dated before firstNewDate is divided by factor.
- points: one published value that is wrong. nav is the verified value, or null
  when the published value is wrong and no correct value exists (the day is dropped).
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORRECTIONS = ROOT / "src" / "data" / "nav_corrections.json"


def _cited(entry):
    return bool(entry.get("evidence")) and bool(entry.get("sources")) and all(
        str(u).startswith("https://") for u in entry["sources"])


def load(path=CORRECTIONS):
    """-> {code: {"splits": [(firstNewDate, factor)], "points": {date: nav or None}}}"""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    rules = {}
    for s in data.get("splits", []):
        factor = float(s["factor"])
        if factor <= 0 or not s.get("firstNewDate") or not _cited(s):
            raise ValueError(f"Invalid NAV split entry: {s}")
        rules.setdefault(str(s["code"]), {"splits": [], "points": {}})["splits"].append((s["firstNewDate"], factor))
    for p in data.get("points", []):
        nav = p.get("nav", "missing")
        valid_nav = nav is None or (isinstance(nav, (int, float)) and not isinstance(nav, bool)
                                    and math.isfinite(nav) and nav > 0)
        if not p.get("date") or not valid_nav or not _cited(p):
            raise ValueError(f"Invalid NAV point entry: {p}")
        points = rules.setdefault(str(p["code"]), {"splits": [], "points": {}})["points"]
        if p["date"] in points:
            raise ValueError(f"Duplicate NAV point entry: {p}")
        points[p["date"]] = None if nav is None else round(float(nav), 4)
    return rules


_RULES = None


def dropped_dates(code, rules=None):
    """Dates whose published value is wrong with no verified replacement."""
    global _RULES
    if rules is None:
        if _RULES is None:
            _RULES = load()
        rules = _RULES
    points = (rules.get(str(code)) or {}).get("points", {})
    return {day for day, nav in points.items() if nav is None}


def correct_history(code, history, rules=None):
    """{date_iso: nav} from the source -> the same history, corrected.

    Splits put earlier values in today's units. A point replaces its date's value
    when the source has that date, or removes the date when nav is null. Point
    values are already in today's units."""
    global _RULES
    if rules is None:
        if _RULES is None:
            _RULES = load()
        rules = _RULES
    rule = rules.get(str(code))
    if not rule:
        return history
    out = {}
    for day, nav in history.items():
        if day in rule["points"]:
            if rule["points"][day] is not None:
                out[day] = rule["points"][day]
            continue
        for first_new, factor in rule["splits"]:
            if day < first_new:
                nav = nav / factor
        out[day] = round(nav, 4)
    return out
