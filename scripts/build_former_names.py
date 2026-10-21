"""
Other names a fund is known by, for search: src/data/former_names.json = { "<code>": [...] }.
=========================================================================================
Investors search by the name they remember. "Kotak Emerging Equity", "Axis Bluechip"
and "Parag Parikh Long Term Value" are all current funds under new names, and a search
that only knows today's name returns nothing or the wrong fund.

Sources, all tied to the fund's own AMFI code (never matched by name):
  1. Groww slugs. A slug keeps the name the page was created under. Every slug in
     public/holdings-history/_slugs.json is verified by scheme_code during capture,
     and renamed pages' old slugs are kept in _former_slugs.json.
  2. "(Formerly Known as X)" / "(erstwhile X)" in the scheme's AMFI full name.
  3. scripts/former_names_curated.json: renames confirmed from AMC documents.

A slug name is kept only if it says something today's name does not: it must have a
distinctive word missing from the current name, after ignoring plan/option words,
spacing ("Nifty200" vs "Nifty 200") and one-letter typos. A slug is usually the older
name but not always, so the site labels these "Also known as", not "Formerly".
Run after capture; deterministic.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FUNDS = os.path.join(ROOT, "src", "data", "funds.json")
SLUGS = os.path.join(ROOT, "public", "holdings-history", "_slugs.json")
FORMER_SLUGS = os.path.join(ROOT, "public", "holdings-history", "_former_slugs.json")
CURATED = os.path.join(HERE, "former_names_curated.json")
OUT = os.path.join(ROOT, "src", "data", "former_names.json")

# Words that carry no identity: plan/option labels, structure words, slug noise.
GENERIC = {
    "fund", "funds", "direct", "growth", "plan", "option", "scheme", "the", "of", "and",
    "regular", "idcw", "fof", "omni", "active", "passive", "index", "formerly", "known",
    "as", "erstwhile", "a", "b", "retail", "directgrowth", "other", "offshore", "off",
    "shore", "i", "come", "com", "tel", "ex", "g", "overseas", "equity",
}
CAP_JOIN = [("small cap", "smallcap"), ("mid cap", "midcap"), ("large cap", "largecap"),
            ("flexi cap", "flexicap"), ("multi cap", "multicap"), ("micro cap", "microcap")]
SLUG_SUFFIX = re.compile(r"(-direct(-plan)?(-growth)?(-option)?|-growth)+$")


def words(s):
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    for a, b in CAP_JOIN:
        s = s.replace(a, b)
    return s.split()


def distinctive(s):
    return [w for w in words(s) if w not in GENERIC]


def slug_name(slug):
    return SLUG_SUFFIX.sub("", slug).replace("-", " ").strip()


def near(a, b):
    """Edit distance <= 1 (a typo such as "Heathcare" for "Healthcare")."""
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1 or min(len(a), len(b)) < 5:
        return False
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1
    return a[i + 1:] == b[i + 1:] or a[i:] == b[i + 1:] or a[i + 1:] == b[i:]


def says_something_new(old, current_names):
    """True if `old` has a distinctive word that no current name has."""
    cur_words = set()
    cur_compact = ""
    for n in current_names:
        cur_words.update(distinctive(n))
        cur_compact += "".join(distinctive(n)) + "|"
    extra = [w for w in distinctive(old) if w not in cur_words]
    # "nifty200" vs "nifty 200", "largemidcap" vs "large midcap": spacing only.
    extra = [w for w in extra if w not in cur_compact]
    # Typos in either name are not a different name.
    extra = [w for w in extra if not any(near(w, c) for c in cur_words)]
    return bool(extra)


def pretty(name, case_map):
    out = []
    for w in name.split():
        out.append(case_map.get(w.lower(), w[:1].upper() + w[1:]))
    return " ".join(out)


def strip_former_clause(name):
    return re.sub(r"\s*\((formerly|erstwhile)[^)]*\)?", "", name, flags=re.I).strip()


def former_from_full_name(full):
    out = []
    for m in re.finditer(r"\((?:formerly known as|formerly|erstwhile|earlier known as)\s+([^)]+)\)?", full or "", re.I):
        n = re.sub(r"\s*-?\s*direct plan.*$", "", m.group(1), flags=re.I).strip(" -")
        if n:
            out.append(n)
    return out


def build(funds, slugs, former_slugs, curated):
    # Keep acronyms as AMCs write them: ICICI, HDFC, SBI, UTI, DSP, LIC, JM, PGIM...
    # A word counts as an acronym when most names that use it write it in capitals;
    # all-capitals names ("ADITYA BIRLA SUN LIFE ARBITRAGE FUND") are not evidence.
    upper, other = {}, {}
    for f in funds:
        name = f.get("name") or ""
        if name.upper() == name:
            continue
        for w in re.split(r"[^A-Za-z0-9&]+", name):
            if len(w) < 2 or w.isdigit():
                continue
            bucket = upper if w.isupper() else other
            bucket[w.lower()] = bucket.get(w.lower(), 0) + 1
    case_map = {w: w.upper() for w, n in upper.items() if n > other.get(w, 0)}
    # Acronyms of former AMC names, which no current fund name carries.
    for w in ("idfc", "dsp", "bnp", "icici", "hdfc", "sbi", "uti", "lic", "jm", "nj", "hsbc",
              "pgim", "iti", "fmcg", "elss", "it", "psu", "mnc", "esg", "us", "etf", "l&t", "iifl"):
        case_map.setdefault(w, w.upper())
    # A name that is another fund's name today belongs to that fund: Kotak Small
    # Cap's page was created as "kotak-midcap-fund", but "Kotak Mid Cap Fund" is
    # now a different scheme, and searching it must not offer the small-cap fund.
    current_owner = {}
    for f in funds:
        key = " ".join(distinctive(strip_former_clause(f.get("name") or "")))
        if key:
            current_owner.setdefault(key, set()).add(str(f["code"]))
    result = {}
    for f in funds:
        code = str(f["code"])
        current = [strip_former_clause(f.get("name") or ""), strip_former_clause(f.get("fullName") or "")]
        found = []
        for n in former_from_full_name(f.get("fullName")) + former_from_full_name(f.get("name")):
            found.append(n)
        for entry in (curated.get(code) or {}).get("names", []):
            found.append(entry)
        # A renamed page's current slug is its NEW name, so only its old slugs count.
        own = [] if former_slugs.get(code) else [slugs.get(code)]
        for slug in own + list(former_slugs.get(code, [])):
            if slug:
                found.append(pretty(slug_name(slug), case_map))
        kept = []
        seen = set()
        for n in found:
            key = " ".join(distinctive(n))
            if not key or key in seen or not says_something_new(n, current):
                continue
            if current_owner.get(key, {code}) - {code}:
                continue
            seen.add(key)
            kept.append(n)
        if kept:
            result[code] = kept
    return dict(sorted(result.items(), key=lambda kv: int(kv[0])))


def _load(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    funds = _load(FUNDS, {"funds": []})["funds"]
    curated = {k: v for k, v in _load(CURATED, {}).items() if not k.startswith("_")}
    result = build(funds, _load(SLUGS, {}), _load(FORMER_SLUGS, {}), curated)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"Wrote {OUT}: former names for {len(result)} funds")


if __name__ == "__main__":
    main()
