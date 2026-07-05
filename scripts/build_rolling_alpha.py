"""
Rolling alpha series — BUILD-TIME precompute.
=============================================
For each fund, emits the month-by-month excess of its rolling annualized return
over the category rolling-return median. This is the exact series behind the
battingAverage stat (same ROLL_WINDOW_M window), plotted as a line so users can
see WHERE and HOW CONSISTENTLY a fund beat its peers over time.

Reuses month_end_series / load_universe / ROLL_WINDOW_M from build_analytics.py
so the window and NAV handling never diverge from the batting-average computation.

Writes analytics.rollingAlpha = { spark: [[YYYY-MM, excessPct], ...], windowM }
into BOTH:
  - src/data/funds.json (bundled index; used by Explore/Compare)
  - public/fund-data/<code>.json (detail files; authoritative on the fund page,
    because mergeFundDetail overwrites analytics with the detail file's copy)

Only the rollingAlpha field is added/replaced; all other analytics are left as-is,
keeping the data diff surgical.
"""
import os
import json
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_analytics import month_end_series, load_universe, ROLL_WINDOW_M, ROOT  # noqa: E402

MAX_POINTS = 60  # cap series length (5Y of monthly points) to bound payload


def compute_rolling_alpha():
    funds = load_universe()
    me_nav = {}
    cat_of = {}
    for fobj in funds:
        code = int(fobj["code"])
        me = month_end_series(code)
        if me is None:
            continue
        me_nav[code] = me
        cat_of[code] = fobj.get("category") or fobj.get("cat", "")

    all_months = pd.date_range(
        start=min(s.index.min() for s in me_nav.values()),
        end=max(s.index.max() for s in me_nav.values()),
        freq="ME",
    )
    nav_cols = {code: s.reindex(all_months) for code, s in me_nav.items()}
    nav_df = pd.concat(nav_cols, axis=1)

    def rolling_ann(code):
        nav = nav_df[code]
        out = {}
        idx = nav.index
        for i in range(ROLL_WINDOW_M, len(idx)):
            n0 = nav.iloc[i - ROLL_WINDOW_M]
            n1 = nav.iloc[i]
            if pd.notna(n0) and pd.notna(n1) and n0 > 0:
                out[idx[i]] = (n1 / n0) ** (12.0 / ROLL_WINDOW_M) - 1
        return pd.Series(out)

    roll = {code: rolling_ann(code) for code in me_nav}

    cats = sorted(set(cat_of.values()))
    cat_roll_median = {}
    for c in cats:
        codes = [k for k in me_nav if cat_of[k] == c]
        m = pd.DataFrame({k: roll[k] for k in codes if len(roll[k])})
        cat_roll_median[c] = m.median(axis=1, skipna=True) if len(m.columns) else pd.Series(dtype=float)

    result = {}
    for code in me_nav:
        cm = cat_roll_median[cat_of[code]]
        spark = []
        for ts, v in roll[code].items():
            med = cm.get(ts)
            if med is not None and pd.notna(med):
                spark.append([ts.strftime("%Y-%m"), round(float((v - med) * 100), 2)])
        spark = spark[-MAX_POINTS:]
        if len(spark) >= 3:
            result[str(code)] = {"spark": spark, "windowM": ROLL_WINDOW_M}
    return result


def merge_into(path, result):
    """Inject analytics.rollingAlpha into a funds.json-shaped file (has ['funds'])."""
    data = json.load(open(path, encoding="utf-8"))
    n = 0
    for fund in data["funds"]:
        cs = str(fund["code"])
        if cs in result:
            fund.setdefault("analytics", {})
            fund["analytics"]["rollingAlpha"] = result[cs]
            n += 1
    tmp = path + ".tmp"
    json.dump(data, open(tmp, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, path)
    return n


def merge_into_details(detail_dir, result):
    """Inject analytics.rollingAlpha into each per-fund detail file."""
    n = 0
    for cs, ra in result.items():
        fpath = os.path.join(detail_dir, f"{cs}.json")
        if not os.path.exists(fpath):
            continue
        d = json.load(open(fpath, encoding="utf-8"))
        d.setdefault("analytics", {})
        d["analytics"]["rollingAlpha"] = ra
        tmp = fpath + ".tmp"
        json.dump(d, open(tmp, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
        os.replace(tmp, fpath)
        n += 1
    return n


def main():
    result = compute_rolling_alpha()
    print(f"Computed rolling alpha for {len(result)} funds (window={ROLL_WINDOW_M}m)")

    funds_path = os.path.join(ROOT, "src", "data", "funds.json")
    nfj = merge_into(funds_path, result)
    print(f"  merged into funds.json: {nfj}")

    detail_dir = os.path.join(ROOT, "public", "fund-data")
    ndet = merge_into_details(detail_dir, result)
    print(f"  merged into fund-data detail files: {ndet}")


if __name__ == "__main__":
    main()
