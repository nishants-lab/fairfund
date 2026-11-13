"""SEBI risk ingestion and workflow contracts, with no live network or data pins."""
import contextlib
from copy import deepcopy
from datetime import date, timedelta
from functools import partial
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import fetch_sebi_risk as R
from groww_identity import fetch_scheme_verified


class RiskTests(unittest.TestCase):
    TODAY = date(2026, 5, 10)

    def run_refresh(self, funds, response=None, slugs=None, **kwargs):
        if response is None:
            response = {"scheme_code": 1, "return_stats": [{"risk": "High"}]}
        fetch = partial(fetch_scheme_verified, get=lambda slug: ("ok", response))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            counts = R.refresh(funds, slugs if slugs is not None else {"1": "fund"},
                               self.TODAY, fetch=fetch, throttle=lambda _: None, **kwargs)
        return counts, output.getvalue()

    def test_all_six_canonical_levels_and_whitespace_case(self):
        levels = ("Low", "Low to Moderate", "Moderate", "Moderately High", "High", "Very High")
        for level in levels:
            with self.subTest(level=level):
                self.assertEqual(R.normalize_risk(" \t" + level.upper().replace(" ", "  \n") + " "), level)
        for bad in (None, 3, [], {}, "", "Medium", "Very High Risk", "Moderately Low"):
            self.assertIsNone(R.normalize_risk(bad))

    def test_first_return_stat_is_the_only_source(self):
        funds = [{"code": 1}]
        counts, log = self.run_refresh(funds, {"scheme_code": 1, "risk": "Low", "return_stats": [{"risk": "  VERY  HIGH "}, {"risk": "Low"}]})
        self.assertEqual(funds[0]["sebiRisk"], "Very High")
        self.assertEqual(funds[0]["sebiRiskAsOf"], self.TODAY.isoformat())
        self.assertEqual(counts, dict(filled=1, changed=0, unchanged=0, failed=0))
        self.assertIn("Groww raw=", log)

    def test_identity_mismatch_or_absent_identity_never_changes_old_value(self):
        for identity in ({"scheme_code": 2}, {}, {"direct_scheme_code": 1}):
            old = {"code": 1, "sebiRisk": "Low", "sebiRiskAsOf": "2020-01-01"}
            funds = [deepcopy(old)]
            counts, log = self.run_refresh(funds, dict(identity, return_stats=[{"risk": "High"}]))
            self.assertEqual(funds, [old])
            self.assertEqual(counts["failed"], 1)
            self.assertIn("identity_mismatch", log)

    def test_unknown_missing_or_malformed_risk_preserves_old_value_and_date(self):
        for stats in (None, [], {}, "bad", [None], [{}], [{"risk": "Medium"}], [{"risk": ""}, {"risk": "High"}]):
            old = {"code": 1, "sebiRisk": "Low", "sebiRiskAsOf": "2020-01-01"}
            funds = [deepcopy(old)]
            counts, log = self.run_refresh(funds, {"scheme_code": 1, "return_stats": stats})
            self.assertEqual(funds, [old])
            self.assertEqual(counts["failed"], 1)
            self.assertIn("::warning::", log)

    def test_changed_and_unchanged_values_refresh_observation_date(self):
        for old_risk, outcome in (("Low", "changed"), ("High", "unchanged")):
            funds = [{"code": 1, "sebiRisk": old_risk, "sebiRiskAsOf": "2020-01-01"}]
            counts, log = self.run_refresh(funds)
            if outcome == "changed":
                self.assertIn(f"::warning::SEBI risk 1 : {old_risk!r} -> {R.LEVELS[4]!r}", log)
            else:
                self.assertNotIn("::warning::", log)
            self.assertEqual(counts[outcome], 1)
            self.assertEqual(funds[0]["sebiRisk"], "High")
            self.assertEqual(funds[0]["sebiRiskAsOf"], self.TODAY.isoformat())

    def test_renamed_verified_scheme_is_accepted(self):
        get = lambda slug: ("redirect", "new") if slug == "old" else ("ok", {"scheme_code": 1, "return_stats": [{"risk": "Moderately High"}]})
        level, raw, reason = R.fetch_one({"code": 1}, "old", partial(fetch_scheme_verified, get=get), lambda _: None)
        self.assertEqual((level, raw, reason), ("Moderately High", "Moderately High", None))

    def test_no_slug_warns_without_fetching(self):
        funds = [{"code": 1}]
        counts, log = self.run_refresh(funds, slugs={})
        self.assertEqual(funds, [{"code": 1}])
        self.assertEqual(counts["failed"], 1)
        self.assertIn("no slug", log)

    def test_default_all_and_missing_only_selection(self):
        funds = [{"code": 1}, {"code": 2, "sebiRisk": "Low"}]
        for code, age in ((3, 29), (4, 30), (5, 31)):
            funds.append({"code": code, "sebiRisk": "High", "sebiRiskAsOf": (self.TODAY - timedelta(days=age)).isoformat()})
        funds.append({"code": 6, "sebiRisk": "Low", "sebiRiskAsOf": "invalid"})
        self.assertEqual([f["code"] for f in funds if R.needs_fetch(f, self.TODAY)], [1, 2, 4, 5, 6])
        self.assertTrue(all(R.needs_fetch(f, self.TODAY, refresh_all=True) for f in funds))
        self.assertEqual([f["code"] for f in funds if R.needs_fetch(f, self.TODAY, missing_only=True)], [1])

    def test_main_outage_exits_zero_warns_and_keeps_file_byte_identical(self):
        for fetch in (lambda c, s: {"status": "fetch_failed"}, lambda c, s: (_ for _ in ()).throw(OSError("offline"))):
            with tempfile.TemporaryDirectory() as tmp:
                path, slugs = Path(tmp) / "funds.json", Path(tmp) / "slugs.json"
                original = json.dumps({"funds": [{"code": 1, "sebiRisk": "Low", "sebiRiskAsOf": "2020-01-01"}, {"code": 2}]}, indent=2)
                path.write_text(original, encoding="utf-8")
                slugs.write_text(json.dumps({"1": "one", "2": "two"}), encoding="utf-8")
                out = io.StringIO()
                with patch.object(R, "FUNDS_PATH", path), patch.object(R, "SLUGS_PATH", slugs), patch.object(R, "fetch_scheme_verified", fetch), patch.object(R.time, "sleep", lambda _: None), contextlib.redirect_stdout(out):
                    self.assertEqual(R.main([]), 0)
                self.assertEqual(path.read_text(encoding="utf-8"), original)
                self.assertIn("::warning::", out.getvalue())
                self.assertIn("failed=2", out.getvalue())

    def test_partial_outage_keeps_successful_updates_and_preserves_failed_fund(self):
        old = {"code": 2, "sebiRisk": "Low", "sebiRiskAsOf": "2020-01-01"}
        funds = [{"code": 1}, deepcopy(old)]
        def fetch(code, slug):
            if code == 2:
                return {"status": "fetch_failed"}
            return {"status": "ok", "payload": {"return_stats": [{"risk": "High"}]}}
        with contextlib.redirect_stdout(io.StringIO()):
            counts = R.refresh(funds, {"1": "one", "2": "two"}, self.TODAY,
                               fetch=fetch, throttle=lambda _: None)
        self.assertEqual(counts, dict(filled=1, changed=0, unchanged=0, failed=1))
        self.assertEqual(funds[0]["sebiRisk"], "High")
        self.assertEqual(funds[1], old)

    def test_cli_modes_and_atomic_persistence_preserve_unrelated_fields(self):
        for mode, expected in (([], [1]), (["--all"], [1, 2]), (["--missing-only"], [1])):
            with tempfile.TemporaryDirectory() as tmp:
                path, slugs = Path(tmp) / "funds.json", Path(tmp) / "slugs.json"
                old = {"code": 2, "sebiRisk": "Low", "sebiRiskAsOf": date.today().isoformat()}
                path.write_text(json.dumps({"totalFunds": 2, "funds": [{"code": 1, "name": "Example"}, old]}), encoding="utf-8")
                slugs.write_text(json.dumps({"1": "one", "2": "two"}), encoding="utf-8")
                called = []
                def fetch(code, slug):
                    called.append(code)
                    return {"status": "ok", "payload": {"return_stats": [{"risk": "High"}]}}
                with patch.object(R, "FUNDS_PATH", path), patch.object(R, "SLUGS_PATH", slugs), patch.object(R, "fetch_scheme_verified", fetch), patch.object(R.time, "sleep", lambda _: None), contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(R.main(mode), 0)
                self.assertEqual(sorted(called), expected)
                data = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(data["totalFunds"], 2)
                self.assertEqual(data["funds"][0]["name"], "Example")
                self.assertEqual(data["funds"][0]["sebiRisk"], "High")
                self.assertFalse(path.with_suffix(".json.tmp").exists())


class WorkflowTests(unittest.TestCase):
    def test_monthly_default_refresh_precedes_metrics_and_warns_only(self):
        wf = (ROOT / ".github/workflows/refresh-data.yml").read_text(encoding="utf-8")
        monthly = wf.split("  monthly-holdings:", 1)[1]
        step = monthly.split("- name: Refresh SEBI riskometer (Groww)", 1)[1].split("- name:", 1)[0]
        self.assertIn("run: python scripts/fetch_sebi_risk.py\n", step)
        self.assertIn("continue-on-error: true", step)
        self.assertLess(monthly.index("scripts/fetch_sebi_risk.py"), monthly.index("pipeline/compute_metrics.py"))

    def test_daily_missing_only_fetch_is_inside_intake_after_onboarding_and_cannot_rollback(self):
        wf = (ROOT / ".github/workflows/refresh-data.yml").read_text(encoding="utf-8")
        daily = wf.split("  monthly-holdings:", 1)[0]
        intake = daily.split("id: intake", 1)[1].split("- name:", 1)[0]
        guarded = intake.split("python pipeline/build_matcher_universe.py", 1)[1].split("} || n=failed", 1)[0]
        self.assertLess(guarded.index("scripts/onboard_new_funds.py"), guarded.index("scripts/fetch_sebi_risk.py"))
        self.assertLess(guarded.index("scripts/fetch_sebi_risk.py"), guarded.index("pipeline/compute_metrics.py"))
        self.assertRegex(guarded, r"\{ python scripts/fetch_sebi_risk.py --missing-only \|\| echo \"::warning::[^\n]+; \} &&")
        self.assertEqual(daily.count("python scripts/fetch_sebi_risk.py"), 1)


if __name__ == "__main__":
    unittest.main()
