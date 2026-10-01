"""Production-code regressions for actual-duration CAGR and peer-alpha parity.

Run: python -m unittest discover -s tests -p test_metric_reconciliation.py -v
No network and no generated fund artifacts are written.
"""
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
spec = importlib.util.spec_from_file_location("fairfund_metrics", ROOT / "pipeline/compute_metrics.py")
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)


def series(start, days, annual_return):
    first = date.fromisoformat(start)
    return [((first + timedelta(days=i)).isoformat(), 100 * (1 + annual_return) ** (i / 365.25))
            for i in range(days + 1)]


class MetricReconciliationTests(unittest.TestCase):
    def test_alpha_uses_same_actual_duration_as_displayed_cagr(self):
        points = series("2021-04-01", 1650, 0.24)
        displayed = metrics.compute_metrics(points)["cagr"]
        alpha, median = metrics.compute_alpha(points, [8, 12, 16], 5)
        self.assertAlmostEqual(alpha, displayed - median, places=2)
        self.assertEqual(alpha, 12.0)

    def test_changing_nominal_label_cannot_change_alpha_for_identical_points(self):
        points = series("2021-04-01", 1650, 0.24)
        self.assertEqual(metrics.compute_alpha(points, [10, 14], 3),
                         metrics.compute_alpha(points, [10, 14], 5))

    def test_peer_median_is_same_for_every_fund_in_category(self):
        histories = {1: series("2020-04-01", 2000, 0.24),
                     2: series("2020-04-01", 2000, 0.12),
                     3: series("2020-04-01", 2000, 0.08)}
        data = {"funds": [{"code": code, "category": "Synthetic", "metrics": {}} for code in histories]}
        with tempfile.TemporaryDirectory(prefix="ff-metrics-", dir=ROOT.parent) as tmp:
            path = Path(tmp) / "funds.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            with patch.object(metrics, "FUNDS_JSON", str(path)), \
                 patch.object(metrics, "load_nav", side_effect=histories.get) as nav_reader, \
                 patch.object(metrics.sys, "argv", ["compute_metrics.py"]), \
                 contextlib.redirect_stdout(io.StringIO()):
                metrics.main()
                self.assertEqual(nav_reader.call_count, len(histories))
            result = json.loads(path.read_text(encoding="utf-8"))
        windows = [fund["metrics"]["5Y"] for fund in result["funds"]]
        self.assertEqual([m["catMedianCagr"] for m in windows], [12.0, 12.0, 12.0])
        for window in windows:
            self.assertLessEqual(abs(window["alpha"] - (window["cagr"] - window["catMedianCagr"])), 0.011)

    def test_missing_peers_has_no_alpha(self):
        self.assertEqual(metrics.compute_alpha(series("2021-04-01", 1650, 0.24), [], 5), (None, None))

    def test_actual_duration_handles_invalid_endpoints(self):
        for points in ([], [("2021-01-01", 100)],
                       [("2021-01-01", 100), ("2021-01-01", 110)],
                       [("2021-01-01", 0), ("2022-01-01", 110)],
                       [("2021-01-01", 100), ("2022-01-01", -1)]):
            with self.subTest(points=points):
                self.assertIsNone(metrics.actual_duration_cagr(points))

    def test_actual_duration_uses_calendar_day_count_across_leap_day(self):
        points = [("2024-02-28", 100), ("2025-02-28", 110)]
        self.assertAlmostEqual(metrics.actual_duration_cagr(points), (1.1 ** (365.25 / 366) - 1) * 100)

    def test_empty_history_has_no_alpha(self):
        self.assertEqual(metrics.compute_alpha([], [12], 5), (None, None))


if __name__ == "__main__":
    unittest.main()
