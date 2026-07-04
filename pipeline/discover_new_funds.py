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
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from config import (
    ELIGIBLE_AMFI_CATEGORIES as EQUITY_CATEGORIES,
    MIN_NAV_POINTS,
    AMFI_NAV_ALL_URL as AMFI_URL,
    MFAPI_BASE_URL as MFAPI_URL,
    map_amfi_category,
    is_excluded_by_name,
)

FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
NAV_DIR = os.path.join(ROOT, "public", "nav")

H = {"User-Agent": "Mozilla/5.0"}


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
        
        # Only Direct + Growth schemes
        name_lower = name.lower()
        if "direct" not in name_lower:
            continue
        if "growth" not in name_lower and "idcw" in name_lower:
            continue

        schemes[int(code)] = {
            "code": int(code),
            "name": name,
            "amc": current_amc or "",
            "amfi_category": current_category or "",
        }

    return schemes


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
    os.makedirs(NAV_DIR, exist_ok=True)

    for i, scheme in enumerate(equity_new):
        code = scheme["code"]
        dates, navs = fetch_nav_history(code)
        
        if not dates:
            skipped_fetch += 1
            continue
        
        if len(dates) < MIN_NAV_POINTS:
            skipped_short += 1
            continue

        cat = scheme["_mapped_category"]
        
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
            "riskLevel": "High",
            "categorySize": 0,  # will be updated by compute_rankings
            "metrics": {},
            "verdict": None,
            "holdings": [],
            "holdingsMeta": {"coverage": "pending"},
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
    print(f"  Skipped (fetch failed): {skipped_fetch}")

    if dry_run:
        print("\n--dry-run: no files written.")
        return

    if added > 0:
        with open(FUNDS_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"\nWrote {FUNDS_JSON} ({data['totalFunds']} total funds)")
        print("Run compute_metrics.py + compute_rankings.py next to rank the new funds.")


def detect_stale_merged_closed(data, amfi_schemes):
    """
    Detect funds that may be closed, merged, or renamed.
    Returns dict of {code: {"status": "closed"|"merged"|"renamed", "note": "..."}}
    """
    from datetime import datetime, timedelta
    findings = {}
    stale_cutoff = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")

    for fund in data["funds"]:
        code = fund["code"]

        # 1. Check if fund's AMFI code no longer exists in current NAVAll.txt
        if code not in amfi_schemes:
            findings[code] = {
                "status": "closed",
                "note": f"Code {code} no longer in AMFI universe. Likely closed or merged.",
                "name": fund["name"],
            }
            continue

        # 2. Check if NAV is stale (no update in 60+ days)
        nav_path = os.path.join(NAV_DIR, f"{code}.json")
        if os.path.exists(nav_path):
            try:
                nav_data = json.load(open(nav_path))
                last_date = nav_data.get("d", [""])[- 1] if nav_data.get("d") else ""
                if last_date and last_date < stale_cutoff:
                    findings[code] = {
                        "status": "closed",
                        "note": f"Last NAV date {last_date} is >60 days old. Likely closed/merged.",
                        "name": fund["name"],
                    }
                    continue
            except Exception:
                pass

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

    # === Lifecycle detection (closed/merged/renamed) ===
    print("\n--- Lifecycle Detection ---")
    findings = detect_stale_merged_closed(data, amfi_schemes)

    if findings:
        closed = [f for f in findings.values() if f["status"] == "closed"]
        renamed = [f for f in findings.values() if f["status"] == "renamed"]
        merged = [f for f in findings.values() if f["status"] == "merged"]

        if closed:
            print(f"\n  Likely CLOSED ({len(closed)}):")
            for f in closed[:10]:
                print(f"    {f['name'][:45]} - {f['note']}")
            if len(closed) > 10:
                print(f"    ... and {len(closed)-10} more")

        if renamed:
            print(f"\n  Likely RENAMED ({len(renamed)}):")
            for f in renamed[:10]:
                print(f"    {f['note']}")

        if merged:
            print(f"\n  Likely MERGED ({len(merged)}):")
            for f in merged[:10]:
                print(f"    {f['name'][:45]} - {f['note']}")

        # Write lifecycle report
        report_path = os.path.join(ROOT, "src", "data", "lifecycle_report.json")
        if not dry_run:
            with open(report_path, "w", encoding="utf-8") as f:
                json.dump(findings, f, indent=2, ensure_ascii=False)
            print(f"\n  Wrote lifecycle report: {report_path}")

        # Mark closed funds in data (add status field)
        if not dry_run:
            for fund in data["funds"]:
                code = fund["code"]
                if code in findings:
                    fund["status"] = findings[code]["status"]
                    if findings[code]["status"] == "renamed" and "new_name" in findings[code]:
                        fund["name"] = findings[code]["new_name"].replace(" - Direct Plan - Growth", "").replace(" - Direct Plan-Growth", "").strip()
    else:
        print("  No lifecycle changes detected.")

    if lifecycle_only:
        if not dry_run and findings:
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
    os.makedirs(NAV_DIR, exist_ok=True)

    for i, scheme in enumerate(equity_new):
        code = scheme["code"]
        dates, navs = fetch_nav_history(code)

        if not dates:
            skipped_fetch += 1
            continue

        if len(dates) < MIN_NAV_POINTS:
            skipped_short += 1
            continue

        cat = scheme["_mapped_category"]

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
            "riskLevel": "High",
            "categorySize": 0,
            "metrics": {},
            "verdict": None,
            "holdings": [],
            "holdingsMeta": {"coverage": "pending"},
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

    data["totalFunds"] = len([f for f in data["funds"] if f.get("status", "active") == "active"])

    print(f"\nResults:")
    print(f"  Added: {added}")
    print(f"  Skipped (too short): {skipped_short}")
    print(f"  Skipped (fetch failed): {skipped_fetch}")
    if findings:
        print(f"  Lifecycle changes: {len(findings)}")

    if dry_run:
        print("\n--dry-run: no files written.")
        return

    if added > 0 or findings:
        with open(FUNDS_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"\nWrote {FUNDS_JSON} ({data['totalFunds']} active funds)")
        if added > 0:
            print("Run compute_metrics.py + compute_rankings.py next to rank the new funds.")


if __name__ == "__main__":
    if "--lifecycle-only" in sys.argv or len(sys.argv) <= 1 or "--dry-run" in sys.argv:
        main_with_lifecycle()
    else:
        main()

