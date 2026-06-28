"""
Migration: Split funds.json into a lightweight index + per-fund detail files

Current state:
  src/data/funds.json = 4.8 MB (838 funds x everything)
  
Target state:
  src/data/funds.json = lightweight (~500 KB) — keeps: code, name, fullName, amc,
      category, categoryDisplay, riskLevel, categorySize, metrics, verdict
  public/fund-data/{code}.json = per-fund heavy data — analytics, holdings,
      holdingsMeta, management, stockMoves (loaded on demand)

This reduces initial bundle from ~5 MB to ~500 KB and makes scraping require
838 individual requests instead of one.
"""

import json
from pathlib import Path

PROJECT = Path(r"C:\Users\nisan\Documents\1. Work Related\1. Fresh\Aki\Fairfund - Aki")
FUNDS_SRC = PROJECT / "src" / "data" / "funds.json"
FUNDS_LIGHT = PROJECT / "src" / "data" / "funds_light.json"
DETAIL_DIR = PROJECT / "public" / "fund-data"

# Fields to keep in the lightweight index (needed for search, explore, home page)
LIGHT_FIELDS = {"code", "name", "fullName", "amc", "category", "categoryDisplay",
                "riskLevel", "categorySize", "metrics", "verdict"}

# Fields to move to per-fund detail files (loaded on demand on fund page)
HEAVY_FIELDS = {"analytics", "holdings", "holdingsMeta", "management", "stockMoves"}

def main():
    with open(FUNDS_SRC, "r", encoding="utf-8") as f:
        data = json.load(f)

    DETAIL_DIR.mkdir(parents=True, exist_ok=True)

    light_funds = []
    detail_count = 0

    for fund in data["funds"]:
        # Extract heavy data
        detail = {}
        for key in HEAVY_FIELDS:
            if key in fund and fund[key]:
                detail[key] = fund[key]

        # Write per-fund detail file (only if it has heavy data)
        if detail:
            out_path = DETAIL_DIR / f"{fund['code']}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, separators=(",", ":"))
            detail_count += 1

        # Build lightweight fund entry
        light_fund = {k: v for k, v in fund.items() if k in LIGHT_FIELDS}
        light_funds.append(light_fund)

    # Write lightweight funds.json (same structure, just lighter funds array)
    light_data = {k: v for k, v in data.items() if k != "funds"}
    light_data["funds"] = light_funds

    with open(FUNDS_LIGHT, "w", encoding="utf-8") as f:
        json.dump(light_data, f, separators=(",", ":"))

    # Sizes
    original_kb = FUNDS_SRC.stat().st_size / 1024
    light_kb = FUNDS_LIGHT.stat().st_size / 1024
    detail_total_kb = sum(f.stat().st_size for f in DETAIL_DIR.glob("*.json")) / 1024

    print(f"Original funds.json: {original_kb:.0f} KB")
    print(f"Lightweight funds_light.json: {light_kb:.0f} KB ({light_kb/original_kb*100:.0f}% of original)")
    print(f"Per-fund detail files: {detail_count} files, {detail_total_kb:.0f} KB total")
    print(f"Average detail file: {detail_total_kb/max(detail_count,1):.1f} KB")
    print(f"\nBundle reduction: {original_kb:.0f} KB -> {light_kb:.0f} KB (saves {original_kb-light_kb:.0f} KB from initial load)")
    print(f"\n✓ Split complete. Original funds.json preserved.")
    print(f"\nNext steps:")
    print(f"  1. Rename funds_light.json -> funds.json (after updating data loader)")
    print(f"  2. Update src/lib/data.ts or FundDetail.tsx to fetch /fund-data/{{code}}.json on demand")
    print(f"  3. Update TypeScript types (Fund type needs analytics/holdings as optional)")
    print(f"  4. Test fund pages load correctly")

if __name__ == "__main__":
    main()
