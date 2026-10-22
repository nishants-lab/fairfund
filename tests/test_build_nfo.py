"""New fund offers list (scripts/build_nfo.py). Offline: AMFI and Groww are fakes.

Pins:
  * scope is the site's own: open-ended, Direct Growth, a FairFund category,
    not excluded by name; window is 45 days back and 60 ahead;
  * status claims only what AMFI shows: "trading" needs a NAV in NAVAll,
    "closed" needs a closing date that has passed, otherwise "offer"/"upcoming";
  * Groww details are used only from the page whose scheme_code is the NFO's;
  * an unreachable or thin AMFI response never replaces the previous file.
"""
from datetime import date
from pathlib import Path
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "scripts"), str(ROOT / "pipeline")]
spec = importlib.util.spec_from_file_location("build_nfo", ROOT / "scripts" / "build_nfo.py")
N = importlib.util.module_from_spec(spec)
spec.loader.exec_module(N)

TODAY = date(2026, 10, 22)
HDR = ["AMC", "Code", "Scheme Name", "Scheme Type", "Scheme Category", "Scheme NAV Name", "Min", "Launch", "Closure", "ISIN"]


def row(code, name, cat="Equity Schemes - Small Cap Fund", launch="16-Oct-2026", close="", plan="Direct Growth",
        stype="Open Ended", amc="Carnelian Asset Management Company Limited", minimum="1000"):
    return [amc, str(code), name, stype, cat, f"{name} - {plan}", minimum, launch, close, "INF000000000"]


class Select(unittest.TestCase):
    def test_scope_matches_the_site(self):
        rows = [
            row(1, "Carnelian Small Cap Fund"),
            row(2, "Carnelian Small Cap Fund", plan="Regular Growth"),
            row(3, "Carnelian Small Cap Fund", plan="Direct IDCW"),
            row(4, "Some FMP Series 9", cat="Income/Debt Oriented Schemes - Fixed Term Plan", stype="Close Ended"),
            row(5, "Some Balanced Advantage Fund", cat="Hybrid Schemes - Balanced Advantage Fund/ Dynamic Asset Allocation"),
            row(6, "quant Nifty 50 Index Fund", cat="Index Funds - Equity Funds", launch="12-Oct-2026"),
            row(7, "Old Small Cap Fund", launch="01-Jan-2026"),
            row(8, "Far Future Small Cap Fund", launch="31-Dec-2026"),
        ]
        got = N.select_nfos(rows, TODAY)
        self.assertEqual(sorted(got), ["1", "6"])
        self.assertEqual(got["1"]["category"], "Small Cap")
        self.assertEqual(got["1"]["amc"], "Carnelian")
        self.assertEqual(got["1"]["minAmount"], 1000.0)
        self.assertTrue(got["6"]["category"].startswith("Index"))

    def test_closing_date_only_when_after_launch(self):
        got = N.select_nfos([row(1, "A Small Cap Fund", launch="12-Oct-2026", close="12-Oct-2026"),
                             row(2, "B Small Cap Fund", launch="12-Oct-2026", close="26-Oct-2026"),
                             row(3, "C Small Cap Fund", launch="12-Oct-2026", close="not a date")], TODAY)
        self.assertIsNone(got["1"]["closeDate"])
        self.assertEqual(got["2"]["closeDate"], "2026-10-26")
        self.assertIsNone(got["3"]["closeDate"])


class Status(unittest.TestCase):
    def rec(self, launch, close=None):
        return {"launchDate": launch, "closeDate": close}

    def test_states(self):
        self.assertEqual(N.status_for(self.rec("2026-10-26"), None, TODAY), "upcoming")
        self.assertEqual(N.status_for(self.rec("2026-10-12"), None, TODAY), "offer")
        self.assertEqual(N.status_for(self.rec("2026-09-30"), None, TODAY), "offer")  # no closing date: not "closed"
        self.assertEqual(N.status_for(self.rec("2026-10-01", "2026-10-15"), None, TODAY), "closed")
        self.assertEqual(N.status_for(self.rec("2026-10-12", "2026-10-26"), None, TODAY), "offer")
        self.assertEqual(N.status_for(self.rec("2026-09-28"), ("2026-10-21", 9.92), TODAY), "trading")


class Details(unittest.TestCase):
    def payload(self, code):
        return {"scheme_code": str(code), "benchmark_name": "NIFTY 50 Total Return Index", "fund_manager": "A Manager",
                "exit_load": "Nil", "min_sip_investment": 500.0, "lock_in": {"years": None}}

    def test_only_the_page_with_the_nfo_code(self):
        hits = [{"search_id": "other-fund", "scheme_code": "999"}, {"search_id": "quant-nifty-50", "scheme_code": "154814"}]
        seen = []
        def verify(code, slug):
            seen.append(slug)
            return {"status": "ok", "slug": slug, "payload": self.payload(code)}
        d = N.groww_details(154814, "quant Nifty 50 Index Fund", verify=verify, search=lambda q: hits)
        self.assertEqual(seen, ["quant-nifty-50"])
        self.assertEqual(d["benchmark"], "NIFTY 50 Total Return Index")
        self.assertIsNone(d["lockInYears"])

    def test_no_matching_code_or_mismatch_gives_none(self):
        self.assertIsNone(N.groww_details(1, "X", verify=lambda c, s: {}, search=lambda q: [{"search_id": "x", "scheme_code": "2"}]))
        mismatch = lambda c, s: {"status": "identity_mismatch", "slug": s, "payload": None}
        self.assertIsNone(N.groww_details(1, "X", verify=mismatch, search=lambda q: [{"search_id": "x", "scheme_code": "1"}]))
        def boom(q):
            raise OSError("network")
        self.assertIsNone(N.groww_details(1, "X", search=boom))

    def test_details_reused_for_a_week(self):
        rows = [row(154814, "quant Nifty 50 Index Fund", cat="Index Funds - Equity Funds", launch="12-Oct-2026")]
        calls = []
        def det(code, name):
            calls.append(code)
            return {"benchmark": "NIFTY 50 Total Return Index"}
        prev = {"nfos": [{"code": 154814, "details": {"benchmark": "old"}, "detailsAsOf": "2026-10-20"}]}
        out = N.build(rows, {}, prev, TODAY, details_fn=det)
        self.assertEqual(calls, [])
        self.assertEqual(out["nfos"][0]["details"], {"benchmark": "old"})
        prev["nfos"][0]["detailsAsOf"] = "2026-10-10"
        out = N.build(rows, {}, prev, TODAY, details_fn=det)
        self.assertEqual(calls, [154814])
        self.assertEqual(out["nfos"][0]["detailsAsOf"], "2026-10-22")
        # A failed lookup keeps the last good details.
        out = N.build(rows, {}, prev, TODAY, details_fn=lambda c, n: None)
        self.assertEqual(out["nfos"][0]["details"], {"benchmark": "old"})

    def test_build_orders_and_marks_trading(self):
        rows = [row(1, "A Small Cap Fund", launch="12-Oct-2026"), row(2, "B Small Cap Fund", launch="20-Oct-2026"),
                row(3, "C Small Cap Fund", launch="26-Oct-2026"), row(4, "D Small Cap Fund", launch="15-Sep-2026")]
        out = N.build(rows, {"4": ("2026-10-21", 10.2)}, None, TODAY, details_fn=lambda c, n: None)
        self.assertEqual([(n["code"], n["status"]) for n in out["nfos"]], [(2, "offer"), (1, "offer"), (3, "upcoming"), (4, "trading")])
        self.assertEqual(out["nfos"][3]["nav"], {"date": "2026-10-21", "value": 10.2})


class NeverBreaksTheRefresh(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.out = os.path.join(self.tmp, "nfo.json")
        with open(self.out, "w", encoding="utf-8") as fh:
            json.dump({"nfos": [{"code": 1}]}, fh)
        self.addCleanup(shutil.rmtree, self.tmp)

    def saved(self):
        with open(self.out, encoding="utf-8") as fh:
            return json.load(fh)

    def run_main(self, master, navall):
        with mock.patch.object(N, "OUT", self.out), mock.patch.object(N, "http_text", master), \
                mock.patch.dict(sys.modules, {"update_nav_daily": mock.Mock(fetch_amfi=navall)}):
            return N.main()

    def test_unreachable_amfi_keeps_previous_file(self):
        def down(*a, **k):
            raise OSError("AMFI down")
        self.assertEqual(self.run_main(down, lambda: {}), 0)
        self.assertEqual(self.saved(), {"nfos": [{"code": 1}]})

    def test_thin_response_keeps_previous_file(self):
        thin = ",".join(HDR) + "\n" + ",".join(row(1, "A Small Cap Fund"))
        self.assertEqual(self.run_main(lambda *a, **k: thin, lambda: {str(i): ("2026-10-21", 10.0) for i in range(2000)}), 0)
        self.assertEqual(self.saved(), {"nfos": [{"code": 1}]})


if __name__ == "__main__":
    unittest.main()
