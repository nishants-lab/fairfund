"""Movers data: estimated flows, windows, costs, managers, stock changes, AMC names.

No network and no repo data: every case is built here.
"""
from datetime import date
from pathlib import Path
import importlib.util
import unittest

ROOT = Path(__file__).resolve().parents[1]


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


B = _load("build_movers")
A = _load("normalize_amc")


def nav(points):
    d = sorted(points)
    return {"d": d, "v": [points[x] for x in d]}


class FlowTests(unittest.TestCase):
    def test_flow_removes_market_movement(self):
        # AUM 1000 -> 1050 while NAV fell 10%: the market took 100, investors added 150.
        self.assertEqual(B.flow_between(1000, 1050, 100, 90), (50.0, 150.0, -100.0))

    def test_fund_that_shrank_can_still_have_inflows(self):
        change, flow, market = B.flow_between(1000, 950, 100, 90)
        self.assertLess(change, 0)
        self.assertGreater(flow, 0)
        self.assertAlmostEqual(change, flow + market, places=1)

    def test_missing_inputs_give_no_value(self):
        self.assertIsNone(B.flow_between(0, 10, 1, 1))
        self.assertIsNone(B.flow_between(10, 10, None, 1))

    def test_nav_must_be_close_to_the_month_end(self):
        n = nav({"2026-08-20": 10.0, "2026-09-30": 11.0})
        self.assertEqual(B.nav_at(n, "2026-09-30"), 11.0)
        self.assertIsNone(B.nav_at(n, "2026-08-31"))       # 11 days stale
        self.assertIsNone(B.nav_at(n, "2026-08-01"))       # before history

    def test_month_end_weekend_uses_last_trading_day(self):
        n = nav({"2026-05-29": 10.0})
        self.assertEqual(B.nav_at(n, "2026-05-31"), 10.0)


class WindowTests(unittest.TestCase):
    NAV = nav({"2026-03-31": 10.0, "2026-04-30": 10.0, "2026-05-29": 10.0, "2026-06-30": 10.0, "2026-07-31": 10.0,
               "2026-08-31": 10.0, "2026-09-30": 10.0})

    def test_duplicate_month_keeps_the_later_disclosure(self):
        m = B.by_month([("2026-05-30", 1.0), ("2026-05-31", 2.0)])
        self.assertEqual(m, {"2026-05": ("2026-05-31", 2.0)})

    def test_gap_never_passes_for_one_month(self):
        # June then September: the old page called this "1M".
        rows, win = B.fund_flow_record([("2026-06-30", 100.0), ("2026-09-30", 130.0)], self.NAV, "2026-09")
        self.assertEqual(win, {})                           # no window can be built across the gap
        self.assertIsNone(rows[1][2])                       # no monthly flow across the gap

    def test_a_gap_inside_a_window_withholds_it(self):
        s = [("2026-06-30", 110.0), ("2026-08-31", 120.0), ("2026-09-30", 125.0)]
        _, win = B.fund_flow_record(s, self.NAV, "2026-09")
        self.assertEqual(win["1"][1], 5.0)
        self.assertNotIn("3", win)                          # July is missing

    def test_windows_are_calendar_months_from_the_reference(self):
        s = [("2026-03-31", 100.0), ("2026-04-30", 102.0), ("2026-05-31", 105.0), ("2026-06-30", 110.0),
             ("2026-07-31", 112.0), ("2026-08-31", 120.0), ("2026-09-30", 125.0)]
        _, win = B.fund_flow_record(s, self.NAV, "2026-09")
        self.assertEqual(win["1"][1], 5.0)
        self.assertEqual(win["3"][1], 15.0)
        self.assertEqual(win["6"][1], 25.0)
        self.assertEqual(win["6"][3], 25.0)                 # % of the starting AUM

    def test_window_flow_does_not_count_returns_on_money_that_came_in_mid_window(self):
        # 100 came in during July, then the NAV rose 10% in August: the 3M flow is the 100,
        # and the extra 10 the July money earned is market movement.
        n = nav({"2026-06-30": 10.0, "2026-07-31": 10.0, "2026-08-31": 11.0, "2026-09-30": 11.0})
        s = [("2026-06-30", 100.0), ("2026-07-31", 200.0), ("2026-08-31", 220.0), ("2026-09-30", 220.0)]
        _, win = B.fund_flow_record(s, n, "2026-09")
        change, flow, market, pct = win["3"]
        self.assertEqual((change, flow, market, pct), (120.0, 100.0, 20.0, 100.0))
        self.assertAlmostEqual(change, flow + market, places=1)

    def test_reference_month_is_what_most_funds_disclosed(self):
        months = [{"2026-08", "2026-09"}] * 5 + [{"2026-07", "2026-08"}] * 2 + [{"2026-09"}]
        self.assertEqual(B.reference_month(months), "2026-09")

    def test_stale_fund_is_flagged_and_has_no_window(self):
        funds = [{"code": 1, "aum": {"series": [["2026-08-31", 10.0], ["2026-09-30", 11.0]]}},
                 {"code": 2, "aum": {"series": [["2026-08-31", 10.0], ["2026-09-30", 11.0]]}},
                 {"code": 3, "aum": {"series": [["2026-07-31", 10.0], ["2026-08-31", 11.0]]}}]
        navs = {str(c): self.NAV for c in (1, 2, 3)}
        movers, _, _ = B.build(funds, navs, {}, {}, {}, date(2026, 10, 22))
        self.assertTrue(movers["funds"]["3"]["stale"])
        self.assertNotIn("w", movers["funds"]["3"])
        self.assertEqual(movers["refMonth"], "2026-09")


class CostTests(unittest.TestCase):
    SNAPS = {"2026-06-30": {"expense_ratio": "0.80"}, "2026-08-31": {"expense_ratio": "0.75"},
             "2026-09-30": {"expense_ratio": "0.70"}}

    def test_change_against_each_window(self):
        self.assertEqual(B.ter_record(self.SNAPS, 0.70, "2026-09"), {"now": 0.7, "1": -0.05, "3": -0.1})

    def test_one_month_spike_between_agreeing_neighbours_is_dropped(self):
        snaps = {"2026-06-30": {"expense_ratio": "1.16"}, "2026-07-31": {"expense_ratio": "1.16"},
                 "2026-08-31": {"expense_ratio": "0.41"}, "2026-09-30": {"expense_ratio": "1.19"}}
        self.assertEqual(B.ter_record(snaps, 1.19, "2026-09"), {"now": 1.19, "3": 0.03})

    def test_a_lasting_change_is_kept(self):
        snaps = {"2026-07-31": {"expense_ratio": "1.16"}, "2026-08-31": {"expense_ratio": "0.80"},
                 "2026-09-30": {"expense_ratio": "0.80"}}
        self.assertEqual(B.ter_record(snaps, 0.80, "2026-09"), {"now": 0.8, "1": 0.0})

    def test_a_later_snapshot_cannot_make_the_reference_month_vanish(self):
        # A holdings snapshot ahead of the reference month: September now looks like a
        # spike between August and October. The record is withheld, never a crash.
        snaps = {"2026-08-31": {"expense_ratio": "1.00"}, "2026-09-30": {"expense_ratio": "0.50"},
                 "2026-10-31": {"expense_ratio": "1.00"}}
        self.assertIsNone(B.ter_record(snaps, 0.50, "2026-09"))

    def test_spikes_are_judged_on_the_disclosed_values(self):
        # Two odd months in a row are not one spike: each has an odd neighbour, so both stay.
        snaps = {"2026-06-30": {"expense_ratio": "1.00"}, "2026-07-31": {"expense_ratio": "0.40"},
                 "2026-08-31": {"expense_ratio": "0.40"}, "2026-09-30": {"expense_ratio": "1.00"}}
        self.assertEqual(B.ter_record(snaps, 1.00, "2026-09"), {"now": 1.0, "1": 0.6, "3": 0.0})

    def test_withheld_expense_ratio_stays_withheld(self):
        self.assertIsNone(B.ter_record(self.SNAPS, None, "2026-09"))

    def test_disagreeing_with_the_published_figure_is_dropped(self):
        self.assertIsNone(B.ter_record(self.SNAPS, 0.95, "2026-09"))


class ManagerTests(unittest.TestCase):
    TODAY = date(2026, 10, 22)

    def test_joined_within_a_year(self):
        rec = {"fetched": True, "managers": [{"name": "A", "since": "2026-05-01"}, {"name": "B", "since": "2019-01-01"}]}
        self.assertEqual(B.manager_record(rec, self.TODAY), [["A", "2026-05-01"]])

    def test_unfetched_record_has_no_claims(self):
        self.assertIsNone(B.manager_record({"fetched": False, "managers": [{"name": "A", "since": "2026-05-01"}]}, self.TODAY))

    def test_departure_is_logged_once(self):
        prev = {"mgrSets": {"1": ["A", "B"]}}
        recs = {"1": {"fetched": True, "managers": [{"name": "A"}]}}
        sets, log = B.update_manager_log(prev, recs, {"1"}, self.TODAY)
        self.assertEqual(log, [["1", "B", "2026-10-22"]])
        sets2, log2 = B.update_manager_log({"mgrSets": sets, "mgrLog": log}, recs, {"1"}, date(2026, 11, 22))
        self.assertEqual(log2, log)

    def test_failed_fetch_is_not_a_departure(self):
        prev = {"mgrSets": {"1": ["A", "B"]}}
        sets, log = B.update_manager_log(prev, {"1": {"fetched": False}}, {"1"}, self.TODAY)
        self.assertEqual(log, [])
        self.assertEqual(sets["1"], ["A", "B"])

    def test_old_entries_and_removed_funds_drop_off(self):
        prev = {"mgrLog": [["1", "X", "2025-01-01"], ["2", "Y", "2026-10-01"], ["1", "Z", "2026-10-01"]]}
        _, log = B.update_manager_log(prev, {}, {"1"}, self.TODAY)
        self.assertEqual(log, [["1", "Z", "2026-10-01"]])


class ManagerRefreshTests(unittest.TestCase):
    """fetch_managers --refresh-all, which the monthly run uses so departures can be seen."""
    @classmethod
    def setUpClass(cls):
        import sys
        sys.path.insert(0, str(ROOT / "scripts"))
        cls.F = _load("fetch_managers")

    def test_verified_record_is_refreshed_once_a_month_old(self):
        F, today = self.F, date(2026, 11, 20)
        existing = {"1": {"fetched": True, "fetchedOn": "2026-10-20"}, "2": {"fetched": True, "fetchedOn": "2026-11-01"},
                    "3": {"fetched": True}, "4": {"fetched": False, "note": "identity mismatch"}}
        self.assertEqual([c for c in (1, 2, 3, 4) if F.is_stale(c, existing, today)], [1, 3])

    def test_failed_refresh_keeps_the_verified_record(self):
        F = self.F
        old = {"fetched": True, "managers": [{"name": "A"}], "fetchedOn": "2026-09-01"}
        self.assertIs(F.merge(old, {"fetched": False, "managers": [], "note": "fetch failed"}), old)
        new = {"fetched": True, "managers": [{"name": "B"}], "fetchedOn": "2026-10-01"}
        self.assertIs(F.merge(old, new), new)
        self.assertEqual(F.merge(None, {"fetched": False})["fetched"], False)
        self.assertIs(F.merge(old, {"fetched": True, "managers": [], "fetchedOn": "2026-10-01"}), old)   # empty page

    def test_monthly_run_refreshes_managers(self):
        wf = (ROOT / ".github" / "workflows" / "refresh-data.yml").read_text(encoding="utf-8")
        self.assertIn("python scripts/fetch_managers.py --refresh-all", wf)


class StockChangeTests(unittest.TestCase):
    def snaps(self, aug, sep):
        return {"2026-08-31": {"aum": 100, "holdings": aug}, "2026-09-30": {"aum": 110, "holdings": sep}}

    def run_changes(self, aug, sep, n=None, ratios=None):
        meta = {}
        out = B.stock_changes(self.snaps(aug, sep), "2026-09", B._load_stock_filter(), meta, ratios, n)
        return out, meta

    def h(self, key, pct, inst="Equity"):
        return {"key": key, "name": key.upper(), "pct": pct, "sector": "S", "instrument": inst}

    def test_every_position_is_listed_before_trades_are_judged(self):
        out, meta = self.run_changes(
            [self.h("a", 50), self.h("b", 30), self.h("c", 20)],
            [self.h("a", 50.05), self.h("b", 25), self.h("d", 24.95)])
        a0, a1, rows, growth = out["1"]
        self.assertIsNone(growth)                                     # no NAV given
        self.assertEqual((a0, a1), (100.0, 110.0))
        self.assertEqual(rows, [["a", 50, 50.05], ["b", 30, 25], ["c", 20, None], ["d", None, 24.95]])
        self.assertEqual(meta["d"], ["D", "S"])

    def test_without_a_price_estimate_small_drifts_are_not_trades(self):
        raw = {"1": {"9": [100.0, 110.0, [["a", 50, 50.05], ["b", 30, 25], ["c", 20, None], ["d", None, 24.95]], None]}}
        pairs, stocks = B.keep_trades(raw, {}, {"b": ["B", "S"], "c": ["C", "S"], "d": ["D", "S"]})
        funds, px = pairs["1"]
        self.assertEqual([s[0] for s in stocks], ["b", "c", "d"])    # "a" drift dropped
        self.assertEqual(funds["9"][2], [[0, 30, 25], [1, 20, None], [2, None, 24.95]])
        self.assertEqual(px, {})

    def test_small_weight_trades_count_once_the_price_move_is_known(self):
        # 0.10% -> 0.15% at flat prices is half as much again of the stock: a trade, though
        # under 0.1 points. 0.10% -> 0.101% is rounding.
        self.assertTrue(B.is_trade(0.10, 0.15, 1.0, 1.0))
        self.assertFalse(B.is_trade(0.10, 0.101, 1.0, 1.0))
        self.assertFalse(B.is_trade(0.10, 0.15, None, 1.0))           # no price move: needs 0.1 points
        # Weight unchanged while the stock fell 10% against the fund: the fund bought more.
        self.assertTrue(B.is_trade(5.0, 5.0, 0.9, 1.0))
        # Weight up 3% with the stock up 3% against the fund: price move only.
        self.assertFalse(B.is_trade(5.0, 5.15, 1.03, 1.0))
        self.assertTrue(B.is_trade(None, 1.0, None, None) and B.is_trade(1.0, None, None, None))

    def test_price_moves_are_listed_for_kept_stocks_only(self):
        raw = {"1": {"9": [100.0, 110.0, [["a", 5.0, 5.0], ["b", 5.0, 5.0]], 1.0]}}
        pairs, stocks = B.keep_trades(raw, {"1": {"a": 0.9, "b": 1.0}}, {"a": ["A", "S"], "b": ["B", "S"]})
        funds, px = pairs["1"]
        self.assertEqual(stocks, [["a", "A", "S"]])
        self.assertEqual(funds["9"][2], [[0, 5.0, 5.0]])
        self.assertEqual(px, {"0": 0.9})

    def test_cash_and_debt_rows_are_not_stock_moves(self):
        out, meta = self.run_changes(
            [self.h("a", 60), self.h("cd", 40, "Certificate of Deposit")],
            [self.h("a", 60), self.h("tb", 40, "T-Bills")])
        self.assertEqual(out["1"][2], [["a", 60, 60]])
        self.assertEqual(set(meta), {"a"})

    def test_price_ratio_is_collected_for_every_stock_held_at_both_ends(self):
        ratios = {}
        n = nav({"2026-08-29": 10.0, "2026-09-30": 10.5})
        out, _ = self.run_changes([self.h("a", 50), self.h("b", 50)], [self.h("a", 50.05), self.h("b", 49.95)], n, ratios)
        self.assertEqual(out["1"][3], 1.05)
        self.assertAlmostEqual(ratios["1"]["a"][0], 50.05 / 50 * 1.05)
        self.assertEqual(set(ratios["1"]), {"a", "b"})

    def test_no_nav_no_price_ratio(self):
        ratios = {}
        self.run_changes([self.h("a", 50), self.h("b", 50)], [self.h("a", 60), self.h("b", 40)], None, ratios)
        self.assertEqual(ratios, {})

    def test_price_move_needs_enough_holders(self):
        ratios = {"1": {"a": [1.0, 1.1, 1.2, 1.3, 2.0], "b": [1.0, 1.1]}}
        self.assertEqual(B.price_moves(ratios), {"1": {"a": 1.2}})   # b too few holders

    def test_index_funds_fill_in_only_when_active_holders_are_few(self):
        active = {"1": {"a": [1.0] * 5, "b": [1.0, 1.0]}}
        passive = {"1": {"a": [2.0] * 9, "b": [2.0] * 3}}
        self.assertEqual(B.price_moves(active, passive)["1"], {"a": 1.0, "b": 2.0})

    def test_partial_snapshot_is_skipped(self):
        out, _ = self.run_changes([self.h("a", 50)], [self.h("b", 95)])
        self.assertEqual(out, {})


class AmcTests(unittest.TestCase):
    def test_amfi_fund_house_wins(self):
        funds = [{"code": 1, "amc": "ICICI Prudential Dividend Yield"}, {"code": 2, "amc": "HDFC"}, {"code": 3, "amc": "Old"}]
        matcher = [{"code": 1, "amc": "ICICI Prudential Mutual Fund"}, {"code": 2, "amc": "HDFC Mutual Fund"}]
        changed, missing = A.normalize(funds, matcher)
        self.assertEqual([f["amc"] for f in funds], ["ICICI Prudential", "HDFC", "Old"])
        self.assertEqual((changed, missing), (1, [3]))
        self.assertEqual(A.normalize(funds, matcher)[0], 0)          # idempotent

    def test_scheme_name_left_in_the_matcher_resolves_to_its_house(self):
        matcher = [{"code": 1, "amc": "Motilal Oswal Mutual Fund"}, {"code": 2, "amc": "Motilal Oswal Nifty"},
                   {"code": 3, "amc": "ASK MUTUAL FUND"}, {"code": 4, "amc": "Unknown House"}]
        funds = [{"code": c, "amc": ""} for c in (1, 2, 3, 4)]
        A.normalize(funds, matcher)
        self.assertEqual([f["amc"] for f in funds], ["Motilal Oswal", "Motilal Oswal", "ASK", "Unknown House"])

    def test_canonical_name(self):
        self.assertEqual(A.canonical_amc("Kotak Mahindra Mutual Fund"), "Kotak Mahindra")
        self.assertEqual(A.canonical_amc("PPFAS Mutual Fund "), "PPFAS")



class WorkflowTests(unittest.TestCase):
    def test_every_data_run_builds_movers_before_the_smoke_test(self):
        for name, runs in (("refresh-data.yml", 2), ("discover-funds.yml", 1)):
            text = (ROOT / ".github" / "workflows" / name).read_text(encoding="utf-8")
            self.assertEqual(text.count("python scripts/build_movers.py"), runs, name)
            parts = text.split("python scripts/build_movers.py")
            for before, after in zip(parts, parts[1:]):
                self.assertIn("python scripts/normalize_amc.py", before.rsplit("- name:", 1)[1])
                self.assertIn("tests/smoke.py", after.split("git add", 1)[0])
                self.assertIn("src/data/", after.split("git add", 1)[1].splitlines()[0])


if __name__ == "__main__":
    unittest.main()
