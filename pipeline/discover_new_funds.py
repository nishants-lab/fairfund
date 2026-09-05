"""
Auto-discover new AMFI equity funds not yet in the FairFund dataset.
====================================================================
Runs monthly via GitHub Actions. Checks the AMFI universe against our funds.json,
identifies new Direct-Growth equity schemes with enough NAV history (>=3 years),
and adds them automatically.

This eliminates the need for a manual admin page for fund additions.

Usage:
  python pipeline/discover_new_funds.py            # discover and add
  python pipeline/discover_new_funds.py --dry-run  # show what would be added
"""
import os
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from config import (
    ELIGIBLE_AMFI_CATEGORIES as ELIGIBLE_CATEGORIES,
    MIN_NAV_POINTS,
    min_nav_points_for,
    STALE_NAV_DAYS,
    AMFI_NAV_ALL_URL as AMFI_URL,
    MFAPI_BASE_URL as MFAPI_URL,
    map_amfi_category,
    is_excluded_by_name,
    is_debt_category,
    is_arbitrage_category,
    uses_reduced_surface,
    risk_level_for,
)

FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
NAV_DIR = os.path.join(ROOT, "public", "nav")

H = {"User-Agent": "Mozilla/5.0"}

_NAME_SUFFIXES = [
    " - Direct Plan - Growth", " - Direct Plan-Growth",
    " -Direct Plan - Growth", " - Direct - Growth Option",
    " - Direct Plan Growth", " Direct - Growth",
    " - Growth - Direct Plan", " Direct Plan Growth",
]


def _clean_scheme_name(name):
    """Strip the Direct-Growth plan/option suffix so a scheme's display name is
    stable across the several AMFI plan codes it may appear under."""
    out = name
    for suffix in _NAME_SUFFIXES:
        if out.lower().endswith(suffix.lower()):
            out = out[:-len(suffix)]
            break
    return out.strip()


def fetch_amfi_universe():
    """Parse AMFI NAVAll.txt to get all scheme codes + metadata."""
    req = urllib.request.Request(AMFI_URL, headers=H)
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode("utf-8", errors="replace")

    schemes = {}
    current_category = None
    current_amc = None

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue

        # Category headers are standalone lines without semicolons
        if ";" not in line and not line[0].isdigit():
            # AMC lines contain "Mutual Fund" typically
            if "mutual fund" in line.lower():
                current_amc = line
            else:
                current_category = line
            continue

        parts = line.split(";")
        if len(parts) < 6:
            continue
        code = parts[0].strip()
        if not code.isdigit():
            continue

        name = parts[3].strip() if len(parts) > 3 else ""
        
        # Only Direct + Growth schemes (strict: must have both).
        # 2026 portal format carries Plan/Option as separate fields
        # (...;Scheme Name;Plan;Option;NAV;Date); legacy format embedded
        # them in the scheme name.
        if len(parts) >= 8:
            plan = parts[4].strip().lower()
            option = parts[5].strip().lower()
            if "direct" not in plan or "growth" not in option:
                continue
        else:
            name_lower = name.lower()
            if "direct" not in name_lower:
                continue
            if "growth" not in name_lower:
                continue

        schemes[int(code)] = {
            "code": int(code),
            "name": name,
            "amc": current_amc or "",
            "amfi_category": current_category or "",
        }

    return schemes


def fetch_amfi_raw_codes():
    """Return the set of ALL scheme codes present in AMFI NAVAll.txt, across
    every plan and category (no Direct/Growth or equity filtering).

    This is the authoritative 'is this scheme still being priced by AMFI' signal.
    A code missing here means AMFI has stopped publishing a NAV for it entirely,
    which is the only reliable closure indicator. The filtered Direct-Growth set
    from fetch_amfi_universe() must NOT be used for closure detection, because a
    live fund can drop out of it purely on a name/parse mismatch."""
    req = urllib.request.Request(AMFI_URL, headers=H)
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode("utf-8", errors="replace")
    codes = set()
    for line in raw.splitlines():
        parts = line.split(";")
        if len(parts) < 6:
            continue
        code = parts[0].strip()
        if code.isdigit():
            codes.add(int(code))
    return codes


def fetch_nav_history(code):
    """Fetch full NAV from mfapi.in. Returns (dates, navs) or None."""
    try:
        req = urllib.request.Request(f"{MFAPI_URL}{code}", headers=H)
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
        
        points_d = []
        points_v = []
        for p in data.get("data", []):
            try:
                dd, mm, yyyy = p["date"].split("-")
                nav = round(float(p["nav"]), 4)
                if nav > 0:
                    points_d.append(f"{yyyy}-{mm}-{dd}")
                    points_v.append(nav)
            except Exception:
                continue
        
        # mfapi returns newest first, reverse to oldest first
        if points_d and points_d[0] > points_d[-1]:
            points_d.reverse()
            points_v.reverse()
        
        return points_d, points_v
    except Exception:
        return None, None


# map_amfi_category is imported from pipeline/config.py


def main():
    dry_run = "--dry-run" in sys.argv

    if not os.path.exists(FUNDS_JSON):
        print(f"ERROR: {FUNDS_JSON} not found")
        sys.exit(1)

    with open(FUNDS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    existing_codes = {f["code"] for f in data["funds"]}
    print(f"Current dataset: {len(existing_codes)} funds")

    print("Fetching AMFI universe...")
    amfi_schemes = fetch_amfi_universe()
    print(f"AMFI Direct-Growth schemes: {len(amfi_schemes)}")

    # Find new schemes not in our dataset
    new_codes = [c for c in amfi_schemes if c not in existing_codes]
    print(f"New schemes not in dataset: {len(new_codes)}")

    # Filter to equity categories only
    equity_new = []
    excluded_debt = 0
    for code in new_codes:
        scheme = amfi_schemes[code]
        cat = map_amfi_category(scheme["amfi_category"])
        if not cat:
            continue
        # Skip debt/fixed-income vehicles that share an equity AMFI bucket
        # (US Treasury bond FoFs, target-maturity Gilt/PSU-Bond/SDL index funds).
        if is_excluded_by_name(scheme["name"]):
            excluded_debt += 1
            continue
        scheme["_mapped_category"] = cat
        equity_new.append(scheme)

    print(f"New equity schemes (mappable category): {len(equity_new)}")
    if excluded_debt:
        print(f"Excluded {excluded_debt} debt/fixed-income scheme(s) by name filter")

    if not equity_new:
        print("No new funds to add.")
        return

    # Fetch NAV and check history length
    added = 0
    skipped_short = 0
    skipped_fetch = 0
    skipped_stale = 0
    skipped_dup = 0
    os.makedirs(NAV_DIR, exist_ok=True)
    stale_before = (datetime.now() - timedelta(days=STALE_NAV_DAYS)).strftime("%Y-%m-%d")
    seen_namecat = {(_clean_scheme_name(f["name"]).lower(), f["category"]) for f in data["funds"]}

    for i, scheme in enumerate(equity_new):
        code = scheme["code"]
        dates, navs = fetch_nav_history(code)
        
        if not dates:
            skipped_fetch += 1
            continue
        
        if len(dates) < min_nav_points_for(scheme["_mapped_category"]):
            skipped_short += 1
            continue

        # Skip wound-up / delisted funds: latest NAV older than the staleness bar.
        if dates[-1] < stale_before:
            skipped_stale += 1
            continue

        cat = scheme["_mapped_category"]

        _key = (_clean_scheme_name(scheme["name"]).lower(), cat)
        if _key in seen_namecat:
            skipped_dup += 1
            continue
        seen_namecat.add(_key)
        
        if dry_run:
            print(f"  Would add: {scheme['name'][:50]} ({cat}, {len(dates)} points)")
            added += 1
            continue

        # Write NAV file
        nav_file = {"d": dates, "v": navs, "u": dates[-1]}
        with open(os.path.join(NAV_DIR, f"{code}.json"), "w") as f:
            json.dump(nav_file, f, separators=(",", ":"))

        # Create fund entry (metrics will be computed by compute_metrics.py next)
        # Clean name: remove "Direct Plan - Growth" suffix variants
        clean_name = scheme["name"]
        for suffix in [" - Direct Plan - Growth", " - Direct Plan-Growth",
                       " -Direct Plan - Growth", " - Direct - Growth Option",
                       " - Direct Plan Growth", " Direct - Growth",
                       " - Growth - Direct Plan", " Direct Plan Growth"]:
            if clean_name.lower().endswith(suffix.lower()):
                clean_name = clean_name[:-len(suffix)]
                break

        fund_entry = {
            "code": code,
            "name": clean_name.strip(),
            "fullName": scheme["name"],
            "amc": scheme["amc"].replace(" Mutual Fund", "").strip(),
            "category": cat,
            "categoryDisplay": cat,
            "riskLevel": risk_level_for(cat),
            "isDebt": is_debt_category(cat),
            "isArbitrage": is_arbitrage_category(cat),
            "categorySize": 0,  # will be updated by compute_rankings
            "inceptionDate": dates[0],
            "navPoints": len(dates),
            "isYoung": len(dates) < 750,
            "metrics": {},
            "holdings": [],
            # Debt funds hold CPs/T-bills/repos, not stocks: never fetch equity
            # holdings for them (marker keeps onboard_new_funds from calling Groww).
            "holdingsMeta": {"coverage": "not_applicable" if uses_reduced_surface(cat) else "pending"},
            "management": None,
            "analytics": {},
            "stockMoves": None,
        }
        data["funds"].append(fund_entry)
        added += 1

        if (i + 1) % 20 == 0:
            print(f"  Progress: {i+1}/{len(equity_new)} | added={added}")
        time.sleep(0.3)  # throttle mfapi requests

    data["totalFunds"] = len(data["funds"])
    print(f"\nResults:")
    print(f"  Added: {added}")
    print(f"  Skipped (too short): {skipped_short}")
    print(f"  Skipped (stale/wound-up): {skipped_stale}")
    print(f"  Skipped (duplicate name+category): {skipped_dup}")
    print(f"  Skipped (fetch failed): {skipped_fetch}")

    if dry_run:
        print("\n--dry-run: no files written.")
        return

    if added > 0:
        with open(FUNDS_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"\nWrote {FUNDS_JSON} ({data['totalFunds']} total funds)")
        print("Run compute_metrics.py + compute_rankings.py next to rank the new funds.")


def detect_stale_merged_closed(data, amfi_schemes, raw_codes):
    """
    Detect funds that may be closed, or renamed.
    Returns dict of {code: {"status": "closed"|"renamed", "note": "..."}}.

    Closure is judged against two trustworthy signals only:
      (a) the code is absent from the RAW AMFI NAVAll universe (raw_codes), i.e.
          AMFI has stopped publishing any NAV for it, AND
      (b) our latest stored NAV is older than STALE_NAV_DAYS.
    A fund still present in raw_codes with fresh NAV is ALIVE, even if it fell out
    of the filtered Direct-Growth set (amfi_schemes) on a name/parse mismatch.
    """
    from datetime import datetime, timedelta
    findings = {}
    stale_cutoff = (datetime.now() - timedelta(days=STALE_NAV_DAYS)).strftime("%Y-%m-%d")

    for fund in data["funds"]:
        code = fund["code"]

        # Latest NAV date we hold for this fund
        last_date = ""
        nav_path = os.path.join(NAV_DIR, f"{code}.json")
        if os.path.exists(nav_path):
            try:
                nav_data = json.load(open(nav_path))
                if nav_data.get("d"):
                    last_date = nav_data["d"][-1]
            except Exception:
                pass

        in_raw = code in raw_codes
        nav_stale = bool(last_date) and last_date < stale_cutoff

        # 1. Genuine closure: AMFI no longer prices the code AND our NAV has gone stale.
        if not in_raw and nav_stale:
            findings[code] = {
                "status": "closed",
                "note": f"Code {code} absent from AMFI NAVAll and last NAV {last_date} is >{STALE_NAV_DAYS}d old. Closed/merged.",
                "name": fund["name"],
            }
            continue

        # 2. Stale-but-still-listed OR delisted-but-recently-priced: not a confirmed
        #    closure. Flag as a data-quality watch item so it is visible, but the
        #    fund is retained (it still has NAV history for research).
        if nav_stale or not in_raw:
            reason = "not in AMFI NAVAll" if not in_raw else f"last NAV {last_date} > {STALE_NAV_DAYS}d old"
            findings[code] = {
                "status": "stale",
                "note": f"Watch: {reason} (retained, has NAV). Verify slug/code or genuine closure.",
                "name": fund["name"],
            }
            continue

        # 3. Check for name mismatch (renamed fund)
        if code in amfi_schemes:
            amfi_name = amfi_schemes[code]["name"]
            our_name = fund.get("fullName") or fund["name"]
            # Simple overlap check (word-level)
            our_words = set(our_name.lower().split())
            amfi_words = set(amfi_name.lower().split())
            # Remove common suffixes for comparison
            noise = {"direct", "plan", "growth", "-", "fund", "mutual"}
            our_words -= noise
            amfi_words -= noise
            if our_words and amfi_words:
                overlap = len(our_words & amfi_words) / max(len(our_words), len(amfi_words))
                if overlap < 0.4:
                    findings[code] = {
                        "status": "renamed",
                        "note": f"Name mismatch: ours='{our_name[:40]}' vs AMFI='{amfi_name[:40]}'",
                        "name": fund["name"],
                        "new_name": amfi_name,
                    }

    return findings


def main_with_lifecycle():
    """Extended main that also detects closed/merged/renamed funds."""
    dry_run = "--dry-run" in sys.argv
    lifecycle_only = "--lifecycle-only" in sys.argv

    if not os.path.exists(FUNDS_JSON):
        print(f"ERROR: {FUNDS_JSON} not found")
        sys.exit(1)

    with open(FUNDS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"Current dataset: {len(data['funds'])} funds")
    print("Fetching AMFI universe...")
    amfi_schemes = fetch_amfi_universe()
    print(f"AMFI Direct-Growth schemes: {len(amfi_schemes)}")
    raw_codes = fetch_amfi_raw_codes()
    print(f"AMFI raw NAVAll codes (all plans): {len(raw_codes)}")

    # === Lifecycle detection (closed/renamed/stale) ===
    print("\n--- Lifecycle Detection ---")
    findings = detect_stale_merged_closed(data, amfi_schemes, raw_codes)

    closed = [f for f in findings.values() if f["status"] == "closed"]
    renamed = [f for f in findings.values() if f["status"] == "renamed"]
    stale = [f for f in findings.values() if f["status"] == "stale"]

    if findings:
        if closed:
            print(f"\n  CLOSED - confirmed, absent from AMFI + NAV stale ({len(closed)}):")
            for f in closed[:10]:
                print(f"    {f['name'][:45]} - {f['note']}")
            if len(closed) > 10:
                print(f"    ... and {len(closed)-10} more")

        if renamed:
            print(f"\n  RENAMED ({len(renamed)}):")
            for f in renamed[:10]:
                print(f"    {f['note']}")

        if stale:
            print(f"\n  STALE / WATCH - retained, has NAV ({len(stale)}):")
            for f in stale[:10]:
                print(f"    {f['name'][:45]} - {f['note']}")
            if len(stale) > 10:
                print(f"    ... and {len(stale)-10} more")

    else:
        print("  No lifecycle changes detected.")

    # Always (re)write the lifecycle report so a month with nothing to flag resets
    # it to {} rather than leaving a stale report from a previous run.
    report_path = os.path.join(ROOT, "src", "data", "lifecycle_report.json")
    if not dry_run:
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(findings, f, indent=2, ensure_ascii=False)
        print(f"\n  Wrote lifecycle report ({len(findings)} findings): {report_path}")

    # Normalize the status field on every fund. Findings drive closed/renamed/stale;
    # every other fund is (re)set to "active" so a previously mis-flagged fund that
    # is now clearly alive has its stale tag cleared automatically.
    status_changed = False
    if not dry_run:
        for fund in data["funds"]:
            code = fund["code"]
            new_status = findings[code]["status"] if code in findings else "active"
            if fund.get("status") != new_status:
                status_changed = True
            fund["status"] = new_status
            if code in findings and findings[code]["status"] == "renamed" and "new_name" in findings[code]:
                fund["name"] = findings[code]["new_name"].replace(" - Direct Plan - Growth", "").replace(" - Direct Plan-Growth", "").strip()

    if lifecycle_only:
        if not dry_run and (findings or status_changed):
            with open(FUNDS_JSON, "w", encoding="utf-8") as f:
                json.dump(data, f, separators=(",", ":"))
            print(f"Updated {FUNDS_JSON}")
        return

    # === New fund discovery (original logic) ===
    print("\n--- New Fund Discovery ---")
    existing_codes = {f["code"] for f in data["funds"]}
    new_codes = [c for c in amfi_schemes if c not in existing_codes]
    print(f"New schemes not in dataset: {len(new_codes)}")

    equity_new = []
    excluded_debt = 0
    for code in new_codes:
        scheme = amfi_schemes[code]
        cat = map_amfi_category(scheme["amfi_category"])
        if not cat:
            continue
        # Skip debt/fixed-income vehicles that share an equity AMFI bucket
        # (US Treasury bond FoFs, target-maturity Gilt/PSU-Bond/SDL index funds).
        if is_excluded_by_name(scheme["name"]):
            excluded_debt += 1
            continue
        scheme["_mapped_category"] = cat
        equity_new.append(scheme)

    print(f"New equity schemes (mappable category): {len(equity_new)}")
    if excluded_debt:
        print(f"Excluded {excluded_debt} debt/fixed-income scheme(s) by name filter")

    if not equity_new and not findings:
        print("No changes needed.")
        return

    # Fetch NAV for new funds and add them
    added = 0
    skipped_short = 0
    skipped_fetch = 0
    skipped_stale = 0
    skipped_dup = 0
    os.makedirs(NAV_DIR, exist_ok=True)
    stale_before = (datetime.now() - timedelta(days=STALE_NAV_DAYS)).strftime("%Y-%m-%d")
    seen_namecat = {(_clean_scheme_name(f["name"]).lower(), f["category"]) for f in data["funds"]}

    for i, scheme in enumerate(equity_new):
        code = scheme["code"]
        dates, navs = fetch_nav_history(code)

        if not dates:
            skipped_fetch += 1
            continue

        if len(dates) < min_nav_points_for(scheme["_mapped_category"]):
            skipped_short += 1
            continue

        # Skip wound-up / delisted funds: latest NAV older than the staleness bar.
        if dates[-1] < stale_before:
            skipped_stale += 1
            continue

        cat = scheme["_mapped_category"]

        _key = (_clean_scheme_name(scheme["name"]).lower(), cat)
        if _key in seen_namecat:
            skipped_dup += 1
            continue
        seen_namecat.add(_key)

        if dry_run:
            print(f"  Would add: {scheme['name'][:50]} ({cat}, {len(dates)} points)")
            added += 1
            continue

        nav_file = {"d": dates, "v": navs, "u": dates[-1]}
        with open(os.path.join(NAV_DIR, f"{code}.json"), "w") as f:
            json.dump(nav_file, f, separators=(",", ":"))

        clean_name = scheme["name"]
        for suffix in [" - Direct Plan - Growth", " - Direct Plan-Growth",
                       " -Direct Plan - Growth", " - Direct - Growth Option",
                       " - Direct Plan Growth", " Direct - Growth",
                       " - Growth - Direct Plan", " Direct Plan Growth"]:
            if clean_name.lower().endswith(suffix.lower()):
                clean_name = clean_name[:-len(suffix)]
                break

        fund_entry = {
            "code": code,
            "name": clean_name.strip(),
            "fullName": scheme["name"],
            "amc": scheme["amc"].replace(" Mutual Fund", "").strip(),
            "category": cat,
            "categoryDisplay": cat,
            "riskLevel": risk_level_for(cat),
            "isDebt": is_debt_category(cat),
            "isArbitrage": is_arbitrage_category(cat),
            "categorySize": 0,
            "inceptionDate": dates[0],
            "navPoints": len(dates),
            "isYoung": len(dates) < 750,
            "metrics": {},
            "holdings": [],
            "holdingsMeta": {"coverage": "not_applicable" if uses_reduced_surface(cat) else "pending"},
            "management": None,
            "analytics": {},
            "stockMoves": None,
            "status": "active",
        }
        data["funds"].append(fund_entry)
        added += 1

        if (i + 1) % 20 == 0:
            print(f"  Progress: {i+1}/{len(equity_new)} | added={added}")
        time.sleep(0.3)

    # totalFunds = the served universe (all funds present, including closed-but-retained
    # ones that still carry NAV history). prune_pending later recomputes this over the
    # post-prune keep set, so keep the same "all present funds" semantics here.
    data["totalFunds"] = len(data["funds"])

    print(f"\nResults:")
    print(f"  Added: {added}")
    print(f"  Skipped (too short): {skipped_short}")
    print(f"  Skipped (stale/wound-up): {skipped_stale}")
    print(f"  Skipped (duplicate name+category): {skipped_dup}")
    print(f"  Skipped (fetch failed): {skipped_fetch}")
    if findings:
        print(f"  Lifecycle changes: {len(findings)}")

    if dry_run:
        print("\n--dry-run: no files written.")
        return

    if added > 0 or findings or status_changed:
        with open(FUNDS_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"\nWrote {FUNDS_JSON} ({data['totalFunds']} funds)")
        if added > 0:
            print("Run compute_metrics.py + compute_rankings.py next to rank the new funds.")


if __name__ == "__main__":
    if "--lifecycle-only" in sys.argv or len(sys.argv) <= 1 or "--dry-run" in sys.argv:
        main_with_lifecycle()
    else:
        main()

