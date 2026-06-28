"""
Migration: Split fund_analytics.json into per-fund files + generate robots.txt

What it does:
1. Reads src/data/fund_analytics.json (824 funds, single file)
2. Splits into public/analytics/{code}.json (one file per fund)
3. Creates a minimal src/data/fund_analytics_index.json (just fund codes list)
4. Generates public/robots.txt that disallows bulk data paths
5. Does NOT delete the original file (safe rollback)

After verifying:
- Update src/lib/data.ts to lazy-load per-fund analytics
- Delete src/data/fund_analytics.json
- Commit
"""

import json
import os
from pathlib import Path

PROJECT = Path(r"C:\Users\nisan\Documents\1. Work Related\1. Fresh\Aki\Fairfund - Aki")
ANALYTICS_SRC = PROJECT / "src" / "data" / "fund_analytics.json"
OUTPUT_DIR = PROJECT / "public" / "analytics"
INDEX_OUT = PROJECT / "src" / "data" / "fund_analytics_index.json"
ROBOTS_OUT = PROJECT / "public" / "robots.txt"

def main():
    # Load monolithic analytics
    with open(ANALYTICS_SRC, "r", encoding="utf-8") as f:
        analytics = json.load(f)

    print(f"Loaded {len(analytics)} fund analytics entries")

    # Create output dir
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Split into per-fund files
    codes = []
    for code, data in analytics.items():
        codes.append(code)
        out_path = OUTPUT_DIR / f"{code}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))  # compact JSON

    print(f"Written {len(codes)} individual analytics files to public/analytics/")

    # Write index (just the list of codes that have analytics)
    with open(INDEX_OUT, "w", encoding="utf-8") as f:
        json.dump({"codes": codes, "count": len(codes)}, f, separators=(",", ":"))
    print(f"Written index to {INDEX_OUT.relative_to(PROJECT)}")

    # Generate robots.txt
    robots = """# FairFund robots.txt
# Allow indexing of pages, block bulk data scraping

User-agent: *
Allow: /
Disallow: /analytics/
Disallow: /nav/
Disallow: /holdings-history/

# Block common AI/LLM crawlers from all content
User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Google-Extended
Disallow: /

# Sitemap (add once you have a custom domain)
# Sitemap: https://fairfund.in/sitemap.xml
"""
    with open(ROBOTS_OUT, "w", encoding="utf-8") as f:
        f.write(robots)
    print(f"Written robots.txt to public/robots.txt")

    # Summary
    total_size_kb = sum(f.stat().st_size for f in OUTPUT_DIR.glob("*.json")) / 1024
    original_size_kb = ANALYTICS_SRC.stat().st_size / 1024
    print(f"\nOriginal: {original_size_kb:.0f} KB (single file)")
    print(f"Split: {total_size_kb:.0f} KB total across {len(codes)} files")
    print(f"Average per fund: {total_size_kb/len(codes):.1f} KB")
    print("\n✓ Migration complete. Original file preserved for rollback.")
    print("\nNext steps:")
    print("  1. Update src/lib/data.ts to fetch per-fund analytics on demand")
    print("  2. Remove the static import of fund_analytics.json")
    print("  3. Test that fund pages load analytics correctly")
    print("  4. Delete src/data/fund_analytics.json")

if __name__ == "__main__":
    main()
