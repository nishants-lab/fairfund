"""Verified NAV unit splits (src/data/nav_corrections.json). No network.

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
        for s in data["splits"]:
            self.assertGreater(s["factor"], 1, s)
            self.assertTrue(s["sources"] and all(u.startswith("https://") for u in s["sources"]), s)
            self.assertTrue(s["evidence"] and s["verified"], s)
        self.assertEqual(set(NC.load()), {"120304"})

    def test_split_divides_only_dates_before_the_new_units(self):
        fixed = NC.correct_history(120304, RAW)
        self.assertEqual(fixed, {"2026-06-18": 458.8297, "2026-06-19": 458.9124,
                                 "2026-06-20": 458.9915, "2026-06-21": 459.0706})
        self.assertTrue(nav_quality_issues(sorted(RAW.items())))
        self.assertEqual(nav_quality_issues(sorted(fixed.items())), [])

    def test_other_funds_are_untouched(self):
        self.assertIs(NC.correct_history(119551, RAW), RAW)

    def test_invalid_entry_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="ff-navfix-", dir=ROOT.parent) as tmp:
            bad = Path(tmp) / "nav_corrections.json"
            bad.write_text(json.dumps({"splits": [{"code": 1, "factor": 10, "firstNewDate": "2026-01-01", "sources": []}]}), encoding="utf-8")
            with self.assertRaises(ValueError):
                NC.load(bad)

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
