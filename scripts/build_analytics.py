"""
Forward-looking analytics — BUILD-TIME precompute (cross-fund analytics).
=========================================================================
Computes the analytics that need the full category peer set, from the daily
NAV we already cache. Writes fund_analytics.json (merged into funds.json by
build_website_data_v6.py). All values are derived ONLY from self-hosted NAV +
the v6 universe — no third-party API at view time (rock-solid constraint).

Per fund, precomputes:
  - rankTrajectory: rolling within-category percentile-rank series (3Y window,
    monthly steps) -> sparkline + climbing/fading/steady + prior-vs-current rank
  - battingAverage: % of rolling 3Y windows the fund beat its category median
  - captureUp / captureDown: up/down capture vs category-median monthly return
  - alphaTStat / alphaConfidence: skill-vs-luck (one-sided t-test on monthly
    excess returns vs category median)
  - hotZScore + hotState: mean-reversion (recent 1Y return z-score vs the fund's
    own rolling-1Y history)
  - regimes: per-regime fund return + alpha vs category median

Single-fund analytics (rolling-returns distribution, outcome cone, drawdown
recovery) are computed CLIENT-SIDE from NAV (see src/lib/forward.ts).

Parameters (documented on the Methodology page):
  ROLL_WINDOW_M = 36     rolling window length in months (3Y)
  ROLL_STEP_M   = 1      monthly steps
  MIN_BATTING_N = 24     below this -> "Limited evidence"
  MIN_ALPHA_N   = 36     below this -> "Not enough data to assess skill"
  ALPHA_CONF_THRESH = 95 confidence% below which -> "Could be luck"
  HOT_Z_HOT = 1.0, HOT_Z_COLD = -1.0   running hot/cold bands
  MIN_PEERS = 5          below this -> "Limited evidence" on trajectory
"""
import os, json, sys
import numpy as np
import pandas as pd
from datetime import datetime
from scipy import stats
import warnings
warnings.filterwarnings("ignore")


def _clean(o):
    """Recursively convert numpy types to native Python for JSON serialization."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(x) for x in o]
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    return o

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from config import is_debt_category, uses_reduced_surface  # noqa: E402
NAV_DIR = os.path.join(ROOT, "public", "nav")
ANCHOR = pd.Timestamp(datetime.now().strftime("%Y-%m-%d"))  # dynamic

ROLL_WINDOW_M = 36
MIN_BATTING_N = 24
MIN_ALPHA_N = 36
ALPHA_CONF_THRESH = 95
HOT_Z_HOT = 1.0
HOT_Z_COLD = -1.0
MIN_PEERS = 5

# Load regimes from auto-detected regimes.json (produced by pipeline/detect_regimes.py)
REGIMES_PATH = os.path.join(ROOT, "src", "data", "regimes.json")
if os.path.exists(REGIMES_PATH):
    REGIMES = json.load(open(REGIMES_PATH, encoding="utf-8"))
    # Keep only name/start/end for computation
    REGIMES = [{"name": r["name"], "start": r["start"], "end": r["end"]} for r in REGIMES]
else:
    print("WARNING: regimes.json not found, using fallback hardcoded regimes")
    REGIMES = [
        {"name": "COVID crash", "start": "2020-02-19", "end": "2020-03-23"},
        {"name": "COVID recovery", "start": "2020-03-24", "end": "2021-10-18"},
        {"name": "2022 correction", "start": "2021-10-19", "end": "2022-06-17"},
        {"name": "2022-24 bull run", "start": "2022-06-18", "end": "2024-09-27"},
        {"name": "2024-25 correction", "start": "2024-09-28", "end": "2025-03-31"},
        {"name": "Liberation Day tariff shock", "start": "2025-04-01", "end": "2025-04-22"},
        {"name": "Tariff-pause recovery", "start": "2025-04-23", "end": "2025-05-30"},
        {"name": "US-Iran war & volatility", "start": "2025-06-01", "end": "2025-08-31"},
        {"name": "Post-war recovery", "start": "2025-09-01", "end": "2026-04-30"},
    ]


def load_universe():
    fpath = os.path.join(ROOT, "src", "data", "funds.json")
    u = json.load(open(fpath, encoding="utf-8"))
    return u["funds"]


def month_end_series(code):
    """Return a month-end NAV pd.Series (indexed by month-end Timestamp) or None."""
    f = os.path.join(NAV_DIR, f"{code}.json")
    if not os.path.exists(f):
        return None
    try:
        raw = json.load(open(f, encoding="utf-8"))
    except Exception:
        return None
    dates = raw.get("d", [])
    values = raw.get("v", [])
    if len(dates) < 60 or len(dates) != len(values):
        return None
    df = pd.DataFrame({"date": dates, "nav": values})
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
    df = df.dropna(subset=["date", "nav"])
    df = df[df["nav"] > 0].sort_values("date")
    if len(df) < 60:
        return None
    s = df.set_index("date")["nav"]
    # month-end resample (last available NAV in each month)
    me = s.resample("ME").last().dropna()
    return me if len(me) >= 13 else None


def main():
    funds = load_universe()
    print(f"Universe funds: {len(funds)}")

    # 1) Load month-end NAV for everyone (once).
    me_nav = {}
    cat_of = {}
    name_of = {}
    for fobj in funds:
        code = int(fobj["code"]) if isinstance(fobj["code"], (int, str)) else fobj["code"]
        me = month_end_series(code)
        if me is None:
            continue
        me_nav[code] = me
        cat_of[code] = fobj.get("category") or fobj.get("cat", "")
        name_of[code] = fobj["name"]
    print(f"Funds with usable month-end NAV: {len(me_nav)}")

    # 2) Monthly returns per fund, aligned to a common monthly calendar.
    all_months = pd.date_range(
        start=min(s.index.min() for s in me_nav.values()),
        end=max(s.index.max() for s in me_nav.values()),
        freq="ME",
    )
    nav_cols = {}
    ret_cols = {}
    for code, s in me_nav.items():
        aligned = s.reindex(all_months)
        nav_cols[code] = aligned
        ret_cols[code] = aligned.pct_change()
    nav_df = pd.concat(nav_cols, axis=1)
    ret_df = pd.concat(ret_cols, axis=1)

    # 3) Category monthly-median return series (only funds present that month).
    cats = sorted(set(cat_of.values()))
    cat_median_ret = {}
    for c in cats:
        codes = [k for k in me_nav if cat_of[k] == c]
        cat_median_ret[c] = ret_df[codes].median(axis=1, skipna=True)

    # 4) Rolling 3Y annualized return per fund (month-end to month-end, 36m apart).
    #    ann = (nav_t / nav_{t-36})^(12/36) - 1
    def rolling_3y_ann(code):
        nav = nav_df[code]
        out = {}
        idx = nav.index
        for i in range(ROLL_WINDOW_M, len(idx)):
            n0 = nav.iloc[i - ROLL_WINDOW_M]
            n1 = nav.iloc[i]
            if pd.notna(n0) and pd.notna(n1) and n0 > 0:
                out[idx[i]] = (n1 / n0) ** (12.0 / ROLL_WINDOW_M) - 1
        return pd.Series(out)

    roll3y = {code: rolling_3y_ann(code) for code in me_nav}

    # category rolling-3Y median at each month (only funds with full window)
    cat_roll_median = {}
    for c in cats:
        codes = [k for k in me_nav if cat_of[k] == c]
        m = pd.DataFrame({k: roll3y[k] for k in codes if len(roll3y[k])})
        cat_roll_median[c] = m.median(axis=1, skipna=True) if len(m.columns) else pd.Series(dtype=float)

    out = {}
    n = 0
    for code in me_nav:
        n += 1
        if n % 200 == 0:
            print(f"  analytics {n}/{len(me_nav)}")
        cat = cat_of[code]
        # Debt (cash-equivalent) funds: skip all equity analytics (regimes,
        # capture, batting, rank trajectory, skill). The UI treats an empty
        # analytics object as "no forward-signals section".
        if uses_reduced_surface(cat):
            out[code] = {}
            continue
        rec = {}

        # ---- Rank trajectory (rolling within-category percentile rank) ----
        # At each month with >= MIN_PEERS funds having a 3Y value, percentile-rank.
        codes_in_cat = [k for k in me_nav if cat_of[k] == c] if False else [k for k in me_nav if cat_of[k] == cat]
        traj = []  # list of [iso_month, percentile 0..100, rank, peers]
        my = roll3y[code]
        for ts in my.index:
            vals = []
            for k in codes_in_cat:
                v = roll3y[k].get(ts)
                if v is not None and pd.notna(v):
                    vals.append((k, v))
            peers = len(vals)
            if peers < 2:
                continue
            vals.sort(key=lambda x: -x[1])  # best first
            rank = next((i + 1 for i, (k, _) in enumerate(vals) if k == code), None)
            if rank is None:
                continue
            pctile = round((peers - rank) / (peers - 1) * 100, 1) if peers > 1 else 100.0
            traj.append([ts.strftime("%Y-%m"), pctile, rank, peers])
        # keep last 36 monthly points to bound size (sparkline needs no more)
        traj = traj[-36:]
        if len(traj) >= 2:
            cur = traj[-1]; prev = traj[-2]
            delta = cur[1] - prev[1]
            direction = "climbing" if delta > 5 else "fading" if delta < -5 else "steady"
            rec["rankTrajectory"] = {
                # sparkline only needs the percentile series (rounded ints)
                "spark": [round(t[1]) for t in traj],
                "currentRank": cur[2], "currentPeers": cur[3],
                "priorRank": prev[2], "priorPeers": prev[3],
                "direction": direction,
                "limited": cur[3] < MIN_PEERS,
            }

        # ---- Batting average (rolling 3Y vs category rolling-3Y median) ----
        cm = cat_roll_median[cat]
        wins = 0; total = 0
        for ts, v in my.items():
            med = cm.get(ts)
            if med is not None and pd.notna(med):
                total += 1
                if v > med:
                    wins += 1
        if total >= 1:
            rec["battingAverage"] = {
                "pct": round(100 * wins / total, 0),
                "n": total,
                "windowM": ROLL_WINDOW_M,
                "limited": total < MIN_BATTING_N,
            }

        # ---- Capture ratios (monthly, vs category-median monthly return) ----
        fr = ret_df[code]
        cr = cat_median_ret[cat]
        aligned = pd.concat([fr, cr], axis=1, keys=["f", "c"]).dropna()
        up = aligned[aligned["c"] > 0]
        dn = aligned[aligned["c"] < 0]
        def capture(block):
            if len(block) < 6:
                return None
            fund_cum = (1 + block["f"]).prod() - 1
            cat_cum = (1 + block["c"]).prod() - 1
            if cat_cum == 0:
                return None
            return round(100 * fund_cum / cat_cum, 0)
        cu = capture(up)
        cd = capture(dn)
        rec["capture"] = {"up": cu, "down": cd, "upMonths": len(up), "downMonths": len(dn)}

        # ---- Alpha significance (one-sided t-test on monthly excess) ----
        excess = (fr - cr).dropna()
        nexc = len(excess)
        if nexc >= MIN_ALPHA_N and excess.std(ddof=1) > 0:
            t = excess.mean() / (excess.std(ddof=1) / np.sqrt(nexc))
            # one-sided p for positive mean
            p = 1 - stats.t.cdf(t, df=nexc - 1)
            conf = round(max(0.0, min(100.0, (1 - p) * 100)), 0)
            rec["alpha"] = {
                "tStat": round(float(t), 2),
                "confidence": float(conf),
                "n": int(nexc),
                "couldBeLuck": conf < ALPHA_CONF_THRESH,
            }
        else:
            rec["alpha"] = {"n": int(nexc), "insufficient": True}

        # ---- Mean reversion (recent 1Y return z-score vs own rolling-1Y) ----
        nav = nav_df[code].dropna()
        if len(nav) >= 36:
            roll1y = []
            idx = nav.index
            for i in range(12, len(idx)):
                n0 = nav.iloc[i - 12]; n1 = nav.iloc[i]
                if n0 > 0:
                    roll1y.append(n1 / n0 - 1)
            roll1y = np.array(roll1y)
            if len(roll1y) >= 24 and roll1y.std(ddof=1) > 0:
                recent = roll1y[-1]
                mu = roll1y[:-1].mean()
                sd = roll1y[:-1].std(ddof=1)
                z = (recent - mu) / sd if sd > 0 else 0.0
                state = "hot" if z > HOT_Z_HOT else "cold" if z < HOT_Z_COLD else "normal"
                rec["meanReversion"] = {
                    "z": round(float(z), 2),
                    "state": state,
                    "recent1Y": round(float(recent) * 100, 1),
                    "norm1Y": round(float(mu) * 100, 1),
                }

        # ---- Regime performance ----
        s_daily = None  # use month-end nav for regime endpoints (approx)
        regrows = []
        navfull = me_nav[code]
        for reg in REGIMES:
            rs = pd.Timestamp(reg["start"]); re = pd.Timestamp(reg["end"])
            seg = navfull[(navfull.index >= rs - pd.Timedelta(days=20)) & (navfull.index <= re + pd.Timedelta(days=20))]
            regime_days = (re - rs).days
            fund_start_in_regime = max(navfull.index.min(), rs)
            coverage_days = (re - fund_start_in_regime).days
            # Mark active if fund covers at least 50% of the regime OR has 2+ data points in range
            if len(seg) < 2 or coverage_days < regime_days * 0.5:
                regrows.append({"name": reg["name"], "active": False})
                continue
            fr_ret = seg.iloc[-1] / seg.iloc[0] - 1
            # category median return over the same regime
            cat_codes = [k for k in me_nav if cat_of[k] == cat]
            crs = []
            for k in cat_codes:
                ks = me_nav[k]
                kseg = ks[(ks.index >= rs - pd.Timedelta(days=20)) & (ks.index <= re + pd.Timedelta(days=20))]
                if len(kseg) >= 2 and ks.index.min() <= rs + pd.Timedelta(days=40):
                    crs.append(kseg.iloc[-1] / kseg.iloc[0] - 1)
            cat_med = float(np.median(crs)) if crs else None
            regrows.append({
                "name": reg["name"], "active": True,
                "ret": round(float(fr_ret) * 100, 1),
                "alpha": round(float(fr_ret - cat_med) * 100, 1) if cat_med is not None else None,
            })
        rec["regimes"] = regrows

        out[str(code)] = rec

    # Clean numpy types for JSON serialization
    out = _clean(out)

    # Write standalone analytics file
    analytics_path = os.path.join(ROOT, "src", "data", "fund_analytics.json")
    json.dump(out, open(analytics_path, "w", encoding="utf-8"), separators=(",", ":"))

    # Merge into funds.json (so the UI picks it up directly)
    funds_path = os.path.join(ROOT, "src", "data", "funds.json")
    if os.path.exists(funds_path):
        fdata = json.load(open(funds_path, encoding="utf-8"))
        merged = 0
        for fund in fdata["funds"]:
            code_str = str(fund["code"])
            if code_str in out:
                fund["analytics"] = out[code_str]
                merged += 1
        # Safe write: write to temp, then rename (prevents corruption on crash)
        tmp_path = funds_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as tmpf:
            json.dump(fdata, tmpf, separators=(",", ":"))
        os.replace(tmp_path, funds_path)
        print(f"\nMerged analytics into funds.json for {merged} funds")
    else:
        print(f"\nWARNING: {funds_path} not found, skipping merge")

    # Coverage report
    nb = sum(1 for r in out.values() if r.get("battingAverage"))
    nt = sum(1 for r in out.values() if r.get("rankTrajectory"))
    na = sum(1 for r in out.values() if r.get("alpha", {}).get("confidence") is not None)
    nr = sum(1 for r in out.values() if r.get("regimes") and any(x.get("active") for x in r["regimes"]))
    print(f"\nWrote fund_analytics.json for {len(out)} funds")
    print(f"  with rank trajectory: {nt}")
    print(f"  with batting average: {nb}")
    print(f"  with alpha confidence: {na}")
    print(f"  with regime data: {nr}")
    print(f"  regimes computed: {len(REGIMES)}")
    print("Params:", {"window_m": ROLL_WINDOW_M, "min_batting_n": MIN_BATTING_N,
                       "min_alpha_n": MIN_ALPHA_N, "alpha_conf_thresh": ALPHA_CONF_THRESH})


if __name__ == "__main__":
    main()
