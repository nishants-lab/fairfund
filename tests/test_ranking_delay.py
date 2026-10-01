"""Bounded category publication delays and historical ranking isolation."""
import contextlib
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_dated_windows import fund, metrics, rankings, series

ROOT = Path(__file__).resolve().parents[1]


def weekdays(start="2019-01-01", end="2025-01-10"):
    from datetime import date
    return [point for point in series(start, end)
            if date.fromisoformat(point[0]).weekday() < 5]


def ranked(end="2025-01-06", horizon="1Y"):
    target = metrics.calendar_start(end, metrics.HORIZONS[horizon])
    return {"cagr": 12, "sharpe": 1, "sortino": 1.2, "calmar": 1,
            "maxDrawdown": -10, "alpha": 2, "volatility": 14,
            "catRank": 2, "catSize": 10, "score": 0.7,
            "windowStart": target, "windowEnd": end, "targetStart": target,
            "targetHorizon": horizon, "startOffsetDays": 0, "endOffsetDays": 0}


class CategoryDelayTests(unittest.TestCase):
    def windows(self, histories, funds=None):
        return metrics.category_windows(funds or [fund(code) for code in histories], histories)

    def test_pp_like_recent_lag_uses_common_end_for_every_horizon(self):
        histories = {1: weekdays(), 2: weekdays(), 122639: weekdays(end="2025-01-08")}
        windows = self.windows(histories)
        self.assertEqual(len(windows), 9)
        self.assertEqual({value["windowEnd"] for value in windows.values()}, {"2025-01-08"})
        for horizon in metrics.HORIZONS:
            self.assertEqual(len({windows[(code, horizon)]["windowStart"] for code in histories}), 1)
            self.assertEqual(windows[(122639, horizon)]["endOffsetDays"], 2)

    def test_exactly_three_published_dates_allowed_four_excluded(self):
        for end, included in (("2025-01-07", True), ("2025-01-06", False)):
            with self.subTest(end=end):
                windows = self.windows({1: weekdays(), 2: weekdays(), 3: weekdays(end=end)})
                self.assertEqual((3, "1Y") in windows, included)
                self.assertEqual(windows[(1, "1Y")]["windowEnd"], end if included else "2025-01-10")

    def test_weekend_and_singleton_weekend_observation_do_not_consume_allowance(self):
        histories = {1: weekdays(end="2025-01-13"), 2: weekdays(end="2025-01-13"),
                     3: weekdays(end="2025-01-08"), 4: series(end="2025-01-13")}
        windows = self.windows(histories)
        self.assertEqual({m["windowEnd"] for m in windows.values()}, {"2025-01-08"})
        self.assertIn((3, "5Y"), windows)

    def test_published_weekday_gaps_count_but_shared_holidays_do_not(self):
        histories = {1: weekdays(end="2025-01-13"), 2: weekdays(end="2025-01-13"),
                     3: weekdays(end="2025-01-07")}
        self.assertNotIn((3, "1Y"), self.windows(histories))
        histories = {code: [p for p in points if p[0] != "2025-01-09"]
                     for code, points in histories.items()}
        windows = self.windows(histories)
        self.assertIn((3, "1Y"), windows)
        self.assertEqual(windows[(1, "1Y")]["windowEnd"], "2025-01-07")

    def test_stale_outlier_cannot_pull_category_back(self):
        windows = self.windows({1: weekdays(), 2: weekdays(), 3: weekdays(end="2024-12-20")})
        self.assertNotIn((3, "1Y"), windows)
        self.assertEqual(windows[(1, "5Y")]["windowEnd"], "2025-01-10")

    def test_all_old_category_is_excluded_against_global_snapshot(self):
        histories = {1: weekdays(), 2: weekdays(end="2024-12-20"), 3: weekdays(end="2024-12-20")}
        windows = self.windows(histories, [fund(1, "Other"), fund(2), fund(3)])
        self.assertEqual({code for code, _ in windows}, {1})

    def test_old_whole_snapshot_keeps_honest_observed_date(self):
        histories = {1: weekdays(end="2024-12-20"), 2: weekdays(end="2024-12-20")}
        windows = self.windows(histories)
        self.assertEqual({m["windowEnd"] for m in windows.values()}, {"2024-12-20"})

    def test_different_history_lengths_share_end_without_short_fund_constraint(self):
        histories = {1: weekdays(), 2: weekdays("2023-01-01"),
                     3: weekdays("2024-12-01", "2025-01-07")}
        windows = self.windows(histories)
        self.assertEqual(windows[(1, "5Y")]["windowEnd"], "2025-01-10")
        self.assertEqual(windows[(2, "1Y")]["windowEnd"], "2025-01-10")
        self.assertNotIn((2, "3Y"), windows)
        self.assertNotIn((3, "1Y"), windows)
        self.assertEqual(self.windows({3: histories[3]}), {})

    def test_many_short_histories_cannot_move_robust_category_date(self):
        histories = {1: weekdays(), 2: weekdays()}
        histories.update({code: weekdays("2024-12-01", "2025-01-07") for code in range(3, 12)})
        windows = self.windows(histories)
        self.assertEqual({m["windowEnd"] for m in windows.values()}, {"2025-01-10"})
        self.assertEqual({code for code, _ in windows}, {1, 2})

    def test_missing_intersection_uses_largest_cohort_then_newest(self):
        histories = {1: weekdays(), 2: weekdays(), 3: weekdays(), 4: weekdays()}
        gaps = {2: {"2025-01-10", "2025-01-08"},
                3: {"2025-01-09", "2025-01-07"}}
        for code, missing in gaps.items():
            histories[code] = [p for p in histories[code] if p[0] not in missing]
        windows = self.windows(histories)
        self.assertEqual({m["windowEnd"] for m in windows.values()}, {"2025-01-10"})
        self.assertEqual({code for code, _ in windows}, {1, 3, 4})
        self.assertEqual(windows, self.windows(dict(reversed(list(histories.items())))))

    def test_common_endpoint_older_than_allowance_never_used(self):
        histories = {1: weekdays(), 2: weekdays(), 3: weekdays(), 4: weekdays()}
        histories[4] = [p for p in histories[4] if p[0] <= "2025-01-06" or p[0] == "2025-01-09"]
        windows = self.windows(histories)
        self.assertEqual(windows[(1, "1Y")]["windowEnd"], "2025-01-09")
        histories[4] = [p for p in histories[4] if p[0] != "2025-01-09"]
        windows = self.windows(histories)
        self.assertEqual(windows[(1, "1Y")]["windowEnd"], "2025-01-10")
        self.assertNotIn((4, "1Y"), windows)


class PreviousRankingTests(unittest.TestCase):
    def refresh(self, data, histories, holds=None):
        with tempfile.TemporaryDirectory(dir=ROOT.parent, prefix="ff-delay-") as tmp:
            path = Path(tmp) / "funds.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            with contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(metrics, "FUNDS_JSON", str(path)))
                stack.enter_context(patch.object(metrics, "load_nav", side_effect=histories.get))
                stack.enter_context(patch.object(metrics, "sticky_nav_holds", return_value=holds or {}))
                stack.enter_context(patch.object(metrics.sys, "argv", ["compute_metrics.py"]))
                stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
                metrics.main()
            result = json.loads(path.read_text(encoding="utf-8"))
        rankings.recompute_rankings(result)
        return result

    def test_first_stale_transition_saves_before_clearing_repeat_retains_then_recovers(self):
        historical = ranked()
        data = {"funds": [fund(1), fund(2), fund(3, values=historical)]}
        histories = {1: weekdays(), 2: weekdays(), 3: weekdays(end="2025-01-06")}
        first = self.refresh(data, histories)
        excluded = first["funds"][2]
        self.assertEqual(excluded["metrics"], {})
        self.assertEqual(excluded["previousRankings"], {"1Y": historical})
        self.assertEqual(first["funds"][0]["metrics"]["1Y"]["catSize"], 2)
        repeated = self.refresh(first, histories)
        self.assertEqual(repeated["funds"][2]["previousRankings"], excluded["previousRankings"])
        histories[3] = weekdays()
        recovered = self.refresh(repeated, histories)["funds"][2]
        self.assertNotIn("previousRankings", recovered)
        self.assertIn("catRank", recovered["metrics"]["1Y"])

    def test_missing_source_preserves_prior_dated_rank(self):
        data = {"funds": [fund(1, values=ranked())]}
        result = self.refresh(data, {1: None})["funds"][0]
        self.assertEqual(result["metrics"], {})
        self.assertEqual(result["previousRankings"], {"1Y": ranked()})

    def test_historical_rank_does_not_enter_ranking_or_category_stats(self):
        stale = fund(1)
        stale.update(metrics={}, previousRankings={"5Y": ranked(horizon="5Y")})
        data = {"funds": [stale, fund(2)], "categories": {"Liquid": {}}}
        rankings.recompute_rankings(data)
        rankings.update_category_metadata(data)
        self.assertEqual(stale["metrics"], {})
        self.assertEqual(stale["previousRankings"]["5Y"]["catRank"], 2)
        self.assertEqual(data["funds"][1]["metrics"]["1Y"]["catSize"], 1)
        self.assertNotIn("medianCagr5Y", data["categories"]["Liquid"])

    def test_retention_is_bounded_and_keeps_most_recent_valid_existing_snapshot(self):
        f = fund(1, values=ranked("2025-01-03"))
        f["previousRankings"] = {"1Y": ranked(), "10Y": ranked()}
        rankings.retain_previous_rankings(f, {})
        self.assertEqual(f["previousRankings"], {"1Y": ranked()})
        f["metrics"]["1Y"] = ranked("2025-01-10")
        rankings.retain_previous_rankings(f, {})
        self.assertEqual(f["previousRankings"]["1Y"]["windowEnd"], "2025-01-10")

    def test_undated_invalid_unranked_or_partial_rank_never_becomes_history(self):
        invalid = [{}, {"cagr": 12}, {**ranked(), "windowStart": "bad"},
                   {**ranked(), "windowEnd": "2999-01-01"},
                   {**ranked(), "windowStart": "2024-02-01"},
                   {**ranked(), "windowStart": "2023-01-01"},
                   {**ranked(), "catRank": True}, {**ranked(), "catRank": 11},
                   {**ranked(), "catSize": None}, {**ranked(), "score": float("nan")},
                   {**ranked(), "cagr": float("inf")}, {**ranked(), "targetHorizon": "3Y"},
                   {key: value for key, value in ranked().items() if key not in ("catRank", "catSize", "score")}]
        for old in invalid:
            with self.subTest(old=old):
                f = fund(1, values=old)
                f["previousRankings"] = {"1Y": old, "10Y": ranked()}
                rankings.retain_previous_rankings(f, {})
                self.assertNotIn("previousRankings", f)

    def test_equity_history_requires_the_actual_rankable_metric_set(self):
        f = fund(1, "Flexi Cap", ranked())
        f["metrics"]["1Y"]["sortino"] = None
        rankings.retain_previous_rankings(f, {})
        self.assertNotIn("previousRankings", f)

    def test_hold_clears_current_and_previous_in_both_producers(self):
        hold = {"status": "quarantined", "issues": []}
        for surface in ("index", "detail"):
            f = fund(1, values=ranked())
            f["previousRankings"] = {"3Y": ranked(horizon="3Y")}
            if surface == "index":
                f["dataQuality"] = hold
            result = self.refresh({"funds": [f]}, {1: weekdays()}, {"1": hold})["funds"][0]
            self.assertEqual(result["metrics"], {})
            self.assertNotIn("previousRankings", result)
        f = fund(1, values=ranked())
        f.update(dataQuality=hold, previousRankings={"1Y": ranked()})
        rankings.recompute_rankings({"funds": [f]})
        self.assertEqual(f["metrics"], {})
        self.assertNotIn("previousRankings", f)

    def test_new_quality_failure_suppresses_old_rank_and_raw_history_unchanged(self):
        histories = {1: weekdays(), 2: None}
        raw_before = deepcopy(histories)
        try:
            metrics.NAV_QUALITY_BY_CODE[2] = [{"reason": "invalid_nav"}]
            data = {"funds": [fund(1), fund(2, values=ranked())]}
            result = self.refresh(data, histories)["funds"][1]
            self.assertNotIn("previousRankings", result)
            self.assertEqual(result["metrics"], {})
            self.assertEqual(histories, raw_before)
        finally:
            metrics.NAV_QUALITY_BY_CODE.clear()


if __name__ == "__main__":
    unittest.main()

