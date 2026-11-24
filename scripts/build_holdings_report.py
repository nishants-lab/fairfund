"""
Build the monthly holdings report: what Indian mutual funds bought and sold.

Output: src/data/holdings_report.json, read by the Holdings report page, its static
research page, the share image and the monthly video.

Funds disclose each month what share of the portfolio every stock is (its weight) and
the fund's size (AUM). They do not disclose, in our source, how many shares they hold.
So a fund's buying of one stock is estimated as

    bought = AUM_end * weight_end - AUM_start * weight_start * price_move

where price_move is how much the stock's price moved over the month. price_move is the
typical (median) weight ratio x NAV growth across the funds that held the stock at both
ends (build_movers.price_moves); a stock held by too few funds uses the fund's own NAV
growth instead, and is counted in `fallbackValue` so the method box can say how much of
the estimate rests on it.

Rupees include buying from new money spread across what a fund already owns. The
number of funds that added or cut a stock counts only deliberate moves: a position that
changed by more than its price move explains (build_movers.is_trade).

Check: the sum of all buying should be close to the new money that came into the
same funds (AUM_end - AUM_start x NAV growth) plus the cash they moved into shares
(the fall in the part of the portfolio that is not shares). All three are published
so readers can see the estimate add up.

Arbitrage funds are left out: they buy shares and sell futures against them, so their
share purchases are not a view on the stock. Index funds are counted in rupees but not
in the number of funds that added or cut a stock, as they follow their index.
"""
import json
import os
import re
import sys
from collections import defaultdict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_movers as bm  # noqa: E402

OUT = os.path.join(bm.ROOT, "src", "data", "holdings_report.json")
OUT_SUMMARY = os.path.join(bm.ROOT, "src", "data", "holdings_summary.json")
NAMES_JSON = os.path.join(bm.ROOT, "src", "data", "stock_names.json")

DETAIL_MONTHS = 3          # months with full lists; older months keep only the trend
TOP = 20                   # rows per ranked list
TOP_SMALL = 8              # rows per category list
TOP_HOUSE = 5              # rows per fund house list
MIN_CONVICTION_HELD = 500  # crore held at the start before a "% added" is meaningful
MIN_CONVICTION_FUNDS = 3   # ... and at least this many funds adding
COMPLETE_SHARE = 0.90      # a month is complete once this share of funds disclosed it
MIN_REPORT_SHARE = 0.50    # the report leads with the latest month at least this covered
MIN_PCT_HELD = 100         # crore held at the start before any "% added" is shown
EXCLUDED_CATEGORY = "Arbitrage"
CRORE_ROUND = 1
# A stock gets its own research page (st/<slug>/) at 20 holders (research-pages.mjs,
# counted from the fund-data files); link only with a margin so a link never 404s.
PAGE_LINK_HOLDERS = 22

# Sector buckets in the source put telecom operators under Technology.
TELECOM = ("bharti-airtel", "vodafone-idea", "indus-towers", "bharti-hexacom",
           "tata-communications", "mahanagar-telephone")


def stock_slug(key):
    """Same as stockSlug in research-pages.mjs."""
    return re.sub(r"[^a-z0-9]+", "-", str(key).lower()).strip("-")[:80]


def sector_of(key, sector):
    if key.startswith(TELECOM):
        return "Telecom"
    return sector or "Other"


def display_names():
    try:
        d = json.load(open(NAMES_JSON, encoding="utf-8"))
    except FileNotFoundError:
        return {}
    out = {}
    for key, v in (d.get("display") or {}).items():
        out[key] = v if isinstance(v, str) else v.get("name")
    for key, v in (d.get("renames") or {}).items():
        out[key] = v.get("name")
    return {k: v for k, v in out.items() if v}


def month_pairs(histories):
    months = set()
    for snaps in histories.values():
        months.update(bm.ym(iso) for iso in snaps)
    months = sorted(months)
    return [m for m in months[1:] if bm.add_months(m, -1) in months]


def coverage(histories, month):
    """(funds that disclosed `month`, funds that disclosed the month before)."""
    prev = bm.add_months(month, -1)
    had_prev = [s for s in histories.values() if any(bm.ym(i) == prev for i in s)]
    have = sum(1 for s in had_prev if any(bm.ym(i) == month for i in s))
    return have, len(had_prev)


def fund_rows(funds, histories, navs, month, is_equity):
    """Per fund: (a0, a1, rows, growth) for the month, plus the price moves."""
    meta, ratios, iratios, raw = {}, {}, {}, {}
    for f in funds:
        code = str(f["code"])
        snaps = histories.get(code)
        if not snaps or f.get("isDebt") or EXCLUDED_CATEGORY in str(f.get("category", "")):
            continue
        is_index = str(f.get("category", "")).startswith("Index")
        r = bm.stock_changes(snaps, month, is_equity, meta,
                             iratios if is_index else ratios, navs.get(code))
        if "1" in r:
            raw[code] = r["1"]
    px = bm.price_moves(ratios, iratios).get("1", {})
    return raw, px, meta


def estimate(raw, px, fund_info):
    """Aggregate per stock and per fund for one month."""
    stocks = defaultdict(lambda: {"net": 0.0, "active": 0.0, "index": 0.0, "held": 0.0,
                                  "added": 0, "cut": 0, "new": 0, "exited": 0,
                                  "funds": defaultdict(float)})
    totals = {"net": 0.0, "active": 0.0, "index": 0.0, "inflow": 0.0, "cashUsed": 0.0,
              "fallbackValue": 0.0, "funds": 0, "houses": set()}
    per_fund = {}
    for code, (a0, a1, rows, growth) in raw.items():
        if not a0 or not a1:
            continue
        info = fund_info[code]
        totals["funds"] += 1
        totals["houses"].add(info["amc"])
        if growth:
            totals["inflow"] += a1 - a0 * growth
        eq0 = sum(w0 or 0 for _, w0, _ in rows)
        eq1 = sum(w1 or 0 for _, _, w1 in rows)
        totals["cashUsed"] += a0 * max(0.0, 100 - eq0) / 100 - a1 * max(0.0, 100 - eq1) / 100
        fund_net = 0.0
        for key, w0, w1 in rows:
            move = px.get(key)
            if move is None:
                move = growth or 1.0
                if w0:
                    totals["fallbackValue"] += a0 * w0 / 100
            v0 = a0 * (w0 or 0) / 100
            v1 = a1 * (w1 or 0) / 100
            dv = v1 - v0 * move
            s = stocks[key]
            s["net"] += dv
            s["index" if info["index"] else "active"] += dv
            s["held"] += v0 * move
            s["funds"][code] += dv
            fund_net += dv
            if info["index"]:
                continue
            if w0 is None:
                s["new"] += 1
                s["added"] += 1
            elif w1 is None:
                s["exited"] += 1
                s["cut"] += 1
            elif bm.is_trade(w0, w1, px.get(key), growth):
                expected = w0 * px[key] / growth if px.get(key) and growth else w0
                if w1 > expected:
                    s["added"] += 1
                else:
                    s["cut"] += 1
        totals["net"] += fund_net
        totals["index" if info["index"] else "active"] += fund_net
        per_fund[code] = fund_net
    return stocks, totals, per_fund


def r1(x):
    return round(x, CRORE_ROUND)


def stock_row(key, s, meta, names, overseas, pages, fund_info, n_funds=3):
    name, sector = meta.get(key, [key, ""])
    top_buyers = sorted(((v, c) for c, v in s["funds"].items() if v > 0), reverse=True)[:n_funds]
    top_sellers = sorted((v, c) for c, v in s["funds"].items() if v < 0)[:n_funds]
    row = {
        "key": key,
        "name": names.get(key) or name,
        "sector": sector_of(key, sector),
        "net": r1(s["net"]),
        "active": r1(s["active"]),
        "index": r1(s["index"]),
        "held": r1(s["held"]),
        "added": s["added"], "cut": s["cut"], "new": s["new"], "exited": s["exited"],
        "buyers": [[c, r1(v)] for v, c in top_buyers],
        "sellers": [[c, r1(v)] for v, c in top_sellers],
    }
    if s["held"] >= MIN_PCT_HELD:
        row["addedPct"] = round(s["net"] / s["held"] * 100, 1)
    if key in overseas:
        row["overseas"] = True
    if stock_slug(key) in pages:
        row["page"] = stock_slug(key)
    return row


def ranked(stocks, keys, sort_key, reverse=True, top=TOP):
    return sorted(keys, key=lambda k: sort_key(stocks[k]), reverse=reverse)[:top]


def month_detail(month, raw, px, meta, fund_info, names, overseas, pages, cov):
    stocks, totals, per_fund = estimate(raw, px, fund_info)
    row = lambda k: stock_row(k, stocks[k], meta, names, overseas, pages, fund_info)  # noqa: E731
    home = [k for k in stocks if k not in overseas]
    abroad = [k for k in stocks if k in overseas]
    conviction = [k for k in home if stocks[k]["held"] >= MIN_CONVICTION_HELD
                  and stocks[k]["added"] >= MIN_CONVICTION_FUNDS and stocks[k]["net"] > 0]

    sectors = defaultdict(float)
    for k, s in stocks.items():
        sectors[sector_of(k, meta.get(k, ["", ""])[1])] += s["net"]

    def group(field, top):
        groups = defaultdict(list)
        for code in per_fund:
            groups[fund_info[code][field]].append(code)
        out = []
        for g, codes in groups.items():
            sub = {c: raw[c] for c in codes}
            st, tot, _ = estimate(sub, px, fund_info)
            buys = sorted((k for k in st if st[k]["net"] > 0 and k not in overseas),
                          key=lambda k: -st[k]["net"])[:top]
            sells = sorted((k for k in st if st[k]["net"] < 0 and k not in overseas),
                           key=lambda k: st[k]["net"])[:top]
            out.append({"name": g, "funds": tot["funds"], "net": r1(tot["net"]),
                        "inflow": r1(tot["inflow"]),
                        "buys": [[k, r1(st[k]["net"]), st[k]["added"]] for k in buys],
                        "sells": [[k, r1(st[k]["net"]), st[k]["cut"]] for k in sells]})
        return sorted(out, key=lambda g: -abs(g["net"]))

    lists = {
        "buys": ranked(stocks, [k for k in home if stocks[k]["net"] > 0], lambda s: s["net"]),
        "sells": ranked(stocks, [k for k in home if stocks[k]["net"] < 0], lambda s: s["net"], reverse=False),
        "widest": ranked(stocks, home, lambda s: (s["added"] - s["cut"], s["net"])),
        "widestCut": ranked(stocks, home, lambda s: (s["cut"] - s["added"], -s["net"])),
        "conviction": ranked(stocks, conviction, lambda s: s["net"] / s["held"]),
        "newEntries": ranked(stocks, [k for k in home if stocks[k]["new"]], lambda s: (s["new"], s["net"])),
        "exits": ranked(stocks, [k for k in home if stocks[k]["exited"]], lambda s: (s["exited"], -s["net"])),
        "overseasBuys": ranked(stocks, [k for k in abroad if stocks[k]["net"] > 0], lambda s: s["net"], top=10),
        "overseasSells": ranked(stocks, [k for k in abroad if stocks[k]["net"] < 0], lambda s: s["net"], reverse=False, top=10),
    }
    used = sorted({k for ks in lists.values() for k in ks})
    cats, houses = group("category", TOP_SMALL), group("amc", TOP_HOUSE)
    refs = {}
    for g in cats + houses:
        for k, *_ in g["buys"] + g["sells"]:
            if k not in used and k not in refs:
                name, sector = meta.get(k, [k, ""])
                refs[k] = [names.get(k) or name, sector_of(k, sector)] + ([stock_slug(k)] if stock_slug(k) in pages else [])
    have, of = cov
    return {
        "month": month,
        "from": bm.add_months(month, -1),
        "coverage": {"funds": have, "of": of, "complete": bool(of) and have / of >= COMPLETE_SHARE},
        "totals": {"net": r1(totals["net"]), "active": r1(totals["active"]), "index": r1(totals["index"]),
                   "inflow": r1(totals["inflow"]), "cashUsed": r1(totals["cashUsed"]),
                   "funds": totals["funds"], "houses": len(totals["houses"]),
                   "fallbackValue": r1(totals["fallbackValue"]),
                   "overseasNet": r1(sum(stocks[k]["net"] for k in abroad))},
        "stocks": {k: row(k) for k in used},
        "lists": lists,
        "sectors": sorted(([s, r1(v)] for s, v in sectors.items()), key=lambda x: -x[1]),
        "categories": cats,
        "houses": houses,
        "refs": refs,
    }


def build(funds, histories, navs, is_equity, names, pages, today):
    fund_info = {str(f["code"]): {"amc": f.get("amc") or "Other",
                                  "category": f.get("categoryDisplay") or f.get("category") or "Other",
                                  "index": str(f.get("category", "")).startswith("Index")}
                 for f in funds}
    snaps_only = {c: (h.get("snapshots") or {}) for c, h in histories.items()}
    overseas = set()
    for snaps in snaps_only.values():
        for snap in snaps.values():
            for h in snap.get("holdings") or []:
                if (h.get("instrument") or "").lower().startswith("foreign") and h.get("key"):
                    overseas.add(h["key"])
    holders = defaultdict(int)
    for snaps in snaps_only.values():
        if not snaps:
            continue
        latest = snaps[max(snaps)]
        for k in {h["key"] for h in latest.get("holdings") or []
                  if h.get("key") and h.get("instrument") == "Equity"}:
            holders[stock_slug(k)] += 1
    pages = {k for k, n in holders.items() if n >= PAGE_LINK_HOLDERS} if pages is None else pages
    months = month_pairs(snaps_only)
    covs = {m: coverage(snaps_only, m) for m in months}
    lead = [m for m in months if covs[m][1] and covs[m][0] / covs[m][1] >= MIN_REPORT_SHARE]
    trend, details = [], []
    for m in months:
        raw, px, meta = fund_rows(funds, snaps_only, navs, m, is_equity)
        if m in lead[-DETAIL_MONTHS:] or (m > (lead[-1] if lead else "")):
            details.append(month_detail(m, raw, px, meta, fund_info, names, overseas, pages, covs[m]))
            t = details[-1]["totals"]
        else:
            _, tot, _ = estimate(raw, px, fund_info)
            t = {"net": r1(tot["net"]), "active": r1(tot["active"]), "index": r1(tot["index"]),
                 "inflow": r1(tot["inflow"]), "cashUsed": r1(tot["cashUsed"]), "funds": tot["funds"]}
        have, of = covs[m]
        trend.append({"month": m, "net": t["net"], "active": t["active"], "index": t["index"],
                      "inflow": t["inflow"], "cashUsed": t["cashUsed"], "funds": t["funds"],
                      "complete": bool(of) and have / of >= COMPLETE_SHARE})
    return {
        "generatedAt": today.isoformat(),
        "lead": lead[-1] if lead else None,
        "trend": trend,
        "months": {d["month"]: d for d in details},
        "funds": {c: [f["name"], fund_info[c]["amc"], fund_info[c]["category"]]
                  for c, f in ((str(f["code"]), f) for f in funds)
                  if any(c in [b[0] for s in d["stocks"].values() for b in s["buyers"] + s["sellers"]]
                         for d in details)},
    }


def summary(report, top=3):
    """The few numbers the home page, share image and video lead with."""
    lead = report["months"].get(report["lead"] or "")
    if not lead:
        return {"lead": None}
    st = lead["stocks"]

    def pick(key):
        return [{"key": k, "name": st[k]["name"], "net": st[k]["net"], "added": st[k]["added"],
                 "cut": st[k]["cut"], "new": st[k]["new"], "exited": st[k]["exited"],
                 "page": st[k].get("page")} for k in lead["lists"][key][:top]]
    return {"lead": lead["month"], "from": lead["from"], "coverage": lead["coverage"],
            "totals": lead["totals"], "buys": pick("buys"), "sells": pick("sells"),
            "sectors": lead["sectors"][:1] + lead["sectors"][-1:],
            "trend": [[t["month"], t["net"], t["complete"]] for t in report["trend"]]}


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def main():
    data = json.load(open(bm.FUNDS_JSON, encoding="utf-8"))
    funds = data["funds"]
    histories, navs = {}, {}
    for f in funds:
        code = str(f["code"])
        h = bm._read_json(os.path.join(bm.HIST_DIR, f"{code}.json"), None)
        if h:
            histories[code] = h
            nav = bm._read_json(os.path.join(bm.NAV_DIR, f"{code}.json"), None)
            if nav:
                navs[code] = nav
    today = date.fromisoformat(data.get("generatedAt") or date.today().isoformat())
    report = build(funds, histories, navs, bm._load_stock_filter(), display_names(), None, today)
    write_json(OUT, report)
    write_json(OUT_SUMMARY, summary(report))
    lead = report["months"].get(report["lead"] or "", {})
    t = lead.get("totals", {})
    print(f"Holdings report: lead {report['lead']}; {t.get('funds')} funds, {t.get('houses')} houses; "
          f"net buying {t.get('net')} cr vs inflow {t.get('inflow')} + cash used {t.get('cashUsed')} cr; "
          f"{os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main()
