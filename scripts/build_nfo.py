"""
New fund offers (NFOs) in FairFund's categories -> src/data/nfo.json.

Sources, every one keyed by AMFI scheme code (never matched by name alone):
  1. AMFI scheme master (DownloadSchemeData_Po.aspx): AMC, name, category, launch
     (offer opening) date, closure date when AMFI gives one, minimum amount.
  2. AMFI NAVAll.txt: a scheme is listed there once units are allotted, so its
     presence means the offer is over and the fund is trading. Same parser as the
     daily NAV update (scripts/update_nav_daily.fetch_amfi).
  3. Groww scheme page, found by search and accepted only when its scheme_code is
     the NFO's code (scripts/groww_identity.fetch_scheme_verified): benchmark,
     fund manager, exit load, minimum SIP, lock-in. Optional; kept from the last
     run for 7 days so Groww is not asked again every day.

Scope is the site's own: open-ended, Direct Growth plan, a category that
pipeline/config.map_amfi_category maps into the universe, not excluded by name.
Window: offers opening up to 60 days ahead, and those opened in the last 45 days.

Never fails the refresh: if AMFI cannot be read, or returns implausibly little,
the previous nfo.json is left untouched and the script exits 0 with a warning.
"""
import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path[:0] = [HERE, os.path.join(ROOT, "pipeline")]

import config as C  # noqa: E402

OUT = os.path.join(ROOT, "src", "data", "nfo.json")
MASTER_URL = "https://portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0"
GROWW_SEARCH = "https://groww.in/v1/api/search/v1/entity?app=false&entity_type=scheme&page=0&size=10&q="
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"}
LOOKBACK_DAYS = 45
LOOKAHEAD_DAYS = 60
DETAILS_MAX_AGE_DAYS = 7
MIN_MASTER_ROWS = 5000
IST = timezone(timedelta(hours=5, minutes=30))


def today_ist():
    return datetime.now(IST).date()


def parse_date(s):
    try:
        return datetime.strptime((s or "").strip(), "%d-%b-%Y").date()
    except ValueError:
        return None


def http_text(url, timeout=90, retries=3):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)


def short_amc(amc):
    s = (amc or "").strip()
    for tail in (" Asset Management Company Limited", " Asset Management Co. Ltd.", " Asset Management Co. Ltd",
                 " Asset Management Company Ltd.", " Asset Management Limited", " Asset Managers Limited",
                 " AMC Limited", " AMC Ltd.", " AMC Ltd", " Limited", " Ltd.", " Ltd"):
        if s.endswith(tail):
            return s[: -len(tail)].strip()
    return s


def is_direct_growth(nav_name):
    n = (nav_name or "").lower()
    return "direct" in n and "growth" in n and "idcw" not in n and "dividend" not in n


def select_nfos(rows, today):
    """Master CSV rows -> {code: record} for in-scope Direct Growth NFOs in the window."""
    lo, hi = today - timedelta(days=LOOKBACK_DAYS), today + timedelta(days=LOOKAHEAD_DAYS)
    out = {}
    for r in rows:
        if len(r) < 9 or r[3].strip() != "Open Ended" or not r[1].strip().isdigit():
            continue
        launch = parse_date(r[7])
        if not launch or not (lo <= launch <= hi) or not is_direct_growth(r[5]):
            continue
        name, amfi_cat = r[2].strip(), r[4].strip()
        if C.is_excluded_by_name(name) or C.is_excluded_by_name(r[5]):
            continue
        cat = C.map_amfi_category(amfi_cat, name)
        if not cat:
            continue
        close = parse_date(r[8])
        try:
            min_amt = float(r[6]) if r[6].strip() else None
        except ValueError:
            min_amt = None
        out[r[1].strip()] = {
            "code": int(r[1]),
            "name": name,
            "amc": short_amc(r[0]),
            "amfiCategory": amfi_cat,
            "category": cat,
            "launchDate": launch.isoformat(),
            # AMFI often repeats the launch date or leaves this blank; only a later date is a closing date.
            "closeDate": close.isoformat() if close and close > launch else None,
            "minAmount": min_amt,
        }
    return out


def status_for(rec, nav, today):
    """upcoming | offer | closed | trading, claiming only what AMFI's data shows.

    "offer" means the offer has opened and units are not yet allotted. Without a
    closing date from AMFI it does not mean the offer is still open, so the site
    says "opened on ..., not trading yet" and points to the offer document.
    """
    launch = date.fromisoformat(rec["launchDate"])
    if nav:
        return "trading"
    if launch > today:
        return "upcoming"
    close = rec.get("closeDate")
    if close and date.fromisoformat(close) < today:
        return "closed"
    return "offer"


def groww_details(code, name, verify=None, search=None):
    """Benchmark/manager/exit load from the Groww page whose scheme_code is `code`, else None."""
    from groww_identity import fetch_scheme_verified
    verify = verify or fetch_scheme_verified
    try:
        hits = (search or _groww_search)(name)
    except Exception:
        return None
    slug = next((h.get("search_id") for h in hits if str(h.get("scheme_code")) == str(code) and h.get("search_id")), None)
    if not slug:
        return None
    res = verify(code, slug)
    p = res.get("payload") if res.get("status") in ("ok", "renamed") else None
    if not p:
        return None
    lock = p.get("lock_in") or {}
    lock_years = lock.get("years") if isinstance(lock, dict) else None
    return {
        "benchmark": p.get("benchmark_name") or p.get("benchmark"),
        "manager": p.get("fund_manager"),
        "exitLoad": p.get("exit_load"),
        "minSip": p.get("min_sip_investment"),
        "lockInYears": lock_years or None,
        "groww": res["slug"],
    }


def _groww_search(name):
    raw = http_text(GROWW_SEARCH + urllib.parse.quote(name), timeout=25, retries=2)
    d = json.loads(raw)
    return d.get("content") or []


def build(master_rows, navall, previous, today, details_fn=groww_details):
    prev = {str(n["code"]): n for n in (previous or {}).get("nfos", [])}
    out = []
    for code, rec in select_nfos(master_rows, today).items():
        nav = navall.get(code)
        rec["status"] = status_for(rec, nav, today)
        rec["nav"] = {"date": nav[0], "value": nav[1]} if nav else None
        old = prev.get(code) or {}
        fresh = old.get("details") and old.get("detailsAsOf") and \
            (today - date.fromisoformat(old["detailsAsOf"])).days < DETAILS_MAX_AGE_DAYS
        if fresh:
            rec["details"], rec["detailsAsOf"] = old["details"], old["detailsAsOf"]
        else:
            det = details_fn(int(code), rec["name"])
            rec["details"] = det if det else old.get("details")
            rec["detailsAsOf"] = today.isoformat() if det else old.get("detailsAsOf")
        out.append(rec)
    # Newest offers first; upcoming ones soonest first; then closed and trading.
    order = {"offer": 0, "upcoming": 1, "closed": 2, "trading": 3}
    out.sort(key=lambda r: (order[r["status"]],
                            r["launchDate"] if r["status"] == "upcoming" else _neg(r["launchDate"]), r["name"]))
    return {
        "generatedAt": today.isoformat(),
        "window": {"lookbackDays": LOOKBACK_DAYS, "lookaheadDays": LOOKAHEAD_DAYS},
        "source": "AMFI scheme master and NAVAll; benchmark, manager and exit load from the scheme's Groww page, matched by AMFI code",
        "nfos": out,
    }


def _neg(iso):
    return -date.fromisoformat(iso).toordinal()


def _load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def main():
    today = today_ist()
    previous = _load(OUT)
    try:
        rows = list(csv.reader(io.StringIO(http_text(MASTER_URL))))[1:]
        from update_nav_daily import fetch_amfi
        navall = fetch_amfi()
    except Exception as e:
        print(f"::warning::NFO list not refreshed (AMFI unreachable: {e}); keeping the previous file")
        return 0
    if len(rows) < MIN_MASTER_ROWS or len(navall) < 1000:
        print(f"::warning::NFO list not refreshed (AMFI returned {len(rows)} master rows, {len(navall)} NAVs); keeping the previous file")
        return 0
    result = build(rows, navall, previous, today)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    counts = {}
    for n in result["nfos"]:
        counts[n["status"]] = counts.get(n["status"], 0) + 1
    print(f"Wrote {OUT}: {len(result['nfos'])} NFOs {counts}; with details: {sum(1 for n in result['nfos'] if n.get('details'))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
