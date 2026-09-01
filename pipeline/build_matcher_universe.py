"""
Build the CAMS matcher universe: every open-ended Growth scheme AMFI prices,
across Direct and Regular plans and all asset classes (equity, debt, hybrid,
index, FoF, solution-oriented).

Why this exists
---------------
funds.json is FairFund's curated *analytics* universe: Direct-Growth EQUITY
only (~756 funds) with full metrics, rankings, holdings and manager data.
That set is intentionally narrow.

The portfolio feature needs a *superset* purely for identification: when a
user uploads a CAMS statement, we must recognise every holding, including
Regular-plan and debt/hybrid schemes that will never enter the analytics
universe. This builder produces that superset as a single flat lookup file.

It carries no NAV or analytics: only the fields needed to match a CAMS line to
a scheme code and classify its plan/option. Valuation for schemes outside
funds.json is fetched on demand from mfapi.in at portfolio-analysis time.

Output: src/data/matcher_universe.json
  { "generated": "<ISO date>",
    "count": <n>,
    "funds": [ {code, name, amc, amfiCategory, planType, optionType}, ... ] }

planType  : "direct" | "regular"
optionType: "growth"   (only Growth schemes are included in Phase 1)

Usage:
  python pipeline/build_matcher_universe.py
  python pipeline/build_matcher_universe.py --dry-run
"""
import os
import sys
import json
import urllib.request
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from config import AMFI_NAV_ALL_URL as AMFI_URL

OUT_PATH = os.path.join(ROOT, "src", "data", "matcher_universe.json")
FUNDS_PATH = os.path.join(ROOT, "src", "data", "funds.json")
H = {"User-Agent": "Mozilla/5.0"}
DRY_RUN = "--dry-run" in sys.argv


def fetch_amfi_raw():
    req = urllib.request.Request(AMFI_URL, headers=H)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8", errors="replace")


def _is_growth_equivalent(option, name):
    """True for Growth / Cumulative options (no periodic payout).

    AMFI's option field is not uniformly populated: most AMCs say "Growth",
    some say "Cumulative" (an older synonym with identical NAV mechanics -
    no distribution, pure accumulation), and a handful leave it blank
    entirely for certain schemes. When blank, fall back to the scheme name;
    if the name gives no signal either way, default to Growth - AMCs that
    omit the option field are, in practice, listing their single Growth-only
    line (IDCW variants are almost always explicitly labelled)."""
    o = option.strip().lower()
    if any(k in o for k in ("growth", "cumulative")):
        return True
    if o:
        return False  # explicitly something else (IDCW/bonus/payout/...)
    n = name.lower()
    if any(k in n for k in ("idcw", "dividend", "bonus", "payout", "reinvest")):
        return False
    return True


def _classify_plan(plan, name):
    """'direct' | 'regular' | None (genuinely unclassifiable)."""
    p = plan.strip().lower()
    if "direct" in p:
        return "direct"
    if "regular" in p:
        return "regular"
    n = name.lower()
    if "direct" in n:
        return "direct"
    if "regular" in n:
        return "regular"
    return None


def parse_universe(raw):
    """Yield every open-ended Direct/Regular Growth scheme in NAVAll.txt.

    2026 portal layout is 8 fields:
      code;isin_growth;isin_reinv;scheme_name;plan;option;nav;date
    Category headers are standalone lines with no ';'; AMC headers contain
    'Mutual Fund'. Only open-ended categories are kept (close-ended/interval
    schemes are matured or non-tradeable, so they cannot appear as a live
    CAMS holding worth valuing).

    Plan/option classification falls back to the scheme name when AMFI's
    fields are blank or non-standard (see _classify_plan / _is_growth_equivalent) -
    several AMCs (observed: Motilal Oswal, Tata index funds) leave these
    fields empty even for live Direct-Growth schemes."""
    current_category = None
    current_amc = None
    seen = {}  # code -> record (dedupe, last wins)

    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if ";" not in line and not line[0].isdigit():
            if "mutual fund" in line.lower():
                current_amc = line
            else:
                current_category = line
            continue

        parts = line.split(";")
        if len(parts) < 8:
            continue
        code = parts[0].strip()
        if not code.isdigit():
            continue

        name = parts[3].strip()
        plan_raw = parts[4]
        option_raw = parts[5]
        cat = current_category or ""

        if "open ended" not in cat.lower():
            continue
        if not _is_growth_equivalent(option_raw, name):
            continue
        plan_type = _classify_plan(plan_raw, name)
        if plan_type is None:
            continue  # cannot confidently classify - excluded, not guessed

        seen[int(code)] = {
            "code": int(code),
            "name": name,
            "amc": current_amc or "",
            "amfiCategory": cat,
            "planType": plan_type,
            "optionType": "growth",
        }

    return list(seen.values())


def main():
    raw = fetch_amfi_raw()
    funds = parse_universe(raw)
    funds.sort(key=lambda f: f["code"])

    # Consistency guard: every curated analytics code must be matchable.
    with open(FUNDS_PATH, encoding="utf-8") as fh:
        curated = json.load(fh)
    curated_codes = {f["code"] for f in curated.get("funds", curated)}
    universe_codes = {f["code"] for f in funds}
    missing = curated_codes - universe_codes

    d_count = sum(1 for f in funds if f["planType"] == "direct")
    r_count = sum(1 for f in funds if f["planType"] == "regular")
    print(f"Parsed: {len(funds)} Growth schemes "
          f"({d_count} direct, {r_count} regular)")
    print(f"Curated funds.json codes covered: "
          f"{len(curated_codes) - len(missing)}/{len(curated_codes)}")
    if missing:
        print(f"WARNING: {len(missing)} curated codes missing from the parsed "
              f"AMFI universe (AMFI plan/option fields blank or non-standard "
              f"for these AMCs) - force-merging from funds.json as a safety "
              f"net so Tier-1 matching can never regress: {sorted(missing)}")
        curated_by_code = {f["code"]: f for f in curated.get("funds", curated)}
        by_code = {f["code"]: f for f in funds}
        for code in missing:
            cf = curated_by_code[code]
            by_code[code] = {
                "code": cf["code"],
                "name": cf.get("fullName") or cf["name"],
                "amc": cf.get("amc", ""),
                "amfiCategory": cf.get("category", ""),
                "planType": "direct",
                "optionType": "growth",
            }
        funds = list(by_code.values())
        funds.sort(key=lambda f: f["code"])
        universe_codes = {f["code"] for f in funds}
        still_missing = curated_codes - universe_codes
        assert not still_missing, f"force-merge failed: {still_missing}"
        print(f"Curated funds.json codes covered after force-merge: "
              f"{len(curated_codes)}/{len(curated_codes)}")

    if DRY_RUN:
        print("(dry-run) not writing", OUT_PATH)
        return

    payload = {
        "generated": date.today().isoformat(),
        "count": len(funds),
        "funds": funds,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"), ensure_ascii=False)
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"Wrote {OUT_PATH} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
