"""
Authoritative category mapping.
================================
Replaces the broken name-keyword categorizer. Maps AMFI's published
`scheme_category` (+ `scheme_type`) to our display buckets.

Key principle: trust AMFI's classification, not the fund's name.
Only accept clean Open-Ended equity-oriented schemes. Reject anything
whose category is malformed/garbage (close-ended leftovers, raw CSV
fragments) by requiring an exact match against the known AMFI taxonomy.

Returns (bucket, is_equity_oriented) or (None, False) if not in scope.
"""

# Direct map: AMFI scheme_category -> our display bucket.
# These are the ONLY equity-oriented categories we rank.
EQUITY_MAP = {
    "Equity Scheme - Large Cap Fund": "Large Cap",
    "Equity Scheme - Mid Cap Fund": "Mid Cap",
    "Equity Scheme - Small Cap Fund": "Small Cap",
    "Equity Scheme - Large & Mid Cap Fund": "Large & Mid Cap",
    "Equity Scheme - Multi Cap Fund": "Multi Cap",
    "Equity Scheme - Flexi Cap Fund": "Flexi Cap",
    "Equity Scheme - ELSS": "ELSS",
    "Equity Scheme - Focused Fund": "Focused",
    "Equity Scheme - Value Fund": "Value/Contra",
    "Equity Scheme - Contra Fund": "Value/Contra",
    "Equity Scheme - Dividend Yield Fund": "Dividend Yield",
    "Equity Scheme - Sectoral/ Thematic": "Sectoral/Thematic",
}

# Index funds (Other Scheme - Index Funds): bucket is refined by name
# because AMFI lumps ALL index funds into one category. Name is acceptable
# HERE only to split large/mid/small/other index — they are all genuinely
# index funds per AMFI, so we are not guessing equity-ness from the name.
def _index_bucket(name: str) -> str:
    n = name.lower()
    if any(x in n for x in ["pharma", "healthcare", "bank", " it ", "auto", "fmcg",
                            "infra", "energy", "metal", "psu", "consumption",
                            "manufacturing", "momentum", "quality", "esg", "value",
                            "defence", "digital", "realty", "media", "commodit",
                            "private bank", "financial", "alpha", "low volatility",
                            "dividend", "capex", "tourism", "ev ", "innovation"]):
        return "Index-Sectoral/Thematic"
    if "midcap" in n or "mid cap" in n or "midsmall" in n or "mid small" in n:
        return "Index-MidCap"
    if "smallcap" in n or "small cap" in n:
        return "Index-SmallCap"
    if any(x in n for x in ["nifty 50", "nifty50", "sensex", "nifty 100", "top 50",
                            "largecap", "large cap", "nifty100"]):
        return "Index-LargeCap"
    return "Index-Other"

# International equity exposure. AMFI puts these under FoF Overseas, but some
# overseas equity funds are also tagged Sectoral/Thematic (handled in EQUITY_MAP
# -> we re-route true international ones below using fund_house/name signals only
# for display grouping, NOT for inclusion).
INTL_CATEGORIES = {
    "Other Scheme - FoF Overseas": "International",
}

# Domestic FoFs: include ONLY if they are equity-oriented FoFs. AMFI category
# "Other Scheme - FoF Domestic" mixes equity FoF, gold FoF, debt FoF, multi-asset.
# We cannot tell equity-ness from category alone here, so domestic FoFs are
# included conditionally based on resolved underlying/holdings at the holdings
# stage. For the ranking universe we EXCLUDE domestic FoFs by default to avoid
# polluting equity peer groups, EXCEPT equity-flavored ones flagged by name.
def _domestic_fof_bucket(name: str):
    n = name.lower()
    # gold / silver / commodity / debt / liquid FoFs are not equity
    if any(x in n for x in ["gold", "silver", "commodit", "debt", "liquid",
                            "bond", "income", "arbitrage", "money market",
                            "g-sec", "gilt"]):
        return None
    # asset-allocation / multi-asset / hybrid / life-stage FoFs are hybrid -> exclude
    if any(x in n for x in ["asset alloc", "multi asset", "multi-asset",
                            "balanced", "conservative", "aggressive hybrid",
                            "dynamic asset", "life stage", "multi factor",
                            "multi sector", "allocator", "asset allocation"]):
        return None
    # International-flavored domestic FoFs (feeders into overseas ETFs) -> International
    if any(x in n for x in ["nasdaq", "s&p", "s & p", "fang", "nyse", "hang seng",
                            "global", "us ", "u.s", "china", "world", "international",
                            "developed", "emerging market", "greater china",
                            "japan", "europe", "asia"]):
        return "International"
    # equity-oriented domestic FoFs (e.g. passive equity ETF FoF)
    if any(x in n for x in ["equity", "nifty", "sensex", "flexi", "large", "mid",
                            "small", "multi cap", "index", "momentum", "alpha",
                            "low volatility", "esg", "defence", "manufacturing",
                            "consumption", "metal", "digital", "internet",
                            "capital markets", "ev ", "pse", "pse", "ipo"]):
        return "FoF-Equity (Domestic)"
    return None


def classify(scheme_category: str, scheme_type: str, name: str):
    """
    Return (bucket, is_equity) using AMFI authoritative category as the
    primary signal. (None, False) if out of scope or malformed.
    """
    cat = (scheme_category or "").strip()
    stype = (scheme_type or "").strip()

    # Reject anything not clearly Open Ended (close-ended/interval/garbage).
    if stype != "Open Ended Schemes":
        return None, False

    # Direct equity categories (exact match against known taxonomy).
    if cat in EQUITY_MAP:
        return EQUITY_MAP[cat], True

    # Index funds.
    if cat == "Other Scheme - Index Funds":
        return _index_bucket(name), True

    # Overseas FoF -> International equity exposure.
    if cat in INTL_CATEGORIES:
        return INTL_CATEGORIES[cat], True

    # Domestic FoF -> include only equity-flavored ones.
    if cat == "Other Scheme - FoF Domestic":
        b = _domestic_fof_bucket(name)
        return (b, True) if b else (None, False)

    # Everything else (debt, hybrid, solution-oriented, liquid, malformed) -> out.
    return None, False


# Known clean equity-oriented AMFI categories (for validation/reporting).
KNOWN_EQUITY_CATEGORIES = set(EQUITY_MAP) | {
    "Other Scheme - Index Funds",
    "Other Scheme - FoF Overseas",
    "Other Scheme - FoF Domestic",
}
