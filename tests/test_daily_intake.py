"""Daily fund intake (refresh-data.yml -> discover_new_funds.py --add-only).

A fund that starts trading must reach the site the morning after its first NAV,
not at the next monthly discovery PR. Guards: AMFI's own NAV admits a fund mfapi
has not indexed yet; unclaimed-money plans never count as new funds; debt,
hybrid-index and closed-ended headers never map into equity categories; the
daily run adds only, never edits existing funds, and adds nothing when a day
shows more new funds than the cap. No network.
"""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(ROOT / "scripts"))
import config as C  # noqa: E402
import discover_new_funds as D  # noqa: E402

M = C.map_amfi_category

RAW = """Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Equity Schemes - Small Cap Fund)

Carnelian Mutual Fund

154787;INF30CN01095;-;Carnelian Small Cap Fund;Direct Plan;Growth;10.0327;09-Nov-2026

Open Ended Schemes(Debt Scheme - Liquid Fund)

Quant Mutual Fund

120837;INF966L01820;-;Quant Liquid Fund;Direct Plan;Growth Option;45.898;10-Nov-2026
148510;-;-;Quant Liquid Fund;Direct Plan;Unclaimed Dividend-Growth Option;13.5232;15-Dec-2025

JM Financial Mutual Fund

148413;-;-;JM Liquid Fund;Direct Plan;Unclaimed Brokerage I.E.F - Growth Plan;41.4437;10-Nov-2026

PGIM India Mutual Fund

152114;-;-;PGIM India Money Market Fund;Direct Plan;Direct Growth;0;09-Nov-2026
"""


class HeaderScopeTests(unittest.TestCase):
    def test_debt_headers_admit_only_cash_equivalents(self):
        self.assertIsNone(M("Open Ended Schemes(Income/Debt Oriented Schemes - Sectoral Fund)",
                            "UTI Financial Services Debt Fund"))
        self.assertIsNone(M("Open Ended Schemes(Index Funds - Debt Funds)", "Axis CRISIL IBX SDL May 2027 Index Fund"))
        self.assertEqual(M("Open Ended Schemes(Debt Scheme - Liquid Fund)"), "Liquid")
        self.assertEqual(M("Open Ended Schemes(Income/Debt Oriented Schemes - Liquid Fund)"), "Liquid")
        self.assertEqual(M("Open Ended Schemes(Income/Debt Oriented Schemes - Money Market Fund)"), "Money Market")

    def test_hybrid_headers_admit_only_arbitrage(self):
        self.assertEqual(M("Open Ended Schemes(Hybrid Schemes - Arbitrage Fund)"), "Arbitrage")
        self.assertEqual(M("Open Ended Schemes(Hybrid Scheme - Arbitrage Fund)"), "Arbitrage")
        self.assertIsNone(M("Open Ended Schemes(Index Funds - Hybrid Fund)",
                            "HDFC Nifty LargeMidcap250 Plus 8-13 yr G-sec 70:30 Index Fund"))
        self.assertIsNone(M("Open Ended Schemes(Hybrid Scheme - Equity Savings)"))

    def test_closed_ended_and_interval_schemes_are_out_of_scope(self):
        self.assertIsNone(M("Close Ended Schemes(ELSS)", "SBI Long Term Advantage Fund - Series IV"))
        self.assertIsNone(M("Interval Fund Schemes(Income)"))

    def test_equity_headers_unchanged(self):
        self.assertEqual(M("Open Ended Schemes(Equity Schemes - Small Cap Fund)"), "Small Cap")
        self.assertEqual(M("Open Ended Schemes(Index Funds - Equity Funds)", "Kotak Nifty 50 Index Fund"), "Index Funds")
        self.assertEqual(M("Open Ended Schemes(Equity Schemes - Thematic Fund)"), "Sectoral/Thematic")


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.u = D.parse_amfi_universe(RAW)

    def test_unclaimed_money_plans_are_not_schemes(self):
        self.assertNotIn(148510, self.u)
        self.assertNotIn(148413, self.u)
        self.assertIn(120837, self.u)

    def test_todays_amfi_price_is_kept(self):
        self.assertEqual(self.u[154787]["nav"], 10.0327)
        self.assertEqual(self.u[154787]["nav_date"], "2026-11-09")
        self.assertIsNone(self.u[152114]["nav"])  # a zero NAV is no price


class AmfiFallbackTests(unittest.TestCase):
    scheme = {"code": 154787, "nav": 10.0327, "nav_date": "2026-11-09"}

    def test_fund_mfapi_has_not_indexed_enters_on_amfi_nav(self):
        d, v = D.nav_history_with_amfi(self.scheme, fetch=lambda c: (None, None))
        self.assertEqual((d, v), (["2026-11-09"], [10.0327]))

    def test_amfi_nav_completes_a_lagging_mfapi_history(self):
        d, v = D.nav_history_with_amfi(self.scheme, fetch=lambda c: (["2026-11-06"], [10.0]))
        self.assertEqual(d, ["2026-11-06", "2026-11-09"])

    def test_no_duplicate_or_future_point(self):
        d, _ = D.nav_history_with_amfi(self.scheme, fetch=lambda c: (["2026-11-06", "2026-11-09"], [10.0, 10.03]))
        self.assertEqual(d, ["2026-11-06", "2026-11-09"])
        future = dict(self.scheme, nav_date="2999-01-01")
        self.assertEqual(D.nav_history_with_amfi(future, fetch=lambda c: (None, None)), (None, None))

    def test_mfapi_duplicates_and_future_points_are_dropped(self):
        d, v = D.nav_history_with_amfi(self.scheme, fetch=lambda c: (["2026-11-09", "2026-11-06", "2026-11-09", "2999-01-01"], [10.03, 10.0, 10.03, 11.0]))
        self.assertEqual((d, v), (["2026-11-06", "2026-11-09"], [10.0, 10.03]))

    def test_no_price_anywhere_is_still_a_skip(self):
        none = {"code": 152114, "nav": None, "nav_date": "2026-11-09"}
        self.assertEqual(D.nav_history_with_amfi(none, fetch=lambda c: (None, None)), (None, None))


class AddOnlyRunTests(unittest.TestCase):
    def run_intake(self, n_new):
        tmp = tempfile.mkdtemp()
        funds_path = os.path.join(tmp, "funds.json")
        nav_dir = os.path.join(tmp, "nav")
        existing = {"code": 100, "name": "Old Fund", "category": "Small Cap", "status": "stale"}
        Path(funds_path).write_text(json.dumps({"funds": [existing], "totalFunds": 1}), encoding="utf-8")
        schemes = {100: {"code": 100, "name": "Old Fund - Renamed", "amc": "X Mutual Fund",
                         "amfi_category": "Equity Schemes - Small Cap Fund", "nav": 5.0, "nav_date": "2026-11-09"}}
        for i in range(n_new):
            code = 200 + i
            schemes[code] = {"code": code, "name": f"New Fund {i} - Direct Plan - Growth", "amc": "Y Mutual Fund",
                             "amfi_category": "Equity Schemes - Small Cap Fund", "nav": 10.0, "nav_date": "2026-11-09"}
        out = os.path.join(tmp, "gh_output")
        buf = io.StringIO()
        with patch.object(D, "FUNDS_JSON", funds_path), patch.object(D, "NAV_DIR", nav_dir), \
                patch.object(D, "ROOT", tmp), patch.object(D, "fetch_amfi_universe", lambda: schemes), \
                patch.object(D, "fetch_amfi_raw_codes", side_effect=AssertionError("lifecycle ran")), \
                patch.object(D, "fetch_nav_history", lambda c: (None, None)), patch.object(D.time, "sleep", lambda s: None), \
                patch.object(sys, "argv", ["discover_new_funds.py", "--add-only"]), \
                patch.dict(os.environ, {"GITHUB_OUTPUT": out}), contextlib.redirect_stdout(buf):
            D.main_with_lifecycle()
        data = json.loads(Path(funds_path).read_text(encoding="utf-8"))
        return data, buf.getvalue(), Path(out).read_text(encoding="utf-8"), tmp

    def test_new_funds_join_and_existing_funds_are_untouched(self):
        data, log, gh, tmp = self.run_intake(2)
        self.assertEqual([f["code"] for f in data["funds"]], [100, 200, 201])
        old = data["funds"][0]
        self.assertEqual((old["name"], old["status"]), ("Old Fund", "stale"))  # no rename, no status reset
        new = data["funds"][1]
        self.assertEqual((new["name"], new["status"], new["navPoints"], new["isYoung"]), ("New Fund 0", "active", 1, True))
        self.assertEqual(new["holdingsMeta"], {"coverage": "pending"})
        self.assertTrue(os.path.exists(os.path.join(tmp, "nav", "200.json")))
        self.assertFalse(os.path.exists(os.path.join(tmp, "src", "data", "lifecycle_report.json")))
        self.assertIn("Added: 2", log)
        self.assertIn("added=2", gh)

    def test_a_day_over_the_cap_adds_nothing(self):
        data, log, gh, tmp = self.run_intake(D.MAX_DAILY_ADDS + 1)
        self.assertEqual([f["code"] for f in data["funds"]], [100])
        self.assertFalse(os.path.isdir(os.path.join(tmp, "nav")) and os.listdir(os.path.join(tmp, "nav")))
        self.assertIn("Added: 0", log)
        self.assertIn("added=0", gh)

    def test_quiet_day_reports_zero(self):
        data, log, gh, _ = self.run_intake(0)
        self.assertIn("Added: 0", log)
        self.assertIn("added=0", gh)


class WorkflowTests(unittest.TestCase):
    def test_daily_refresh_runs_the_intake_before_metrics(self):
        wf = (ROOT / ".github/workflows/refresh-data.yml").read_text(encoding="utf-8")
        daily = wf.split("  monthly-holdings:", 1)[0]
        intake = daily.index("python pipeline/discover_new_funds.py --add-only")
        self.assertLess(daily.index("python scripts/update_nav_daily.py"), intake)
        self.assertLess(intake, daily.index("python pipeline/compute_metrics.py"))
        self.assertIn("set -o pipefail", daily)
        # CAMS statement import must recognise a fund on the day it is listed.
        self.assertLess(intake, daily.index("python pipeline/build_matcher_universe.py"))
        self.assertLess(daily.index("python pipeline/build_matcher_universe.py"), daily.index("python scripts/normalize_amc.py"))
        self.assertLess(daily.index("python scripts/prune_pending.py"), daily.index("python scripts/build_analytics.py"))
        # Every intake-specific step sits inside the guarded block, so its failure
        # restores the pre-intake files instead of failing the daily publish.
        block = daily.split("- name: Admit and onboard funds that started trading", 1)[1].split("- name:", 1)[0]
        for cmd in ("build_matcher_universe.py", "split_funds.py", "onboard_new_funds.py",
                    "enrich_fund_data.py", "prune_pending.py"):
            self.assertIn(cmd, block)
        self.assertEqual(daily.count("python scripts/prune_pending.py"), 1)
        self.assertIn("public/holdings-history/", daily.split("Commit updated data", 1)[1])


if __name__ == "__main__":
    unittest.main()
