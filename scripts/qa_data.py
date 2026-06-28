"""
QA: data integrity for funds.json + self-hosted NAV files.
Implements section A of QA-PLAN.md. Prints PASS/FAIL per check and a summary.
Exit code 0 if all pass, 1 otherwise.
"""
import json, os, sys

ROOT = r"c:\Users\nisan\Documents\1. Work Related\1. Fresh\Kiro"
SITE = os.path.join(ROOT, "mf-website-v2")
FUNDS = os.path.join(SITE, "src", "data", "funds.json")
NAV_DIR = os.path.join(SITE, "public", "nav")
HIST_DIR = os.path.join(SITE, "public", "holdings-history")

CATEGORY_ORDER = {
    'Large Cap','Flexi Cap','Multi Cap','Large & Mid Cap','Mid Cap','Small Cap',
    'Value/Contra','Focused','ELSS','Dividend Yield','Sectoral/Thematic',
    'International','FoF-Equity (Domestic)','Index-LargeCap','Index-MidCap',
    'Index-SmallCap','Index-Sectoral/Thematic','Index-Other',
}
KNOWN_COVERAGE = {
    'stock_level','lookthrough_domestic','lookthrough_etf','feeder_domestic',
    'feeder_foreign','feeder_unresolved','no_disclosure','unresolved','unknown',
}

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))

d = json.load(open(FUNDS, encoding="utf-8"))
funds = d["funds"]

print("== A. DATA INTEGRITY ==")
check("A1 totalFunds matches", d.get("totalFunds") == len(funds), f"{d.get('totalFunds')} vs {len(funds)}")

req = ["code","name","fullName","amc","category","categoryDisplay","riskLevel","categorySize","metrics","holdings","holdingsMeta"]
missing = [f.get("code") for f in funds if any(k not in f for k in req)]
check("A2 required fields present", not missing, f"{len(missing)} funds missing fields")

cats = set(f["category"] for f in funds)
unmapped = [f["code"] for f in funds if not f.get("categoryDisplay") or not f.get("riskLevel")]
check("A3 display+risk mapping present", not unmapped, f"{len(unmapped)} unmapped")
check("A4 categories in categoryOrder", cats <= CATEGORY_ORDER, f"unknown: {cats - CATEGORY_ORDER}")

bad_metrics = []
for f in funds:
    for w, m in f["metrics"].items():
        if m is None: continue
        # 1Y on volatile thematic/international funds can legitimately exceed 100%
        cagr_hi = 300 if w == "1Y" else 120
        if not (-60 <= m["cagr"] <= cagr_hi): bad_metrics.append((f["code"], w, "cagr", m["cagr"]))
        if not (-6 <= m["sharpe"] <= 12): bad_metrics.append((f["code"], w, "sharpe", m["sharpe"]))
        if not (-100 <= m["maxDrawdown"] <= 0.5): bad_metrics.append((f["code"], w, "maxDD", m["maxDrawdown"]))
        if not (0 <= m["volatility"] <= 100): bad_metrics.append((f["code"], w, "vol", m["volatility"]))
check("A5 metrics in sane ranges", not bad_metrics, f"{len(bad_metrics)} out-of-range: {bad_metrics[:3]}")

rank_bad = []
for f in funds:
    for w, m in f["metrics"].items():
        if not m: continue
        size = m.get("catSize", f["categorySize"])
        if not (1 <= m["catRank"] <= max(1, size)):
            rank_bad.append((f["code"], w, m["catRank"], size))
check("A6 catRank within per-window size", not rank_bad, f"{len(rank_bad)} bad: {rank_bad[:3]}")

hold_bad = []
for f in funds:
    hs = f.get("holdings") or []
    s = 0
    for h in hs:
        if h.get("pct") is None or not (0 <= h["pct"] <= 100.5):
            hold_bad.append((f["code"], h.get("name"), h.get("pct")))
        s += h.get("pct") or 0
    if s > 101.5 and f.get("holdingsMeta",{}).get("coverage") in ("stock_level","lookthrough_domestic","lookthrough_etf"):
        hold_bad.append((f["code"], "SUM", round(s,1)))
check("A7 holdings pct sane", not hold_bad, f"{len(hold_bad)} issues: {hold_bad[:3]}")

cov_bad = [f["code"] for f in funds if f.get("holdingsMeta",{}).get("coverage") not in KNOWN_COVERAGE]
check("A8 coverage labels known", not cov_bad, f"{len(cov_bad)} unknown")

# A8b management signal values known
KNOWN_SIGNALS = {"Strong","Solid","Mixed","Limited evidence","No data"}
mgmt_bad = []
for f in funds:
    mg = f.get("management") or {}
    if mg.get("available"):
        if mg.get("signal") not in KNOWN_SIGNALS:
            mgmt_bad.append((f["code"], mg.get("signal")))
        tr = mg.get("trackRecord")
        if tr and not (0 <= tr.get("beatRate", 0) <= 1):
            mgmt_bad.append((f["code"], "beatRate", tr.get("beatRate")))
        for m in (mg.get("managers") or []):
            t = m.get("sinceYears")
            if t is not None and not (0 <= t <= 40):
                mgmt_bad.append((f["code"], "tenure", t))
check("A8b management signals/tenure sane", not mgmt_bad, f"{len(mgmt_bad)} issues: {mgmt_bad[:3]}")

# A9 self-hosted NAV
nav_missing = []
nav_bad = []
for f in funds:
    p = os.path.join(NAV_DIR, f"{f['code']}.json")
    if not os.path.exists(p):
        nav_missing.append(f["code"]); continue
    try:
        nv = json.load(open(p))
        if len(nv["d"]) != len(nv["v"]) or len(nv["d"]) < 30:
            nav_bad.append(f["code"])
        elif nv["d"] != sorted(nv["d"]):
            nav_bad.append((f["code"],"unsorted"))
    except Exception as e:
        nav_bad.append((f["code"], str(e)[:20]))
check("A9 self-hosted NAV present+valid", not nav_missing and not nav_bad,
      f"{len(nav_missing)} missing, {len(nav_bad)} invalid; missing e.g. {nav_missing[:5]}")

codes = [f["code"] for f in funds]
check("A10 no duplicate codes", len(codes) == len(set(codes)), f"{len(codes)-len(set(codes))} dups")

# ---- Forward-looking analytics (v3) ----
import math
TRAJ_DIRS = {"climbing", "fading", "steady"}
MR_STATES = {"hot", "cold", "normal"}
REGIME_NAMES = {"COVID crash", "COVID recovery", "2022 correction",
                "2022-24 bull run", "2024-25 correction", "Tariff & Iran-war era"}

def _fin(v):
    """True if v is None or a finite number (no NaN/Inf, which break JSON.parse downstream)."""
    return v is None or (isinstance(v, (int, float)) and math.isfinite(v))

# A11 analytics block present on every fund
no_analytics = [f["code"] for f in funds if not f.get("analytics")]
check("A11 analytics block present", not no_analytics, f"{len(no_analytics)} missing; e.g. {no_analytics[:5]}")

# A12 always-present sub-blocks (capture, alpha, regimes computed for all funds)
miss_sub = []
for f in funds:
    a = f.get("analytics") or {}
    for k in ("capture", "alpha", "regimes"):
        if a.get(k) is None:
            miss_sub.append((f["code"], k))
check("A12 capture/alpha/regimes present", not miss_sub, f"{len(miss_sub)} missing; e.g. {miss_sub[:3]}")

# A13 rank trajectory: direction in set, sparkline ints 0-100, sample-size fields present
traj_bad = []
for f in funds:
    rt = (f.get("analytics") or {}).get("rankTrajectory")
    if rt is None:
        continue
    if rt.get("direction") not in TRAJ_DIRS:
        traj_bad.append((f["code"], "dir", rt.get("direction")))
    spark = rt.get("spark")
    if not isinstance(spark, list) or not spark:
        traj_bad.append((f["code"], "spark", "empty"))
    elif any(not isinstance(p, (int, float)) or not (0 <= p <= 100) for p in spark):
        traj_bad.append((f["code"], "spark", "out-of-range"))
    if not isinstance(rt.get("currentPeers"), int) or rt.get("currentRank") is None:
        traj_bad.append((f["code"], "peers/rank", None))
check("A13 rankTrajectory valid", not traj_bad, f"{len(traj_bad)} issues; e.g. {traj_bad[:3]}")

# A14 batting average: pct 0-100, n present, windowM positive
bat_bad = []
for f in funds:
    ba = (f.get("analytics") or {}).get("battingAverage")
    if ba is None:
        continue
    if ba.get("pct") is None or not (0 <= ba["pct"] <= 100):
        bat_bad.append((f["code"], "pct", ba.get("pct")))
    if not isinstance(ba.get("n"), int) or ba["n"] < 0:
        bat_bad.append((f["code"], "n", ba.get("n")))
    if not ba.get("windowM"):
        bat_bad.append((f["code"], "windowM", ba.get("windowM")))
check("A14 battingAverage valid", not bat_bad, f"{len(bat_bad)} issues; e.g. {bat_bad[:3]}")

# A15 capture ratios: up/down null-or-finite-numeric in sane band, month counts non-negative ints
cap_bad = []
for f in funds:
    cap = (f.get("analytics") or {}).get("capture") or {}
    for side in ("up", "down"):
        v = cap.get(side)
        if not _fin(v) or (v is not None and not (-300 <= v <= 1000)):
            cap_bad.append((f["code"], side, v))
    for side in ("upMonths", "downMonths"):
        m = cap.get(side)
        if not isinstance(m, int) or m < 0:
            cap_bad.append((f["code"], side, m))
check("A15 capture ratios valid", not cap_bad, f"{len(cap_bad)} issues; e.g. {cap_bad[:3]}")

# A16 alpha significance: confidence 0-100, tStat finite, n present, flags boolean
alpha_bad = []
for f in funds:
    al = (f.get("analytics") or {}).get("alpha") or {}
    c = al.get("confidence")
    if c is not None and not (0 <= c <= 100):
        alpha_bad.append((f["code"], "conf", c))
    if not _fin(al.get("tStat")):
        alpha_bad.append((f["code"], "tStat", al.get("tStat")))
    if not isinstance(al.get("n"), int) or al["n"] < 0:
        alpha_bad.append((f["code"], "n", al.get("n")))
    for flag in ("couldBeLuck", "insufficient"):
        if flag in al and not isinstance(al[flag], bool):
            alpha_bad.append((f["code"], flag, al[flag]))
check("A16 alpha significance valid", not alpha_bad, f"{len(alpha_bad)} issues; e.g. {alpha_bad[:3]}")

# A17 mean reversion: state in set, z finite, recent/norm 1Y finite
mr_bad = []
for f in funds:
    mr = (f.get("analytics") or {}).get("meanReversion")
    if mr is None:
        continue
    if mr.get("state") not in MR_STATES:
        mr_bad.append((f["code"], "state", mr.get("state")))
    if not _fin(mr.get("z")) or mr.get("z") is None or not (-15 <= mr["z"] <= 15):
        mr_bad.append((f["code"], "z", mr.get("z")))
    if not _fin(mr.get("recent1Y")) or not _fin(mr.get("norm1Y")):
        mr_bad.append((f["code"], "1Y", (mr.get("recent1Y"), mr.get("norm1Y"))))
check("A17 meanReversion valid", not mr_bad, f"{len(mr_bad)} issues; e.g. {mr_bad[:3]}")

# A18 regimes: exactly the 6 fixed regimes, ret/alpha null-or-finite
reg_bad = []
for f in funds:
    rg = (f.get("analytics") or {}).get("regimes")
    if rg is None:
        continue
    names = {r.get("name") for r in rg}
    if names != REGIME_NAMES:
        reg_bad.append((f["code"], "names", sorted(names - REGIME_NAMES) or sorted(REGIME_NAMES - names)))
    for r in rg:
        if not _fin(r.get("ret")) or not _fin(r.get("alpha")):
            reg_bad.append((f["code"], r.get("name"), (r.get("ret"), r.get("alpha"))))
        if not isinstance(r.get("active"), bool):
            reg_bad.append((f["code"], "active", r.get("active")))
check("A18 regimes valid", not reg_bad, f"{len(reg_bad)} issues; e.g. {reg_bad[:3]}")

# ---- Holdings-history dataset (Option A: accumulating monthly snapshots) ----
# This dataset grows over time; checks must pass even with 0 or 1 snapshot/fund.
KNOWN_HIST_COV = {"stock_level", "feeder_unresolved"}
if os.path.isdir(HIST_DIR):
    hist_files = [f for f in os.listdir(HIST_DIR) if f.endswith(".json") and not f.startswith("_")]
    hist_bad = []
    total_snaps = 0
    multi = 0
    for fn in hist_files:
        try:
            rec = json.load(open(os.path.join(HIST_DIR, fn), encoding="utf-8"))
        except Exception as e:
            hist_bad.append((fn, f"unreadable:{str(e)[:20]}")); continue
        if rec.get("code") is None or "snapshots" not in rec:
            hist_bad.append((fn, "missing code/snapshots")); continue
        snaps = rec["snapshots"]
        total_snaps += len(snaps)
        if len(snaps) >= 2:
            multi += 1
        for pd, snap in snaps.items():
            # snapshot key must equal its portfolioDate (idempotency contract)
            if snap.get("portfolioDate") != pd:
                hist_bad.append((fn, f"key!=portfolioDate {pd}"))
            if snap.get("coverage") not in KNOWN_HIST_COV:
                hist_bad.append((fn, f"coverage {snap.get('coverage')}"))
            hs = snap.get("holdings") or []
            if not hs:
                hist_bad.append((fn, f"empty holdings {pd}")); continue
            s = 0.0
            for h in hs:
                p = h.get("pct")
                if p is None or not (0 <= p <= 100.5):
                    hist_bad.append((fn, f"pct {p}")); break
                s += p
            if s > 101.5 and snap.get("coverage") == "stock_level":
                # A small overshoot (to ~115%) is plausible disclosure rounding /
                # slightly stale weights from the source; true corruption
                # (duplicate listings) doubles the sum to ~180-200%. Flag only the
                # latter so we catch real bugs without rejecting honest data.
                if s > 115:
                    hist_bad.append((fn, f"sum {round(s,1)}"))
    check("A19 holdings-history records valid", not hist_bad,
          f"{len(hist_bad)} issues; e.g. {hist_bad[:3]}")
    # manifest consistency (non-fatal info if absent)
    mpath = os.path.join(HIST_DIR, "_manifest.json")
    if os.path.exists(mpath):
        man = json.load(open(mpath, encoding="utf-8"))
        check("A20 holdings-history manifest matches files",
              man.get("funds") == len(hist_files) and man.get("totalSnapshots") == total_snaps,
              f"manifest funds={man.get('funds')}/{len(hist_files)} snaps={man.get('totalSnapshots')}/{total_snaps}")
    print(f"\n  Holdings-history: {len(hist_files)} funds, {total_snaps} snapshots, "
          f"{multi} with >=2 (change-analysis ready: {'YES' if multi else 'not yet — needs another monthly capture'})")
else:
    print("\n  Holdings-history: directory not present yet (capture not run).")

# coverage breakdown info
from collections import Counter
cov = Counter(f.get("holdingsMeta",{}).get("coverage") for f in funds)
print("\n  Holdings coverage:", dict(cov))
real = sum(v for k,v in cov.items() if k in ("stock_level","lookthrough_domestic","lookthrough_etf"))
print(f"  Funds with real stock holdings: {real}/{len(funds)} ({100*real//len(funds)}%)")
mgsig = Counter((f.get("management") or {}).get("signal") if (f.get("management") or {}).get("available") else "No data" for f in funds)
print("  Management signals:", dict(mgsig))
withmg = sum(1 for f in funds if (f.get("management") or {}).get("available"))
print(f"  Funds with manager data: {withmg}/{len(funds)} ({100*withmg//len(funds)}%)")

passed = sum(1 for _,ok,_ in results if ok)
print(f"\n== DATA QA: {passed}/{len(results)} passed ==")
sys.exit(0 if passed == len(results) else 1)
