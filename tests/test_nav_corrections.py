"""Verified NAV corrections (src/data/nav_corrections.json). No network.

UTI Liquid Fund Direct Growth (120304) changed its unit size 10:1 in June 2026;
AMFI history jumps -90% on 2026-06-20 and the fund sat in quarantine. The split
is confirmed by UTI's own factsheets, so the source history is put in today's
units by every fetcher, and the stored file holds the corrected values.
"""
from pathlib import Path
import json
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import nav_corrections as NC  # noqa: E402
import resync_nav_from_source as RS  # noqa: E402
from nav_quality import nav_quality_issues  # noqa: E402

RAW = {"2026-06-18": 4588.2967, "2026-06-19": 4589.1243, "2026-06-20": 458.9915, "2026-06-21": 459.0706}


class NavCorrectionTests(unittest.TestCase):
    def test_every_entry_is_cited_and_sane(self):
        data = json.loads(NC.CORRECTIONS.read_text(encoding="utf-8"))
        for s in data["splits"] + data["points"]:
            self.assertTrue(s["sources"] and all(u.startswith("https://") for u in s["sources"]), s)
            self.assertTrue(s["evidence"] and s["verified"], s)
        for s in data["splits"]:
            self.assertGreater(s["factor"], 1, s)
        self.assertEqual(set(NC.load()), {"120304", "119517", "120826"})

    def test_split_divides_only_dates_before_the_new_units(self):
        fixed = NC.correct_history(120304, RAW)
        self.assertEqual(fixed, {"2026-06-18": 458.8297, "2026-06-19": 458.9124,
                                 "2026-06-20": 458.9915, "2026-06-21": 459.0706})
        self.assertTrue(nav_quality_issues(sorted(RAW.items())))
        self.assertEqual(nav_quality_issues(sorted(fixed.items())), [])

    def test_other_funds_are_untouched(self):
        self.assertIs(NC.correct_history(119551, RAW), RAW)

    def test_invalid_entry_is_rejected(self):
        cited = {"evidence": "x", "sources": ["https://example.org/"]}
        bad_files = [
            {"splits": [{"code": 1, "factor": 10, "firstNewDate": "2026-01-01", "sources": []}]},
            {"points": [{"code": 1, "date": "2026-01-01", "nav": 10, "evidence": "x", "sources": []}]},
            {"points": [{"code": 1, "date": "2026-01-01", **cited}]},
            {"points": [{"code": 1, "date": "2026-01-01", "nav": 0, **cited}]},
            {"points": [{"code": 1, "date": "2026-01-01", "nav": True, **cited}]},
            {"points": [{"code": 1, "date": "2026-01-01", "nav": 5, "evidence": "x", "sources": ["http://x/"]}]},
            {"points": [{"code": 1, "date": "2026-01-01", "nav": 5, **cited}, {"code": 1, "date": "2026-01-01", "nav": None, **cited}]},
        ]
        with tempfile.TemporaryDirectory(prefix="ff-navfix-", dir=ROOT.parent) as tmp:
            bad = Path(tmp) / "nav_corrections.json"
            for data in bad_files:
                bad.write_text(json.dumps(data), encoding="utf-8")
                with self.assertRaises(ValueError, msg=data):
                    NC.load(bad)

    def test_point_replaces_a_verified_value(self):
        # AMFI history report: 21.7136, 21.5909, 21.5441 (09 to 11 Apr 2019); mfapi had 70.5334.
        raw = {"2019-04-09": 21.7136, "2019-04-10": 70.5334, "2019-04-11": 21.5441}
        self.assertTrue(nav_quality_issues(sorted(raw.items())))
        fixed = NC.correct_history(119517, raw)
        self.assertEqual(fixed, {"2019-04-09": 21.7136, "2019-04-10": 21.5909, "2019-04-11": 21.5441})
        self.assertEqual(nav_quality_issues(sorted(fixed.items())), [])
        self.assertEqual(raw["2019-04-10"], 70.5334, "input is not mutated")

    def test_null_point_drops_a_wrong_day(self):
        raw = {"2015-05-26": 25.1163, "2015-05-27": 42.6479, "2015-05-28": 25.045}
        fixed = NC.correct_history(120826, raw)
        self.assertEqual(fixed, {"2015-05-26": 25.1163, "2015-05-28": 25.045})
        self.assertEqual(nav_quality_issues(sorted(fixed.items())), [])
        self.assertEqual(NC.dropped_dates(120826), {"2015-05-27"})
        self.assertEqual(NC.dropped_dates(119517), set())

    def test_point_only_applies_when_the_source_has_the_date(self):
        self.assertEqual(NC.correct_history(119517, {"2019-04-09": 21.7136}), {"2019-04-09": 21.7136})

    def test_resync_drops_and_replaces(self):
        stored = {"d": ["2015-05-26", "2015-05-27", "2015-05-28"], "v": [25.1163, 42.6479, 25.045], "u": "2015-05-28"}
        corrected = NC.correct_history(120826, dict(zip(stored["d"], stored["v"])))
        new, changed = RS.resync(stored, corrected, NC.dropped_dates(120826))
        self.assertEqual(changed, ["2015-05-27"])
        self.assertEqual((new["d"], new["v"], new["u"]), (["2015-05-26", "2015-05-28"], [25.1163, 25.045], "2015-05-28"))
        self.assertEqual(RS.resync(new, corrected, NC.dropped_dates(120826))[1], [])

    def test_stored_histories_of_released_funds_are_clean(self):
        for code, day, want in (("119517", "2019-04-10", 21.5909), ("120826", "2015-05-27", None)):
            raw = json.loads((ROOT / f"public/nav/{code}.json").read_text(encoding="utf-8"))
            nav = dict(zip(raw["d"], raw["v"]))
            self.assertEqual(nav.get(day), want, code)
            self.assertEqual(nav_quality_issues(list(zip(raw["d"], raw["v"]))), [], code)

    def test_resync_takes_corrected_source_values_and_is_idempotent(self):
        stored = {"d": list(RAW), "v": [4588.2967, 4589.1243, 4589.915, 459.0706], "u": "2026-06-21"}
        corrected = NC.correct_history(120304, RAW)
        new, changed = RS.resync(stored, corrected)
        self.assertEqual(changed, ["2026-06-18", "2026-06-19", "2026-06-20"])
        self.assertEqual(new["v"], [458.8297, 458.9124, 458.9915, 459.0706])
        self.assertEqual(list(new), ["d", "v", "u"])
        self.assertEqual(RS.resync(new, corrected)[1], [])

    def test_stored_history_is_clean_and_in_todays_units(self):
        raw = json.loads((ROOT / "public/nav/120304.json").read_text(encoding="utf-8"))
        nav = dict(zip(raw["d"], raw["v"]))
        # UTI factsheets: 4569.7551 on 31 May 2026 (old units), 459.9553 on 30 June 2026.
        self.assertAlmostEqual(nav["2026-05-31"], 456.9755, places=4)
        self.assertAlmostEqual(nav["2026-06-30"], 459.9553, places=4)
        self.assertEqual(nav_quality_issues(list(zip(raw["d"], raw["v"]))), [])


if __name__ == "__main__":
    unittest.main()
