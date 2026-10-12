"""Smart-move scoring must judge share trades only.

Equity funds hold certificates of deposit and commercial paper for cash. Their
names ("HDFC BANK LIMITED CD 10SEP26") fuzzy-match the issuer's share ticker,
so a CD roll was scored as a stock trade: Parag Parikh Flexi Cap's verdict
rested on 8 such rows and 2 real trades. No network: prices are supplied.
"""
from pathlib import Path
import importlib.util
import unittest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("build_stock_moves", ROOT / "scripts" / "build_stock_moves.py")
M = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(M)


def h(name, instrument="Equity", pct=1.0):
    return {"key": name.lower(), "name": name, "pct": pct, "instrument": instrument}


PRICES = {  # monthly closes; every ticker rose after September
    t: {"prices": {"2026-08": 100.0, "2026-09": 100.0, "2026-10": 110.0}}
    for t in ("HDFCBANK", "KOTAKBANK", "IOC", "INFY", "TCS", "ITC", "LT")
}


class ClassifierTests(unittest.TestCase):
    def test_instrument_type_decides_when_present(self):
        self.assertTrue(M.is_equity_holding(h("HDFC Bank Ltd")))
        self.assertTrue(M.is_equity_holding(h("Alphabet Inc Forgn. Eq (GOOGL)", "Foreign - Equity")))
        self.assertTrue(M.is_equity_holding(h("Unilever PLC - ADR", "ADS/ADR")))
        for inst in ("Certificate of Deposit", "Commercial Paper", "T-Bills", "GOI Securities",
                     "Debenture", "Bonds", "REITs", "Mutual Fund", "Preference Shares", "Margin Money"):
            self.assertFalse(M.is_equity_holding(h("Anything", inst)), inst)

    def test_name_fallback_without_instrument_type(self):
        def bare(name):
            return {"key": name.lower(), "name": name}
        for name in ("HDFC BANK LIMITED CD 10SEP26", "Indian Oil Corporation Limited (08/12/2026) **",
                     "POWER FINANCE CORPORATION LIMITED 91D CP 18NOV26", "Reserve Bank of India T-Bill",
                     "360 ONE PRIME LIMITED 8.95 NCD 04JU27", "Net Current Assets"):
            self.assertFalse(M.is_equity_holding(bare(name)), name)
        for name in ("HDFC Bank Ltd", "Steel Strips Wheels Ltd", "HEXAWARE TECHNOLOGIES LIMITED EQ NEW FV RS.2/-",
                     "Cdsl Ltd", "Coforge Ltd"):
            self.assertTrue(M.is_equity_holding(bare(name)), name)


class ScoringTests(unittest.TestCase):
    TICKERS = {"hdfc bank limited cd 10sep26": "HDFCBANK", "kotak mahindra bank limited cd 24sep26": "KOTAKBANK",
               "indian oil corporation limited (08/12/2026) **": "IOC", "infosys ltd": "INFY",
               "tata consultancy services ltd": "TCS", "itc ltd": "ITC", "larsen & toubro ltd": "LT"}

    def test_debt_rows_are_not_scored(self):
        before = {"holdings": [h("Infosys Ltd"), h("ITC Ltd"),
                               h("HDFC BANK LIMITED CD 10SEP26", "Certificate of Deposit")]}
        after = {"holdings": [h("Infosys Ltd"), h("Tata Consultancy Services Ltd"), h("Larsen & Toubro Ltd"),
                              h("KOTAK MAHINDRA BANK LIMITED CD 24SEP26", "Certificate of Deposit"),
                              h("Indian Oil Corporation Limited (08/12/2026) **", "Commercial Paper")]}
        r = M.compute_fund_moves("1", {"2026-08-31": before, "2026-09-30": after}, self.TICKERS, PRICES)
        self.assertEqual([x["name"] for x in r["added"]], ["Tata Consultancy Services Ltd", "Larsen & Toubro Ltd"])
        self.assertEqual([x["name"] for x in r["exited"]], ["ITC Ltd"])
        self.assertEqual(r["smartBasis"], 3)  # the 3 CD/CP rows would have made it 6
        self.assertEqual(r["smartScore"], 67)  # 2 adds rose (good), 1 exit rose (bad)

    def test_only_debt_rolled_gives_empty_result_not_stale(self):
        before = {"holdings": [h("Infosys Ltd"), h("HDFC BANK LIMITED CD 10SEP26", "Certificate of Deposit")]}
        after = {"holdings": [h("Infosys Ltd"), h("KOTAK MAHINDRA BANK LIMITED CD 24SEP26", "Certificate of Deposit")]}
        r = M.compute_fund_moves("1", {"2026-08-31": before, "2026-09-30": after}, self.TICKERS, PRICES)
        self.assertIsNotNone(r)  # replaces any earlier card in the detail file
        self.assertEqual((r["added"], r["exited"], r["smartScore"]), ([], [], None))
        self.assertEqual(r["verdict"], "Insufficient price data")


if __name__ == "__main__":
    unittest.main()
