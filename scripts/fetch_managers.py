"""
Fetch fund manager details for the universe, reusing the ALREADY-VALIDATED
Groww slugs in holdings_cache/_slugs/{code}.json (so no wrong-fund risk).

Groww scheme payload provides per-manager:
  person_name, education, experience, date_from (tenure start),
  funds_managed [{scheme_name, scheme_code, search_id}]

Output: fund_managers.json
  { code: {
      managers: [ {name, since (ISO), education, experience,
                   funds_managed:[{name, code}]} ],
      fetched: true/false } }

Resumable & idempotent. Uses a browser User-Agent. Manager data is only kept
when Groww's scheme_code for the page is this fund's own code (same guard as
the holdings capture, scripts/groww_identity.py). A matching name alone is not
enough: "SBI Nifty IT Index Fund" and "SBI Nifty Index Fund" overlap by name.
"""
import json, os, sys, time, urllib.parse
from datetime import date
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
from groww_identity import fetch_scheme_verified  # noqa: E402

# Try importing fetch_holdings for _get/_name_overlap; provide fallbacks if not available
try:
    import fetch_holdings as fh
except ImportError:
    fh = None

SLUG_DIR = os.path.join(ROOT, "public", "holdings-history", "_slugs")
OUT = os.path.join(ROOT, "src", "data", "fund_managers.json")
MGR_CACHE = os.path.join(ROOT, "manager_cache")
os.makedirs(MGR_CACHE, exist_ok=True)

# Load universe from funds.json
_funds_path = os.path.join(ROOT, "src", "data", "funds.json")
_funds_data = json.load(open(_funds_path, encoding="utf-8"))
names = {int(f["code"]): f["name"] for f in _funds_data["funds"] if not f.get("isDebt") and not f.get("isArbitrage")}  # debt & arbitrage: no equity manager attribution
META = os.path.join(ROOT, "scheme_meta_cache")

# Support --refresh-all: re-fetch managers older than 30 days. Age is the record's own
# fetchedOn date, so it works in CI, where the local manager_cache is never present.
REFRESH_ALL = "--refresh-all" in sys.argv
MAX_CACHE_AGE_DAYS = 30

def auth_name(code):
    f = os.path.join(META, f"{code}.json")
    if os.path.exists(f):
        try:
            return json.load(open(f)).get("scheme_name") or names.get(code, "")
        except:
            pass
    return names.get(code, "")

HIST_DIR = os.path.join(ROOT, "public", "holdings-history")
SLUG_MAP = os.path.join(HIST_DIR, "_slugs.json")

# Records worth asking Groww again on the next run. A young fund is onboarded
# with a slug but no holdings history yet, so an earlier run may have stored
# "no slug" for it; an identity mismatch stays put until a slug is corrected.
RETRY_NOTES = {"no slug", "fetch failed"}


def load_slug_map():
    try:
        with open(SLUG_MAP, encoding="utf-8") as fh_:
            return json.load(fh_)
    except (OSError, ValueError):
        return {}


SLUGS = load_slug_map()


def needs_fetch(code, existing):
    """True when this run should ask Groww for the fund's managers."""
    rec = existing.get(str(code))
    if rec is None:
        return not os.path.exists(os.path.join(MGR_CACHE, f"{code}.json"))
    return not rec.get("fetched") and rec.get("note") in RETRY_NOTES


def is_stale(code, existing, today):
    """A successfully fetched record older than MAX_CACHE_AGE_DAYS (or never dated)."""
    rec = existing.get(str(code))
    if not rec or not rec.get("fetched"):
        return False
    try:
        fetched_on = date.fromisoformat(rec.get("fetchedOn") or "")
    except ValueError:
        return True
    return (today - fetched_on).days >= MAX_CACHE_AGE_DAYS


def merge(old, new):
    """A refresh that fails, or comes back with no managers, keeps what an earlier fetch
    verified: neither may read as a fund losing its managers."""
    if not (old and old.get("fetched")):
        return new
    # a verified page that lists no managers is as suspect as a failed fetch
    if new.get("fetched") and (new.get("managers") or not old.get("managers")):
        return new
    return old


def slug_for(code):
    # Prefer the slug embedded in the committed holdings-history file (present
    # in CI and any fresh checkout); fall back to the legacy _slugs cache dir.
    hf = os.path.join(HIST_DIR, f"{code}.json")
    if os.path.exists(hf):
        try:
            slug = json.load(open(hf, encoding="utf-8")).get("slug")
            if slug:
                return slug
        except:
            pass
    if SLUGS.get(str(code)):
        return SLUGS[str(code)]
    f = os.path.join(SLUG_DIR, f"{code}.json")
    if os.path.exists(f):
        try:
            return json.load(open(f)).get("slug")
        except:
            return None
    return None

def fetch_one(code, retry=False):
    cf = os.path.join(MGR_CACHE, f"{code}.json")
    if os.path.exists(cf) and not retry:
        try:
            return code, json.load(open(cf))
        except:
            pass
    slug = slug_for(code)
    if not slug:
        rec = {"managers": [], "fetched": False, "note": "no slug"}
        json.dump(rec, open(cf, "w")); return code, rec
    res = fetch_scheme_verified(code, slug)
    if res["status"] == "identity_mismatch":
        rec = {"managers": [], "fetched": False, "note": "identity mismatch"}
        json.dump(rec, open(cf, "w")); return code, rec
    if res["status"] not in ("ok", "renamed"):
        rec = {"managers": [], "fetched": False, "note": "fetch failed"}
        json.dump(rec, open(cf, "w")); return code, rec
    d = res["payload"]

    details = d.get("fund_manager_details") or []
    managers = []
    seen = set()
    for m in details:
        nm = (m.get("person_name") or "").strip()
        if not nm or nm.lower() in seen:
            continue
        seen.add(nm.lower())
        fm = []
        for x in (m.get("funds_managed") or []):
            sc = x.get("scheme_code")
            try:
                sc = int(sc)
            except:
                sc = None
            fm.append({"name": x.get("scheme_name"), "code": sc})
        managers.append({
            "name": nm,
            "since": (m.get("date_from") or "")[:10] or None,
            "education": (m.get("education") or "").strip() or None,
            "experience": (m.get("experience") or "").strip() or None,
            "fundsManaged": fm,
        })
    rec = {"managers": managers, "fetched": True,
           "fund_manager_str": d.get("fund_manager"), "fetchedOn": date.today().isoformat()}
    json.dump(rec, open(cf, "w"))
    return code, rec

def main():
    codes = list(names.keys())
    existing = {}
    if os.path.exists(OUT):
        try:
            existing = json.load(open(OUT, encoding="utf-8"))
        except:
            existing = {}
    if REFRESH_ALL:
        # New and retryable records, plus verified ones whose fetchedOn is a month old
        today = date.today()
        todo = [c for c in codes if needs_fetch(c, existing) or is_stale(c, existing, today)]
    else:
        todo = [c for c in codes if needs_fetch(c, existing)]
    print(f"Universe: {len(codes)} | already done: {len(codes)-len(todo)} | to fetch: {len(todo)}")

    results = dict(existing)
    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(fetch_one, c, str(c) in existing or REFRESH_ALL): c for c in todo}
        for fut in as_completed(futs):
            code, rec = fut.result()
            results[str(code)] = merge(existing.get(str(code)), rec)
            done += 1
            if done % 100 == 0:
                rate = done/(time.time()-t0)
                print(f"  {done}/{len(todo)} | {rate:.1f}/s")
    # also fold in any cache files not in todo (already cached)
    for c in codes:
        cf = os.path.join(MGR_CACHE, f"{c}.json")
        if str(c) not in results and os.path.exists(cf):
            try:
                results[str(c)] = json.load(open(cf))
            except:
                pass
    json.dump(results, open(OUT, "w", encoding="utf-8"))
    withmgr = sum(1 for r in results.values() if r.get("managers"))
    print(f"\nDone. {len(results)} funds; with >=1 manager: {withmgr}")

if __name__ == "__main__":
    main()
