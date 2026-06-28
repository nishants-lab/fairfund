"""
Audit holdings slug-resolution accuracy.
For each fund, compare the Groww scheme_code in the fetched holdings payload
against our MFAPI scheme_code. If they differ, the slug resolved to the WRONG
fund (name-search fuzzy mismatch). Reports the count and examples.
"""
import json, os

ROOT = r"c:\Users\nisan\Documents\1. Work Related\1. Fresh\Kiro"
holdings = json.load(open(os.path.join(ROOT, "fund_holdings.json"), encoding="utf-8"))
HOLD_CACHE = os.path.join(ROOT, "holdings_cache")
u = json.load(open(os.path.join(ROOT, "mf_v6_universe.json"), encoding="utf-8"))
names = {str(f["code"]): f["name"] for f in u["funds"]}

def safe(s):
    import re
    return re.sub(r'[<>:"/\\|?*]', "_", s)

mismatch = []
ok = 0
nofile = 0
for code, rec in holdings.items():
    slug = rec.get("slug")
    if not slug:
        continue
    cf = os.path.join(HOLD_CACHE, f"{safe(slug)}.json")
    if not os.path.exists(cf):
        nofile += 1
        continue
    try:
        sc = json.load(open(cf))
    except:
        continue
    groww_code = str(sc.get("scheme_code") or "")
    # Groww scheme_code is often the REGULAR plan code, not direct. So a direct
    # mismatch isn't necessarily wrong. Better signal: does the slug look like
    # a totally different fund? Compare name tokens.
    if groww_code and groww_code != str(code):
        mismatch.append((code, names.get(code, "?"), slug, groww_code))

print(f"Total with slug: {sum(1 for r in holdings.values() if r.get('slug'))}")
print(f"Groww scheme_code != our code: {len(mismatch)}")
print("(NOTE: Groww often returns the REGULAR-plan code for a direct fund, so")
print(" a code mismatch alone is not proof of error. Use name comparison.)\n")

# Stronger heuristic: token overlap between our name and the slug.
def tokens(s):
    import re
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    stop = {"fund", "direct", "growth", "plan", "the", "of", "and", "scheme",
            "option", "regular", "in", "india"}
    return set(t for t in s.split() if t not in stop and len(t) > 2)

likely_wrong = []
for code, rec in holdings.items():
    slug = rec.get("slug")
    if not slug:
        continue
    nm = names.get(code, "")
    t_name = tokens(nm)
    t_slug = tokens(slug.replace("-", " "))
    if not t_name:
        continue
    overlap = len(t_name & t_slug) / len(t_name)
    if overlap < 0.5:
        likely_wrong.append((code, nm, slug, round(overlap, 2)))

print(f"LIKELY WRONG slug (name-token overlap < 50%): {len(likely_wrong)}")
for code, nm, slug, ov in sorted(likely_wrong, key=lambda x: x[3])[:40]:
    print(f"  [{ov}] {code} {nm[:42]}  ->  {slug[:50]}")
