"""New fund offers list (scripts/build_nfo.py). Offline: AMFI and Groww are fakes.

Pins:
  * scope is the site's own: open-ended, Direct Growth, a FairFund category,
    not excluded by name; window is 45 days back and 60 ahead;
  * status claims only what AMFI shows: "trading" needs a NAV in NAVAll,
    "closed" needs a closing date that has passed, otherwise "offer"/"upcoming";
  * Groww details are used only from the page whose scheme_code is the NFO's;
  * an unreachable or thin AMFI response never replaces the previous file;
  * a closing date AMFI leaves blank comes from ICICIdirect/Morningstar only when
    the opening date, AMC and numbers in the name agree and one NFO fits;
  * an NFO leaves the list 7 calendar days after it closes (or after its first
    NAV when no closing date is known) and shows when units are available.
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

    def test_name_slug_tried_when_search_misses_but_code_still_decides(self):
        seen = []
        def verify(code, slug):
            seen.append(slug)
            return {"status": "ok", "slug": slug, "payload": dict(self.payload(code), launch_date="26-Oct-2026")}
        d = N.groww_details(154798, "Kotak Nifty 500 Index Fund", verify=verify, search=lambda q: [{"search_id": "x", "scheme_code": "2"}])
        self.assertEqual(seen, ["kotak-nifty-500-index-fund-direct-growth"])
        self.assertEqual(d["reopenDate"], "2026-10-26")
        mismatch = lambda c, s: {"status": "identity_mismatch", "slug": s, "payload": None}
        self.assertIsNone(N.groww_details(154798, "Kotak Nifty 500 Index Fund", verify=mismatch, search=lambda q: []))

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
        old = {"benchmark": "old", "reopenDate": None}
        prev = {"nfos": [{"code": 154814, "details": old, "detailsAsOf": "2026-10-20"}]}
        out = N.build(rows, {}, prev, TODAY, details_fn=det)
        self.assertEqual(calls, [])
        self.assertEqual(out["nfos"][0]["details"], old)
        prev["nfos"][0]["detailsAsOf"] = "2026-10-10"
        out = N.build(rows, {}, prev, TODAY, details_fn=det)
        self.assertEqual(calls, [154814])
        self.assertEqual(out["nfos"][0]["detailsAsOf"], "2026-10-22")
        # A failed lookup keeps the last good details.
        out = N.build(rows, {}, prev, TODAY, details_fn=lambda c, n: None)
        self.assertEqual(out["nfos"][0]["details"], old)

    def test_details_without_a_reopen_date_are_refreshed_once(self):
        rows = [row(154814, "quant Nifty 50 Index Fund", cat="Index Funds - Equity Funds", launch="12-Oct-2026")]
        calls = []
        prev = {"nfos": [{"code": 154814, "details": {"benchmark": "old"}, "detailsAsOf": "2026-10-21"}]}
        N.build(rows, {}, prev, TODAY, details_fn=lambda c, n: calls.append(c) or {"reopenDate": "2026-10-28"})
        self.assertEqual(calls, [154814])

    def test_reopen_date_is_groww_launch_date(self):
        p = dict(self.payload(154814), launch_date="28-Oct-2026")
        ok = lambda c, s: {"status": "ok", "slug": s, "payload": p}
        d = N.groww_details(154814, "quant Nifty 50 Index Fund", verify=ok,
                            search=lambda q: [{"search_id": "q", "scheme_code": "154814"}])
        self.assertEqual(d["reopenDate"], "2026-10-28")
        p["launch_date"] = None
        self.assertIsNone(N.groww_details(154814, "q", verify=ok, search=lambda q: [{"search_id": "q", "scheme_code": "154814"}])["reopenDate"])

    def test_build_orders_and_marks_trading(self):
        rows = [row(1, "A Small Cap Fund", launch="12-Oct-2026"), row(2, "B Small Cap Fund", launch="20-Oct-2026"),
                row(3, "C Small Cap Fund", launch="26-Oct-2026"), row(4, "D Small Cap Fund", launch="15-Sep-2026")]
        out = N.build(rows, {"4": ("2026-10-21", 10.2)}, None, TODAY, details_fn=lambda c, n: None)
        self.assertEqual([(n["code"], n["status"]) for n in out["nfos"]], [(2, "offer"), (1, "offer"), (3, "upcoming"), (4, "trading")])
        self.assertEqual(out["nfos"][3]["nav"], {"date": "2026-10-21", "value": 10.2})


# Rows as the two sites serve them on 2026-10-22 (Morningstar's end-date cell is
# closed by a stray </div>, so it runs into the next cell).
ICICI_ROW = ('<tr> <td class="company_name"> <span><a href="https://www.icicidirect.com/mutual-funds/nfo-detail/'
             'quant-nifty-50-index-fund-regular-g" onclick="trackCustomEvent(\'x\',\'nfo_Others,Index Fund,Oct 12, 2026,Oct 26, 2026\');">'
             'Quant Nifty 50 Index Fund - Regular (G)</a></span> </td> <td class="text-left"><span>Others</span></td> '
             '<td class="text-left"><span>Index Fund</span></td> <td class="text-center"><span>Oct 12, 2026</span></td> '
             '<td class="text-center"><span>Oct 26, 2026</span></td> <td company_name"><span> <a href="x">Sameer Kate</a></span></td> </tr>')
MS_ROW = ('<tr class="mds-data-table__row"> <td align="left"> <a title="Quant Nifty 100 Index Reg Gr">Quant Nifty 100 Index Reg Gr</a> </td> '
          '<td> <span class="tiles-label">Initial Investment : </span> 5000 </td> <td> <span class="tiles-label">IPO Offer Price : </span> 10.0000 </td> '
          '<td> <span class="tiles-label">NFO Start Date : </span> Oct 12, 2026 </td> <td> <span class="tiles-label">NFO End Date : </span> Oct 26, 2026 </div> '
          '<td> <span class="tiles-label">Risk Level : </span> - </td> </tr>')
HEAD_ROW = "<tr><th>Fund Name</th><th>NFO Start Date</th><th>NFO End Date</th></tr>"


def nfo(code, name, launch, amc="quant", close=None, status="offer"):
    return {"code": code, "name": name, "amc": amc, "launchDate": launch, "closeDate": close, "status": status}


QUANT = [nfo(154814, "quant Nifty 50 Index Fund", "2026-10-12"), nfo(154822, "quant Nifty 100 Index Fund", "2026-10-12"),
         nfo(154818, "quant Nifty Midcap 150 Index Fund", "2026-10-12")]


class ClosingDates(unittest.TestCase):
    def test_tables_of_both_sites_parse(self):
        got = N.parse_offer_table("<table>" + HEAD_ROW + ICICI_ROW + MS_ROW + "</table>")
        self.assertEqual(got, [("Quant Nifty 50 Index Fund - Regular (G)", date(2026, 10, 12), date(2026, 10, 26)),
                               ("Quant Nifty 100 Index Reg Gr", date(2026, 10, 12), date(2026, 10, 26))])

    def test_detail_page_parses(self):
        page = ('<h1 class="t">Kotak Nifty 500 Index Fund - Regular (G)</h1><li>Open Date <b>Oct 05, 2026</b></li>'
                '<li>Close Date <b>Oct 19, 2026</b></li>')
        self.assertEqual(N.parse_detail_page(page), ("Kotak Nifty 500 Index Fund - Regular (G)", date(2026, 10, 5), date(2026, 10, 19)))
        self.assertIsNone(N.parse_detail_page("<h1>Not found</h1>"))

    def test_numbers_pick_the_right_quant_fund(self):
        o = date(2026, 10, 12)
        self.assertEqual(N.match_offer(QUANT, "Quant Nifty 100 Index Reg Gr", o)["code"], 154822)
        self.assertEqual(N.match_offer(QUANT, "Quant Nifty 50 Index Fund - Regular (G)", o)["code"], 154814)
        self.assertEqual(N.match_offer(QUANT, "Quant Nifty Midcap 150 Index Fund - Regular (G)", o)["code"], 154818)

    def test_no_match_on_other_date_amc_or_numbers(self):
        self.assertIsNone(N.match_offer(QUANT, "Quant Nifty 50 Index Reg Gr", date(2026, 10, 13)))
        self.assertIsNone(N.match_offer(QUANT, "Kotak Nifty 50 Index Fund - Regular (G)", date(2026, 10, 12)))
        self.assertIsNone(N.match_offer(QUANT, "Quant Nifty 200 Index Reg Gr", date(2026, 10, 12)))
        self.assertIsNone(N.match_offer(QUANT, "Quant Nifty 50 Index Reg Gr", None))

    def test_two_lookalikes_give_no_answer(self):
        twins = [nfo(1, "X Value Fund", "2026-10-12", amc="X"), nfo(2, "X Value Fund", "2026-10-12", amc="X")]
        self.assertIsNone(N.match_offer(twins, "X Value Fund - Regular (G)", date(2026, 10, 12)))
        pair = [nfo(1, "X Value Fund", "2026-10-12", amc="X"), nfo(2, "X Contra Fund", "2026-10-12", amc="X")]
        self.assertEqual(N.match_offer(pair, "X Contra Fund - Regular (G)", date(2026, 10, 12))["code"], 2)

    def test_plausible_close(self):
        o = date(2026, 10, 12)
        self.assertTrue(N.plausible_close(o, date(2026, 10, 26)))
        self.assertFalse(N.plausible_close(o, o))
        self.assertFalse(N.plausible_close(o, date(2026, 10, 1)))
        self.assertFalse(N.plausible_close(o, date(2026, 12, 31)))

    def test_detail_slug(self):
        self.assertEqual(N.detail_slug("Choice Large & Mid Cap Fund"), "choice-large-and-mid-cap-fund-regular-g")

    def resolve(self, recs, prev=None, offers=(), detail=None):
        N.resolve_close_dates(recs, {str(p["code"]): p for p in (prev or [])}, offers, detail)
        return {r["code"]: (r["closeDate"], r["closeDateSource"]) for r in recs}

    def test_amfi_first_then_lists_then_kept_then_detail_page(self):
        o, c = date(2026, 10, 12), date(2026, 10, 26)
        recs = [dict(r) for r in QUANT] + [nfo(5, "Kotak Nifty 500 Index Fund", "2026-10-05", amc="Kotak Mahindra"),
                                           nfo(6, "A Small Cap Fund", "2026-10-01", amc="A", close="2026-10-15")]
        prev = [{"code": 154818, "launchDate": "2026-10-12", "closeDate": "2026-10-27", "closeDateSource": "ICICIdirect"}]
        offers = [("Quant Nifty 50 Index Reg Gr", o, c, N.OFFER_LISTS[1]),
                  ("Quant Nifty 50 Index Fund - Regular (G)", o, c, N.OFFER_LISTS[0]),
                  ("A Small Cap Fund - Regular (G)", date(2026, 10, 1), date(2026, 10, 20), N.OFFER_LISTS[0])]
        seen = []
        def detail(name):
            seen.append(name)
            return ("Kotak Nifty 500 Index Fund - Regular (G)", date(2026, 10, 5), date(2026, 10, 19)) if "Kotak" in name else None
        got = self.resolve(recs, prev, offers, detail)
        self.assertEqual(got[154814], ("2026-10-26", "Morningstar"))  # first listing that matched
        self.assertEqual(got[154818], ("2026-10-27", "ICICIdirect"))  # kept from the last run
        self.assertEqual(got[5], ("2026-10-19", "ICICIdirect"))       # scheme page
        self.assertEqual(got[6], ("2026-10-15", "AMFI"))              # AMFI is never overridden
        self.assertEqual(got[154822], (None, None))
        self.assertEqual(seen, ["quant Nifty 100 Index Fund", "Kotak Nifty 500 Index Fund"])

    def test_kept_date_dropped_when_amfi_moves_the_opening(self):
        prev = [{"code": 154814, "launchDate": "2026-10-10", "closeDate": "2026-10-24"}]
        self.assertEqual(self.resolve([dict(QUANT[0])], prev)[154814], (None, None))

    def test_detail_page_must_match_too(self):
        wrong = lambda name: ("Quant Nifty 50 Index Fund - Regular (G)", date(2026, 10, 11), date(2026, 10, 26))
        self.assertEqual(self.resolve([dict(QUANT[0])], detail=wrong)[154814], (None, None))
        trading = dict(QUANT[0], status="trading")
        calls = []
        self.resolve([trading], detail=lambda n: calls.append(n))
        self.assertEqual(calls, [])


class SevenDaysAfterClose(unittest.TestCase):
    def build(self, rows, navall=None, prev=None, offers=(), first_nav=None):
        return {n["code"]: n for n in N.build(rows, navall or {}, prev, TODAY, details_fn=lambda c, n: None, offers=offers,
                                              first_nav_fn=first_nav)["nfos"]}

    def test_closed_offer_stays_seven_days(self):
        rows = [row(1, "A Small Cap Fund", launch="01-Oct-2026", close="15-Oct-2026"),
                row(2, "B Small Cap Fund", launch="01-Oct-2026", close="14-Oct-2026"),
                row(3, "C Small Cap Fund", launch="12-Oct-2026", close="20-Oct-2026")]
        got = self.build(rows)
        self.assertEqual(sorted(got), [1, 3])  # 15 Oct + 7 = 22 Oct is the last day
        self.assertEqual(got[1]["status"], "closed")

    def test_trading_fund_uses_close_then_first_nav(self):
        rows = [row(1, "A Small Cap Fund", launch="01-Oct-2026", close="16-Oct-2026"),
                row(2, "B Small Cap Fund", launch="15-Sep-2026"),
                row(3, "C Small Cap Fund", launch="01-Oct-2026"),
                row(4, "D Small Cap Fund", launch="01-Oct-2026")]
        nav = {str(c): ("2026-10-21", 10.1) for c in (1, 2, 3, 4)}
        first = {1: "2026-10-20", 2: "2026-10-01", 3: "2026-10-16", 4: None}
        got = self.build(rows, nav, first_nav=first.get)
        self.assertEqual(sorted(got), [1, 3, 4])  # 2 first traded 21 days ago; 4 has no date to count from
        self.assertEqual(got[1]["firstNavDate"], "2026-10-20")
        self.assertEqual(got[3]["firstNavDate"], "2026-10-16")

    def test_first_nav_date_is_kept_not_refetched(self):
        rows = [row(1, "A Small Cap Fund", launch="01-Oct-2026")]
        calls = []
        prev = {"nfos": [{"code": 1, "firstNavDate": "2026-10-19"}]}
        got = self.build(rows, {"1": ("2026-10-21", 10.0)}, prev, first_nav=lambda c: calls.append(c))
        self.assertEqual((got[1]["firstNavDate"], calls), ("2026-10-19", []))

    def test_first_nav_date_from_site_file(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        with open(os.path.join(tmp, "154738.json"), "w", encoding="utf-8") as fh:
            json.dump({"d": ["2026-10-05", "2026-10-06"], "v": [10.0, 10.1]}, fh)
        with mock.patch.object(N, "NAV_DIR", tmp), mock.patch.object(N, "http_text", side_effect=AssertionError("no network")):
            self.assertEqual(N.first_nav_date(154738), "2026-10-05")
        api = json.dumps({"data": [{"date": "21-10-2026", "nav": "10.1"}, {"date": "16-10-2026", "nav": "10.0"}]})
        with mock.patch.object(N, "NAV_DIR", tmp), mock.patch.object(N, "http_text", return_value=api):
            self.assertEqual(N.first_nav_date(154740), "2026-10-16")
        with mock.patch.object(N, "NAV_DIR", tmp), mock.patch.object(N, "http_text", side_effect=OSError("down")):
            self.assertIsNone(N.first_nav_date(154740))

    def test_offer_list_failure_is_a_warning(self):
        with mock.patch.object(N, "http_text", side_effect=OSError("blocked")):
            self.assertEqual(N.fetch_offer_lists(), [])


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
