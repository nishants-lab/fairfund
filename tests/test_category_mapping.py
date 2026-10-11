"""map_amfi_category places funds in the right FairFund category.

Guards two discovery bugs: "Large & Mid Cap Fund" being caught by its
substring "Mid Cap Fund", and every index fund falling into "Index-Other"
regardless of the index it tracks. Uses real AMFI category strings; no network.
"""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(ROOT / "scripts"))
import config as C  # noqa: E402

M = C.map_amfi_category
INDEX = "Index Funds - Equity Funds"
INDEX_OLD = "Other Scheme - Index Funds"


class DirectMappingTests(unittest.TestCase):
    def test_every_key_maps_to_its_own_value(self):
        # A key must never be shadowed by a shorter key it contains. This
        # catches any future overlapping key, not only Mid Cap.
        for key, value in C.AMFI_TO_FAIRFUND_CATEGORY.items():
            with self.subTest(key=key):
                self.assertEqual(M(key), value)

    def test_large_and_mid_cap_is_not_mid_cap(self):
        for cat in ("Equity Scheme - Large & Mid Cap Fund",
                    "Equity Schemes - Large & Mid Cap Fund"):
            with self.subTest(cat=cat):
                self.assertEqual(M(cat), "Large & Mid Cap")

    def test_single_cap_categories_unchanged(self):
        self.assertEqual(M("Equity Schemes - Mid Cap Fund"), "Mid Cap")
        self.assertEqual(M("Equity Schemes - Large Cap Fund"), "Large Cap")
        self.assertEqual(M("Equity Schemes - Small Cap Fund"), "Small Cap")


class DiscoveredFundsOctober2026(unittest.TestCase):
    CASES = [
        ("Equity Schemes - Large & Mid Cap Fund", "TRUSTMF LARGE & MIDCAP FUND", "Large & Mid Cap"),
        ("Equity Scheme - Large & Mid Cap Fund", "Abakkus Large & Mid Cap Fund", "Large & Mid Cap"),
        ("Equity Schemes - Mid Cap Fund", "The Wealth Company Mid Cap Fund", "Mid Cap"),
        ("Equity Schemes - Flexi Cap Fund", "AlphaGrep Flexi Cap Fund", "Flexi Cap"),
        ("Equity Schemes - Value Fund", "NJ Value Fund", "Value/Contra"),
        ("Equity Schemes - Thematic Fund", "NJ Momentum Fund", "Sectoral/Thematic"),
        ("Equity Schemes - Thematic Fund", "Baroda BNP Paribas Services Fund", "Sectoral/Thematic"),
        ("Hybrid Schemes - Arbitrage Fund", "Zerodha Arbitrage Fund", "Arbitrage"),
        (INDEX, "Axis Nifty50 Equal Weight Index Fund", "Index Funds"),
    ]

    def test_each_fund(self):
        for cat, name, expected in self.CASES:
            with self.subTest(name=name):
                self.assertEqual(M(cat, name), expected)


class IndexBucketTests(unittest.TestCase):
    def test_broad_large_cap_goes_to_index_funds(self):
        for name in ("Axis Nifty 50 Index Fund", "UTI Nifty50 Equal Weight Index Fund",
                     "HDFC NIFTY 100 Index Fund", "Kotak Nifty 100 Equal Weight Index Fund",
                     "SBI BSE Sensex Index Fund", "Groww Nifty 50 Index Fund"):
            for cat in (INDEX, INDEX_OLD):
                with self.subTest(name=name, cat=cat):
                    self.assertEqual(M(cat, name), "Index Funds")

    def test_wider_narrower_or_factor_index_stays_other(self):
        for name in ("Motilal Oswal Nifty 500 Index Fund", "DSP Nifty500 Index Fund",
                     "Kotak Nifty Next 50 Index Fund", "DSP Nifty Top 10 Equal Weight Index Fund",
                     "Axis Nifty500 Quality 50 Index Fund", "UTI Nifty50 Value 20 Index Fund",
                     "ICICI Nifty100 Low Volatility 30 Index Fund", "UTI Nifty500 Shariah Index Fund"):
            with self.subTest(name=name):
                self.assertEqual(M(INDEX, name), "Index-Other")

    def test_elss_index_fund_joins_elss_whatever_the_index(self):
        for name in ("360 ONE ELSS Tax Saver Nifty 50 Index Fund",
                     "Navi ELSS Tax Saver Nifty 50 Index Fund",
                     "Zerodha ELSS Tax Saver Nifty LargeMidcap 250 Index Fund"):
            with self.subTest(name=name):
                self.assertEqual(M(INDEX, name), "ELSS")


class CompatibilityTests(unittest.TestCase):
    def test_one_argument_callers_keep_previous_index_behaviour(self):
        # refresh.py --add-fund and smoke.py call without a name.
        self.assertEqual(M(INDEX), "Index-Other")
        self.assertEqual(M("Large Cap Fund"), "Large Cap")

    def test_out_of_scope_and_empty(self):
        self.assertIsNone(M("Debt Scheme - Gilt Fund"))
        self.assertIsNone(M(""))
        self.assertIsNone(M(None))


if __name__ == "__main__":
    unittest.main()
