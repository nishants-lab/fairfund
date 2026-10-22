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
     fund manager, exit load, minimum SIP, lock-in, and the date units are
     expected to be available again after the offer (its "launch_date"). Optional;
     kept from the last run for 7 days so Groww is not asked again every day.
  4. Closing date, when AMFI leaves it blank: the open-offer tables of ICICIdirect
     and Morningstar, then ICICIdirect's page for the scheme. These list the
     Regular plan by name, so an entry is used only when its opening date is the
     AMFI launch date, its name starts with the AMC and carries the same numbers,
     and exactly one in-scope NFO fits. A closing date once found is kept.
  5. First NAV date of a scheme that trades: its NAV file on the site, else mfapi.

An offer leaves the list 7 calendar days after it closes (or, when no closing
date was ever found, 7 days after its first NAV). During those days the list
shows when units are available: the first NAV date, or the expected date.

Scope is the site's own: open-ended, Direct Growth plan, a category that
pipeline/config.map_amfi_category maps into the universe, not excluded by name.
Window: offers opening up to 60 days ahead, and those opened in the last 45 days.

Never fails the refresh: if AMFI cannot be read, or returns implausibly little,
the previous nfo.json is left untouched and the script exits 0 with a warning.
"""
import csv
import html
import io
import json
import os
import re
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
SHOW_DAYS_AFTER_CLOSE = 7
MAX_OFFER_DAYS = 30  # SEBI caps an NFO at 15 days; anything far longer is a misread
OFFER_LISTS = ("https://www.icicidirect.com/MutualFund/NFOListing/existing",
               "https://www.morningstar.in/nfo/nfolist.aspx")
ICICI_DETAIL = "https://www.icicidirect.com/mutual-funds/nfo-detail/"
MFAPI = "https://api.mfapi.in/mf/"
NAV_DIR = os.path.join(ROOT, "public", "nav")
IST = timezone(timedelta(hours=5, minutes=30))


def today_ist():
    return datetime.now(IST).date()


def parse_date(s):
    try:
        return datetime.strptime((s or "").strip(), "%d-%b-%Y").date()
    except ValueError:
        return None


def parse_any_date(s):
    """'26-Oct-2026', 'Oct 26, 2026', 'Oct 6, 2026' or '2026-10-26' -> date, else None."""
    t = re.sub(r"\s+", " ", (s or "").strip())
    for fmt in ("%d-%b-%Y", "%b %d, %Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            pass
    return None


_DATE_IN_TEXT = re.compile(r"\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b")


def _text(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def parse_offer_table(page):
    """(name, open, close) for each table row with a scheme name and two dates.

    ICICIdirect gives Name | Category | Sub-category | Open Date | Close Date;
    Morningstar gives Name | Minimum | Price | 'NFO Start Date : ...' | 'NFO End
    Date : ...'. In both the first date is the opening and the second the closing.
    """
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page or "", flags=re.S):
        cells = [_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, flags=re.S)]
        if not cells or not cells[0]:
            continue
        dates = [parse_any_date(d) for d in _DATE_IN_TEXT.findall(" ".join(cells[1:]))]
        if len(dates) >= 2 and all(dates[:2]):
            out.append((cells[0], dates[0], dates[1]))
    return out


def parse_detail_page(page):
    """(name, open, close) from an ICICIdirect NFO page, else None."""
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", page or "", flags=re.S)
    t = _text(page or "")
    o = re.search(r"Open Date\s*(" + _DATE_IN_TEXT.pattern + ")", t)
    c = re.search(r"Close Date\s*(" + _DATE_IN_TEXT.pattern + ")", t)
    if not (h1 and o and c):
        return None
    return _text(h1.group(1)), parse_any_date(o.group(1)), parse_any_date(c.group(1))


_PLAN_WORDS = {"reg", "regular", "rg", "gr", "g", "growth", "direct", "plan", "option", "the", "fund", "fd"}


def _compact(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _words(s):
    return [w for w in re.findall(r"[a-z]+", (s or "").lower()) if w not in _PLAN_WORDS]


def _numbers(s):
    return sorted(re.findall(r"\d+", s or ""))


def offer_matches(rec, name, opened):
    """Could `name`, opening on `opened`, be this AMFI NFO's Regular plan?"""
    amc = _words(rec["amc"])[:1]
    return (bool(amc) and opened is not None and opened.isoformat() == rec["launchDate"]
            and _compact(name).startswith(amc[0]) and _numbers(name) == _numbers(rec["name"]))


def _name_score(rec, name):
    mine = set(_words(rec["name"]))
    theirs = _words(name)
    if not theirs:
        return 0.0
    hit = sum(1 for w in theirs if any(m.startswith(w) or w.startswith(m) for m in mine))
    return hit / len(theirs)


def match_offer(recs, name, opened):
    """The one in-scope NFO an outside listing describes, else None."""
    cands = [r for r in recs if offer_matches(r, name, opened)]
    if len(cands) > 1:
        scored = sorted(((_name_score(r, name), r["code"]) for r in cands), reverse=True)
        if scored[0][0] < 0.5 or scored[0][0] == scored[1][0]:
            return None
        cands = [r for r in cands if r["code"] == scored[0][1]]
    return cands[0] if len(cands) == 1 else None


def plausible_close(opened, closed):
    return bool(opened and closed and opened < closed and (closed - opened).days <= MAX_OFFER_DAYS)


def detail_slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", " and ")).strip("-") + "-regular-g"


def icici_detail(name):
    """ICICIdirect's page for the scheme's Regular plan, as (name, open, close), else None."""
    try:
        return parse_detail_page(http_text(ICICI_DETAIL + detail_slug(name), timeout=25, retries=1))
    except Exception:
        return None


def fetch_offer_lists():
    """Rows from every outside open-offer table that answered. Never raises."""
    rows = []
    for url in OFFER_LISTS:
        try:
            got = [(n, o, c, url) for n, o, c in parse_offer_table(http_text(url, timeout=40, retries=2))]
            rows.extend(got)
            print(f"{url}: {len(got)} offers")
        except Exception as e:
            print(f"::warning::closing dates: {url} unreachable ({e})")
    return rows


def first_nav_date(code):
    """First NAV date of a trading scheme: the site's NAV file, else mfapi. None if unknown."""
    try:
        with open(os.path.join(NAV_DIR, f"{code}.json"), encoding="utf-8") as fh:
            d = json.load(fh).get("d") or []
        if d:
            return d[0]
    except (OSError, ValueError):
        pass
    try:
        data = json.loads(http_text(MFAPI + str(code), timeout=25, retries=2)).get("data") or []
        first = parse_any_date(data[-1]["date"]) if data else None
        return first.isoformat() if first else None
    except Exception:
        return None


def source_name(url):
    return "ICICIdirect" if "icicidirect" in url else "Morningstar" if "morningstar" in url else url


def visible_until(rec):
    """Last day the NFO is listed: 7 days after it closes, else after its first NAV."""
    anchor = rec.get("closeDate") or rec.get("firstNavDate")
    if not anchor:
        return None
    return (date.fromisoformat(anchor) + timedelta(days=SHOW_DAYS_AFTER_CLOSE)).isoformat()


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
    # Groww's search often lags a new scheme; its page usually sits at the plain
    # name slug. The scheme_code check below decides either way.
    res = verify(code, slug or groww_slug(name))
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
        # Before a scheme trades, Groww's launch_date is the day units are expected
        # again (allotment or reopening), e.g. 28-Oct-2026 for an offer closing 26 Oct.
        "reopenDate": _iso(parse_date(p.get("launch_date"))),
        "groww": res["slug"],
    }


def _iso(d):
    return d.isoformat() if d else None


def groww_slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", " and ")).strip("-") + "-direct-growth"


def _groww_search(name):
    raw = http_text(GROWW_SEARCH + urllib.parse.quote(name), timeout=25, retries=2)
    d = json.loads(raw)
    return d.get("content") or []


def resolve_close_dates(recs, prev, offers, detail_fn):
    """Fill closeDate/closeDateSource where AMFI gave none. Mutates `recs`."""
    found = {}
    for name, opened, closed, url in offers:
        r = match_offer(recs, name, opened)
        if r and plausible_close(opened, closed):
            found.setdefault(r["code"], (closed.isoformat(), source_name(url)))
    for r in recs:
        if r["closeDate"]:
            r["closeDateSource"] = "AMFI"
            continue
        old = prev.get(str(r["code"])) or {}
        if r["code"] in found:
            r["closeDate"], r["closeDateSource"] = found[r["code"]]
        elif old.get("closeDate") and old.get("launchDate") == r["launchDate"]:
            r["closeDate"], r["closeDateSource"] = old["closeDate"], old.get("closeDateSource")
        elif detail_fn and r["status"] != "trading":
            hit = detail_fn(r["name"])
            if hit and match_offer([r], hit[0], hit[1]) and plausible_close(hit[1], hit[2]):
                r["closeDate"], r["closeDateSource"] = hit[2].isoformat(), "ICICIdirect"
        r.setdefault("closeDateSource", None)


def build(master_rows, navall, previous, today, details_fn=groww_details, offers=(), detail_fn=None,
          first_nav_fn=None):
    """`offers`, `detail_fn` and `first_nav_fn` reach outside sites; main() passes the
    real ones, tests pass fakes, and leaving them out makes no network call."""
    prev = {str(n["code"]): n for n in (previous or {}).get("nfos", [])}
    recs = list(select_nfos(master_rows, today).values())
    for rec in recs:
        nav = navall.get(str(rec["code"]))
        rec["status"] = status_for(rec, nav, today)
        rec["nav"] = {"date": nav[0], "value": nav[1]} if nav else None
    resolve_close_dates(recs, prev, offers, detail_fn)
    out = []
    for rec in recs:
        code = str(rec["code"])
        rec["status"] = status_for(rec, navall.get(code), today)
        old = prev.get(code) or {}
        rec["firstNavDate"] = None
        if rec["nav"]:
            rec["firstNavDate"] = old.get("firstNavDate") or (first_nav_fn(int(code)) if first_nav_fn else None)
        until = visible_until(rec)
        if rec["status"] in ("closed", "trading") and until and until < today.isoformat():
            continue
        fresh = old.get("details") and old.get("detailsAsOf") and "reopenDate" in old["details"] and \
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
        "showDaysAfterClose": SHOW_DAYS_AFTER_CLOSE,
        "source": "AMFI scheme master and NAVAll; benchmark, manager, exit load and expected reopening from the scheme's Groww page, matched by AMFI code; closing dates AMFI leaves blank from ICICIdirect and Morningstar, matched by AMC, opening date and name",
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
    result = build(rows, navall, previous, today, offers=fetch_offer_lists(), detail_fn=icici_detail,
                   first_nav_fn=first_nav_date)
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
