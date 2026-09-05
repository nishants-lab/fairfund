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
    # Debt (cash-equivalent only)
    "Liquid Fund",
    "Money Market Fund",
    # Hybrid (equity-taxed, cash-alternative)
    "Arbitrage Fund",
    # Index
    "Index Funds",
    "Index Fund",
    # FoF
    "Fund of Funds (Overseas)",
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
    "Liquid Fund": "Liquid",
    "Money Market Fund": "Money Market",
    "Arbitrage Fund": "Arbitrage",
}

# Fallback rules applied after the direct mapping above.
# Each rule: (list_of_keywords, category). ANY keyword in the list triggers the match.
# This is OR logic within each rule.
AMFI_CATEGORY_FALLBACKS = [
    (["sectoral", "thematic"], "Sectoral/Thematic"),
    (["index"], "Index-Other"),
    (["overseas", "international"], "International"),
]

# --------------------------------------------------------------------------
# Asset-class awareness.
#
# FairFund's analytics (holdings X-ray, manager skill, market-regime behaviour,
# drawdown/recovery, capture ratios) are built for EQUITY funds. Debt funds
# earn accrual, not stock-picking alpha, so those enrichment steps must be
# SKIPPED for them and the UI must hide the equity-only sections.
#
# DEBT_CATEGORIES holds the FairFund internal category keys that are debt
# (cash-equivalent) funds. Keep this in sync with AMFI_TO_FAIRFUND_CATEGORY.
# --------------------------------------------------------------------------
DEBT_CATEGORIES = {"Liquid", "Money Market"}

# Arbitrage funds are a HYBRID asset class: they hold >=65% equity via fully
# hedged cash-futures positions, so they are TAXED AS EQUITY (STCG 20% <12mo,
# LTCG 12.5% >=12mo above the annual exemption) - NOT at slab like true debt.
# But their return comes from arbitrage spread capture, not stock-picking, so
# the equity-skill analytics (holdings X-ray, manager alpha, regime behaviour,
# capture ratios) are misleading and must be hidden, exactly like debt. Hence
# they share the "reduced surface" treatment while keeping equity taxation and
# their own cost+return ranking.
ARBITRAGE_CATEGORIES = {"Arbitrage"}

# SEBI riskometer band per FairFund category. Equity categories default to
# "High" (unchanged behaviour); debt cash-equivalents carry their true, lower
# band so the risk pill does not lie.
RISK_BY_CATEGORY = {
    "Liquid": "Low to Moderate",
    "Money Market": "Moderate",
    "Arbitrage": "Low to Moderate",
}
DEFAULT_RISK_LEVEL = "High"


def is_debt_category(fairfund_category):
    """True if a FairFund internal category is a debt (cash-equivalent) fund
    for which equity-only enrichment (holdings/managers/regimes) must be skipped."""
    return fairfund_category in DEBT_CATEGORIES


def is_arbitrage_category(fairfund_category):
    """True for arbitrage funds: equity-taxed but return comes from hedged
    arbitrage spread, so equity-skill analytics must be hidden (like debt)."""
    return fairfund_category in ARBITRAGE_CATEGORIES


def uses_reduced_surface(fairfund_category):
    """True if a category should hide equity-only analytics (holdings X-ray,
    manager skill, regimes, capture ratios): all debt AND arbitrage funds.
    Taxation is handled separately - arbitrage stays equity-taxed."""
    return is_debt_category(fairfund_category) or is_arbitrage_category(fairfund_category)


def risk_level_for(fairfund_category):
    """SEBI riskometer band for a FairFund category (equity -> High by default)."""
    return RISK_BY_CATEGORY.get(fairfund_category, DEFAULT_RISK_LEVEL)

# FairFund is an equity-only universe. AMFI's "Index Funds" and
# "Fund of Funds (Overseas)" buckets are mixed: they also carry debt/fixed-income
# vehicles (US Treasury bond FoFs, target-maturity Gilt / PSU-Bond / SDL index
# funds) whose AMFI category string is indistinguishable from equity ones.
# We filter those out by name so they never enter the universe.
EXCLUDE_NAME_KEYWORDS = ["treasury", "debt", "gilt", "overnight", "bond", " sdl", "g-sec", "gsec"]


def is_excluded_by_name(fund_name):
    """True if a fund's name marks it as a debt/fixed-income vehicle that must
    not enter FairFund's equity universe (e.g. US Treasury bond FoFs or
    target-maturity Gilt/PSU-Bond/SDL index funds arriving under AMFI's mixed
    'Index Funds' / 'Fund of Funds (Overseas)' categories)."""
    if not fund_name:
        return False
    low = fund_name.lower()
    return any(kw in low for kw in EXCLUDE_NAME_KEYWORDS)

# Minimum NAV data points (~3 years of trading days) for a fund to be eligible.
# Equity funds need a 3Y window for their risk-adjusted analytics to be meaningful.
MIN_NAV_POINTS = 750

# Debt (cash-equivalent) funds are judged on 1Y return consistency and cost, not
# on 3Y risk-adjusted ratios, so a shorter history is acceptable. ~250 trading
# days is about one year, enough to compute the 1Y window. Newer liquid/money-market
# funds that clear this bar are onboarded and simply carry 1Y metrics only.
MIN_NAV_POINTS_DEBT = 250


def min_nav_points_for(fairfund_category):
    """Minimum NAV history a fund needs to enter the universe. Debt cash-equivalents
    qualify on ~1Y of history; equity funds require ~3Y."""
    return MIN_NAV_POINTS_DEBT if uses_reduced_surface(fairfund_category) else MIN_NAV_POINTS

# Groww API settings
GROWW_SEARCH_URL = "https://groww.in/v1/api/search/v3/query/global/st_query?query="
GROWW_SCHEME_URL = "https://groww.in/v1/api/data/mf/web/v2/scheme/search/"
GROWW_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept": "application/json",
}

# AMFI API
AMFI_NAV_ALL_URL = "https://portal.amfiindia.com/spages/NAVAll.txt"
MFAPI_BASE_URL = "https://api.mfapi.in/mf/"

# A fund is treated as genuinely closed only if its code is absent from the RAW
# AMFI NAVAll universe (all plans, not just Direct-Growth) OR its latest NAV is
# older than this many days. Absence from the filtered Direct-Growth set alone is
# NOT a closure signal (parsing/name mismatches would otherwise flag live funds).
STALE_NAV_DAYS = 60

# Daily NAV staleness ledger: a fund is recorded once its code has been missing
# from AMFI (or AMFI has not repriced it) for more than this many consecutive
# calendar days, which filters out normal weekend/holiday gaps.
DAILY_STALE_GAP_DAYS = 7


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
