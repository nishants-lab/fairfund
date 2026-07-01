"""
Holdings-history capture — accumulate dated portfolio snapshots over time.
============================================================================
WHY: Groww only exposes a fund's *latest* portfolio snapshot (one portfolio_date),
not history. To later answer "what did the manager ADD / EXIT in a period, and was
the move smart?", we must capture snapshots ourselves, monthly, and accumulate them.
This is Option A from the design discussion: start building the dataset now, ship
the analysis once we have >= 2 snapshots per fund.

DATA INTEGRITY (project bar): we store ONLY what Groww actually returns, keyed by
the REAL portfolio_date. We never fabricate intermediate months. Re-running in the
same month is idempotent (same portfolio_date -> skip).

STORAGE: public/holdings-history/{code}.json (same-origin, servable later, and —
critically — committed to the repo so the dataset persists across stateless CI runs
and accumulates month over month). Shape:
  {
    "code": 122639,
    "slug": "parag-parikh-...",
    "name": "Parag Parikh Flexi Cap Fund",
    "snapshots": {
      "2026-04-30": { "portfolioDate": "2026-04-30", "capturedOn": "2026-05-31",
                       "coverage": "stock_level", "aum": 1234.5,
                       "holdings": [ {"name","pct","sector","instrument","key"}, ... ] },
      ...
    }
  }

Slugs are resolved once and cached in public/holdings-history/_slugs.json so CI does
not need to re-resolve 800+ funds over the network each month.

Resumable, threaded, periodic-save. Run locally or in CI. Paths resolve relative to
this file so both work.
"""
import os, json, sys, time, re
import urllib.request, urllib.parse
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

# Resolve the history dir (local workspace vs CI repo root), mirroring update_nav_daily.
_CAND = [
    os.path.join(HERE, "..", "mf-website-v2", "public", "holdings-history"),  # local
    os.path.join(HERE, "..", "public", "holdings-history"),                   # CI (script in repo)
    os.path.join(os.getcwd(), "public", "holdings-history"),                  # CI cwd = repo root
]
HIST_DIR = next((os.path.abspath(p) for p in _CAND if os.path.isdir(os.path.dirname(p))), None)
if HIST_DIR is None:
    HIST_DIR = os.path.abspath(_CAND[0])
os.makedirs(HIST_DIR, exist_ok=True)
SLUG_MAP_PATH = os.path.join(HIST_DIR, "_slugs.json")

# Local seed sources (present in the workspace, absent in CI).
WS_SLUG_CACHE = os.path.join(ROOT, "holdings_cache", "_slugs")
UNIVERSE_PATH = os.path.join(ROOT, "mf_v6_universe.json")
# funds.json — could be under a nested mf-website-v2/ dir (local workspace) or directly under src/ (CI repo root).
_FUNDS_CANDIDATES = [
    os.path.join(ROOT, "mf-website-v2", "src", "data", "funds.json"),  # local workspace layout
    os.path.join(ROOT, "src", "data", "funds.json"),                   # CI: repo root = mf-website-v2
    os.path.join(HERE, "..", "src", "data", "funds.json"),             # CI: relative to scripts/
]
FUNDS_JSON = next((p for p in _FUNDS_CANDIDATES if os.path.exists(p)), _FUNDS_CANDIDATES[0])
META_CACHE = os.path.join(ROOT, "scheme_meta_cache")

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}
SEARCH = "https://groww.in/v1/api/search/v3/query/global/st_query?query="
SCHEME = "https://groww.in/v1/api/data/mf/web/v2/scheme/search/"

FEEDER_INSTR = {"mutual fund", "foreign mf", "fund", "exchange traded fund", "etf"}
EQUITY_INSTR = {"equity", "forgn. eq", "foreign equity", "equity shares", "fgn equity"}


def _get(url, timeout=20):
    """HTTP GET with exponential backoff + rate-limit awareness.
    Retries up to 4x with increasing wait (0.5s, 1s, 2s, 4s) and respects
    Groww's 429/403 signals — backs off longer on rate-limit responses."""
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=H)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status == 200:
                    return json.loads(r.read().decode("utf-8", errors="replace"))
                # 429 Too Many Requests or 403 Forbidden (Groww's rate-limit signal)
                if r.status in (429, 403):
                    wait = min(2 ** (attempt + 2), 30)  # 4s, 8s, 16s, 30s
                    time.sleep(wait)
                    continue
            time.sleep(0.5 * (2 ** attempt))
        except urllib.error.HTTPError as e:
            if e.code in (429, 403):
                wait = min(2 ** (attempt + 2), 30)
                time.sleep(wait)
                continue
            time.sleep(0.5 * (2 ** attempt))
        except Exception:
            time.sleep(0.5 * (2 ** attempt))
    return None


def _tokens(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    stop = {"fund", "direct", "growth", "plan", "the", "of", "and", "scheme",
            "option", "regular", "in", "india", "formerly", "known", "as", "ltd"}
    return set(t for t in s.split() if t not in stop and len(t) > 2)


def _name_overlap(a, b):
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _clean_query(name):
    n = re.sub(r"\(formerly[^)]*\)", " ", name, flags=re.IGNORECASE)
    n = re.sub(r"formerly known as[^-]*", " ", n, flags=re.IGNORECASE)
    for w in ["growth option", "growth plan", "idcw", "dividend", "payout",
              "reinvestment", "bonus option", "bonus", "- growth", "growth",
              "regular plan", "option"]:
        n = re.sub(re.escape(w), " ", n, flags=re.IGNORECASE)
    n = re.sub(r"[-–|]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    if "direct" not in n.lower():
        n = n + " Direct"
    return re.sub(r"\s+", " ", n + " Growth").strip()


def load_slug_map():
    """Load slug map: committed _slugs.json first, then seed from workspace cache."""
    smap = {}
    if os.path.exists(SLUG_MAP_PATH):
        try:
            smap = json.load(open(SLUG_MAP_PATH, encoding="utf-8"))
        except Exception:
            smap = {}
    # seed any missing from the workspace per-code slug cache (local only)
    if os.path.isdir(WS_SLUG_CACHE):
        for fn in os.listdir(WS_SLUG_CACHE):
            if not fn.endswith(".json"):
                continue
            code = fn[:-5]
            if code in smap and smap[code]:
                continue
            try:
                slug = json.load(open(os.path.join(WS_SLUG_CACHE, fn))).get("slug")
                if slug:
                    smap[code] = slug
            except Exception:
                pass
    return smap


def resolve_slug(code, name, smap):
    if smap.get(str(code)):
        return smap[str(code)]
    d = _get(SEARCH + urllib.parse.quote(_clean_query(name)), timeout=15)
    slug = None
    best = 0.0
    second = 0.0
    if d and d.get("data", {}).get("content"):
        content = d["data"]["content"]
        for c in content:
            if str(c.get("scheme_code")) == str(code) and c.get("search_id"):
                slug = c["search_id"]; best = 1.0; break
        if not slug:
            best_slug = None
            for c in content:
                if c.get("entity_type") != "Scheme" or not c.get("search_id"):
                    continue
                ov = _name_overlap(name, c.get("title", ""))
                if ov > best:
                    second = best; best = ov; best_slug = c["search_id"]
                elif ov > second:
                    second = ov
            if best_slug and ((best >= 0.6 and best - second >= 0.1) or best >= 0.8):
                slug = best_slug
    if slug:
        smap[str(code)] = slug
    return slug


def norm_holdings(raw):
    out = []
    seen = set()
    for h in raw:
        cp = h.get("corpus_per")
        if cp is None:
            continue
        pct = round(float(cp), 4)
        # Drop non-positive line items (cash, net payables/receivables, derivative
        # offsets) — these aren't real stock holdings and can be negative. Keeping
        # them corrupts weight sums and "added/exited" diffs later. Mirrors the
        # filtering in fetch_holdings.py / build_website_data_v6.py.
        if pct <= 0:
            continue
        name = (h.get("company_name") or "").strip()
        low = name.lower()
        if any(k in low for k in ("net payable", "net receivable", "net current asset",
                                  "treps", "reverse repo", "cash", "cblo", "margin",
                                  "triparty")):
            continue
        # Keep only real security holdings for change-analysis. Drop derivatives,
        # repo, and sovereign cash-equivalents — these are not stock selections and
        # can push weight sums >100% (and would pollute added/exited diffs).
        instr = (h.get("instrument_name") or "").strip().lower()
        DROP_INSTR = {"futures", "options", "index derivatives", "repo", "reverse repo",
                      "treasury bills", "treasury bill", "cblo", "tri-party repo"}
        if instr in DROP_INSTR:
            continue
        # De-duplicate: Groww occasionally lists each stock twice (share-class /
        # payload quirk), which doubles the weight sum. Keep first occurrence.
        key = h.get("stock_search_id") or low
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "name": name,
            "pct": pct,
            "sector": h.get("sector_name"),
            "instrument": (h.get("instrument_name") or "").strip(),
            "key": key,
        })
    out.sort(key=lambda x: -x["pct"])
    return out


def is_feeder_singleline(holds):
    if not holds:
        return False
    eq = [h for h in holds if h["instrument"].lower() in EQUITY_INSTR]
    feeders = [h for h in holds if h["instrument"].lower() in FEEDER_INSTR]
    return bool(not eq and feeders and feeders[0]["pct"] >= 80)


def iso_pdate(s):
    """Groww portfolio_date '2026-04-29T18:30:00.000Z' -> '2026-04-30' (IST date)."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        # Groww stamps 18:30Z = 00:00 IST next day; add 5h30m to get the IST calendar date
        from datetime import timedelta
        ist = dt.astimezone(timezone.utc) + timedelta(hours=5, minutes=30)
        return ist.strftime("%Y-%m-%d")
    except Exception:
        return s[:10]


def auth_name(code, fallback):
    f = os.path.join(META_CACHE, f"{code}.json")
    if os.path.exists(f):
        try:
            nm = json.load(open(f)).get("scheme_name")
            if nm:
                return nm
        except Exception:
            pass
    return fallback


def load_universe():
    uni = {}
    if os.path.exists(UNIVERSE_PATH):
        print(f"  loading universe from: {UNIVERSE_PATH}")
        u = json.load(open(UNIVERSE_PATH, encoding="utf-8"))
        for f in u["funds"]:
            c = int(f["code"]); uni[c] = auth_name(c, f["name"])
    elif os.path.exists(FUNDS_JSON):
        print(f"  loading universe from: {FUNDS_JSON}")
        fj = json.load(open(FUNDS_JSON, encoding="utf-8"))
        for f in fj["funds"]:
            c = int(f["code"]); uni[c] = auth_name(c, f.get("fullName") or f["name"])
    else:
        print(f"  ERROR: tried {UNIVERSE_PATH} and {FUNDS_JSON}, neither exists.")
    return uni


def capture_one(code, name, smap, today):
    slug = resolve_slug(code, name, smap)
    if not slug:
        return code, None, "unresolved"
    sc = _get(SCHEME + slug, timeout=25)
    if not sc:
        return code, None, "fetch_failed"
    # name-match guard against fuzzy mis-resolution
    fetched = sc.get("scheme_name") or sc.get("fund_name") or ""
    if str(sc.get("scheme_code")) != str(code) and _name_overlap(name, fetched) < 0.45:
        return code, None, "name_mismatch"
    raw = sc.get("holdings") or []
    holds = norm_holdings(raw)
    pdate = iso_pdate(raw[0].get("portfolio_date")) if raw else None
    if not holds or not pdate:
        return code, None, "no_disclosure"
    coverage = "feeder_unresolved" if is_feeder_singleline(holds) else "stock_level"
    snap = {
        "portfolioDate": pdate,
        "capturedOn": today,
        "coverage": coverage,
        "aum": sc.get("aum"),
        "expense_ratio": sc.get("expense_ratio"),
        "holdings": holds,
    }
    return code, snap, coverage


def main():
    print(f"History dir: {HIST_DIR}")
    uni = load_universe()
    if not uni:
        print("ERROR: could not load universe (mf_v6_universe.json or funds.json).")
        sys.exit(1)
    print(f"Universe: {len(uni)} funds")

    smap = load_slug_map()
    print(f"Slugs known: {sum(1 for v in smap.values() if v)}")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Determine work: skip funds that already have a snapshot whose portfolioDate
    # matches the CURRENT latest Groww date — but we don't know that without a fetch.
    # Cheap heuristic: always fetch, but only WRITE if the portfolioDate is new.
    todo = list(uni.items())
    # Optional cap for a quick smoke test: set FF_CAPTURE_LIMIT=5
    _lim = os.environ.get("FF_CAPTURE_LIMIT")
    if _lim and _lim.isdigit():
        todo = todo[: int(_lim)]
        print(f"(FF_CAPTURE_LIMIT set — only {len(todo)} funds this run)")
    print(f"Capturing snapshots (idempotent by portfolioDate)... today={today}")

    added_snaps = 0
    skipped_same = 0
    cov_counter = {}
    fetch_errors = 0
    t0 = time.time()
    done = 0

    def load_hist(code):
        p = os.path.join(HIST_DIR, f"{code}.json")
        if os.path.exists(p):
            try:
                return json.load(open(p, encoding="utf-8"))
            except Exception:
                return None
        return None

    lock_writes = {}

    # 4 workers (reduced from 8) — less aggressive against Groww's rate limiter.
    # A 0.3s sleep between each future submission further throttles request rate.
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {}
        for c, n in todo:
            futs[ex.submit(capture_one, c, n, smap, today)] = (c, n)
            time.sleep(0.3)  # throttle submission rate to ~3 req/s per worker = ~12/s total
        for fut in as_completed(futs):
            c, n = futs[fut]
            done += 1
            try:
                code, snap, cov = fut.result()
            except Exception as e:
                cov = f"error:{str(e)[:20]}"; snap = None; code = c; fetch_errors += 1
            cov_counter[cov] = cov_counter.get(cov, 0) + 1
            if cov and ("error" in str(cov) or cov == "fetch_failed"):
                fetch_errors += 1
            c, n = futs[fut]
            done += 1
            try:
                code, snap, cov = fut.result()
            except Exception as e:
                cov = f"error:{str(e)[:20]}"; snap = None; code = c
            cov_counter[cov] = cov_counter.get(cov, 0) + 1
            if snap:
                rec = load_hist(code) or {"code": code, "slug": smap.get(str(code)),
                                          "name": n, "snapshots": {}}
                pd = snap["portfolioDate"]
                if pd in rec["snapshots"]:
                    skipped_same += 1
                else:
                    rec["snapshots"][pd] = snap
                    rec["name"] = n
                    rec["slug"] = smap.get(str(code))
                    json.dump(rec, open(os.path.join(HIST_DIR, f"{code}.json"), "w",
                                        encoding="utf-8"), separators=(",", ":"))
                    added_snaps += 1
            if done % 50 == 0:
                rate = done / (time.time() - t0)
                eta = (len(todo) - done) / rate if rate else 0
                print(f"  {done}/{len(todo)} | {rate:.1f}/s | ETA {eta:.0f}s | new={added_snaps} same={skipped_same}")

    # persist any newly-resolved slugs
    json.dump(smap, open(SLUG_MAP_PATH, "w", encoding="utf-8"), separators=(",", ":"))

    # write/refresh a manifest summarizing the dataset
    manifest = {"updatedAt": today, "funds": 0, "totalSnapshots": 0, "multiSnapshot": 0}
    for fn in os.listdir(HIST_DIR):
        if not fn.endswith(".json") or fn.startswith("_"):
            continue
        try:
            rec = json.load(open(os.path.join(HIST_DIR, fn), encoding="utf-8"))
        except Exception:
            continue
        ns = len(rec.get("snapshots", {}))
        manifest["funds"] += 1
        manifest["totalSnapshots"] += ns
        if ns >= 2:
            manifest["multiSnapshot"] += 1
    json.dump(manifest, open(os.path.join(HIST_DIR, "_manifest.json"), "w",
                             encoding="utf-8"), separators=(",", ":"))

    print(f"\nDone. New snapshots: {added_snaps} | unchanged (same month): {skipped_same}")
    print("Coverage this run:", cov_counter)
    print(f"Fetch errors/failures: {fetch_errors}")
    print(f"Dataset: {manifest['funds']} funds, {manifest['totalSnapshots']} total snapshots, "
          f"{manifest['multiSnapshot']} funds with >=2 snapshots (ready for change analysis).")
    print(f"::NEW_SNAPSHOTS::{added_snaps}")

    # Minimum-capture threshold: if this is a scheduled CI run (not a manual
    # dispatch or local test with FF_CAPTURE_LIMIT) and we captured ZERO new
    # snapshots, something is likely wrong (Groww down, rate-limited, API changed).
    # Emit a GitHub Actions warning annotation so the run shows a yellow badge.
    is_ci = os.environ.get("GITHUB_ACTIONS") == "true"
    is_limited = os.environ.get("FF_CAPTURE_LIMIT")
    if is_ci and not is_limited and added_snaps == 0:
        print("::warning::Holdings capture produced 0 new snapshots this run. "
              "Possible cause: Groww API rate-limiting, downtime, or format change. "
              f"Fetch errors: {fetch_errors}/{len(todo)}. Check the logs above.")
    if is_ci and not is_limited and fetch_errors > len(todo) * 0.5:
        print(f"::warning::Over 50% of fund fetches failed ({fetch_errors}/{len(todo)}). "
              "Groww may be rate-limiting or blocking CI IPs.")


if __name__ == "__main__":
    main()
