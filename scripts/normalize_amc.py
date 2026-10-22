"""
Set each fund's AMC to the fund house AMFI files it under.

The index `amc` field used to be cut from the scheme name, so 425 of 1,013 funds
carried names such as "ICICI Prudential Dividend Yield" or "Kotak Mahindra Small
Cap" as their AMC. Fund pages showed that text, and grouping or searching by fund
house could not work. AMFI's scheme master (src/data/matcher_universe.json, rebuilt
by pipeline/build_matcher_universe.py) names the fund house for every scheme code,
so it is the source of truth here.

Idempotent. A code missing from the matcher universe keeps its current value and is
reported, so a stale matcher file never blanks a fund house.
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNDS_JSON = os.path.join(ROOT, "src", "data", "funds.json")
MATCHER_JSON = os.path.join(ROOT, "src", "data", "matcher_universe.json")


def canonical_amc(amfi_name):
    """'Kotak Mahindra Mutual Fund' -> 'Kotak Mahindra'."""
    name = (amfi_name or "").strip()
    if name.lower().endswith(" mutual fund"):
        name = name[: -len(" mutual fund")]
    return name.strip()


def fund_houses(matcher_funds):
    """Names AMFI files as '<house> Mutual Fund'. A few matcher rows instead carry an
    older scheme-derived value ('Motilal Oswal Nifty'), copied from the index when the
    scheme master had no section header for them."""
    return {canonical_amc(m.get("amc")) for m in matcher_funds
            if (m.get("amc") or "").strip().lower().endswith(" mutual fund")}


def resolve(value, houses):
    name = canonical_amc(value)
    if name in houses or not name:
        return name
    prefixes = [h for h in houses if name.lower().startswith(h.lower() + " ")]
    return max(prefixes, key=len) if prefixes else name


def normalize(funds, matcher_funds):
    houses = fund_houses(matcher_funds)
    by_code = {int(m["code"]): resolve(m.get("amc"), houses) for m in matcher_funds}
    changed, missing = 0, []
    for f in funds:
        amc = by_code.get(int(f["code"]))
        if not amc:
            missing.append(f["code"])
            continue
        if f.get("amc") != amc:
            f["amc"] = amc
            changed += 1
    return changed, missing


def main():
    data = json.load(open(FUNDS_JSON, encoding="utf-8"))
    matcher = json.load(open(MATCHER_JSON, encoding="utf-8"))
    changed, missing = normalize(data["funds"], matcher.get("funds", []))
    if changed:
        with open(FUNDS_JSON, "w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
    if missing:
        print(f"::warning::{len(missing)} fund(s) not in the AMFI matcher universe; AMC left as is: {missing[:10]}")
    print(f"AMC names: {changed} corrected, {len(data['funds']) - changed - len(missing)} already correct")


if __name__ == "__main__":
    main()
