"""
Build the data behind the Movers page.

Outputs (both lazy-loaded by the page, never by other pages):
  src/data/movers.json         per-fund monthly AUM and estimated net flows, AUM and
                               flow windows, expense-ratio changes, manager joins and
                               departures, and the stock dictionary
  src/data/movers_stocks.json  per-fund stock weight changes over 1 and 3 months

Estimated net flow. AMFI does not publish scheme-level flows, so a month's flow is
estimated from what we have:

    flow = AUM_end - AUM_start * (NAV_end / NAV_start)

i.e. the change in fund size that market movement does not explain. AUM covers all
plans of a scheme while our NAV is the Direct plan, so this is an estimate (the
Direct/Regular return gap is about 0.1% a month). Windows are calendar months
ending at the reference month. A window's flow is the sum of its monthly flows, so
money that came in mid-window is not counted again for the returns it earned later;
a window needs every one of its months, so a fund with a gap in its disclosures
shows no value rather than a wrong one.

Manager departures are not in any source. This script remembers each fund's manager
list from its previous run (movers_state.json) and logs a name that disappears, but only when
the fund's manager record was fetched in both runs, so a failed fetch never reads as
a departure.

Runs after the AUM, cost, manager and holdings steps; before the smoke test.
"""
import bisect
import importlib.util
import json
import os
from collections import Counter
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
MANAGERS_JSON = os.path.join(ROOT, "src", "data", "fund_managers.json")
NAV_DIR = os.path.join(ROOT, "public", "nav")
HIST_DIR = os.path.join(ROOT, "public", "holdings-history")
OUT = os.path.join(ROOT, "src", "data", "movers.json")
OUT_STOCKS = os.path.join(ROOT, "src", "data", "movers_stocks.json")
# Pipeline memory only (never loaded by the site): last run's manager lists.
OUT_STATE = os.path.join(ROOT, "src", "data", "movers_state.json")

WINDOWS = (1, 3, 6)          # flow / AUM windows, calendar months
STOCK_WINDOWS = (1, 3)       # portfolio-change windows
NAV_MAX_LAG_DAYS = 7         # NAV used for a month-end must be this close to it
MIN_WEIGHT_CHANGE = 0.1      # percentage points; without a price estimate, smaller drifts are not kept
TRADE_TOLERANCE = 0.05       # a position change beyond the price move smaller than this is no trade
ROUNDING_PP = 0.02           # ... and so is one within the rounding of the disclosed weights
MIN_DISCLOSED_PCT = 90.0     # a snapshot listing less than this is partial: a stock
                             # missing from it may only have been left off the list
MIN_PRICE_HOLDERS = 5        # funds holding a stock at both ends before its typical
                             # value change is used as the stand-in for its price move
TER_SPIKE = 0.25             # percentage points away from both neighbouring months
TER_NEIGHBOUR_AGREE = 0.10   # ... while the neighbours agree to within this
MANAGER_JOIN_DAYS = 365      # "new manager" look-back
MANAGER_LOG_DAYS = 365       # how long a departure stays listed


def _load_stock_filter():
    spec = importlib.util.spec_from_file_location(
        "build_stock_moves", os.path.join(ROOT, "scripts", "build_stock_moves.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.is_equity_holding


def ym(iso):
    return iso[:7]


def add_months(month, k):
    y, m = int(month[:4]), int(month[5:7])
    total = y * 12 + (m - 1) + k
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def by_month(points):
    """[(iso, value), ...] -> {YYYY-MM: (iso, value)} keeping the latest date in each
    month (some funds carry both 05-30 and 05-31 disclosures)."""
    out = {}
    for iso, val in sorted(points):
        if val is None:
            continue
        out[ym(iso)] = (iso, val)
    return out


def nav_at(nav, iso):
    """Last NAV on or before iso, if it is no older than NAV_MAX_LAG_DAYS."""
    if not nav:
        return None
    d, v = nav["d"], nav["v"]
    i = bisect.bisect_right(d, iso) - 1
    if i < 0:
        return None
    if (date.fromisoformat(iso) - date.fromisoformat(d[i])).days > NAV_MAX_LAG_DAYS:
        return None
    return v[i] if v[i] and v[i] > 0 else None


def flow_between(a0, a1, n0, n1):
    """(aum change, estimated net flow, market effect), crore, or None."""
    if not (a0 and a0 > 0 and a1 is not None and n0 and n1):
        return None
    change = a1 - a0
    flow = a1 - a0 * (n1 / n0)
    return round(change, 1), round(flow, 1), round(change - flow, 1)


def reference_month(fund_months):
    """The latest month most funds have disclosed AUM for."""
    latest = Counter(max(ms) for ms in fund_months if len(ms) >= 2)
    if not latest:
        return None
    top = max(latest.values())
    return max(m for m, n in latest.items() if n == top)


def fund_flow_record(series, nav, ref):
    ms = by_month(series)
    months = sorted(ms)
    rows = []
    for m in months:
        iso, a1 = ms[m]
        prev = ms.get(add_months(m, -1))
        n1 = nav_at(nav, iso)
        flow = ret = None
        if prev:
            n0 = nav_at(nav, prev[0])
            fb = flow_between(prev[1], a1, n0, n1)
            if fb:
                flow = fb[1]
                ret = round((n1 / n0 - 1) * 100, 2)
        rows.append([m, round(a1, 1), flow, ret])
    win = {}
    if ref in ms:
        a1 = ms[ref][1]
        flows = {r[0]: r[2] for r in rows}
        for k in WINDOWS:
            start = ms.get(add_months(ref, -k))
            monthly = [flows.get(add_months(ref, -j)) for j in range(k)]
            if not start or not start[1] or start[1] <= 0 or any(f is None for f in monthly):
                continue
            change = round(a1 - start[1], 1)
            flow = round(sum(monthly), 1)
            win[str(k)] = [change, flow, round(change - flow, 1), round(flow / start[1] * 100, 2)]
    return rows, win


def ter_record(snapshots, published, ref, label=""):
    """Expense-ratio change from the monthly Groww disclosures. Only for funds whose
    expense ratio is published on the site (young funds above SEBI's ceiling are
    withheld upstream and must stay withheld here)."""
    if published is None:
        return None
    vals = {}
    for iso, snap in sorted(snapshots.items()):
        try:
            vals[ym(iso)] = float(snap.get("expense_ratio"))
        except (TypeError, ValueError):
            continue
    if ref not in vals or abs(vals[ref] - float(published)) > 0.005:
        return None
    # A month that jumps away from both neighbours while they agree is a disclosure
    # error (one Groww month had 0.41% between 1.16% and 1.19%), not two changes.
    # Judged on the disclosed values, so one dropped month never decides another.
    spikes = set()
    for m in vals:
        before, after = vals.get(add_months(m, -1)), vals.get(add_months(m, 1))
        if before is None or after is None:
            continue
        if abs(before - after) <= TER_NEIGHBOUR_AGREE and min(abs(vals[m] - before), abs(vals[m] - after)) > TER_SPIKE:
            spikes.add(m)
    if ref in spikes:
        # the reference month itself looks wrong (a later snapshot disagrees with it)
        print(f"  Movers: cost history withheld for {label or 'a fund'}: reference month {ref} expense ratio {vals[ref]} is out of line with its neighbours")
        return None
    vals = {m: v for m, v in vals.items() if m not in spikes}
    rec = {"now": round(float(published), 2)}
    for k in WINDOWS:
        then = vals.get(add_months(ref, -k))
        if then is not None:
            rec[str(k)] = round(vals[ref] - then, 2)
    return rec


def manager_record(rec, today):
    if not rec or not rec.get("fetched"):
        return None
    out = []
    for m in rec.get("managers") or []:
        since = (m.get("since") or "")[:10]
        if not since:
            continue
        try:
            joined = date.fromisoformat(since)
        except ValueError:
            continue
        if 0 <= (today - joined).days <= MANAGER_JOIN_DAYS:
            out.append([m.get("name"), since])
    return out


def update_manager_log(prev, records, codes, today):
    prev_sets = prev.get("mgrSets") or {}
    log = [e for e in (prev.get("mgrLog") or [])
           if e[0] in codes and (today - date.fromisoformat(e[2])).days <= MANAGER_LOG_DAYS]
    seen = {(e[0], e[1]) for e in log}
    sets = {}
    for code in codes:
        rec = records.get(code)
        if rec and rec.get("fetched") and rec.get("managers"):
            now = sorted({m.get("name") for m in rec["managers"] if m.get("name")})
            sets[code] = now
            before = prev_sets.get(code)
            if before:
                for name in sorted(set(before) - set(now)):
                    if (code, name) not in seen:
                        log.append([code, name, today.isoformat()])
        elif code in prev_sets:
            sets[code] = prev_sets[code]   # fetch failed: remember, never infer a departure
    return sets, log


def _disclosed(snap):
    return sum((h.get("pct") or 0) for h in snap.get("holdings") or [])


def stock_changes(snapshots, ref, is_equity, meta, ratios=None, nav=None):
    """Positions per window: [AUM at start, AUM at end, rows, NAV growth | None], where a
    row is [stock key, weight before | None, weight after | None] for every equity
    position in either snapshot. keep_trades decides later which are trades, once the
    price moves are known. `meta` collects each stock's name and sector.

    A fund that leaves a stock alone (new money spread pro rata) sees its weight move
    only with the stock's price against the fund's own NAV, so weight ratio x NAV growth
    is the stock's price move. When `ratios` is given, that figure is collected for every
    stock held at both ends, so price_moves can take the typical one."""
    ms = by_month([(iso, s) for iso, s in snapshots.items()])
    out = {}
    if ref not in ms:
        return out
    end_iso, end = ms[ref]
    for k in STOCK_WINDOWS:
        start = ms.get(add_months(ref, -k))
        if not start:
            continue
        start_iso, start = start
        if min(_disclosed(start), _disclosed(end)) < MIN_DISCLOSED_PCT:
            continue
        w0 = {h["key"]: h for h in start.get("holdings") or [] if h.get("key") and is_equity(h)}
        w1 = {h["key"]: h for h in end.get("holdings") or [] if h.get("key") and is_equity(h)}
        if not w0 or not w1:
            continue
        try:
            a0, a1 = float(start.get("aum")), float(end.get("aum"))
        except (TypeError, ValueError):
            a0 = a1 = None
        n0, n1 = nav_at(nav, start_iso), nav_at(nav, end_iso)
        growth = round(n1 / n0, 4) if n0 and n1 else None
        if ratios is not None and growth:
            bucket = ratios.setdefault(str(k), {})
            for key in set(w0) & set(w1):
                p0, p1 = w0[key].get("pct") or 0.0, w1[key].get("pct") or 0.0
                if p0 > 0 and p1 > 0:
                    bucket.setdefault(key, []).append(p1 / p0 * growth)
        rows = []
        for key in sorted(set(w0) | set(w1)):
            h = w1.get(key) or w0.get(key)
            meta.setdefault(key, [h.get("name") or key, h.get("sector") or ""])
            rows.append([key, round(w0[key].get("pct") or 0.0, 3) if key in w0 else None,
                         round(w1[key].get("pct") or 0.0, 3) if key in w1 else None])
        out[str(k)] = [a0, a1, rows, growth]
    return out


def price_moves(ratios, index_ratios=None):
    """Median of weight ratio x NAV growth per stock across the funds that held it at
    both ends: the stock's price move, as most holders do not reweight a given stock in
    a month. A fund's own figure divided by it shows whether it raised or cut the stock
    beyond what the price move explains. Keyed by window, then stock key.

    Index funds all rebalance together when an index changes, so their figures are
    used only when too few active funds hold the stock."""
    out = {}
    index_ratios = index_ratios or {}
    for k in sorted(set(ratios) | set(index_ratios)):
        px = {}
        active, passive = ratios.get(k, {}), index_ratios.get(k, {})
        for key in set(active) | set(passive):
            vals = active.get(key, [])
            if len(vals) < MIN_PRICE_HOLDERS:
                vals = vals + passive.get(key, [])
            if len(vals) >= MIN_PRICE_HOLDERS:
                v = sorted(vals)
                n = len(v)
                px[key] = round(v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2, 4)
        out[k] = px
    return out


def is_trade(before, after, px, growth):
    """A new or exited position always is. A held one is when it moved by at least
    TRADE_TOLERANCE beyond the price move (and by more than the weights' rounding);
    without a price estimate, when its weight moved MIN_WEIGHT_CHANGE points or more."""
    if before is None or after is None:
        return True
    if px and growth and before > 0:
        expected = before * px / growth
        return abs(after / expected - 1) >= TRADE_TOLERANCE and abs(after - expected) > ROUNDING_PP
    return abs(after - before) >= MIN_WEIGHT_CHANGE


def keep_trades(raw, px, meta):
    """Raw positions -> the published pairs: only trades are kept, stocks are numbered
    in the order first kept, and price moves are listed for kept stocks only."""
    stocks, index = [], {}
    pairs = {}
    for k, funds in raw.items():
        kpx = px.get(k, {})
        out = {}
        for code, (a0, a1, rows, growth) in funds.items():
            kept = []
            for key, before, after in rows:
                if not is_trade(before, after, kpx.get(key), growth):
                    continue
                if key not in index:
                    index[key] = len(stocks)
                    stocks.append([key] + meta.get(key, [key, ""]))
                kept.append([index[key], before, after])
            out[code] = [a0, a1, kept, growth]
        pairs[k] = (out, {str(index[key]): v for key, v in kpx.items() if key in index})
    return pairs, stocks


def build(funds, navs, histories, managers, prev, today):
    codes = [str(f["code"]) for f in funds]
    series = {str(f["code"]): [tuple(p) for p in ((f.get("aum") or {}).get("series") or [])] for f in funds}
    ref = reference_month([set(by_month(s)) for s in series.values() if s])
    out_funds, raw_stock = {}, {"1": {}, "3": {}}
    meta, ratios, index_ratios = {}, {}, {}
    is_equity = _load_stock_filter()
    for f in funds:
        code = str(f["code"])
        rec = {}
        if series[code] and ref:
            rows, win = fund_flow_record(series[code], navs.get(code), ref)
            rec["m"] = rows
            if win:
                rec["w"] = win
            if max(by_month(series[code])) < ref:
                rec["stale"] = True
        snaps = (histories.get(code) or {}).get("snapshots") or {}
        if ref and snaps:
            ter = ter_record(snaps, f.get("expenseRatio"), ref, f"{f.get('name')} ({code})")
            if ter:
                rec["t"] = ter
            if not f.get("isDebt"):
                for k, v in stock_changes(snaps, ref, is_equity, meta,
                                           index_ratios if str(f.get("category", "")).startswith("Index") else ratios,
                                           navs.get(code)).items():
                    raw_stock[k][code] = v
        joined = manager_record(managers.get(code), today)
        if joined:
            rec["mj"] = joined
        if rec:
            out_funds[code] = rec
    sets, log = update_manager_log(prev, managers, set(codes), today)
    pairs, stocks = keep_trades(raw_stock, price_moves(ratios, index_ratios), meta)
    movers = {
        "generatedAt": today.isoformat(),
        "refMonth": ref,
        "windows": list(WINDOWS),
        "stockWindows": list(STOCK_WINDOWS),
        "funds": out_funds,
        "mgrLog": log,
        "stocks": stocks,
    }
    stock_out = {"refMonth": ref, "pairs": {k: {"from": add_months(ref, -int(k)) if ref else None, "funds": v,
                                                "px": kpx}
                                            for k, (v, kpx) in pairs.items()}}
    return movers, stock_out, {"mgrSets": sets, "mgrLog": log}


def _read_json(path, default):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default


def main():
    data = json.load(open(FUNDS_JSON, encoding="utf-8"))
    funds = data["funds"]
    navs, histories = {}, {}
    for f in funds:
        code = str(f["code"])
        nav = _read_json(os.path.join(NAV_DIR, f"{code}.json"), None)
        if nav:
            navs[code] = nav
        hist = _read_json(os.path.join(HIST_DIR, f"{code}.json"), None)
        if hist:
            histories[code] = hist
    managers = _read_json(MANAGERS_JSON, {})
    prev = _read_json(OUT_STATE, {})
    today = date.fromisoformat(data.get("generatedAt") or date.today().isoformat())
    movers, stock_out, state = build(funds, navs, histories, managers, prev, today)
    for path, obj in ((OUT, movers), (OUT_STOCKS, stock_out), (OUT_STATE, state)):
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, separators=(",", ":"), ensure_ascii=False)
        os.replace(tmp, path)
    with_flow = sum(1 for r in movers["funds"].values() if "1" in r.get("w", {}))
    print(f"Movers: reference month {movers['refMonth']}; {with_flow} funds with a 1M flow estimate; "
          f"{sum(1 for r in movers['funds'].values() if 't' in r)} with cost history; "
          f"{sum(1 for r in movers['funds'].values() if 'mj' in r)} with a manager who joined in the last year; "
          f"{len(movers['mgrLog'])} logged departures; {len(movers['stocks'])} stocks; "
          f"{len(stock_out['pairs']['1']['funds'])}/{len(stock_out['pairs']['3']['funds'])} funds with 1M/3M stock changes")


if __name__ == "__main__":
    main()
