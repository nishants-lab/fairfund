"""Apply source-verified NAV corrections (src/data/nav_corrections.json).

Corrections apply to raw source responses only (mfapi.in / AMFI), never to a
stored public/nav file, which already holds corrected values. Applying them to a
stored file would divide it twice. The app applies the same file to its live
mfapi fetch (src/lib/navCorrections.ts).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORRECTIONS = ROOT / "src" / "data" / "nav_corrections.json"


def load(path=CORRECTIONS):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    splits = {}
    for s in data.get("splits", []):
        factor = float(s["factor"])
        if factor <= 0 or not s.get("firstNewDate") or not s.get("sources"):
            raise ValueError(f"Invalid NAV split entry: {s}")
        splits.setdefault(str(s["code"]), []).append((s["firstNewDate"], factor))
    return splits


_SPLITS = None


def correct_history(code, history, splits=None):
    """{date_iso: nav} from the source -> the same dates in today's units."""
    global _SPLITS
    if splits is None:
        if _SPLITS is None:
            _SPLITS = load()
        splits = _SPLITS
    rules = splits.get(str(code))
    if not rules:
        return history
    out = {}
    for day, nav in history.items():
        for first_new, factor in rules:
            if day < first_new:
                nav = nav / factor
        out[day] = round(nav, 4)
    return out
