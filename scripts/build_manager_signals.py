"""
Build objective manager-quality signals from fetched manager data + our metrics.
================================================================================
For each fund we produce a `management` block with two lenses:

1. CROSS-FUND track record (unchanged): how the managers' OTHER funds have done
   vs peers. This is genuine "does this person generally beat peers?" evidence.

2. TENURE-WINDOW performance (NEW): what has THIS fund done SINCE the current
   lead manager took over, vs the category median over the SAME window. This
   answers "what has actually happened here since they arrived?" and honestly
   separates manager contribution from market environment.

Signal classification uses BOTH lenses:
- Short tenure (<1.5 yrs): the cross-fund signal gets a "too early to tell"
  caveat regardless of what's happening, because short windows are unreliable.
  If the fund is doing great, we flag "could be market timing"; if poorly, we
  flag "early concern" but note the market context.
- Adequate tenure (≥1.5 yrs): if the fund has NEGATIVE alpha under this manager
  vs the category, we CAP the signal at "Mixed" regardless of cross-fund record.
  Good cross-fund record + poor here = the record isn't translating. Conversely,
  positive alpha under them CONFIRMS the cross-fund signal.

This prevents:
- Calling a fund "Strong management" when the manager just arrived 6 months ago
  during a bull run (could be luck/market timing).
- Calling it "Strong" when the new manager's 6-month track is awful (the cross-
  fund record is outdated or irrelevant to this mandate).
- Blaming the manager when the whole category fell equally (market context).

Output:
  - manager_signals.json under the repo root (intermediate audit artifact)
  - each fund's block merged into public/fund-data/{code}.json under key "management"

"""
import json, os
from datetime import datetime
from statistics import median
import numpy as np

from pathlib import Path

# Repo-relative root. In CI the repo root IS the site root; in the local dev
# workspace the site lives under mf-website-v2/. Resolve both layouts.
ROOT = str(Path(__file__).resolve().parent.parent)

def _pick_dir(cands):
    for c in cands:
        if os.path.isdir(c):
            return c
    return cands[0]  # canonical (repo-root) default even if absent

SRC_DATA = _pick_dir([
    os.path.join(ROOT, "src", "data"),                    # repo-root layout (CI)
    os.path.join(ROOT, "mf-website-v2", "src", "data"),   # local dev workspace
])
PUBLIC = _pick_dir([
    os.path.join(ROOT, "public"),
    os.path.join(ROOT, "mf-website-v2", "public"),
])
NAV_DIR = os.path.join(PUBLIC, "nav")                     # public/nav/{code}.json (mfapi-style)
HIST_DIR = os.path.join(PUBLIC, "holdings-history")
FUND_DATA_DIR = os.path.join(PUBLIC, "fund-data")
ANCHOR = datetime.now()                                   # tenure/return windows run up to "now"
MIN_TENURE_YEARS = 1.5  # below this = "too early to tell"

managers_raw = json.load(open(os.path.join(SRC_DATA, "fund_managers.json"), encoding="utf-8"))
funds_data = json.load(open(os.path.join(SRC_DATA, "funds.json"), encoding="utf-8"))
fund_by_code = {f["code"]: f for f in funds_data["funds"]}

def best_metric(fund):
    """Return (alpha, rank, size, basis) using 3Y else 5Y else 1Y."""
    for w in ["3Y", "5Y", "1Y"]:
        m = fund.get("metrics", {}).get(w)
        if m:
            return m.get("alpha"), m.get("catRank"), m.get("catSize"), w
    return None, None, None, None

def years_since(iso):
    if not iso:
        return None
    try:
        d = datetime.strptime(iso[:10], "%Y-%m-%d")
        return round((ANCHOR - d).days / 365.25, 1)
    except:
        return None

# Build a map: manager name -> set of universe fund codes they manage (from the
# funds_managed lists, intersected with our universe so it's apples-to-apples).
mgr_funds = {}
for code_s, rec in managers_raw.items():
    for m in rec.get("managers", []):
        nm = m["name"]
        s = mgr_funds.setdefault(nm, set())
        for fmd in m.get("fundsManaged", []):
            c = fmd.get("code")
            if c in fund_by_code:
                s.add(c)
        # also include the current fund itself
        try:
            s.add(int(code_s))
        except:
            pass

def manager_track_record(manager_names, exclude_code):
    """Aggregate cross-fund evidence for a set of managers, excluding the fund
    being viewed (so it's genuinely OTHER-fund evidence; fall back to include
    it only if the manager has no other funds)."""
    codes = set()
    for nm in manager_names:
        codes |= mgr_funds.get(nm, set())
    other = codes - {exclude_code}
    use = other if other else codes  # if only manages this fund, use it (flagged later)
    alphas, ranks_share, sample = [], [], []
    basis_count = {}
    for c in use:
        f = fund_by_code.get(c)
        if not f:
            continue
        a, rank, size, basis = best_metric(f)
        if a is None:
            continue
        alphas.append(a)
        basis_count[basis] = basis_count.get(basis, 0) + 1
        if rank and size:
            ranks_share.append(1.0 if rank <= max(1, size / 4) else 0.0)
        sample.append({"name": f["name"], "code": c, "alpha": a,
                       "rank": rank, "size": size})
    if not alphas:
        return None
    sample.sort(key=lambda x: (x["alpha"] is None, -(x["alpha"] or 0)))
    basis = max(basis_count, key=basis_count.get) if basis_count else None
    return {
        "funds": len(alphas),
        "medianAlpha": round(median(alphas), 2),
        "beatRate": round(sum(1 for a in alphas if a > 0) / len(alphas), 2),
        "topRankShare": round(sum(ranks_share) / len(ranks_share), 2) if ranks_share else None,
        "basis": basis,
        "usedOtherFunds": bool(other),
        "sampleFunds": sample[:6],
    }

def compute_tenure_alpha(code, lead_since_iso, category, nav_mem):
    """Compute fund alpha vs category median OVER THE LEAD MANAGER'S TENURE.
    Returns dict with alpha, fund/cat returns, months, and the categoryUpFundDown flag.
    Uses the pre-loaded nav_mem dict (avoids repeated disk IO)."""
    if not lead_since_iso:
        return None
    try:
        start_dt = datetime.strptime(lead_since_iso[:10], "%Y-%m-%d")
    except Exception:
        return None
    # need at least 3 months of tenure to compute anything meaningful
    tenure_days = (ANCHOR - start_dt).days
    if tenure_days < 90:
        return None

    fund_nav = nav_mem.get(code)
    if not fund_nav:
        return None

    def nav_return(raw_data, start_date, end_date):
        """Compute total return from a compact NAV file ({"d":[iso...],
        "v":[nav...]}) between two dates. Dates are ISO and chronological."""
        dates = raw_data.get("d") or []
        vals = raw_data.get("v") or []
        if not dates or len(dates) != len(vals):
            return None
        pts = sorted(
            ((d, n) for d, n in zip(dates, vals) if isinstance(n, (int, float)) and n > 0),
            key=lambda x: x[0],
        )
        if not pts:
            return None
        start_iso = start_date.strftime("%Y-%m-%d")
        end_iso = end_date.strftime("%Y-%m-%d")
        after_start = [(d, n) for d, n in pts if d >= start_iso]
        before_end = [(d, n) for d, n in pts if d <= end_iso]
        if not after_start or not before_end:
            return None
        start_nav = after_start[0][1]
        end_nav = before_end[-1][1]
        if start_nav <= 0:
            return None
        return (end_nav / start_nav - 1) * 100

    fund_ret = nav_return(fund_nav, start_dt, ANCHOR)
    if fund_ret is None:
        return None

    # compute category-median return over the same window (from memory)
    cat_funds = [f for f in funds_data["funds"] if f.get("category") == category and f["code"] != code]
    cat_rets = []
    for cf in cat_funds:
        raw = nav_mem.get(cf["code"])
        if not raw:
            continue
        r = nav_return(raw, start_dt, ANCHOR)
        if r is not None:
            cat_rets.append(r)

    if len(cat_rets) < 3:
        return None
    cat_median_ret = float(np.median(cat_rets))
    alpha = fund_ret - cat_median_ret
    months = round(tenure_days / 30.4)

    # Detect the strongest negative pattern: category did well but this fund didn't.
    category_up_fund_down = cat_median_ret > 3 and fund_ret < cat_median_ret - 5

    return {
        "alpha": round(alpha, 1),
        "fundReturn": round(fund_ret, 1),
        "categoryReturn": round(cat_median_ret, 1),
        "months": months,
        "categoryUpFundDown": category_up_fund_down,
    }


# ---- Holdings-change analysis (when >=2 snapshots exist) ----
# HIST_DIR defined in the config block at the top of this file

def compute_holdings_moves(code, lead_since_iso):
    """If we have >=2 holdings snapshots for this fund, compute what changed
    since the manager arrived: stocks added, exited, and a simple quality score
    (did the adds outperform the exits on average?). Returns None if insufficient data."""
    hist_path = os.path.join(HIST_DIR, f"{code}.json")
    if not os.path.exists(hist_path):
        return None
    try:
        rec = json.load(open(hist_path, encoding="utf-8"))
    except Exception:
        return None
    snaps = rec.get("snapshots", {})
    if len(snaps) < 2:
        return None  # need at least 2 to compute a diff

    # Sort snapshots by date
    dates = sorted(snaps.keys())
    # Find the snapshot closest to (and on or after) the manager's start date
    manager_start = lead_since_iso[:10] if lead_since_iso else None
    if manager_start:
        pre_mgr = [d for d in dates if d < manager_start]
        post_mgr = [d for d in dates if d >= manager_start]
        if pre_mgr and post_mgr:
            before_snap = snaps[pre_mgr[-1]]
            after_snap = snaps[post_mgr[-1]]  # latest
        else:
            # No snapshot from before this manager, use oldest vs latest
            before_snap = snaps[dates[0]]
            after_snap = snaps[dates[-1]]
    else:
        before_snap = snaps[dates[0]]
        after_snap = snaps[dates[-1]]

    # Compute diff: added, exited, increased, decreased
    before_holdings = {h["key"]: h for h in before_snap.get("holdings", []) if h.get("key")}
    after_holdings = {h["key"]: h for h in after_snap.get("holdings", []) if h.get("key")}

    added = [after_holdings[k] for k in after_holdings if k not in before_holdings]
    exited = [before_holdings[k] for k in before_holdings if k not in after_holdings]

    if not added and not exited:
        return None  # no meaningful changes

    # Quality indicator: are the adds generally higher-weight (conviction buys)?
    avg_add_wt = sum(h["pct"] for h in added) / len(added) if added else 0
    avg_exit_wt = sum(h["pct"] for h in exited) / len(exited) if exited else 0

    return {
        "available": True,
        "fromDate": before_snap.get("portfolioDate") or dates[0],
        "toDate": after_snap.get("portfolioDate") or dates[-1],
        "added": len(added),
        "exited": len(exited),
        "topAdds": [{"name": h["name"], "pct": h["pct"]} for h in sorted(added, key=lambda x: -x["pct"])[:5]],
        "topExits": [{"name": h["name"], "pct": h["pct"]} for h in sorted(exited, key=lambda x: -x["pct"])[:5]],
        "avgAddWeight": round(avg_add_wt, 2),
        "avgExitWeight": round(avg_exit_wt, 2),
    }


def classify(tr, avg_tenure, tenure_perf, lead_tenure_yrs):
    """Classify the management signal using BOTH lenses:
    1. Cross-fund track record (tr)
    2. Tenure-window performance at THIS fund (tenure_perf)"""
    if not tr:
        return "No data", "Manager track record isn't available for this fund."

    n = tr["funds"]
    ma = tr["medianAlpha"]
    beat = tr["beatRate"]

    # ---- Thin evidence: too few other funds to judge ----
    if n < 3:
        if not tr["usedOtherFunds"]:
            return ("Limited evidence",
                    "These managers run only this fund in our universe, so there's no independent cross-fund track record to judge yet.")
        return ("Limited evidence",
                f"Only {n} other fund(s) by these managers are in our universe, too small a sample to judge skill reliably (median alpha {ma:+.1f}%/yr).")

    # ---- Determine the BASE signal from cross-fund record ----
    if ma >= 2 and beat >= 0.6:
        base_signal = "Strong"
        base_note = f"Across {n} funds these managers run, the median peer-relative alpha is {ma:+.1f}%/yr and {int(beat*100)}% beat their category."
    elif ma > 0 and beat >= 0.5:
        base_signal = "Solid"
        base_note = f"Across {n} funds, median alpha {ma:+.1f}%/yr with {int(beat*100)}% beating their category."
    else:
        base_signal = "Mixed"
        base_note = f"Across {n} funds, median alpha {ma:+.1f}%/yr and {int(beat*100)}% beat their category, an inconsistent record."

    # ---- Apply tenure-window overlay (the new lens) ----
    if lead_tenure_yrs is not None and lead_tenure_yrs < MIN_TENURE_YEARS:
        # SHORT TENURE: too early to attribute anything to this manager.
        months_str = f"{int(lead_tenure_yrs * 12)} months" if lead_tenure_yrs < 1 else f"{lead_tenure_yrs:.1f} yrs"
        caveat = f" However, the lead manager has been here only {months_str}, too early to attribute this fund's recent performance to them."
        if tenure_perf:
            tp = tenure_perf
            if tp["alpha"] > 5:
                caveat += (f" The fund returned {tp['fundReturn']:+.1f}% since they joined "
                           f"(category median {tp['categoryReturn']:+.1f}%), looks good, but "
                           f"a {tp['months']}-month window can't distinguish skill from market timing.")
            elif tp["alpha"] < -5:
                caveat += (f" The fund returned {tp['fundReturn']:+.1f}% since they joined "
                           f"(category median {tp['categoryReturn']:+.1f}%), an early concern, "
                           f"though {tp['months']} months isn't enough to judge conclusively. "
                           f"{'The whole category fell similarly.' if tp['categoryReturn'] < -5 else 'The category did better, suggesting fund-specific weakness.'}")
        # Signal stays at its base level but with a clear caveat
        return (base_signal + " *", base_note + caveat)

    if tenure_perf and lead_tenure_yrs is not None and lead_tenure_yrs >= MIN_TENURE_YEARS:
        tp = tenure_perf
        # ADEQUATE TENURE: we can meaningfully judge performance under this manager.
        if tp["alpha"] < -3:
            # Fund is UNDERPERFORMING its category since this manager took over.
            # Cap at "Mixed" regardless of cross-fund record, the record isn't
            # translating to this fund.
            if base_signal in ("Strong", "Solid"):
                if tp.get("categoryUpFundDown"):
                    # STRONGEST caution: category thrived but fund didn't. This is
                    # NOT macro, it's management-specific underperformance.
                    downgrade_note = (
                        f" CAUTION: since the current lead manager took over ({tp['months']} months ago), "
                        f"this fund returned {tp['fundReturn']:+.1f}% while the category median returned "
                        f"{tp['categoryReturn']:+.1f}%. The category did well but this fund didn't, "
                        f"this points to fund-specific issues under the current management, not macro headwinds."
                    )
                else:
                    downgrade_note = (
                        f" But since the current lead manager took over ({tp['months']} months ago), "
                        f"this fund returned {tp['fundReturn']:+.1f}% vs the category median's "
                        f"{tp['categoryReturn']:+.1f}%, a {tp['alpha']:+.1f}% gap. "
                        f"{'The category also struggled (macro headwinds), but this fund fared worse.' if tp['categoryReturn'] < 0 else 'The category did fine; this fund lagged, the cross-fund record may not be translating here.'}"
                    )
                return ("Mixed", base_note + downgrade_note)
            # Already Mixed or worse, add context with the category-up-fund-down flag
            addendum = (f" Since the current manager took over ({tp['months']} months), "
                        f"alpha vs category is {tp['alpha']:+.1f}%.")
            if tp.get("categoryUpFundDown"):
                addendum += " Notably, the category performed well in this period but this fund lagged, a fund-specific concern."
            return (base_signal, base_note + addendum)
        elif tp["alpha"] > 3:
            # Positive alpha under this manager confirms the cross-fund signal.
            confirm_note = (f" Confirmed at this fund: since the lead manager took over "
                            f"({tp['months']} months), alpha vs the category is {tp['alpha']:+.1f}%.")
            return (base_signal, base_note + confirm_note)
        else:
            # Alpha near zero, neutral, no modification.
            neutral_note = (f" Under the current lead ({tp['months']} months), this fund has tracked "
                            f"its category closely ({tp['alpha']:+.1f}% alpha).")
            return (base_signal, base_note + neutral_note)

    return (base_signal, base_note)

out = {}
processed = 0
total_funds = len(fund_by_code)
import time as _time
_t0 = _time.time()

# Pre-load all NAV data into memory (avoids re-reading JSON for every peer in
# every fund's tenure-alpha calculation, ~42,000 redundant reads otherwise).
print("Pre-loading NAV files into memory...")
_nav_mem = {}
for code in fund_by_code:
    p = os.path.join(NAV_DIR, f"{code}.json")
    if os.path.exists(p):
        try:
            _nav_mem[code] = json.load(open(p, encoding="utf-8"))
        except:
            pass
print(f"  loaded {len(_nav_mem)} fund NAVs into memory")

for code, fund in fund_by_code.items():
    if fund.get("isDebt"):
        continue  # debt funds have no manager signals; ManagementCard is hidden for them
    processed += 1
    if processed % 100 == 0:
        elapsed = _time.time() - _t0
        rate = processed / elapsed if elapsed > 0 else 0
        print(f"  {processed}/{total_funds} ({rate:.0f} funds/s)")
    rec = managers_raw.get(str(code), {})
    mgrs = rec.get("managers", [])
    if not mgrs:
        out[code] = {"available": False}
        continue
    names = [m["name"] for m in mgrs]
    tenures = [years_since(m.get("since")) for m in mgrs if years_since(m.get("since")) is not None]
    avg_tenure = round(sum(tenures) / len(tenures), 1) if tenures else None
    lead = None
    lead_since = None
    lead_tenure = None
    # lead = longest tenure
    best_t = -1
    for m in mgrs:
        t = years_since(m.get("since"))
        if t is not None and t > best_t:
            best_t = t; lead = m["name"]; lead_since = m.get("since"); lead_tenure = t

    # TEAM-LEVEL turnover: if the majority of the team changed recently, the fund
    # has effectively "new management" regardless of any single holdover. The one
    # long-tenure manager doesn't mask instability when 80% of the team is new.
    new_mgr_count = sum(1 for t in tenures if t is not None and t < 1.0)
    team_size = len(tenures) if tenures else len(mgrs)
    team_recently_changed = team_size >= 2 and new_mgr_count >= team_size * 0.5
    # For the tenure gate, use the MEDIAN tenure when the team recently changed
    # (not the longest-tenured holdover, which masks the real instability).
    effective_tenure = None
    if tenures:
        sorted_tenures = sorted(tenures)
        effective_tenure = sorted_tenures[len(sorted_tenures) // 2] if team_recently_changed else lead_tenure

    tr = manager_track_record(names, code)

    # NEW: compute what happened at THIS fund since the lead manager took over
    tenure_perf = compute_tenure_alpha(code, lead_since, fund.get("category"), _nav_mem)

    # NEW: holdings changes under this manager (when >=2 snapshots exist)
    holdings_moves = compute_holdings_moves(code, lead_since)

    # Cross-reference with forward-looking momentum signals: if the fund is
    # FADING + COLD + bottom-half rank, AND management recently changed, the
    # conclusion should be harsher regardless of the cross-fund record.
    analytics = fund.get("analytics") or {}
    is_fading = analytics.get("rankTrajectory", {}).get("direction") == "fading"
    is_cold = analytics.get("meanReversion", {}).get("state") == "cold"
    m3y = fund.get("metrics", {}).get("3Y") or {}
    is_bottom_half = (m3y.get("catRank") or 999) > (m3y.get("catSize") or 1) / 2

    signal, note = classify(tr, avg_tenure, tenure_perf, effective_tenure)
    signal_key = signal.rstrip(" *")

    # POST-CLASSIFICATION OVERRIDE: team turnover + deteriorating momentum.
    # If the team recently changed AND the fund is showing signs of trouble
    # (fading rank, running cold, or bottom-half), cap at Mixed with a clear
    # warning that ties the management change to the deterioration.
    if team_recently_changed and (is_fading or is_cold or is_bottom_half):
        if signal_key in ("Strong", "Solid"):
            signal_key = "Mixed"
            months_new = int(min(t for t in tenures if t is not None and t < 1.0) * 12)
            fade_reasons = []
            if is_fading: fade_reasons.append("rank is deteriorating")
            if is_cold: fade_reasons.append("running cold vs its own norm")
            if is_bottom_half: fade_reasons.append(f"ranked {m3y.get('catRank')}/{m3y.get('catSize')} in its category")
            note = (
                f"{new_mgr_count} of {team_size} managers joined in the last year, "
                f"effectively a new team. Since the change, the fund's {' and '.join(fade_reasons)}. "
                f"Cross-fund record ({tr['medianAlpha']:+.1f}%/yr median alpha across {tr['funds']} funds) "
                f"looks good on paper, but that record may be from passive/index mandates under these "
                f"managers and may not transfer to this fund's active mandate. Too early to call, watch the next 6-12 months."
            )
    # Also: if effective tenure is short (team-level), add caveat even without fading signals
    elif team_recently_changed and signal_key in ("Strong", "Solid"):
        months_new = int(min(t for t in tenures if t is not None and t < 1.0) * 12)
        note += (f" Note: {new_mgr_count} of {team_size} managers are new (< 1 year). "
                 f"While the longest-serving manager has been here {lead_tenure:.1f} yrs, "
                 f"this level of team turnover means the dynamics may have shifted. Watch for stability.")

    has_caveat = signal != signal_key or (team_recently_changed and signal_key != signal.rstrip(" *"))

    out[code] = {
        "available": True,
        "managers": [{
            "name": m["name"],
            "sinceYears": years_since(m.get("since")),
            "education": m.get("education"),
            "experience": m.get("experience"),
        } for m in mgrs],
        "leadManager": lead,
        "avgTenureYears": avg_tenure,
        "trackRecord": tr,
        "signal": signal_key,
        "tenureCaveat": has_caveat,
        "tenurePerf": tenure_perf,
        "holdingsMoves": holdings_moves,
        "note": note,
    }

json.dump(out, open(os.path.join(ROOT, "manager_signals.json"), "w", encoding="utf-8"))

# Merge each fund's management block into public/fund-data/{code}.json.
# Compact single-line write with no trailing newline matches the committed
# format, so only genuinely changed files are rewritten (no churn).
merged = 0
for code, block in out.items():
    fp = os.path.join(FUND_DATA_DIR, f"{code}.json")
    if not os.path.exists(fp):
        continue
    try:
        fd = json.load(open(fp, encoding="utf-8"))
    except Exception:
        continue
    if fd.get("management") == block:
        continue
    fd["management"] = block
    with open(fp, "w", encoding="utf-8") as _fh:
        json.dump(fd, _fh, ensure_ascii=False, separators=(",", ":"))
    merged += 1
print(f"Merged management block into {merged} fund-data files")

from collections import Counter
sig = Counter(v.get("signal","No data") if v.get("available") else "No data" for v in out.values())
caveats = sum(1 for v in out.values() if v.get("tenureCaveat"))
with_tp = sum(1 for v in out.values() if v.get("tenurePerf"))
downgrades = sum(1 for v in out.values()
                 if v.get("tenurePerf") and v["tenurePerf"]["alpha"] < -3
                 and v.get("signal") == "Mixed" and v.get("trackRecord", {}).get("medianAlpha", 0) >= 2)
print(f"Built manager signals for {len(out)} funds")
print("Signal distribution:", dict(sig))
print(f"With tenure-window alpha computed: {with_tp}")
print(f"With 'too early to tell' caveat (lead < {MIN_TENURE_YEARS}yr): {caveats}")
print(f"Downgraded from Strong/Solid to Mixed (negative tenure alpha): {downgrades}")
withtr = sum(1 for v in out.values() if v.get("available") and v.get("trackRecord"))
print(f"With computable cross-fund track record: {withtr}")
