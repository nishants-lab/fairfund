"""Debt index funds must never sit in FairFund's equity universe.

CRISIL-IBX AAA target-maturity index funds carry no "bond"/"debt" word and
arrive under AMFI's mixed "Index Funds" bucket, so they slipped past the name
filter and were ranked against equity sectoral index funds. Guards the filter
and the prune step that removes any fund the filter rejects. No network.
"""
from pathlib import Path
import json
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(ROOT / "scripts"))
import config as C  # noqa: E402
import prune_pending as P  # noqa: E402

DEBT_INDEX_NAMES = [
    # The six that were live, as stored in funds.json
    "Aditya Birla Sun Life Crisil-IBX AAA NBFC-HFC Index-Sep 2026 Fund",
    "Edelweiss CRISIL IBX AAA Financial Services - Jan 2028 Index Fund",
    "Nippon India CRISIL - IBX AAA Financial Services - Dec 2026 Index Fund",
    "Aditya Birla Sun Life Crisil-IBX AAA Financial Services Index-Sep 2027 Fund",
    "Kotak CRISIL-IBX AAA Financial Services Index-Sep 2027 Fund",
    "Nippon India CRISIL - IBX AAA Financial Services - Jan 2028 Index Fund",
]

EQUITY_NAMES = [
    "Kotak Nifty Bank Index Fund",
    "Groww Nifty PSU Bank Index Fund",
    "SBI BSE PSU BANK INDEX FUND",
    "Kotak BSE PSU Index Fund",
    "ICICI Prudential Nifty Financial Services Index Fund",
    "Axis Nifty50 Equal Weight Index Fund",
    "Zerodha ELSS Tax Saver Nifty LargeMidcap 250 Index Fund",
    "Parag Parikh Flexi Cap Fund",
    "HDFC Banking and Financial Services Fund",
    "quant PSU Fund",
]


class ExclusionRuleTests(unittest.TestCase):
    def test_crisil_ibx_debt_index_funds_are_excluded(self):
        for name in DEBT_INDEX_NAMES:
            self.assertTrue(C.is_excluded_by_name(name), name)

    def test_equity_index_and_sector_funds_are_kept(self):
        for name in EQUITY_NAMES:
            self.assertFalse(C.is_excluded_by_name(name), name)

    def test_rule_matches_whole_words_only(self):
        # "aaa" or "ibx" inside a longer word must not exclude a fund.
        self.assertFalse(C.is_excluded_by_name("Kaaashi Ibxen Growth Fund"))

    def test_live_universe_holds_no_excluded_fund(self):
        funds = json.loads((ROOT / "src" / "data" / "funds.json").read_text(encoding="utf-8"))["funds"]
        bad = [f["code"] for f in funds
               if C.is_excluded_by_name(f.get("name")) or C.is_excluded_by_name(f.get("fullName"))]
        self.assertEqual(bad, [])


def _fund(code, name, category, ret):
    m = {"cagr": ret, "alpha": 0.0, "volatility": 10.0, "sharpe": 1.0, "maxDrawdown": -10.0}
    return {"code": code, "name": name, "fullName": name + " - Direct Plan - Growth",
            "category": category, "categoryDisplay": category, "categorySize": 0,
            "metrics": {"1Y": dict(m)}}


class PruneStepTests(unittest.TestCase):
    """Run prune_pending.main() against a throwaway copy of the repo layout."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for d in ("src/data", "public/fund-data", "public/nav", "public/holdings-history"):
            (self.tmp / d).mkdir(parents=True)
        self.saved = {k: getattr(P, k) for k in ("FUNDS_JSON", "FUND_DATA_DIR", "NAV_DIR", "HIST_DIR", "FUND_ANALYTICS")}
        P.FUNDS_JSON = str(self.tmp / "src/data/funds.json")
        P.FUND_DATA_DIR = str(self.tmp / "public/fund-data")
        P.NAV_DIR = str(self.tmp / "public/nav")
        P.HIST_DIR = str(self.tmp / "public/holdings-history")
        P.FUND_ANALYTICS = str(self.tmp / "src/data/fund_analytics.json")

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(P, k, v)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_prune_removes_debt_index_fund_and_its_files(self):
        funds = [
            _fund(1, "Alpha Nifty Bank Index Fund", "Index-Sectoral/Thematic", 12.0),
            _fund(2, "Beta Nifty Financial Services Index Fund", "Index-Sectoral/Thematic", 10.0),
            _fund(3, "Kotak CRISIL-IBX AAA Financial Services Index-Sep 2027 Fund", "Index-Sectoral/Thematic", 7.5),
        ]
        data = {"funds": funds, "categories": {"Index-Sectoral/Thematic": {"fundCount": 3}}}
        (self.tmp / "src/data/funds.json").write_text(json.dumps(data), encoding="utf-8")
        for f in funds:
            detail = {"holdingsMeta": {"coverage": "full"}, "category": f["category"]}
            (self.tmp / f"public/fund-data/{f['code']}.json").write_text(json.dumps(detail), encoding="utf-8")
            (self.tmp / f"public/nav/{f['code']}.json").write_text("{}", encoding="utf-8")
            (self.tmp / f"public/holdings-history/{f['code']}.json").write_text('{"snapshots":{}}', encoding="utf-8")
        (self.tmp / "public/nav/_manifest.json").write_text(json.dumps({"1": 1, "2": 1, "3": 1}), encoding="utf-8")
        (self.tmp / "src/data/fund_analytics.json").write_text(json.dumps({"1": {}, "2": {}, "3": {}}), encoding="utf-8")

        P.main()

        out = json.loads((self.tmp / "src/data/funds.json").read_text(encoding="utf-8"))
        self.assertEqual([f["code"] for f in out["funds"]], [1, 2])
        self.assertEqual(out["totalFunds"], 2)
        self.assertEqual(out["categories"]["Index-Sectoral/Thematic"]["fundCount"], 2)
        self.assertTrue(all(f["categorySize"] == 2 for f in out["funds"]))
        for sub in ("public/fund-data", "public/nav", "public/holdings-history"):
            self.assertFalse((self.tmp / sub / "3.json").exists(), sub)
            self.assertTrue((self.tmp / sub / "1.json").exists(), sub)
        self.assertNotIn("3", json.loads((self.tmp / "public/nav/_manifest.json").read_text(encoding="utf-8")))
        self.assertNotIn("3", json.loads((self.tmp / "src/data/fund_analytics.json").read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
