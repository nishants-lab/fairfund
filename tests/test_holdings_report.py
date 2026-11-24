"""Holdings report: estimated buying per stock, what is counted, and what is left out.

No network and no repo data: every case is built here. Funds F1-F6 move with the
price, F7 adds stock A and trims B, F8 is an index fund, F9 an arbitrage fund, F10
opens an overseas position. Prices: A rose 10%, B was flat, NAV flat throughout.
"""
from datetime import date
from pathlib import Path
import importlib.util
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load("build_holdings_report")
B = R.bm

SEP, OCT, NOV = "2026-09-30", "2026-10-31", "2026-11-30"
NAV = {"d": [SEP, OCT, NOV], "v": [10.0, 10.0, 10.0]}


def h(key, pct, instrument="Equity", sector="Industrials"):
    return {"key": key, "name": key.upper(), "pct": pct, "instrument": instrument, "sector": sector}


def snap(aum, *rows):
    return {"aum": aum, "holdings": list(rows)}


def fund(code, category="Flexi Cap", amc="A"):
    return {"code": code, "name": f"Fund {code}", "amc": amc, "category": category,
            "categoryDisplay": category}


def fixture(with_november=False):
    funds, hist = [], {}
    for code in range(1, 7):
        funds.append(fund(code))
        hist[str(code)] = {"snapshots": {SEP: snap(1000, h("aaa", 10), h("bbb", 85)),
                                         OCT: snap(1000, h("aaa", 11), h("bbb", 85))}}
    funds.append(fund(7, amc="B"))
    hist["7"] = {"snapshots": {SEP: snap(1000, h("aaa", 10), h("bbb", 85)),
                               OCT: snap(1000, h("aaa", 16.5), h("bbb", 80))}}
    funds.append(fund(8, category="Index Funds", amc="C"))
    hist["8"] = {"snapshots": {SEP: snap(1000, h("aaa", 10), h("bbb", 85)),
                               OCT: snap(1000, h("aaa", 22), h("bbb", 85))}}
    funds.append(fund(9, category="Arbitrage", amc="C"))
    hist["9"] = {"snapshots": {SEP: snap(1000, h("aaa", 50), h("bbb", 45)),
                               OCT: snap(1000, h("aaa", 70), h("bbb", 25))}}
    funds.append(fund(10, amc="B"))
    hist["10"] = {"snapshots": {SEP: snap(1000, h("bbb", 90)),
                                OCT: snap(1000, h("bbb", 85), h("zzz-inc", 5, "Foreign - Equity", "Technology"))}}
    if with_november:
        hist["1"]["snapshots"][NOV] = snap(1000, h("aaa", 11), h("bbb", 85))
    navs = {str(f["code"]): NAV for f in funds}
    return funds, hist, navs


def run(with_november=False):
    funds, hist, navs = fixture(with_november)
    return R.build(funds, hist, navs, B._load_stock_filter(), {}, None, date(2026, 11, 24))


class EstimateTests(unittest.TestCase):
    def setUp(self):
        self.r = run()
        self.m = self.r["months"]["2026-10"]
        self.s = self.m["stocks"]

    def test_holding_that_only_moved_with_its_price_is_no_buying(self):
        # F1-F6 hold A at 10% -> 11% while A rose 10%: no shares bought.
        self.assertEqual(self.s["aaa"]["buyers"][0][0], "8")
        self.assertNotIn("1", [c for c, _ in self.s["aaa"]["buyers"]])

    def test_rupees_count_index_funds_and_active_funds_separately(self):
        a = self.s["aaa"]
        self.assertAlmostEqual(a["net"], 165.0)    # F7 +55, F8 +110
        self.assertAlmostEqual(a["active"], 55.0)
        self.assertAlmostEqual(a["index"], 110.0)

    def test_arbitrage_funds_are_left_out(self):
        self.assertNotIn("9", self.r["funds"])
        self.assertEqual(self.m["totals"]["funds"], 9)

    def test_only_active_funds_count_as_adding_or_cutting(self):
        a, b = self.s["aaa"], self.s["bbb"]
        self.assertEqual((a["added"], a["cut"]), (1, 0))   # F7; F8 is an index fund
        self.assertEqual((b["added"], b["cut"]), (0, 2))   # F7 and F10

    def test_overseas_stocks_are_listed_apart(self):
        self.assertTrue(self.s["zzz-inc"]["overseas"])
        self.assertEqual(self.m["lists"]["overseasBuys"], ["zzz-inc"])
        self.assertNotIn("zzz-inc", self.m["lists"]["buys"])
        self.assertEqual(self.s["zzz-inc"]["new"], 1)

    def test_totals_add_up(self):
        t = self.m["totals"]
        self.assertAlmostEqual(t["net"], 115.0)        # A +165, B -100, overseas +50
        self.assertAlmostEqual(t["inflow"], 0.0)       # fund sizes and NAV unchanged
        self.assertAlmostEqual(t["cashUsed"], 125.0)   # F1-F6 10 each, F7 15, F8 50
        self.assertEqual(t["houses"], 3)
        self.assertAlmostEqual(t["overseasNet"], 50.0)

    def test_percent_added_needs_a_real_starting_holding(self):
        self.assertAlmostEqual(self.s["aaa"]["addedPct"], 18.75, delta=0.06)   # 165 of 880 held
        self.assertNotIn("addedPct", self.s["zzz-inc"])

    def test_rankings(self):
        L = self.m["lists"]
        self.assertEqual(L["buys"], ["aaa"])
        self.assertEqual(L["sells"], ["bbb"])
        self.assertEqual(L["widest"][0], "aaa")
        self.assertEqual(L["widestCut"][0], "bbb")

    def test_category_and_fund_house_views(self):
        cats = {c["name"]: c for c in self.m["categories"]}
        self.assertAlmostEqual(cats["Index Funds"]["net"], 110.0)
        self.assertEqual(cats["Flexi Cap"]["funds"], 8)
        houses = {g["name"]: g for g in self.m["houses"]}
        self.assertAlmostEqual(houses["B"]["net"], 5.0)    # F7 +5, F10 0


class MonthTests(unittest.TestCase):
    def test_complete_month_leads(self):
        r = run()
        self.assertEqual(r["lead"], "2026-10")
        self.assertTrue(r["months"]["2026-10"]["coverage"]["complete"])
        self.assertEqual([t["month"] for t in r["trend"]], ["2026-10"])

    def test_partly_disclosed_month_is_kept_but_does_not_lead(self):
        r = run(with_november=True)
        self.assertEqual(r["lead"], "2026-10")
        nov = r["months"]["2026-11"]["coverage"]
        self.assertFalse(nov["complete"])
        self.assertEqual((nov["funds"], nov["of"]), (1, 10))
        self.assertFalse(r["trend"][-1]["complete"])


class SummaryTests(unittest.TestCase):
    def test_summary_leads_with_the_complete_month(self):
        s = R.summary(run(with_november=True))
        self.assertEqual(s["lead"], "2026-10")
        self.assertEqual([b["key"] for b in s["buys"]], ["aaa"])
        self.assertEqual([b["key"] for b in s["sells"]], ["bbb"])
        self.assertAlmostEqual(s["totals"]["net"], 115.0)
        self.assertEqual([t[0] for t in s["trend"]], ["2026-10", "2026-11"])

    def test_no_data_gives_no_lead(self):
        self.assertEqual(R.summary({"lead": None, "months": {}, "trend": []}), {"lead": None})


class NamingTests(unittest.TestCase):
    def test_slug_matches_research_pages(self):
        self.assertEqual(R.stock_slug("NetFlix Inc. (USA) Forgn. Eq (NFLX)"), "netflix-inc-usa-forgn-eq-nflx")
        self.assertEqual(R.stock_slug("hdfc-bank-ltd"), "hdfc-bank-ltd")

    def test_telecom_operators_get_their_own_sector(self):
        self.assertEqual(R.sector_of("bharti-airtel-ltd", "Technology"), "Telecom")
        self.assertEqual(R.sector_of("infosys-ltd", "Technology"), "Technology")
        self.assertEqual(R.sector_of("x", ""), "Other")


if __name__ == "__main__":
    unittest.main()
