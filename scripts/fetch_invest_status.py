#!/usr/bin/env python3
"""
Fetch fresh-subscription availability (lumpsum / SIP / redemption) from Kuvera
and merge it into each fund's investInfo, validated by ISIN.

Source: Kuvera v5 fund detail (api.kuvera.in). Kuvera keys funds by its own
unique_fund_code (not ISIN), so we resolve the code by name from Kuvera's
scheme list, then confirm the match by comparing the ISIN in the detail payload
against the AMFI isin_growth for our scheme code. No ISIN match => no data
written (safe default).

Freshness: Kuvera has no explicit "flags-updated-on" field, so we record the
NAV date from the same payload as the as-of stamp. Callers/UI must gate the
badge on this date being recent.

Usage:
  python scripts/fetch_invest_status.py [--category International] [--all] [--dry-run]
"""
import os, sys, json, re, time, argparse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
FUND_DATA_DIR = os.path.join(ROOT, "public", "fund-data")
AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
KUVERA_LIST = "https://api.kuvera.in/insight/api/v1/mutual_fund_search.json?limit=3000"
KUVERA_DETAIL = "https://api.kuvera.in/mf/api/v5/fund_schemes/{code}.json"
H = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
STOP = {"direct", "regular", "plan", "growth", "idcw", "payout", "reinvestment",
        "fund", "scheme", "of", "the", "an", "dividend", "option"}


def get(url, timeout=30, headers=None):
    req = urllib.request.Request(url, headers=headers or H)
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")


def norm(s):
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    toks = [t for t in s.split() if t not in STOP]
    return " ".join(toks)


def amfi_isin_map():
    m = {}
    for line in get(AMFI_URL, timeout=120, headers={"User-Agent": "Mozilla/5.0"}).splitlines():
        p = line.strip().split(";")
        if len(p) >= 6 and p[0].isdigit():
            m[p[0]] = (p[1] or "").strip()  # isin_growth
    return m


def kuvera_index():
    d = json.loads(get(KUVERA_LIST))
    funds = (d.get("data") or {}).get("funds") or []
    idx = {}
    for f in funds:
        idx.setdefault(norm(f.get("name")), []).append(f)
    return idx, funds


def candidates(name_norm, exact_idx, all_funds, topn=3):
    if name_norm in exact_idx:
        return exact_idx[name_norm]
    toks = set(name_norm.split())
    scored = []
    for f in all_funds:
        kt = set(norm(f.get("name")).split())
        if not kt:
            continue
        j = len(toks & kt) / len(toks | kt)
        if j >= 0.5:
            scored.append((j, f))
    scored.sort(key=lambda x: -x[0])
    return [f for _, f in scored[:topn]]


def kuvera_detail(code):
    d = json.loads(get(KUVERA_DETAIL.format(code=code)))
    return d[0] if isinstance(d, list) and d else (d if isinstance(d, dict) else None)


def yn(v):
    return str(v).strip().upper() == "Y"


def build_availability(det):
    nav = det.get("nav") or {}
    return {
        "lumpsum": yn(det.get("lump_available")),
        "sip": yn(det.get("sip_available")),
        "redemption": yn(det.get("redemption_allowed")),
        "asOf": nav.get("date"),
        "source": "kuvera",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--category", default="International")
    ap.add_argument("--all", action="store_true", help="process every fund")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data = json.load(open(FUNDS_JSON, encoding="utf-8"))
    funds = data["funds"]
    targets = funds if args.all else [f for f in funds if f.get("category") == args.category]
    print(f"targets: {len(targets)} ({'ALL' if args.all else args.category})")

    print("loading AMFI ISIN map...")
    c2isin = amfi_isin_map()
    print(f"  AMFI codes: {len(c2isin)}")
    print("loading Kuvera scheme list...")
    exact_idx, all_kf = kuvera_index()
    print(f"  Kuvera funds: {len(all_kf)}")

    matched = 0
    skipped_noisin = []
    skipped_nomatch = []
    writes = []  # (fund, availability)

    for f in targets:
        code = str(f["code"])
        our_isin = c2isin.get(code, "")
        if not our_isin:
            skipped_noisin.append(code)
            continue
        nm = norm(f.get("fullName") or f.get("name"))
        det = None
        for cand in candidates(nm, exact_idx, all_kf):
            try:
                d = kuvera_detail(cand["unique_fund_code"])
            except Exception:
                continue
            time.sleep(0.15)
            if d and (d.get("ISIN") or "").strip().upper() == our_isin.upper():
                det = d
                break
        if not det:
            skipped_nomatch.append((code, f.get("name", "")[:45]))
            continue
        avail = build_availability(det)
        writes.append((f, avail))
        matched += 1

    print(f"\n=== RESULT: {matched} validated / {len(targets)} targets ===")
    print(f"  skipped (no AMFI ISIN): {len(skipped_noisin)}")
    print(f"  skipped (no ISIN-validated Kuvera match): {len(skipped_nomatch)}")
    for c, n in skipped_nomatch:
        print(f"    - {c} {n}")

    # sample of what we found
    print("\nsample validated:")
    for f, a in writes[:8]:
        print(f"  {f['code']} {f.get('name','')[:38]:38} lump={a['lumpsum']} sip={a['sip']} redeem={a['redemption']} asOf={a['asOf']}")

    if args.dry_run:
        print("\n[dry-run] no files written")
        return

    # write: merge availability into existing investInfo, both funds.json + fund-data
    for f, avail in writes:
        code = f["code"]
        fd_path = os.path.join(FUND_DATA_DIR, f"{code}.json")
        # base investInfo: prefer fund-data (authoritative merge target), else funds.json
        base_inv = None
        fd = None
        if os.path.exists(fd_path):
            fd = json.load(open(fd_path, encoding="utf-8"))
            base_inv = fd.get("investInfo")
        if base_inv is None:
            base_inv = f.get("investInfo") or {}
        base_inv = dict(base_inv or {})
        base_inv["availability"] = avail
        f["investInfo"] = base_inv
        if fd is not None:
            fd["investInfo"] = base_inv
            json.dump(fd, open(fd_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    json.dump(data, open(FUNDS_JSON, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"\nwrote availability for {len(writes)} funds to funds.json + fund-data/")


if __name__ == "__main__":
    main()
