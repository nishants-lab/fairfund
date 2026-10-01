"""Full observed-window eligibility and ranking regressions."""
import contextlib
import importlib.util
import io
import json
from datetime import date, timedelta
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


metrics = load("dated_metrics", "pipeline/compute_metrics.py")
rankings = load("dated_rankings", "pipeline/compute_rankings.py")


def series(start="2019-01-01", end="2025-01-06", annual=0.12):
    first = date.fromisoformat(start)
    days = (date.fromisoformat(end) - first).days
    return [((first + timedelta(days=i)).isoformat(), 100 * (1 + annual) ** (i / 365.25))
            for i in range(days + 1)]


def fund(code, category="Liquid", values=None):
    return {"code": code, "category": category, "metrics": {"1Y": values or {"cagr": 6}}}


class DatedWindowTests(unittest.TestCase):
    def test_calendar_year_is_required_not_ninety_percent(self):
        for years in (1, 3, 5):
            with self.subTest(years=years):
                target = metrics.calendar_start("2025-01-06", years)
                late = (date.fromisoformat(target) + timedelta(days=1)).isoformat()
                self.assertIsNone(metrics.slice_nav(series(late), years))
                self.assertEqual(metrics.slice_nav(series(target), years)[0][0], target)

    def test_leap_anniversary_clamps_to_february_end(self):
        self.assertEqual(metrics.calendar_start("2024-02-29", 1), "2023-02-28")
        self.assertIsNotNone(metrics.slice_nav(series("2023-02-28", "2024-02-29"), 1))
        self.assertIsNone(metrics.slice_nav(series("2023-03-01", "2024-02-29"), 1))

    def test_holiday_uses_prior_observation_with_bounded_offset(self):
        points = series()
        target = "2024-01-06"
        without_target = [point for point in points if point[0] != target]
        self.assertEqual(metrics.slice_nav(without_target, 1)[0][0], "2024-01-05")
        gap = [p for p in points if not "2023-12-30" <= p[0] <= target]
        self.assertIsNone(metrics.slice_nav(gap, 1))

    def test_common_endpoints_exclude_new_stale_and_missing_start(self):
        points = series()
        histories = {1: points, 2: series(annual=0.08),
                     3: [p for p in points if p[0] != "2024-01-06"],
                     4: series(end="2024-12-01"), 5: series("2024-01-07"), 6: None}
        windows = metrics.category_windows([fund(c) for c in histories], histories)
        for code in (1, 2):
            m = windows[(code, "1Y")]
            self.assertEqual((m["windowStart"], m["windowEnd"]), ("2024-01-06", "2025-01-06"))
            self.assertEqual(m["targetStart"], "2024-01-06")
            self.assertEqual(m["targetHorizon"], "1Y")
            self.assertEqual(m["startOffsetDays"], 0)
        for code in (3, 4, 5, 6):
            self.assertNotIn((code, "1Y"), windows)
        self.assertEqual(windows[(1, "1Y")]["catMedianCagr"], 10)
        self.assertEqual(windows[(2, "1Y")]["catMedianCagr"], 10)

    def test_weekend_category_end_is_common_and_discloses_offsets(self):
        points = series()
        weekday = [p for p in points if date.fromisoformat(p[0]).weekday() < 5 and p[0] < "2025-01-06"]
        histories = {1: points, 2: weekday, 3: weekday}
        windows = metrics.category_windows([fund(c) for c in histories], histories)
        for code in histories:
            m = windows[(code, "1Y")]
            self.assertEqual(m["windowEnd"], "2025-01-03")
            self.assertEqual(m["endOffsetDays"], 3)
        self.assertEqual(len({windows[(c, "1Y")]["windowStart"] for c in histories}), 1)

    def test_robust_anchor_ignores_isolated_later_tail(self):
        histories = {code: series(end="2025-01-03") for code in range(metrics.MIN_ANCHOR_FUNDS)}
        histories[999] = series()
        self.assertEqual(metrics.observed_anchor(histories), "2025-01-03")
        self.assertIsNone(metrics.observed_anchor({1: None}))

    def test_end_selection_never_retreats_to_old_category(self):
        histories = {1: series(), 2: series(end="2024-12-01")}
        funds = [fund(1), fund(2, "Arbitrage")]
        windows = metrics.category_windows(funds, histories)
        self.assertIn((1, "1Y"), windows)
        self.assertNotIn((2, "1Y"), windows)

    def test_precomputation_slices_each_fund_at_most_once_per_horizon(self):
        histories = {code: series() for code in range(12)}
        with patch.object(metrics, "slice_nav", wraps=metrics.slice_nav) as slicer:
            windows = metrics.category_windows([fund(c) for c in histories], histories)
        self.assertEqual(len(windows), 36)
        self.assertEqual(slicer.call_count, 36)


    def run_producer(self, histories, failed=False, single=None, held=False):
        data = {"anchor": "2024-12-01", "funds": [fund(c, values={"cagr": 99, "score": 1, "catRank": 1}) for c in histories]}
        for f in data["funds"]:
            f.update(si={"cagr": 99}, analytics={"old": True}, dataQuality={"status": "quarantined", "issues": [{"reason": "unverified_nav_jump"}]} if held else {"status": "old"})
        with tempfile.TemporaryDirectory(dir=ROOT.parent, prefix="ff-dated-") as tmp:
            path = Path(tmp) / "funds.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            with contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(metrics, "FUNDS_JSON", str(path)))
                reader = stack.enter_context(patch.object(metrics, "load_nav", side_effect=histories.get))
                stack.enter_context(patch.object(metrics.sys, "argv", ["compute_metrics.py"] + (["--fund", str(single)] if single else [])))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                if failed:
                    stack.enter_context(patch.object(metrics, "compute_metrics", return_value=None))
                metrics.main()
                self.assertEqual(reader.call_count, len(histories))
            return json.loads(path.read_text(encoding="utf-8"))

    def test_full_recompute_stamps_validated_anchor_and_clears_it_without_nav(self):
        result = self.run_producer({1: series(), 2: None})
        self.assertEqual(result["anchor"], "2025-01-06")
        self.assertIsNone(self.run_producer({1: None})["anchor"])

    def test_single_fund_updates_category_peers_and_preserves_global_anchor(self):
        result = self.run_producer({1: series(), 2: series()}, single=1)
        self.assertEqual(result["anchor"], "2024-12-01")
        for f in result["funds"]:
            self.assertEqual(f["metrics"]["1Y"]["windowEnd"], "2025-01-06")
            self.assertNotIn("score", f["metrics"]["1Y"])

    def test_unavailable_and_new_histories_clear_stale_metrics_but_remain_browsable(self):
        result = self.run_producer({1: series(), 2: None, 3: series("2024-12-01")})["funds"]
        self.assertNotIn("score", result[0]["metrics"]["1Y"])
        self.assertEqual(result[1]["metrics"], {})
        self.assertNotIn("si", result[1])
        self.assertEqual(result[2]["metrics"], {})
        self.assertIn("si", result[2])
        self.assertTrue(result[2]["isYoung"])
        self.assertTrue(all("dataQuality" not in f for f in result))

    def test_missing_source_does_not_release_existing_quarantine(self):
        result = self.run_producer({1: None}, held=True)["funds"][0]
        self.assertEqual(result["dataQuality"]["status"], "quarantined")
        self.assertNotIn("analytics", result)

    def test_failed_metric_calculation_cannot_retain_old_rank(self):
        result = self.run_producer({1: series()}, failed=True)["funds"][0]
        self.assertEqual(result["metrics"], {})
        self.assertIn("si", result)

    def test_quarantine_preserves_source_and_clears_derived_data(self):
        raw = json.dumps({"d": ["2024-01-01", "2024-01-02"], "v": [100, 1000]})
        with tempfile.TemporaryDirectory(dir=ROOT.parent, prefix="ff-quality-") as tmp:
            path = Path(tmp) / "9.json"
            path.write_text(raw, encoding="utf-8")
            with patch.object(metrics, "NAV_DIR", tmp):
                self.assertIsNone(metrics.load_nav(9))
            self.assertEqual(path.read_text(encoding="utf-8"), raw)
        try:
            result = self.run_producer({9: None})["funds"][0]
            self.assertEqual(result["dataQuality"]["status"], "quarantined")
            self.assertEqual(result["metrics"], {})
            self.assertNotIn("si", result)
            self.assertNotIn("analytics", result)
        finally:
            metrics.NAV_QUALITY_BY_CODE.clear()

    def test_invalid_and_unordered_usable_points_quarantine_without_repair(self):
        payloads = [(["2024-01-01", "2024-01-02"], [100, None]),
                    (["2024-01-02", "2024-01-01"], [100, 101]),
                    (["2024-01-01", "2024-01-01"], [100, 101])]
        with tempfile.TemporaryDirectory(dir=ROOT.parent, prefix="ff-invalid-") as tmp:
            with patch.object(metrics, "NAV_DIR", tmp):
                for days, values in payloads:
                    Path(tmp, "8.json").write_text(json.dumps({"d": days, "v": values}))
                    self.assertIsNone(metrics.load_nav(8))
                    self.assertTrue(metrics.NAV_QUALITY_BY_CODE[8])
        metrics.NAV_QUALITY_BY_CODE.clear()

    def test_direct_metrics_reject_anomalous_series(self):
        points = series()
        points[-1] = (points[-1][0], points[-1][1] * 10)
        self.assertIsNone(metrics.compute_metrics(points))


class RankingEligibilityTests(unittest.TestCase):
    def test_cash_categories_need_only_finite_cagr_and_ties_use_code(self):
        for category in ("Liquid", "Money Market", "Arbitrage"):
            with self.subTest(category=category):
                data = {"funds": [fund(20, category), fund(3, category),
                                  fund(2, category, {"cagr": None, "score": 1, "catRank": 1})]}
                rankings.recompute_rankings(data)
                self.assertEqual([f["metrics"]["1Y"].get("catRank") for f in data["funds"]], [2, 1, None])
                self.assertNotIn("score", data["funds"][2]["metrics"]["1Y"])

    def test_singleton_has_neutral_score(self):
        data = {"funds": [fund(1)]}
        changes = rankings.recompute_rankings(data)
        self.assertEqual(data["funds"][0]["metrics"]["1Y"]["score"], 0.5)
        self.assertEqual(changes["funds_ranked"], 1)

    def test_invalid_metadata_is_neutral(self):
        for value in (None, "invalid", "NaN", float("inf"), -1, True):
            f = fund(1)
            f.update(expenseRatio=value, aum={"current": value})
            self.assertAlmostEqual(rankings.debt_score(f, {"cagr": 6}, [0.1, 0.2], [100, 200], [5, 6, 7]), 0.5)
        self.assertEqual(rankings.ter_of({"expenseRatio": "0.1"}), 0.1)
        self.assertEqual(rankings.ter_of({"expenseRatio": 0}), 0)
        self.assertIsNone(rankings.aum_of({"aum": {"current": 0}}))

    def test_equity_missing_sortino_keeps_metrics_without_rank(self):
        values = {key: 1 for key in rankings.SCORE_METRICS}
        values.update(sortino=None, catRank=1, catSize=1, score=1, catMedianCagr=42)
        data = {"funds": [fund(1, "Large Cap", values)]}
        rankings.recompute_rankings(data)
        m = data["funds"][0]["metrics"]["1Y"]
        self.assertIsNone(m["sortino"])
        self.assertEqual(m["cagr"], 1)
        self.assertEqual(m["catMedianCagr"], 42)
        for key in ("catRank", "catSize", "score"):
            self.assertNotIn(key, m)

    def test_rankings_never_overwrite_alpha_cohort_median(self):
        values = {key: 1 for key in rankings.SCORE_METRICS}
        values["catMedianCagr"] = 42
        f = fund(1, "Large Cap")
        f["metrics"] = {"3Y": values}
        data = {"funds": [f], "categories": {"Large Cap": {}}}
        rankings.recompute_rankings(data)
        self.assertEqual(values["catMedianCagr"], 42)

    def test_nonfinite_cagr_is_unranked_and_empty_category_stats_clear(self):
        data = {"funds": [fund(1, values={"cagr": float("nan"), "catRank": 1})],
                "categories": {"Liquid": {"medianCagr5Y": 99, "topCagr5Y": 99}}}
        rankings.recompute_rankings(data)
        rankings.update_category_metadata(data)
        self.assertNotIn("catRank", data["funds"][0]["metrics"]["1Y"])
        self.assertEqual(data["categories"]["Liquid"], {"fundCount": 1})

    def test_ranking_preserves_metric_snapshot_anchor_even_without_usable_nav(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent, prefix="ff-rank-anchor-") as tmp:
            path = Path(tmp) / "funds.json"
            for anchor in ("2025-01-06", None):
                path.write_text(json.dumps({"anchor": anchor, "funds": [fund(1)]}))
                with contextlib.ExitStack() as stack:
                    stack.enter_context(patch.object(rankings, "FUNDS_JSON", str(path)))
                    stack.enter_context(patch.object(rankings.sys, "argv", ["compute_rankings.py"]))
                    stack.enter_context(patch.object(rankings, "ist_today", return_value="2025-01-07"))
                    stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                    rankings.main()
                result = json.loads(path.read_text())
                self.assertEqual(result["anchor"], anchor)
                self.assertEqual(result["generatedAt"], "2025-01-07")

    def test_null_horizon_is_unavailable(self):
        f = fund(1)
        f["metrics"] = {"1Y": None}
        self.assertEqual(rankings.recompute_rankings({"funds": [f]})["funds_ranked"], 0)


if __name__ == "__main__":
    unittest.main()
