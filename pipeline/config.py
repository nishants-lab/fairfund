"""
Shared configuration for FairFund pipeline.
Single source of truth for category mappings, thresholds, and API settings.

To add a new fund category (e.g., liquid funds):
  1. Add the AMFI category string to ELIGIBLE_AMFI_CATEGORIES
  2. Add the mapping in AMFI_TO_FAIRFUND_CATEGORY or AMFI_CATEGORY_FALLBACKS
  3. Push. Discovery will pick them up on the next run (4th of month).
"""

# AMFI category strings we consider eligible for the FairFund universe.
# These are the exact strings from AMFI's NAVAll.txt category headers.
ELIGIBLE_AMFI_CATEGORIES = {
    # Equity
    "Large Cap Fund",
    "Mid Cap Fund",
    "Small Cap Fund",
    "Large & Mid Cap Fund",
    "Multi Cap Fund",
    "Flexi Cap Fund",
    "Dividend Yield Fund",
    "Value Fund",
    "Contra Fund",
    "Focused Fund",
    "Sectoral/Thematic",
    "ELSS",
    # Index
    "Index Funds",
    "Index Fund",
    # FoF
    "Fund of Funds (Overseas)",
    "Fund of Funds (Domestic)",
}

# Map AMFI's category string to FairFund's internal display category.
# Checked in order: first match wins (case-insensitive substring match).
AMFI_TO_FAIRFUND_CATEGORY = {
    "Large Cap Fund": "Large Cap",
    "Mid Cap Fund": "Mid Cap",
    "Small Cap Fund": "Small Cap",
    "Large & Mid Cap Fund": "Large & Mid Cap",
    "Multi Cap Fund": "Multi Cap",
    "Flexi Cap Fund": "Flexi Cap",
    "Dividend Yield Fund": "Dividend Yield",
    "Value Fund": "Value/Contra",
    "Contra Fund": "Value/Contra",
    "Focused Fund": "Focused",
    "ELSS": "ELSS",
}

# Fallback rules applied after the direct mapping above.
# Each rule: (list_of_keywords, category). ANY keyword in the list triggers the match.
# This is OR logic within each rule.
AMFI_CATEGORY_FALLBACKS = [
    (["sectoral", "thematic"], "Sectoral/Thematic"),
    (["index"], "Index-Other"),
    (["overseas", "international"], "International"),
    (["fof domestic", "fund of funds (domestic)"], "FoF-Equity (Domestic)"),
]

# FairFund is an equity-only universe. AMFI's "Index Funds" and
# "Fund of Funds (Overseas)" buckets are mixed: they also carry debt/fixed-income
# vehicles (US Treasury bond FoFs, target-maturity Gilt / PSU-Bond / SDL index
# funds) whose AMFI category string is indistinguishable from equity ones.
# We filter those out by name so they never enter the universe.
EXCLUDE_NAME_KEYWORDS = ["treasury", "debt", "gilt", "overnight", "bond", " sdl"]


def is_excluded_by_name(fund_name):
    """True if a fund's name marks it as a debt/fixed-income vehicle that must
    not enter FairFund's equity universe (e.g. US Treasury bond FoFs or
    target-maturity Gilt/PSU-Bond/SDL index funds arriving under AMFI's mixed
    'Index Funds' / 'Fund of Funds (Overseas)' categories)."""
    if not fund_name:
        return False
    low = fund_name.lower()
    return any(kw in low for kw in EXCLUDE_NAME_KEYWORDS)

# Minimum NAV data points (~3 years of trading days) for a fund to be eligible
MIN_NAV_POINTS = 750

# Groww API settings
GROWW_SEARCH_URL = "https://groww.in/v1/api/search/v3/query/global/st_query?query="
GROWW_SCHEME_URL = "https://groww.in/v1/api/data/mf/web/v2/scheme/search/"
GROWW_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json",
}

# AMFI API
AMFI_NAV_ALL_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
MFAPI_BASE_URL = "https://api.mfapi.in/mf/"


def map_amfi_category(amfi_cat):
    """Map AMFI's category string to FairFund's internal category key.
    Returns None if the category is not in our universe."""
    if not amfi_cat:
        return None
    low = amfi_cat.lower()

    # Direct mapping (exact substring match)
    for key, val in AMFI_TO_FAIRFUND_CATEGORY.items():
        if key.lower() in low:
            return val

    # Fallback rules (OR logic: any keyword in the list triggers)
    for keywords, category in AMFI_CATEGORY_FALLBACKS:
        if any(kw in low for kw in keywords):
            return category

    return None
