"""Other names a fund is searched by (scripts/build_former_names.py).

Offline: every input is built here. Pins the rules the search relies on:
  * a slug or "(Formerly ...)" clause is kept only if it names something the
    current name does not (spacing, plan words and one-letter typos are not new);
  * a renamed page's current slug is its new name, so only old slugs count;
  * a name that is another fund's current name is never attached to this fund
    (Kotak Small Cap's page began as "kotak-midcap-fund").
"""
from pathlib import Path
import importlib.util
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_former_names", ROOT / "scripts" / "build_former_names.py")
bfn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bfn)


def fund(code, name, full=None):
    return {"code": code, "name": name, "fullName": full or name}


class SaysSomethingNew(unittest.TestCase):
    def test_spacing_plan_words_and_typos_are_not_new(self):
        self.assertFalse(bfn.says_something_new("HDFC Nifty200 Momentum 30", ["HDFC NIFTY 200 Momentum 30 Index Fund"]))
        self.assertFalse(bfn.says_something_new("Axis Large Cap Fund Direct Growth", ["Axis Large Cap Fund"]))
        self.assertFalse(bfn.says_something_new("SBI Heathcare Opportunities", ["SBI Healthcare Opportunities Fund"]))
        self.assertFalse(bfn.says_something_new("Mirae Large and Midcap", ["Mirae Asset Large & Mid Cap Fund"]))

    def test_a_different_word_is_new(self):
        self.assertTrue(bfn.says_something_new("Axis Bluechip Fund", ["Axis Large Cap Fund"]))
        self.assertTrue(bfn.says_something_new("Kotak Emerging Equity Scheme", ["Kotak Mid Cap Fund"]))

    def test_near_is_one_edit_and_needs_five_letters(self):
        self.assertTrue(bfn.near("healthcare", "heathcare"))
        self.assertTrue(bfn.near("bluechip", "bluechips"))
        self.assertFalse(bfn.near("midcap", "smallcap"))
        self.assertFalse(bfn.near("axis", "axes"))  # too short to call a typo


class FormerFromFullName(unittest.TestCase):
    def test_clauses(self):
        self.assertEqual(bfn.former_from_full_name(
            "Sundaram Large Cap Fund (Formerly Known as Sundaram Blue Chip Fund) - Direct Plan - Growth"),
            ["Sundaram Blue Chip Fund"])
        self.assertEqual(bfn.former_from_full_name("ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund)"),
                         ["Bluechip Fund"])
        self.assertEqual(bfn.former_from_full_name("HDFC Mid Cap Fund - Direct Plan"), [])
        self.assertEqual(bfn.former_from_full_name(None), [])


class Build(unittest.TestCase):
    def test_slug_curated_and_clause_sources(self):
        funds = [fund(120465, "Axis Large Cap Fund"),
                 fund(119775, "Kotak Mid Cap Fund"),
                 fund(148507, "Sundaram Large Cap Fund", "Sundaram Large Cap Fund (Formerly Known as Sundaram Blue Chip Fund)")]
        slugs = {"120465": "axis-large-cap-fund-direct-growth", "119775": "kotak-emerging-equity-scheme-direct-growth"}
        curated = {"120465": {"names": ["Axis Bluechip Fund"]}}
        out = bfn.build(funds, slugs, {}, curated)
        self.assertEqual(out["120465"], ["Axis Bluechip Fund"])
        self.assertEqual(out["119775"], ["Kotak Emerging Equity Scheme"])
        self.assertEqual(out["148507"], ["Sundaram Blue Chip Fund"])

    def test_renamed_page_uses_only_old_slugs(self):
        funds = [fund(118834, "Mirae Asset Large & Midcap Fund")]
        # The new slug has a word the name lacks ("india"); it must still be skipped.
        slugs = {"118834": "mirae-asset-india-equity-fund-direct-growth"}
        former = {"118834": ["mirae-asset-emerging-bluechip-fund-direct-growth"]}
        self.assertEqual(bfn.build(funds, slugs, former, {})["118834"], ["Mirae Asset Emerging Bluechip Fund"])
        self.assertEqual(bfn.build(funds, slugs, {}, {})["118834"], ["Mirae Asset India Equity Fund"])

    def test_another_funds_current_name_is_dropped(self):
        funds = [fund(120164, "Kotak Small Cap Fund"), fund(119775, "Kotak Mid Cap Fund")]
        slugs = {"120164": "kotak-midcap-fund-direct-growth", "119775": "kotak-mid-cap-fund-direct-growth"}
        self.assertEqual(bfn.build(funds, slugs, {}, {}), {})

    def test_no_new_word_means_no_entry(self):
        funds = [fund(122639, "Parag Parikh Flexi Cap Fund")]
        self.assertEqual(bfn.build(funds, {"122639": "parag-parikh-flexi-cap-fund-direct-growth"}, {}, {}), {})


if __name__ == "__main__":
    unittest.main()
