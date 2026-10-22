"""Funds that have just started trading enter the universe straight away.

Pins the 2026-10-22 change:
  * one published NAV is enough for a fund in a covered category to be listed
    (it was 30, so new funds waited about six weeks and a month of discovery);
  * the discovery run fetches managers, size and cost for new funds itself;
  * a fund onboarded with a slug but no holdings yet still gets its managers.
    fetch_managers looked for the slug only in holdings-history files, stored
    "no slug" and never asked again (36 listed funds had no managers for this);
  * six index funds carried another index as their benchmark.
No network: Groww is never called.
"""
from pathlib import Path
import importlib.util
import json
import re
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "pipeline"))


def _load(name, folder="scripts"):
    spec = importlib.util.spec_from_file_location(name, ROOT / folder / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class ThresholdTests(unittest.TestCase):
    def test_one_nav_is_enough_for_equity_and_debt(self):
        cfg = _load("config", "pipeline")
        for category in ("Flexi Cap", "Index-Other", "Value/Contra", "Liquid", "Money Market"):
            self.assertEqual(cfg.min_nav_points_for(category), 1, category)

    def test_comments_no_longer_promise_years_of_history(self):
        text = (ROOT / "pipeline" / "config.py").read_text(encoding="utf-8")
        self.assertNotIn("~3 years of trading days", text)
        self.assertNotIn("~250 trading", text)


class ManagerRetryTests(unittest.TestCase):
    def setUp(self):
        self.M = _load("fetch_managers")
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_slug_map_is_used_when_there_is_no_holdings_history(self):
        with mock.patch.object(self.M, "HIST_DIR", self.tmp), mock.patch.object(self.M, "SLUG_DIR", self.tmp), \
                mock.patch.object(self.M, "SLUGS", {"154740": "icici-prudential-contra-fund-direct-growth"}):
            self.assertEqual(self.M.slug_for(154740), "icici-prudential-contra-fund-direct-growth")
            self.assertIsNone(self.M.slug_for(999999))

    def test_holdings_history_slug_still_wins(self):
        Path(self.tmp, "154515.json").write_text(json.dumps({"slug": "from-history"}), encoding="utf-8")
        with mock.patch.object(self.M, "HIST_DIR", self.tmp), mock.patch.object(self.M, "SLUGS", {"154515": "from-map"}):
            self.assertEqual(self.M.slug_for(154515), "from-history")

    def test_only_unreached_records_are_asked_again(self):
        existing = {
            "1": {"managers": [{"name": "A"}], "fetched": True},
            "2": {"managers": [], "fetched": False, "note": "no slug"},
            "3": {"managers": [], "fetched": False, "note": "fetch failed"},
            "4": {"managers": [], "fetched": False, "note": "identity mismatch"},
        }
        with mock.patch.object(self.M, "MGR_CACHE", self.tmp):
            got = [c for c in (1, 2, 3, 4, 5) if self.M.needs_fetch(c, existing)]
        self.assertEqual(got, [2, 3, 5])

    def test_retry_ignores_a_stale_no_slug_cache_file(self):
        Path(self.tmp, "154740.json").write_text(json.dumps({"managers": [], "fetched": False, "note": "no slug"}), encoding="utf-8")
        p = {"scheme_code": "154740", "fund_manager_details": [{"person_name": "Ihab Dalwai", "date_from": "2026-10-01T00:00:00"}]}
        ok = lambda code, slug: {"status": "ok", "slug": slug, "payload": p, "got": "154740"}
        with mock.patch.object(self.M, "MGR_CACHE", self.tmp), mock.patch.object(self.M, "slug_for", return_value="icici-contra"), \
                mock.patch.object(self.M, "fetch_scheme_verified", ok):
            _, cached = self.M.fetch_one(154740)
            _, fresh = self.M.fetch_one(154740, retry=True)
        self.assertFalse(cached["fetched"])
        self.assertEqual([m["name"] for m in fresh["managers"]], ["Ihab Dalwai"])


class DiscoveryWorkflowTests(unittest.TestCase):
    def test_new_funds_get_managers_and_cost_before_metrics(self):
        text = (ROOT / ".github" / "workflows" / "discover-funds.yml").read_text(encoding="utf-8")
        order = [text.index(s) for s in ("scripts/onboard_new_funds.py", "scripts/fetch_managers.py",
                                         "scripts/build_manager_signals.py", "scripts/enrich_fund_data.py",
                                         "pipeline/compute_metrics.py")]
        self.assertEqual(order, sorted(order))
        self.assertIn("src/data/", text.split("git add", 1)[1].splitlines()[0])


class YoungFundCostTests(unittest.TestCase):
    """A young fund's first-month TER above SEBI's ceiling is withheld, not shown."""

    def run_enrich(self, funds, snaps, details=None):
        E = _load("enrich_fund_data")
        with tempfile.TemporaryDirectory(prefix="ff-ter-", dir=ROOT.parent) as tmp:
            base = Path(tmp)
            hist, det = base / "history", base / "details"
            hist.mkdir(); det.mkdir()
            for f in funds:
                (det / f"{f['code']}.json").write_text(json.dumps((details or {}).get(f["code"], {})), encoding="utf-8")
                (hist / f"{f['code']}.json").write_text(json.dumps({"snapshots": snaps[f["code"]]}), encoding="utf-8")
            index = base / "funds.json"
            index.write_text(json.dumps({"funds": funds}), encoding="utf-8")
            with mock.patch.multiple(E, HISTORY_DIR=hist, DETAIL_DIR=det, FUNDS_PATH=index):
                E.main()
            out = {f["code"]: f for f in json.loads(index.read_text(encoding="utf-8"))["funds"]}
            return out, {f["code"]: json.loads((det / f"{f['code']}.json").read_text(encoding="utf-8")) for f in funds}

    def test_ceilings(self):
        E = _load("enrich_fund_data")
        self.assertEqual((E.ter_ceiling("Index-Other"), E.ter_ceiling("Liquid"), E.ter_ceiling("Flexi Cap")), (1.0, 2.0, 2.25))

    def test_young_fund_above_ceiling_is_withheld_and_others_kept(self):
        snap = lambda er: {"2026-09-30": {"aum": 50.0, "expense_ratio": er}}
        funds = [
            {"code": 154738, "name": "Axis Nifty500 Low Volatility 50 Index Fund", "category": "Index-Sectoral/Thematic",
             "inceptionDate": "2026-08-20", "expenseRatio": 15.55},
            {"code": 2, "name": "Young plausible", "category": "Flexi Cap", "inceptionDate": "2026-09-10"},
            {"code": 3, "name": "Old fund", "category": "Flexi Cap", "inceptionDate": "2013-01-02"},
            {"code": 4, "name": "Young liquid", "category": "Liquid", "inceptionDate": "2026-09-01"},
            {"code": 5, "name": "No inception", "category": "Index-Other"},
            {"code": 6, "name": "Young index within GST headroom", "category": "Index-Other", "inceptionDate": "2026-07-02"},
            {"code": 7, "name": "Young flexi cap at 3.39%", "category": "Flexi Cap", "inceptionDate": "2026-09-10"},
        ]
        snaps = {154738: snap(15.55), 2: snap(0.55), 3: snap(2.69), 4: snap(1.5), 5: snap(1.2), 6: snap(1.07), 7: snap(3.39)}
        index, details = self.run_enrich(funds, snaps, {154738: {"expenseRatio": 15.55}})
        self.assertNotIn("expenseRatio", index[154738])
        self.assertNotIn("expenseRatio", details[154738])
        self.assertEqual(index[154738]["aum"]["current"], 50.0)  # size still published
        self.assertNotIn("expenseRatio", index[7])
        self.assertEqual([index[c]["expenseRatio"] for c in (2, 3, 4, 5, 6)], [0.55, 2.69, 1.5, 1.2, 1.07])

    def test_six_months_on_the_figure_is_published(self):
        funds = [{"code": 1, "name": "A", "category": "Flexi Cap", "inceptionDate": "2026-03-01"}]
        index, _ = self.run_enrich(funds, {1: {"2026-09-30": {"expense_ratio": 2.4}}})
        self.assertEqual(index[1]["expenseRatio"], 2.4)


def _norm(s):
    t = (s or "").lower()
    t = re.sub(r"\([^)]*\)", " ", t).replace("&", " and ")
    t = re.sub(r"\btotal returns? index\b|\btri\b|\bindex\b|\bprice return\b", " ", t)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"([a-z])(\d)", r"\1 \2", t)
    t = re.sub(r"(\d)([a-z])", r"\1 \2", t)
    t = re.sub(r"\blarge mid ?cap\b", "largemidcap", t)
    t = re.sub(r"\bmid cap\b", "midcap", t)
    t = re.sub(r"\bsmall cap\b", "smallcap", t)
    return re.sub(r"\s+", " ", t).strip()


def _stem(w):
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def name_agrees(name, benchmark):
    """Same rule as nameAgreesWithBenchmark in src/lib/nfo.ts."""
    want = _norm(benchmark)
    have = {_stem(w) for w in _norm(name).split()}
    return bool(want) and all(w in {"s", "p", "and", "bse", "nse"} or _stem(w) in have for w in want.split())


# Index funds whose names leave out a word of a benchmark that Groww confirms
# (checked 2026-10-22): "SBI Nifty Index Fund" tracks NIFTY 50; "Navi NiftyIT".
REVIEWED = {119827, 152535}


class IndexBenchmarkTests(unittest.TestCase):
    def setUp(self):
        data = json.loads((ROOT / "src" / "data" / "funds.json").read_text(encoding="utf-8"))
        self.funds = {f["code"]: f for f in data["funds"]}

    def test_six_mislabels_are_corrected(self):
        want = {118741: "NIFTY 50 Total Return Index", 118791: "BSE Sensex Total Return Index",
                153161: "NIFTY 500 Total Return Index", 153320: "NIFTY IT Total Return Index",
                152041: "NIFTY IT Total Return Index", 151814: "Nifty Microcap 250 Total Return Index"}
        for code, bench in want.items():
            self.assertEqual(self.funds[code]["benchmark"], bench, code)

    def test_every_index_fund_name_agrees_with_its_benchmark(self):
        bad = {c for c, f in self.funds.items()
               if f["category"].startswith("Index") and f.get("benchmark") and not name_agrees(f["name"], f["benchmark"])}
        self.assertEqual(bad - REVIEWED, set(), "index fund stored under another index's benchmark")

    def test_rule_catches_the_old_mislabels(self):
        self.assertFalse(name_agrees("Nippon India Index Fund - Nifty 50", "NIFTY IT Total Return Index"))
        self.assertFalse(name_agrees("ICICI Prudential Nifty 500 Index Fund", "NIFTY 50 Total Return Index"))
        self.assertFalse(name_agrees("Motilal Oswal Nifty Microcap 250 Index Fund", "NIFTY Smallcap 250 Total Return Index"))
        self.assertTrue(name_agrees("Nippon India Index Fund - BSE Sensex", "BSE Sensex Total Return Index"))


if __name__ == "__main__":
    unittest.main()
