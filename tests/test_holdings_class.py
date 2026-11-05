"""Fund-of-funds books must not be published as stock-level holdings.

Groww lists an overseas feeder's single underlying fund as "Foreign Mutual Funds",
which the old per-script instrument sets did not know, so 38 such funds were stored
as stock_level and their underlying fund showed up as if it were a stock. Guards the
shared rule in scripts/holdings_class.py and checks the live data. No network.
"""
from pathlib import Path
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import holdings_class as H  # noqa: E402


def h(name, pct, instrument):
    return {"name": name, "pct": pct, "instrument": instrument}


class FundOfFundsRuleTests(unittest.TestCase):
    def test_single_foreign_feeder_is_feeder_unresolved(self):
        holds = [h("Franklin US Opportunities Fund", 97.8, "Foreign Mutual Funds"),
                 h("TREPS", 2.4, "Reverse Repo"), h("Net Payables", -0.2, "Cash")]
        self.assertEqual(H.fund_of_funds_coverage(holds), "feeder_unresolved")
        self.assertEqual(H.underlying_name(holds), "Franklin US Opportunities Fund")

    def test_domestic_feeder_is_feeder_unresolved(self):
        holds = [h("Nippon India ETF Gold BeES", 99.1, "Mutual Fund"), h("TREPS", 0.9, "Reverse Repo")]
        self.assertEqual(H.fund_of_funds_coverage(holds), "feeder_unresolved")

    def test_spread_of_underlying_funds_is_fof_level(self):
        holds = [h("Fund A", 30.0, "Foreign Mutual Funds"), h("Fund B", 28.0, "Mutual Funds"),
                 h("Fund C", 25.0, "ETF"), h("TREPS", 17.0, "Reverse Repo")]
        self.assertEqual(H.fund_of_funds_coverage(holds), "fof_level")

    def test_equity_fund_with_small_fund_line_stays_stock_level(self):
        holds = [h("HDFC Bank Ltd", 9.5, "Equity"), h("Infosys Ltd", 7.0, "Equity"),
                 h("Liquid Fund Units", 4.0, "Mutual Fund")] + [h(f"Stock {i}", 5.0, "Equity") for i in range(15)]
        self.assertIsNone(H.fund_of_funds_coverage(holds))

    def test_feeder_with_large_direct_equity_is_not_fof(self):
        holds = [h("Global Fund", 80.0, "Foreign Mutual Funds"), h("Apple Inc", 20.0, "Foreign - Equity")]
        self.assertIsNone(H.fund_of_funds_coverage(holds))

    def test_empty_book(self):
        self.assertIsNone(H.fund_of_funds_coverage([]))
        self.assertIsNone(H.underlying_name([]))

    def test_instrument_match_ignores_case_and_spaces(self):
        holds = [h("X", 95.0, "  FOREIGN MUTUAL FUNDS "), h("Cash", 5.0, "Cash")]
        self.assertEqual(H.fund_of_funds_coverage(holds), "feeder_unresolved")


class FetchHoldingsTests(unittest.TestCase):
    def test_a_spread_of_underlying_funds_is_published_as_fof_level(self):
        import fetch_holdings as F
        saved = (F.resolve_slug, F.fetch_scheme, F.norm_holdings)
        try:
            F.resolve_slug = lambda code, name: "example-fof"
            F.fetch_scheme = lambda slug: {"scheme_name": "Example Global FoF", "scheme_code": 1, "holdings": []}
            F.norm_holdings = lambda raw: [h("Fund A", 45.0, "Mutual Funds"), h("Fund B", 45.0, "Mutual Funds"),
                                           h("TREPS", 10.0, "Reverse Repo")]
            rec = F.process_fund(1, "Example Global FoF")[1]
        finally:
            F.resolve_slug, F.fetch_scheme, F.norm_holdings = saved
        self.assertEqual(rec["coverage"], "fof_level")
        self.assertEqual(rec["underlying"], "Fund A")


class LiveDataTests(unittest.TestCase):
    def test_no_stock_level_fund_is_mostly_fund_units(self):
        bad = []
        for p in sorted((ROOT / "public" / "fund-data").glob("*.json")):
            d = json.loads(p.read_text(encoding="utf-8"))
            if (d.get("holdingsMeta") or {}).get("coverage") != "stock_level":
                continue
            holds = d.get("holdings") or []
            if H.fund_of_funds_coverage(holds):
                bad.append(p.stem)
        self.assertEqual(bad, [], "stock_level funds whose book is units of other funds")


if __name__ == "__main__":
    unittest.main()
