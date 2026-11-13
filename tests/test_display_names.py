"""Display names: capitals and stray dashes from AMFI are tidied, abbreviations kept."""
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from config import tidy_display_name  # noqa: E402
import discover_new_funds as D  # noqa: E402
import tidy_fund_names as T  # noqa: E402


class TidyDisplayName(unittest.TestCase):
    def test_capitalised_names_become_title_case(self):
        cases = {
            "BANDHAN MID CAP FUND": "Bandhan Mid Cap Fund",
            "BARODA BNP PARIBAS Focused Fund": "Baroda BNP Paribas Focused Fund",
            "TRUSTMF Flexi Cap Fund": "TrustMF Flexi Cap Fund",
            "BANK OF INDIA Flexi Cap Fund": "Bank of India Flexi Cap Fund",
            "Bank Of India ELSS Tax Saver": "Bank of India ELSS Tax Saver",
            "THE WEALTH COMPANY ETHICAL FUND": "The Wealth Company Ethical Fund",
            "ANGEL ONE NIFTY TOTAL MARKET MOMENTUM QUALITY 50 INDEX FUND":
                "Angel One Nifty Total Market Momentum Quality 50 Index Fund",
            "HDFC NIFTY100 Low Volatility 30 Index Fund": "HDFC Nifty100 Low Volatility 30 Index Fund",
            "TRUSTMF LARGE & MIDCAP FUND": "TrustMF Large & Midcap Fund",
        }
        for raw, want in cases.items():
            self.assertEqual(tidy_display_name(raw), want, raw)

    def test_abbreviations_and_mixed_case_are_left_alone(self):
        for name in ("ICICI Prudential NASDAQ 100 Index Fund", "SBI ELSS Tax Saver Fund", "360 ONE ELSS Tax Saver Nifty 50 Index Fund",
                     "HDFC BSE REITS and Commercial Real Estate Index Fund", "ASK Liquid Fund", "quant ELSS Tax Saver Fund",
                     "Invesco India - Invesco EQQQ Nasdaq-100 ETF Fund of Fund", "UTI - MNC Fund", "LIC MF ELSS Tax Saver",
                     "Edelweiss MSCI India Domestic & World Healthcare 45 Index Fund", "WhiteOak Capital ELSS Tax Saver Fund"):
            self.assertEqual(tidy_display_name(name), name)

    def test_stray_dash_and_double_spaces_go(self):
        self.assertEqual(tidy_display_name("ICICI Prudential Liquid Fund -"), "ICICI Prudential Liquid Fund")
        self.assertEqual(tidy_display_name("Bandhan Money  Market Fund"), "Bandhan Money Market Fund")
        self.assertEqual(tidy_display_name("Nippon India Index Fund - Nifty 50"), "Nippon India Index Fund - Nifty 50")

    def test_idempotent(self):
        for raw in ("BANDHAN MID CAP FUND", "ICICI Prudential Liquid Fund -", "BANK OF INDIA VALUE FUND"):
            once = tidy_display_name(raw)
            self.assertEqual(tidy_display_name(once), once)

    def test_new_funds_and_renames_are_tidied_where_they_enter(self):
        self.assertEqual(D._clean_scheme_name("BANDHAN MID CAP FUND - Direct Plan - Growth"), "Bandhan Mid Cap Fund")
        self.assertEqual(D._clean_scheme_name("ICICI Prudential Liquid Fund - - Direct Plan - Growth"), "ICICI Prudential Liquid Fund")

    def test_tidy_script_reports_each_change(self):
        funds = [{"code": 1, "name": "TRUSTMF Liquid Fund"}, {"code": 2, "name": "SBI Liquid Fund"}]
        self.assertEqual(T.tidy(funds), [(1, "TRUSTMF Liquid Fund", "TrustMF Liquid Fund")])
        self.assertEqual(funds[0]["name"], "TrustMF Liquid Fund")


class LiveNames(unittest.TestCase):
    def test_every_listed_fund_and_nfo_name_is_tidy(self):
        for path, key in (("src/data/funds.json", "funds"), ("src/data/nfo.json", "nfos")):
            with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
                rows = json.load(fh)[key]
            untidy = [(r["code"], r["name"]) for r in rows if tidy_display_name(r["name"]) != r["name"]]
            self.assertEqual(untidy, [], f"{path}: run scripts/tidy_fund_names.py")


if __name__ == "__main__":
    unittest.main()
