"""Shared rule for telling a fund-of-funds book from a stock-level portfolio.

capture_holdings_snapshot.py, fetch_holdings.py and onboard_new_funds.py each
classified holdings with their own copy of the instrument sets, and none of them
knew Groww's "Foreign Mutual Funds" instrument. Overseas feeder funds (a single
line into a Luxembourg or US fund) were therefore stored as stock_level.
"""

FEEDER_INSTR = {"mutual fund", "mutual funds", "foreign mf", "foreign mutual fund",
                "foreign mutual funds", "fund", "exchange traded fund", "etf"}
EQUITY_INSTR = {"equity", "forgn. eq", "foreign equity", "foreign - equity",
                "equity shares", "fgn equity"}

# A book is a fund of funds when units of other funds make up at least this
# share of it and direct equity is small.
FOF_MIN_PCT = 80.0
FOF_MAX_EQUITY_PCT = 20.0


def _inst(h):
    return (h.get("instrument") or "").strip().lower()


def fund_of_funds_coverage(holds):
    """'feeder_unresolved' for one dominant underlying fund, 'fof_level' for a
    spread of underlying funds, None when the book is not a fund of funds."""
    if not holds:
        return None
    feeders = [h for h in holds if _inst(h) in FEEDER_INSTR]
    fund_pct = sum(h["pct"] for h in feeders)
    eq_pct = sum(h["pct"] for h in holds if _inst(h) in EQUITY_INSTR)
    if fund_pct < FOF_MIN_PCT or eq_pct >= FOF_MAX_EQUITY_PCT:
        return None
    top = max(feeders, key=lambda h: h["pct"])
    return "feeder_unresolved" if top["pct"] >= FOF_MIN_PCT else "fof_level"


def underlying_name(holds):
    """Name of the largest underlying fund, for the 'invests through' note."""
    feeders = [h for h in holds or [] if _inst(h) in FEEDER_INSTR]
    return max(feeders, key=lambda h: h["pct"])["name"] if feeders else None
