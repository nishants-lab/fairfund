"""
Build a "typical fund" median benchmark series for cash-like categories
(Liquid, Money Market, Arbitrage) where no single index proxy is meaningful.

Construction: a chained MEDIAN-DAILY-RETURN index.
  For each trading date d, take the median of every constituent fund's daily
  return on d (funds present on both d and their own prior date), then chain:
      I(d0) = 100 ; I(d) = I(d_prev) * (1 + median_return(d))
This collapses the whole category into ONE continuous "growth of 100" series,
so:
  - absolute NAV levels (one fund at Rs 100, another at Rs 3500) never distort it,
  - young funds join the return-median the day they have two data points,
  - the client can re-rebase it to any selected range start EXACTLY (a single
    chained series re-normalizes cleanly; no median-does-not-commute problem).

A date is emitted only once >= MIN_CONSTITUENTS funds contribute, so the line
starts only when the category is representative.

Output: public/category-median/{key}.json in the compact self-hosted NAV
format {"d":[ISO...],"v":[num...]} plus metadata, so the existing NAV parser
and RangeChart rebase path consume it unchanged.

Usage: python scripts/build_category_median.py
Idempotent. Reads committed public/nav/*.json (no network).
"""
import os, json, statistics, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
BENCH_JSON = os.path.join(ROOT, "src", "data", "benchmarks.json")
NAV_DIR = os.path.join(ROOT, "public", "nav")
OUT_DIR = os.path.join(ROOT, "public", "category-median")

MIN_CONSTITUENTS = 5      # emit a date only once the category is representative
RET_CLAMP = 0.5           # ignore absurd daily moves (data errors), matches metrics.ts

def load_nav(code):
    p = os.path.join(NAV_DIR, f"{code}.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        j = json.load(f)
    d, v = j.get("d"), j.get("v")
    if not d or not v or len(d) != len(v):
        return None
    # chronological (files are oldest->newest already)
    return list(zip(d, [float(x) for x in v]))

def daily_returns(series):
    """Map date -> daily return using the fund's own consecutive points."""
    out = {}
    for i in range(1, len(series)):
        pd, pv = series[i - 1]
        cd, cv = series[i]
        if pv > 0:
            r = cv / pv - 1.0
            if abs(r) < RET_CLAMP:
                out[cd] = r
    return out

def build_category(cat, funds):
    codes = [f["code"] for f in funds if f.get("category") == cat]
    ret_maps = []
    for c in codes:
        s = load_nav(c)
        if s and len(s) > 1:
            ret_maps.append(daily_returns(s))
    if not ret_maps:
        return None, 0
    all_dates = sorted(set().union(*[set(m.keys()) for m in ret_maps]))
    out_d, out_v = [], []
    idx = 100.0
    started = False
    for d in all_dates:
        rets = [m[d] for m in ret_maps if d in m]
        if len(rets) < MIN_CONSTITUENTS:
            if not started:
                continue  # skip leading thin period
            # mid-series thin day: carry forward flat rather than distort
            out_d.append(d); out_v.append(round(idx, 4)); continue
        med = statistics.median(rets)
        if not started:
            # first representative date is the baseline: emit exactly 100.0
            # (that day's own return is the seed, not a move off the seed)
            started = True
            out_d.append(d); out_v.append(100.0); continue
        idx *= (1.0 + med)
        out_d.append(d); out_v.append(round(idx, 4))
    if not out_d:
        return None, len(ret_maps)
    return {"d": out_d, "v": out_v, "n": len(ret_maps),
            "generated": datetime.date.today().isoformat()}, len(ret_maps)

def main():
    with open(FUNDS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    funds = data["funds"] if isinstance(data, dict) else data
    with open(BENCH_JSON, encoding="utf-8") as f:
        bench = json.load(f)
    median_cats = bench["medianCategories"]
    os.makedirs(OUT_DIR, exist_ok=True)
    for cat, key in median_cats.items():
        series, n = build_category(cat, funds)
        if not series:
            print(f"  SKIP {cat}: no constituent NAV data")
            continue
        outp = os.path.join(OUT_DIR, f"{key}.json")
        with open(outp, "w", encoding="utf-8", newline="\n") as f:
            json.dump(series, f, separators=(",", ":"))
        start_v, end_v = series["v"][0], series["v"][-1]
        print(f"  OK  {cat:14s} -> {key}.json  funds={n:3d}  points={len(series['d']):4d}  "
              f"{series['d'][0]}..{series['d'][-1]}  100 -> {end_v:.2f}")

if __name__ == "__main__":
    main()
