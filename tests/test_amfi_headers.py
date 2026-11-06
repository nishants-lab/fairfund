"""AMFI NAVAll.txt section headers: an AMC whose name starts with a digit ("360 ONE
Mutual Fund") must still start a new fund-house section. Before 2026-11-06 the parsers
skipped such headers, so 360 ONE schemes took the previous section's fund house
(Zerodha, WhiteOak Capital, UTI)."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
import build_matcher_universe as BMU  # noqa: E402
import discover_new_funds as DNF  # noqa: E402

RAW = """Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Index Funds - Equity Funds)

Zerodha CASE Mutual Fund

153906;INF0R8F01091;-;Zerodha Nifty 50 Index Fund;Direct Plan;Growth;12.1;05-Nov-2026

360 ONE Mutual Fund

151165;INF579M01AN2;-;360 ONE ELSS Tax Saver Nifty 50 Index Fund;Direct Plan;GROWTH Option;13.9558;05-Nov-2026

Open Ended Schemes(Equity Scheme - Focused Fund)

360 ONE Mutual Fund

131580;INF579M01878;-;360 ONE Focused Fund - Direct Plan - Growth;Direct Plan;Growth;50.1;05-Nov-2026
"""


class AmfiHeaderTests(unittest.TestCase):
    def test_matcher_universe_reads_digit_led_fund_house(self):
        amc = {r["code"]: r["amc"] for r in BMU.parse_universe(RAW)}
        self.assertEqual(amc[153906], "Zerodha CASE Mutual Fund")
        self.assertEqual(amc[151165], "360 ONE Mutual Fund")
        self.assertEqual(amc[131580], "360 ONE Mutual Fund")

    def test_discovery_reads_digit_led_fund_house(self):
        schemes = DNF.parse_amfi_universe(RAW)
        got = {int(k): v["amc"] for k, v in schemes.items()}
        self.assertEqual(got.get(151165), "360 ONE Mutual Fund")
        self.assertEqual(got.get(153906), "Zerodha CASE Mutual Fund")


if __name__ == "__main__":
    unittest.main()
