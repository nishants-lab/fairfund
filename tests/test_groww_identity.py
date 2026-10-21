"""A Groww payload is only trusted when its own scheme_code is the fund's code.

Pins the 2026-10-21 holdings integrity fix:
  * eight funds had a sibling's Groww slug (DSP Nifty 50 -> Nifty Next 50, SBI
    Nifty IT -> SBI Nifty, ...) and showed that fund's holdings, AUM and TER;
  * thirty funds had slugs Groww renamed. Groww answers HTTP 308 with the new
    slug in a JSON body, urllib raised, and their portfolios froze in June/July.
No network: every Groww response here is a fake.
"""
from pathlib import Path
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


G = _load("groww_identity")
C = _load("capture_holdings_snapshot")
SM = _load("build_stock_moves")


def payload(code, holdings=None, aum=100.0):
    return {"scheme_code": str(code), "direct_scheme_code": str(code), "scheme_name": f"Fund {code}",
            "aum": aum, "expense_ratio": 0.5, "exit_load": "Nil",
            "holdings": holdings if holdings is not None else [
                {"company_name": "HDFC Bank Ltd", "corpus_per": 9.5, "sector_name": "Financial",
                 "instrument_name": "Equity", "stock_search_id": "hdfc-bank",
                 "portfolio_date": "2026-09-29T18:30:00.000Z"}]}


def fake_groww(pages):
    """pages: slug -> ("ok", payload) | ("redirect", slug) | ("not_found", None) | ("failed", None)."""
    calls = []

    def get(slug):
        calls.append(slug)
        return pages.get(slug, ("not_found", None))
    get.calls = calls
    return get


class SchemeMatchTests(unittest.TestCase):
    def test_matches_own_code_in_either_field(self):
        self.assertTrue(G.scheme_matches(146376, {"scheme_code": "146376"}))
        self.assertTrue(G.scheme_matches("146376", {"scheme_code": 146376}))
        self.assertTrue(G.scheme_matches(146376, {"scheme_code": None, "direct_scheme_code": "146376"}))

    def test_sibling_code_is_rejected(self):
        # The live failure: DSP Nifty 50's slug served DSP Nifty Next 50.
        self.assertFalse(G.scheme_matches(146376, {"scheme_code": "146381", "direct_scheme_code": "146381"}))

    def test_absent_code_is_not_proof(self):
        self.assertFalse(G.scheme_matches(146376, {"scheme_name": "DSP Nifty 50 Index Fund"}))
        self.assertFalse(G.scheme_matches(146376, {"scheme_code": "", "direct_scheme_code": None}))
        self.assertFalse(G.scheme_matches(146376, None))
        self.assertFalse(G.scheme_matches(146376, ["146376"]))
        self.assertFalse(G.scheme_matches("", {"scheme_code": ""}))


class FetchVerifiedTests(unittest.TestCase):
    def test_plain_ok(self):
        r = G.fetch_scheme_verified(1, "a", fake_groww({"a": ("ok", payload(1))}))
        self.assertEqual((r["status"], r["slug"]), ("ok", "a"))
        self.assertEqual(r["payload"]["scheme_code"], "1")

    def test_rename_chain_is_followed_and_reported(self):
        # JM Multi Strategy -> JM Flexi Cap needed two hops on the live site.
        get = fake_groww({"old": ("redirect", "mid"), "mid": ("redirect", "new"), "new": ("ok", payload(120492))})
        r = G.fetch_scheme_verified(120492, "old", get)
        self.assertEqual((r["status"], r["slug"]), ("renamed", "new"))
        self.assertEqual(get.calls, ["old", "mid", "new"])

    def test_redirect_into_another_scheme_is_a_mismatch(self):
        get = fake_groww({"old": ("redirect", "other"), "other": ("ok", payload(999))})
        r = G.fetch_scheme_verified(1, "old", get)
        self.assertEqual(r["status"], "identity_mismatch")
        self.assertIsNone(r["payload"])
        self.assertEqual(r["got"], "999")

    def test_wrong_scheme_payload_is_withheld(self):
        r = G.fetch_scheme_verified(153320, "sbi-nifty", fake_groww({"sbi-nifty": ("ok", payload(119827))}))
        self.assertEqual(r["status"], "identity_mismatch")
        self.assertIsNone(r["payload"])

    def test_loops_and_long_chains_stop(self):
        loop = fake_groww({"a": ("redirect", "b"), "b": ("redirect", "a")})
        self.assertEqual(G.fetch_scheme_verified(1, "a", loop)["status"], "redirect_loop")
        chain = {f"s{i}": ("redirect", f"s{i+1}") for i in range(10)}
        long = fake_groww(chain)
        self.assertEqual(G.fetch_scheme_verified(1, "s0", long)["status"], "redirect_loop")
        self.assertLessEqual(len(long.calls), G.MAX_REDIRECTS + 1)

    def test_not_found_and_failure(self):
        self.assertEqual(G.fetch_scheme_verified(1, "x", fake_groww({}))["status"], "not_found")
        self.assertEqual(G.fetch_scheme_verified(1, "x", fake_groww({"x": ("failed", None)}))["status"], "fetch_failed")


class GrowwGetTests(unittest.TestCase):
    """The real HTTP adapter, with urlopen faked."""

    def _err(self, code, body=b"{}"):
        return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(body))

    def test_308_body_search_id_becomes_redirect(self):
        body = json.dumps({"scheme_code": None, "search_id": "kotak-mid-cap-fund-direct-growth"}).encode()
        with mock.patch.object(G.urllib.request, "urlopen", side_effect=self._err(308, body)):
            self.assertEqual(G.groww_get("kotak-emerging-equity-scheme-direct-growth", sleep=lambda s: None),
                             ("redirect", "kotak-mid-cap-fund-direct-growth"))

    def test_308_without_new_slug_fails_rather_than_loops(self):
        with mock.patch.object(G.urllib.request, "urlopen", side_effect=self._err(308, b"not json")):
            self.assertEqual(G.groww_get("x", sleep=lambda s: None), ("failed", None))
        same = json.dumps({"search_id": "x"}).encode()
        with mock.patch.object(G.urllib.request, "urlopen", side_effect=self._err(308, same)):
            self.assertEqual(G.groww_get("x", sleep=lambda s: None), ("failed", None))

    def test_404_and_200(self):
        with mock.patch.object(G.urllib.request, "urlopen", side_effect=self._err(404)):
            self.assertEqual(G.groww_get("x", sleep=lambda s: None), ("not_found", None))
        resp = mock.MagicMock()
        resp.__enter__.return_value.read.return_value = json.dumps({"scheme_code": "5"}).encode()
        with mock.patch.object(G.urllib.request, "urlopen", return_value=resp):
            self.assertEqual(G.groww_get("x"), ("ok", {"scheme_code": "5"}))

    def test_rate_limit_retries_then_fails(self):
        sleeps = []
        with mock.patch.object(G.urllib.request, "urlopen", side_effect=self._err(429)):
            self.assertEqual(G.groww_get("x", retries=3, sleep=sleeps.append), ("failed", None))
        self.assertEqual(len(sleeps), 3)


class CaptureRunTests(unittest.TestCase):
    """capture_holdings_snapshot.main() end to end against a temp history dir."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.patches = [
            mock.patch.object(C, "HIST_DIR", self.tmp),
            mock.patch.object(C, "SLUG_MAP_PATH", os.path.join(self.tmp, "_slugs.json")),
            mock.patch.object(C, "FORMER_SLUGS_PATH", os.path.join(self.tmp, "_former_slugs.json")),
            mock.patch.object(C, "WS_SLUG_CACHE", os.path.join(self.tmp, "no-ws-cache")),
            mock.patch.object(C.time, "sleep", lambda s: None),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def hist(self, code, slug, dates):
        rec = {"code": code, "slug": slug, "name": f"Fund {code}", "snapshots": {
            d: {"portfolioDate": d, "exit_load": "Nil", "holdings": [{"name": "Old Co", "pct": 5, "key": "old"}]}
            for d in dates}}
        json.dump(rec, open(os.path.join(self.tmp, f"{code}.json"), "w"))

    def read(self, code):
        return json.load(open(os.path.join(self.tmp, f"{code}.json")))

    def run_capture(self, universe, slugs, pages, env=None):
        json.dump(slugs, open(os.path.join(self.tmp, "_slugs.json"), "w"))
        get = fake_groww(pages)
        verified = lambda code, slug: G.fetch_scheme_verified(code, slug, get)
        with mock.patch.object(C, "load_universe", return_value=universe), \
                mock.patch.object(C, "fetch_scheme_verified", verified), \
                mock.patch.dict(os.environ, env or {}, clear=False):
            out = io.StringIO()
            with mock.patch("sys.stdout", out):
                C.main()
        return out.getvalue(), json.load(open(os.path.join(self.tmp, "_slugs.json")))

    def test_misattributed_history_is_reset_and_rebuilt_from_the_right_page(self):
        # 146376 history was captured from DSP Nifty Next 50's page (146381).
        self.hist(146376, "dsp-next-50", ["2026-07-31", "2026-08-31"])
        log, slugs = self.run_capture(
            {146376: "DSP Nifty 50"}, {"146376": "dsp-nifty-50"},
            {"dsp-nifty-50": ("ok", payload(146376)), "dsp-next-50": ("ok", payload(146381))})
        rec = self.read(146376)
        self.assertEqual(sorted(rec["snapshots"]), ["2026-09-30"])
        self.assertEqual(rec["slug"], "dsp-nifty-50")
        self.assertIn("Reset history for 1 funds", log)

    def test_rename_keeps_history_and_saves_the_new_slug(self):
        self.hist(119775, "kotak-emerging", ["2026-06-30", "2026-07-31"])
        log, slugs = self.run_capture(
            {119775: "Kotak Midcap"}, {"119775": "kotak-emerging"},
            {"kotak-emerging": ("redirect", "kotak-mid-cap"), "kotak-mid-cap": ("ok", payload(119775))})
        rec = self.read(119775)
        self.assertEqual(sorted(rec["snapshots"]), ["2026-06-30", "2026-07-31", "2026-09-30"])
        self.assertEqual(rec["slug"], "kotak-mid-cap")
        self.assertEqual(slugs["119775"], "kotak-mid-cap")
        self.assertIn("119775: kotak-emerging -> kotak-mid-cap", log)
        former = json.load(open(os.path.join(self.tmp, "_former_slugs.json")))
        self.assertEqual(former, {"119775": ["kotak-emerging"]})

    def test_former_slugs_append_without_duplicates(self):
        path = os.path.join(self.tmp, "_former_slugs.json")
        json.dump({"1": ["a"]}, open(path, "w"))
        C.record_former_slugs({1: ("a", "b"), 2: ("x", "y"), 3: (None, "z")}, path)
        C.record_former_slugs({1: ("b", "c")}, path)
        self.assertEqual(json.load(open(path)), {"1": ["a", "b"], "2": ["x"]})

    def test_wrong_page_writes_nothing_and_warns(self):
        self.hist(153320, "sbi-nifty", ["2026-08-31"])
        before = self.read(153320)
        log, slugs = self.run_capture(
            {153320: "SBI Nifty IT"}, {"153320": "sbi-nifty"},
            {"sbi-nifty": ("ok", payload(119827))})
        self.assertEqual(self.read(153320), before)
        self.assertEqual(slugs, {"153320": "sbi-nifty"})
        self.assertIn("::warning::1 slugs point at a different Groww scheme", log)
        self.assertIn("153320 (slug sbi-nifty is scheme 119827)", log)

    def test_unfetchable_old_slug_keeps_history(self):
        # Cannot prove the old page was another scheme, so nothing is discarded.
        self.hist(5, "gone", ["2026-08-31"])
        self.run_capture({5: "Fund 5"}, {"5": "now"}, {"now": ("ok", payload(5))})
        self.assertEqual(sorted(self.read(5)["snapshots"]), ["2026-08-31", "2026-09-30"])

    def test_codes_filter_limits_the_run(self):
        get_pages = {"a": ("ok", payload(1)), "b": ("ok", payload(2))}
        self.run_capture({1: "A", 2: "B"}, {"1": "a", "2": "b"}, get_pages, env={"FF_CAPTURE_CODES": "2"})
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "1.json")))
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "2.json")))

    def test_progress_counts_each_fund_once(self):
        log, _ = self.run_capture({1: "A"}, {"1": "a"}, {"a": ("ok", payload(1))})
        self.assertIn("New snapshots: 1", log)
        self.assertIn("'stock_level': 1", log)


class ClearMovesTests(unittest.TestCase):
    def test_short_history_moves_are_nulled_others_untouched(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        json.dump({"stockMoves": {"added": [1]}}, open(os.path.join(tmp, "1.json"), "w"))
        json.dump({"stockMoves": None}, open(os.path.join(tmp, "2.json"), "w"))
        json.dump({"stockMoves": {"added": [3]}}, open(os.path.join(tmp, "3.json"), "w"))
        self.assertEqual(SM.clear_short_history_moves(tmp, {"1", "2", "4"}), 1)
        self.assertIsNone(json.load(open(os.path.join(tmp, "1.json")))["stockMoves"])
        self.assertEqual(json.load(open(os.path.join(tmp, "3.json")))["stockMoves"], {"added": [3]})


class CommittedSlugIntegrityTests(unittest.TestCase):
    """Adaptive checks on the committed data, re-evaluated on every run."""

    @classmethod
    def setUpClass(cls):
        cls.slugs = json.load(open(ROOT / "public" / "holdings-history" / "_slugs.json", encoding="utf-8"))

    def test_no_two_funds_share_a_groww_slug(self):
        by_slug = {}
        for code, slug in self.slugs.items():
            by_slug.setdefault(slug, []).append(code)
        shared = {s: c for s, c in by_slug.items() if len(c) > 1}
        self.assertEqual(shared, {}, "one Groww page cannot be two funds")

    def test_history_files_record_the_current_slug(self):
        stale = []
        for code, slug in self.slugs.items():
            p = ROOT / "public" / "holdings-history" / f"{code}.json"
            if p.exists():
                rec = json.loads(p.read_text(encoding="utf-8"))
                if rec.get("slug") and rec["slug"] != slug:
                    stale.append((code, rec["slug"], slug))
        self.assertEqual(stale, [])

    def test_known_misattributions_stay_fixed(self):
        bad = {"146376": "dsp-nifty-next-50-index-fund-direct-growth",
               "151814": "motilal-oswal-nifty-smallcap-250-index-fund-direct-growth",
               "118791": "nippon-india-bse-sensex-next-30-index-fund-direct-growth",
               "119231": "tata-ethical-fund-direct-growth",
               "148945": "sbi-nifty-index-fund-direct-growth",
               "153320": "sbi-nifty-index-fund-direct-growth",
               "132140": "aditya-birla-sun-life-special-opportunities-fund-direct-growth",
               "119354": "baroda-bnp-paribas-multi-asset-fund-direct-growth"}
        for code, wrong in bad.items():
            self.assertNotEqual(self.slugs.get(code), wrong, f"{code} points at another fund again")


class ManagerIdentityTests(unittest.TestCase):
    def test_name_overlap_alone_no_longer_admits_a_sibling(self):
        M = _load("fetch_managers")
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        mismatch = lambda code, slug: {"status": "identity_mismatch", "slug": slug, "payload": None, "got": "119827"}
        with mock.patch.object(M, "MGR_CACHE", tmp), mock.patch.object(M, "slug_for", return_value="sbi-nifty"), \
                mock.patch.object(M, "fetch_scheme_verified", mismatch):
            code, rec = M.fetch_one(153320)
        self.assertEqual(rec, {"managers": [], "fetched": False, "note": "identity mismatch"})

    def test_matching_page_yields_managers(self):
        M = _load("fetch_managers")
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        p = payload(153320)
        p["fund_manager_details"] = [{"person_name": "A Manager", "date_from": "2024-01-01T00:00:00"}]
        ok = lambda code, slug: {"status": "ok", "slug": slug, "payload": p, "got": "153320"}
        with mock.patch.object(M, "MGR_CACHE", tmp), mock.patch.object(M, "slug_for", return_value="sbi-nifty-it"), \
                mock.patch.object(M, "fetch_scheme_verified", ok):
            code, rec = M.fetch_one(153320)
        self.assertTrue(rec["fetched"])
        self.assertEqual([m["name"] for m in rec["managers"]], ["A Manager"])


if __name__ == "__main__":
    unittest.main()
