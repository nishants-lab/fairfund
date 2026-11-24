"""The monthly holdings capture must keep running until fund houses' portfolios are in,
and must say so when it falls behind (24 Nov 2026: 433 of 940 October portfolios)."""
import importlib.util
import io
import re
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


capture = load("capture_holdings_snapshot", "scripts/capture_holdings_snapshot.py")
daily = load("update_nav_daily", "scripts/update_nav_daily.py")


class PreviousMonth(unittest.TestCase):
    def test_previous_month(self):
        self.assertEqual(capture.previous_month("2026-11-24"), "2026-10")
        self.assertEqual(capture.previous_month("2027-01-06"), "2026-12")


class CoverageWarnings(unittest.TestCase):
    def test_late_month_stall_is_reported(self):
        out = capture.coverage_warnings("2026-11-24", 0, 0, 940, 433, 940)
        self.assertEqual(len(out), 1)
        self.assertIn("Only 433 of 940 funds have their 2026-10 portfolio on day 24", out[0])

    def test_complete_month_is_quiet_even_with_nothing_new(self):
        self.assertEqual(capture.coverage_warnings("2026-11-24", 0, 0, 940, 930, 940), [])

    def test_early_month_zero_new_is_reported(self):
        out = capture.coverage_warnings("2026-11-08", 0, 3, 940, 0, 940)
        self.assertEqual(len(out), 1)
        self.assertIn("0 new snapshots", out[0])

    def test_mid_month_partial_with_new_data_is_quiet(self):
        self.assertEqual(capture.coverage_warnings("2026-11-12", 200, 0, 940, 433, 940), [])

    def test_mass_fetch_failure_is_reported(self):
        out = capture.coverage_warnings("2026-11-12", 10, 600, 940, 433, 940)
        self.assertTrue(any("Over 50% of fund fetches failed" in m for m in out))


class Schedule(unittest.TestCase):
    def test_monthly_capture_runs_every_day_from_the_6th_to_month_end(self):
        wf = (ROOT / ".github/workflows/refresh-data.yml").read_text(encoding="utf-8")
        crons = re.findall(r'cron:\s*"([^"]+)"', wf)
        monthly = [c for c in crons if c.split()[2] != "*"]
        self.assertEqual(len(monthly), 1, crons)
        days_field = monthly[0].split()[2]
        days = set()
        for part in days_field.split(","):
            lo, _, hi = part.partition("-")
            days.update(range(int(lo), int(hi or lo) + 1))
        self.assertTrue(set(range(6, 32)) <= days, f"monthly capture skips days: {sorted(set(range(6, 32)) - days)}")
        # The job condition must name the same cron, or the schedule fires and the job skips.
        self.assertIn(f"github.event.schedule == '{monthly[0]}'", wf)


class AmfiRetry(unittest.TestCase):
    def test_connection_reset_is_retried(self):
        calls = []

        class Body(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def urlopen(req, timeout):
            calls.append(1)
            if len(calls) < 3:
                raise urllib.error.URLError(ConnectionResetError(104, "Connection reset by peer"))
            return Body(b"Scheme Code;x\n")

        with patch.object(daily.urllib.request, "urlopen", urlopen):
            text = daily.read_amfi_text(sleep=lambda s: None)
        self.assertEqual(text, "Scheme Code;x\n")
        self.assertEqual(len(calls), 3)

    def test_persistent_failure_still_fails_the_run(self):
        def urlopen(req, timeout):
            raise urllib.error.URLError(ConnectionResetError(104, "reset"))

        with patch.object(daily.urllib.request, "urlopen", urlopen):
            with self.assertRaises(urllib.error.URLError):
                daily.read_amfi_text(attempts=3, sleep=lambda s: None)


if __name__ == "__main__":
    unittest.main()
