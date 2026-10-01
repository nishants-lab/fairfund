"""Alternate refresh entrypoints use the publication contract without real fetches."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("refresh_orchestrator", ROOT / "pipeline/refresh.py")
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)

STEPS = [
    ("compute_metrics.py", []), ("compute_rankings.py", []),
    ("build_analytics.py", []), ("split_funds.py", []),
    ("quarantine_nav.py", ["--apply"]), ("sync_analytics_to_shells.py", []),
    ("build_rolling_alpha.py", []), ("build_category_median.py", []),
    ("quarantine_nav.py", ["--check"]), ("sync_analytics_to_shells.py", ["--check"]),
    ("smoke.py", []),
]


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ff-refresh-", dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.path = self.base / "funds.json"
        self.original = {"funds": [{"code": 101, "metrics": {"old": True}}], "anchor": "2026-09-29"}
        self.path.write_text(json.dumps(self.original), encoding="utf-8")
        paths = patch.multiple(refresh, DATA_DIR=self.base, NAV_DIR=self.base)
        paths.start()
        self.addCleanup(paths.stop)

    def commands(self, mock):
        return [(Path(call.args[0][1]).name, call.args[0][2:]) for call in mock.call_args_list]

    def test_all_derived_steps_are_ordered_and_required(self):
        with patch.object(refresh.subprocess, "run") as run:
            refresh.rebuild_derived()
        self.assertEqual(self.commands(run), STEPS)
        for call in run.call_args_list:
            self.assertTrue(call.kwargs["check"])
            self.assertEqual(call.kwargs["cwd"], str(refresh.ROOT))

    def test_failure_stops_every_later_step(self):
        calls = []
        def execute(command, **kwargs):
            calls.append(Path(command[1]).name)
            if calls[-1] == "build_analytics.py":
                raise subprocess.CalledProcessError(7, command)
        before = self.path.read_bytes()
        with patch.object(refresh.subprocess, "run", side_effect=execute):
            with self.assertRaises(subprocess.CalledProcessError):
                refresh.main(["--analytics-only"])
        self.assertEqual(calls, ["detect_regimes.py", "compute_metrics.py", "compute_rankings.py", "build_analytics.py"])
        self.assertEqual(self.path.read_bytes(), before)

    def test_main_never_rewrites_the_pre_run_index_or_validated_dates(self):
        produced = {"funds": [{"code": 101, "metrics": {"new": True}}, {"code": 202}],
                    "anchor": "2026-09-30", "generatedAt": "2026-10-01"}
        def execute(command, **kwargs):
            if Path(command[1]).name == "compute_metrics.py":
                self.path.write_text(json.dumps(produced), encoding="utf-8")
        with patch.object(refresh.subprocess, "run", side_effect=execute):
            refresh.main([])
        self.assertEqual(json.loads(self.path.read_text()), produced)

    def test_analytics_only_rebuilds_dependencies_without_nav_fetch(self):
        with patch.object(refresh.subprocess, "run") as run:
            refresh.main(["--analytics-only"])
        self.assertEqual(self.commands(run), [("detect_regimes.py", [])] + STEPS)

    def test_monthly_and_holdings_enrich_before_rank(self):
        for args in (["--monthly"], ["--holdings-only"]):
            with self.subTest(args=args), patch.object(refresh.subprocess, "run") as run:
                refresh.main(args)
            names = [name for name, _ in self.commands(run)]
            self.assertLess(names.index("capture_holdings_snapshot.py"), names.index("enrich_fund_data.py"))
            self.assertLess(names.index("enrich_fund_data.py"), names.index("compute_rankings.py"))
            self.assertEqual(self.commands(run)[-len(STEPS):], STEPS)

    def test_add_fund_runs_guarded_rebuild_after_mocked_source_fetch(self):
        source = SimpleNamespace(fetch_nav_history=lambda code: (["2026-09-30"], [100]),
                                 map_amfi_category=lambda category: "Liquid",
                                 fetch_amfi_universe=lambda: {101: {"amfi_category": "Liquid"}})
        with patch.dict(sys.modules, {"discover_new_funds": source}), patch.object(refresh.subprocess, "run") as run:
            refresh.main(["--add-fund", "101"])
        self.assertEqual(self.commands(run), STEPS)
        self.assertEqual(json.loads((self.base / "101.json").read_text())["v"], [100])


if __name__ == "__main__":
    unittest.main()
