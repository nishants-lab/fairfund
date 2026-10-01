"""NAV quarantine publication contract, using temporary source and output trees."""
from copy import deepcopy
from datetime import date, timedelta
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import quarantine_nav as quarantine
import build_analytics as analytics
import build_category_median as category
import sync_analytics_to_shells as sync

TODAY = "2026-10-01"
SIGNALS = {"alpha": {"n": 40, "confidence": 99}}
ROLLING = {"spark": [["2026-09", 1.2]], "windowM": 36}


class QuarantineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ff-quarantine-", dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.nav = self.root / "public/nav"
        self.details = self.root / "public/fund-data"
        self.index = self.root / "src/data/funds.json"
        self.producer = self.root / "src/data/fund_analytics.json"
        self.funds = [{"code": code, "metrics": {"1Y": {"cagr": 999}},
                       "si": {"totalReturn": 999}, "analytics": deepcopy(SIGNALS)}
                      for code in (101, 202)]
        self.write(self.index, {"funds": self.funds})
        self.write(self.producer, {"101": SIGNALS, "202": SIGNALS})
        for code in (101, 202):
            self.write(self.nav / f"{code}.json", {"d": ["2026-09-29", "2026-09-30"], "v": [100, 101]})
            self.write(self.details / f"{code}.json", {"analytics": {**SIGNALS, "rollingAlpha": ROLLING},
                       "metrics": {"1Y": {"cagr": 999}}, "si": {"cagr": 999},
                       "holdings": [{"name": "X"}], "aum": {"current": 123}})
        clock = patch.object(quarantine, "ist_today", return_value=TODAY)
        clock.start()
        self.addCleanup(clock.stop)

    def write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def read(self, path):
        return json.loads(path.read_text(encoding="utf-8"))

    def snapshot(self):
        return {p.relative_to(self.root): p.read_bytes() for p in self.root.rglob("*.json")}

    def run_mode(self, mode):
        return quarantine.main([mode, "--root", str(self.root)])

    def make_jump(self, code=101):
        self.write(self.nav / f"{code}.json", {"d": ["2026-09-29", "2026-09-30"], "v": [100, 150]})

    def test_check_is_read_only_and_apply_clears_all_surfaces_idempotently(self):
        self.make_jump()
        before = self.snapshot()
        self.assertEqual(self.run_mode("--check"), 1)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(self.run_mode("--apply"), 0)
        after = self.snapshot()
        for relative in (Path("public/nav/101.json"), Path("public/nav/202.json"), Path("public/fund-data/202.json")):
            self.assertEqual(before[relative], after[relative])
        fund = self.read(self.index)["funds"][0]
        detail = self.read(self.details / "101.json")
        for record in (fund, detail):
            self.assertEqual(record["metrics"], {})
            self.assertEqual(record["analytics"], {})
            self.assertNotIn("si", record)
            self.assertEqual(record["dataQuality"]["status"], "quarantined")
            self.assertEqual(record["dataQuality"]["issues"][0]["date"], "2026-09-30")
        self.assertEqual(detail["holdings"], [{"name": "X"}])
        self.assertEqual(detail["aum"], {"current": 123})
        self.assertEqual(self.read(self.producer)["101"], {})
        self.assertEqual(self.read(self.index)["funds"][1], self.funds[1])
        with patch.multiple(sync, FA_PATH=self.producer, FUNDS_PATH=self.index, DETAIL_DIR=self.details):
            self.assertEqual(sync.plan_updates(), (2, []))
        self.assertEqual(self.run_mode("--check"), 0)
        self.assertEqual(self.run_mode("--apply"), 0)
        self.assertEqual(after, self.snapshot())

    def test_hold_clears_historical_rankings_from_index_and_detail(self):
        for path in (self.index, self.details / "101.json"):
            data = self.read(path)
            record = data["funds"][0] if path == self.index else data
            record["previousRankings"] = {"3Y": {"catRank": 1, "catSize": 10}}
            self.write(path, data)
        self.make_jump()
        self.assertEqual(self.run_mode("--check"), 1)
        self.assertEqual(self.run_mode("--apply"), 0)
        self.assertNotIn("previousRankings", self.read(self.index)["funds"][0])
        self.assertNotIn("previousRankings", self.read(self.details / "101.json"))

    def test_normal_data_and_metadata_are_byte_identical(self):
        self.write(self.nav / "_manifest.json", {"generated": TODAY})
        before = self.snapshot()
        self.assertEqual(self.run_mode("--check"), 0)
        self.assertEqual(self.run_mode("--apply"), 0)
        self.assertEqual(before, self.snapshot())

    def test_future_and_malformed_dates_are_excluded_before_quality_checks(self):
        self.write(self.nav / "101.json", {"d": ["2026-09-29", TODAY, "2026-10-02", "bad"],
                                         "v": [100, 101, 99999, -1]})
        self.assertEqual(self.run_mode("--check"), 0)

    def test_invalid_values_and_order_are_not_sanitized_away(self):
        for values in ([100, 0], [100, -1], [100, True], [100, "101"], [100, float("inf")], [100, float("nan")]):
            with self.subTest(values=values):
                issues = quarantine.source_issues({"d": ["2026-09-29", TODAY], "v": values}, TODAY)
                self.assertEqual(issues[0]["reason"], "invalid_nav")
        for dates in ([TODAY, "2026-09-29"], [TODAY, TODAY]):
            issues = quarantine.source_issues({"d": dates, "v": [100, 101]}, TODAY)
            self.assertEqual(issues[0]["reason"], "unordered_or_duplicate_date")
        self.assertEqual(quarantine.source_issues({"d": [TODAY], "v": []}, TODAY),
                         [{"reason": "invalid_nav_shape"}])

    def test_non_index_nav_stale_detail_and_producer_are_also_cleared(self):
        self.make_jump(303)
        self.write(self.details / "303.json", {"analytics": {"rollingAlpha": ROLLING}})
        producer = self.read(self.producer)
        producer["303"] = SIGNALS
        self.write(self.producer, producer)
        self.assertEqual(self.run_mode("--check"), 1)
        self.assertEqual(self.run_mode("--apply"), 0)
        self.assertEqual(self.read(self.details / "303.json")["analytics"], {})
        self.assertEqual(self.read(self.producer)["303"], {})

    def test_existing_hold_is_not_released_by_clean_raw_source_alone(self):
        fund = self.funds[0]
        fund["dataQuality"] = {"status": "quarantined", "issues": [{"reason": "unverified_nav_jump", "date": TODAY}]}
        self.write(self.index, {"funds": self.funds})
        self.assertEqual(self.run_mode("--check"), 1)
        self.run_mode("--apply")
        self.assertEqual(self.read(self.index)["funds"][0]["dataQuality"], fund["dataQuality"])

    def test_sticky_holds_union_index_detail_before_clean_nav_cohorts(self):
        import compute_metrics as metrics
        import compute_rankings as rankings
        from nav_quality import sticky_nav_holds
        from contextlib import ExitStack, redirect_stdout
        import io
        start = date(2020, 1, 1)
        days = (date.fromisoformat(TODAY) - start).days
        points = [((start + timedelta(days=i)).isoformat(), 100 * 1.0002 ** i) for i in range(days + 1)]
        for surface in ("index", "detail"):
            with self.subTest(surface=surface):
                funds = [{"code": code, "category": "Liquid", "metrics": {}} for code in (101, 202)]
                hold = {"status": "quarantined", "issues": []}
                if surface == "index":
                    funds[0]["dataQuality"] = hold
                self.write(self.index, {"funds": funds})
                for code in (101, 202):
                    self.write(self.details / f"{code}.json", {"dataQuality": hold} if surface == "detail" and code == 101 else {})
                    self.write(self.nav / f"{code}.json", {"d": [d for d, _ in points], "v": [v for _, v in points]})
                before = self.snapshot()
                self.assertEqual(set(sticky_nav_holds(self.root)), {"101"})
                self.assertEqual(before, self.snapshot())
                with ExitStack() as stack:
                    stack.enter_context(patch.multiple(metrics, ROOT=str(self.root), FUNDS_JSON=str(self.index), NAV_DIR=str(self.nav)))
                    stack.enter_context(patch.object(metrics.sys, "argv", ["compute_metrics.py"]))
                    stack.enter_context(redirect_stdout(io.StringIO()))
                    metrics.main()
                result = self.read(self.index)
                rankings.recompute_rankings(result)
                held, healthy = result["funds"]
                self.assertEqual(held["dataQuality"], hold)
                self.assertEqual(held["metrics"], {})
                self.assertNotIn("si", held)
                for horizon in ("1Y", "3Y", "5Y"):
                    self.assertEqual(healthy["metrics"][horizon]["catRank"], 1)
                    self.assertEqual(healthy["metrics"][horizon]["catSize"], 1)
                    self.assertEqual(healthy["metrics"][horizon]["score"], 0.5)
                with patch.object(analytics, "ROOT", str(self.root)):
                    self.assertEqual([f["code"] for f in analytics.load_universe()], [202])
                with patch.multiple(category, ROOT=str(self.root), NAV_DIR=str(self.nav)):
                    with patch.object(category, "load_nav", wraps=category.load_nav) as reader:
                        category.build_category("Liquid", result["funds"])
                    self.assertEqual([c.args[0] for c in reader.call_args_list], [202])

    def test_missing_detail_and_malformed_json_fail_before_any_write(self):
        self.make_jump()
        (self.details / "101.json").unlink()
        before = self.snapshot()
        with self.assertRaises(ValueError):
            self.run_mode("--apply")
        self.assertEqual(before, self.snapshot())
        (self.details / "101.json").write_text("{broken", encoding="utf-8")
        before = self.snapshot()
        with self.assertRaises(json.JSONDecodeError):
            self.run_mode("--apply")
        self.assertEqual(before, self.snapshot())


class WindowContractTests(unittest.TestCase):
    def funds(self):
        return [{"code": code, "category": "Liquid", "metrics": {"1Y": {
            "cagr": 5, "windowStart": "2025-09-30", "windowEnd": "2026-09-30"}}}
                for code in (101, 202)]

    def test_same_category_horizon_requires_identical_dates(self):
        funds = self.funds()
        self.assertEqual(quarantine.window_issues(funds, TODAY), [])
        funds[1]["metrics"]["1Y"]["windowEnd"] = "2026-09-29"
        self.assertEqual(len(quarantine.window_issues(funds, TODAY)), 1)
        funds[1]["category"] = "Money Market"
        self.assertEqual(quarantine.window_issues(funds, TODAY), [])

    def test_missing_future_and_invalid_window_fail_closed(self):
        for start, end in ((None, None), ("bad", "2026-09-30"),
                           ("2025-09-30", "2026-10-02"), ("2026-09-30", "2026-09-30")):
            funds = self.funds()
            funds[0]["metrics"]["1Y"].update(windowStart=start, windowEnd=end)
            self.assertEqual(len(quarantine.window_issues(funds, TODAY)), 1)

    def test_unrankable_metrics_do_not_form_cohort(self):
        funds = self.funds()
        funds[0]["metrics"]["1Y"] = {"cagr": None}
        self.assertEqual(quarantine.window_issues(funds, TODAY), [])
        funds[0]["category"] = "Flexi Cap"
        funds[0]["metrics"]["1Y"] = {"cagr": 10}
        self.assertEqual(quarantine.window_issues(funds, TODAY), [])


@unittest.skipIf(importlib.util.find_spec("pandas") is None, "pandas not installed")
class DownstreamTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ff-downstream-", dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        start = date(2020, 1, 1)
        self.dates = [(start + timedelta(days=i)).isoformat() for i in range(1100)]
        self.values = [round(100 * 1.0002 ** i, 6) for i in range(1100)]
        for module in (analytics, category):
            patches = [patch.object(module, "NAV_DIR", str(self.base)), patch.object(module, "ist_today", return_value=TODAY)]
            for p in patches:
                p.start()
                self.addCleanup(p.stop)

    def write_nav(self, dates, values):
        (self.base / "101.json").write_text(json.dumps({"d": dates, "v": values}), encoding="utf-8")

    def test_intramonth_jump_rejected_before_resampling(self):
        values = list(self.values)
        values[10] *= 10
        self.write_nav(self.dates, values)
        self.assertIsNone(analytics.month_end_series(101))
        self.assertIsNone(category.load_nav(101))

    def test_normal_series_unchanged_by_future_tail(self):
        self.write_nav(self.dates, self.values)
        normal = analytics.month_end_series(101)
        self.assertIsNotNone(normal)
        self.write_nav(self.dates + ["2099-01-01"], self.values + [9999999])
        self.assertTrue(normal.equals(analytics.month_end_series(101)))
        self.assertEqual(category.load_nav(101), list(zip(self.dates, self.values)))

    def test_invalid_values_and_duplicate_dates_rejected_by_both_loaders(self):
        for dates, values in ((self.dates, [0] + self.values[1:]),
                              ([self.dates[1]] + self.dates[1:], self.values)):
            self.write_nav(dates, values)
            self.assertIsNone(analytics.month_end_series(101))
            self.assertIsNone(category.load_nav(101))

    def test_rolling_alpha_never_reinjects_held_index_and_excludes_held_cohorts(self):
        import build_rolling_alpha as rolling
        hold = {"status": "quarantined", "issues": []}
        index = self.base / "src/data/funds.json"
        index.parent.mkdir(parents=True)
        index.write_text(json.dumps({"funds": [
            {"code": 101, "category": "Liquid", "dataQuality": hold, "analytics": {"rollingAlpha": ROLLING}},
            {"code": 202, "category": "Liquid"},
        ]}))
        self.assertEqual(rolling.merge_into(str(index), {"101": ROLLING, "202": ROLLING}), 1)
        result = json.loads(index.read_text())["funds"]
        self.assertEqual(result[0]["analytics"], {})
        self.assertEqual(result[1]["analytics"]["rollingAlpha"], ROLLING)
        with patch.object(analytics, "ROOT", str(self.base)), patch.object(rolling, "month_end_series", return_value=None) as reader:
            self.assertEqual(rolling.compute_rolling_alpha(), {})
        self.assertEqual([c.args[0] for c in reader.call_args_list], [202])

    def test_rolling_alpha_prunes_stale_and_quarantined_details(self):
        import build_rolling_alpha as rolling
        for code in (101, 202, 303):
            detail = {"analytics": {**SIGNALS, "rollingAlpha": ROLLING}, "holdings": ["keep"]}
            if code == 303:
                detail["dataQuality"] = {"status": "quarantined"}
            (self.base / f"{code}.json").write_text(json.dumps(detail), encoding="utf-8")
        self.assertEqual(rolling.merge_into_details(str(self.base), {"202": ROLLING, "303": ROLLING}), 1)
        for code in (101, 303):
            detail = json.loads((self.base / f"{code}.json").read_text())
            self.assertEqual(detail["analytics"], SIGNALS)
            self.assertEqual(detail["holdings"], ["keep"])
        self.assertEqual(json.loads((self.base / "202.json").read_text())["analytics"]["rollingAlpha"], ROLLING)
        with patch.object(rolling, "load_universe", return_value=[{"code": 101}]), patch.object(rolling, "month_end_series", return_value=None):
            self.assertEqual(rolling.compute_rolling_alpha(), {})


if __name__ == "__main__":
    unittest.main()
