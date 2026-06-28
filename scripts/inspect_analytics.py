"""Quick inspection of the analytics block distribution across funds.json.
Used to design QA checks (value sets, presence rates, numeric ranges)."""
import json, os
from collections import Counter

ROOT = r"c:\Users\nisan\Documents\1. Work Related\1. Fresh\Kiro"
FUNDS = os.path.join(ROOT, "mf-website-v2", "src", "data", "funds.json")
funds = json.load(open(FUNDS, encoding="utf-8"))["funds"]

present = Counter()
dirs = Counter()
states = Counter()
limited_traj = limited_bat = 0
luck = insuff = 0
n_regimes = Counter()
regime_names = Counter()
cap_null_up = cap_null_down = 0

for f in funds:
    a = f.get("analytics") or {}
    for k in ("rankTrajectory","battingAverage","capture","alpha","meanReversion","regimes"):
        if a.get(k) is not None:
            present[k] += 1
    rt = a.get("rankTrajectory")
    if rt:
        dirs[rt.get("direction")] += 1
        limited_traj += 1 if rt.get("limited") else 0
    ba = a.get("battingAverage")
    if ba:
        limited_bat += 1 if ba.get("limited") else 0
    cap = a.get("capture")
    if cap:
        cap_null_up += 1 if cap.get("up") is None else 0
        cap_null_down += 1 if cap.get("down") is None else 0
    al = a.get("alpha")
    if al:
        luck += 1 if al.get("couldBeLuck") else 0
        insuff += 1 if al.get("insufficient") else 0
    mr = a.get("meanReversion")
    if mr:
        states[mr.get("state")] += 1
    rg = a.get("regimes")
    if rg is not None:
        n_regimes[len(rg)] += 1
        for r in rg:
            regime_names[r.get("name")] += 1

print("total funds:", len(funds))
print("present:", dict(present))
print("trajectory directions:", dict(dirs), "| limited:", limited_traj)
print("batting limited:", limited_bat)
print("capture null up/down:", cap_null_up, cap_null_down)
print("alpha couldBeLuck:", luck, "| insufficient:", insuff)
print("meanReversion states:", dict(states))
print("n_regimes per fund:", dict(n_regimes))
print("regime names:", dict(regime_names))

# numeric range scan
import math
issues = []
for f in funds:
    a = f.get("analytics") or {}
    ba = a.get("battingAverage")
    if ba and ba.get("pct") is not None and not (0 <= ba["pct"] <= 100):
        issues.append((f["code"], "batting", ba["pct"]))
    al = a.get("alpha")
    if al and al.get("confidence") is not None and not (0 <= al["confidence"] <= 100):
        issues.append((f["code"], "alphaConf", al["confidence"]))
    rt = a.get("rankTrajectory")
    if rt:
        for p in rt.get("spark", []):
            if not (0 <= p <= 100):
                issues.append((f["code"], "spark", p)); break
print("numeric issues:", issues[:10], "count", len(issues))


# ---- numeric range + finiteness scan (for QA bound-setting) ----
def rng(vals):
    vals = [v for v in vals if isinstance(v, (int, float))]
    return (round(min(vals), 1), round(max(vals), 1)) if vals else (None, None)

cap_up=[]; cap_down=[]; mz=[]; reg_ret=[]; reg_alpha=[]; aconf=[]; atstat=[]; nonfinite=[]
for f in funds:
    a = f.get("analytics") or {}
    cap = a.get("capture") or {}
    cap_up.append(cap.get("up")); cap_down.append(cap.get("down"))
    mr = a.get("meanReversion") or {}
    if mr: mz.append(mr.get("z"))
    al = a.get("alpha") or {}
    if al.get("confidence") is not None: aconf.append(al["confidence"])
    if al.get("tStat") is not None: atstat.append(al["tStat"])
    for r in (a.get("regimes") or []):
        if r.get("ret") is not None: reg_ret.append(r["ret"])
        if r.get("alpha") is not None: reg_alpha.append(r["alpha"])
    # finiteness
    for k,v in [("z",mr.get("z")),("up",cap.get("up")),("down",cap.get("down"))]:
        if isinstance(v,float) and not math.isfinite(v): nonfinite.append((f["code"],k,v))
print("\ncapture up range:", rng(cap_up), "down range:", rng(cap_down))
print("meanRev z range:", rng(mz))
print("alpha confidence range:", rng(aconf), "tStat range:", rng(atstat))
print("regime ret range:", rng(reg_ret), "alpha range:", rng(reg_alpha))
print("non-finite values:", nonfinite[:10], "count", len(nonfinite))
