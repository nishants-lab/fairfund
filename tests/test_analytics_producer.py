"""Analytics producer merge contract and the no_disclosure stub writer.

Merge-contract tests also support standard-library-only local interpreters.
The CI release gate installs numeric packages to execute the producer end to end;
that test is explicitly skipped for local interpreters missing those packages.

Write paths use temporary fixture trees beside the checkout; the producer
imports the checked-in regimes.json read-only at module load. No production data is written.
"""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
NUMERIC = ('numpy', 'pandas', 'scipy')
MISSING = [name for name in NUMERIC if importlib.util.find_spec(name) is None]


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_without_numeric(name, relative):
    """Import a producer module with the numeric packages made unimportable."""
    blocked = {key: None for key in list(sys.modules) + list(NUMERIC)
               if key.split('.')[0] in NUMERIC}
    with patch.dict(sys.modules, blocked):
        for key in NUMERIC:
            try:
                importlib.import_module(key)
            except ImportError:
                continue
            raise AssertionError(f'{key} is still importable; the gate-parity block failed')
        return load(name, relative)


producer = load_without_numeric('build_analytics', 'scripts/build_analytics.py')
prune = load('prune_pending', 'scripts/prune_pending.py')

RECORD = {'alpha': {'n': 40, 'confidence': 97.0}, 'regimes': [{'name': 'r', 'active': True}]}


class MergeContractTests(unittest.TestCase):
    def test_producer_module_imports_without_numeric_packages(self):
        self.assertTrue(hasattr(producer, 'merge_analytics_into_index'))
        self.assertTrue(hasattr(producer, 'month_end_series'))

    def test_populated_record_is_attached_by_string_code(self):
        fdata = {'funds': [{'code': 101, 'analytics': {}}]}
        self.assertEqual(producer.merge_analytics_into_index(fdata, {'101': RECORD}), (1, 0))
        self.assertEqual(fdata['funds'][0]['analytics'], RECORD)

    def test_omitted_fund_loses_the_previous_runs_analytics(self):
        fdata = {'funds': [{'code': 101, 'analytics': RECORD}, {'code': 202, 'analytics': RECORD}]}
        self.assertEqual(producer.merge_analytics_into_index(fdata, {'101': RECORD}), (1, 1))
        self.assertEqual(fdata['funds'][1]['analytics'], {})

    def test_reduced_surface_empty_record_clears_stale_analytics(self):
        fdata = {'funds': [{'code': 303, 'analytics': RECORD}]}
        self.assertEqual(producer.merge_analytics_into_index(fdata, {'303': {}}), (0, 1))
        self.assertEqual(fdata['funds'][0]['analytics'], {})

    def test_int_keyed_record_fails_closed_without_touching_the_index(self):
        fdata = {'funds': [{'code': 303, 'analytics': RECORD}, {'code': 101, 'analytics': {}}]}
        with self.assertRaises(ValueError):
            producer.merge_analytics_into_index(fdata, {'101': RECORD, 303: {}})
        self.assertEqual(fdata['funds'][0]['analytics'], RECORD)
        self.assertEqual(fdata['funds'][1]['analytics'], {})

    def test_every_fund_ends_with_an_analytics_object(self):
        fdata = {'funds': [{'code': 101}, {'code': 202, 'analytics': {}}]}
        self.assertEqual(producer.merge_analytics_into_index(fdata, {}), (0, 0))
        self.assertEqual([f['analytics'] for f in fdata['funds']], [{}, {}])

    def test_unrelated_index_fields_are_untouched(self):
        fund = {'code': 101, 'name': 'A', 'aum': {'current': 10.0}, 'analytics': {}}
        producer.merge_analytics_into_index({'funds': [fund]}, {'101': RECORD})
        self.assertEqual(fund['name'], 'A')
        self.assertEqual(fund['aum'], {'current': 10.0})

    def test_invalid_record_type_is_rejected_before_any_mutation(self):
        fdata = {'funds': [{'code': 101, 'analytics': RECORD}]}
        with self.assertRaises(ValueError):
            producer.merge_analytics_into_index(fdata, {'101': ['bad']})
        self.assertEqual(fdata['funds'][0]['analytics'], RECORD)


class YoungStubTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ff-stub-', dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)
        self.patcher = patch.object(prune, 'FUND_DATA_DIR', str(self.dir))
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        self.existing = {
            'holdingsMeta': {'coverage': 'stock_level', 'portfolioDate': '2026-08-31', 'count': 33},
            'holdings': [{'name': 'X', 'pct': 5.0}],
            'stockMoves': {'added': ['X']},
            'analytics': {'alpha': {'n': 40}, 'rollingAlpha': {'spark': [['2026-09', 1.2]], 'windowM': 36}},
            'aum': {'current': 771.5, 'asOf': '2026-08-31'},
            'expenseRatio': 0.21,
            'investInfo': {'availability': {'sip': True}},
            'management': {'managers': ['M']},
            'category': 'Flexi Cap',
            'categoryDisplay': 'Flexi Cap',
            'categorySize': 30,
        }
        self.write(500, self.existing)

    def path(self, code):
        return self.dir / f'{code}.json'

    def write(self, code, data):
        self.path(code).write_text(json.dumps(data), encoding='utf-8')

    def read(self, code):
        return json.loads(self.path(code).read_text(encoding='utf-8'))

    def test_unrelated_fields_survive_the_stub_write(self):
        prune.write_young_stub({'code': 500, 'isYoung': True, 'category': 'Flexi Cap',
                                'categoryDisplay': 'Flexi Cap', 'categorySize': 30})
        after = self.read(500)
        for key in ('analytics', 'aum', 'expenseRatio', 'investInfo', 'management'):
            self.assertEqual(after[key], self.existing[key], key)
        self.assertEqual(after['analytics']['rollingAlpha'], self.existing['analytics']['rollingAlpha'])

    def test_unavailable_holdings_are_cleared(self):
        prune.write_young_stub({'code': 500, 'isYoung': True, 'category': 'Flexi Cap'})
        after = self.read(500)
        self.assertNotIn('holdings', after)
        self.assertNotIn('stockMoves', after)
        self.assertEqual(after['holdingsMeta'], {
            'coverage': 'no_disclosure', 'portfolioDate': None,
            'note': after['holdingsMeta']['note'], 'underlying': None, 'count': 0})
        self.assertIn('new', after['holdingsMeta']['note'])

    def test_debt_fund_gets_the_cash_equivalent_note(self):
        prune.write_young_stub({'code': 500, 'isDebt': True, 'category': 'Liquid'})
        self.assertIn('cash-equivalent', self.read(500)['holdingsMeta']['note'])

    def test_index_category_fields_are_written(self):
        prune.write_young_stub({'code': 501, 'isYoung': True, 'category': 'Small Cap',
                                'categoryDisplay': 'Small Cap', 'categorySize': 22})
        self.assertEqual(self.read(501), {
            'holdingsMeta': self.read(501)['holdingsMeta'],
            'category': 'Small Cap', 'categoryDisplay': 'Small Cap', 'categorySize': 22})

    def test_missing_index_category_fields_do_not_erase_the_existing_values(self):
        prune.write_young_stub({'code': 500, 'isYoung': True})
        after = self.read(500)
        for key in ('category', 'categoryDisplay', 'categorySize'):
            self.assertEqual(after[key], self.existing[key], key)

    def test_unreadable_existing_file_fails_before_it_is_replaced(self):
        corrupt = '{"holdingsMeta": {"coverage":'
        self.path(500).write_text(corrupt, encoding='utf-8')
        with self.assertRaises(json.JSONDecodeError):
            prune.write_young_stub({'code': 500, 'isYoung': True, 'category': 'Flexi Cap'})
        self.assertEqual(self.path(500).read_text(encoding='utf-8'), corrupt)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ['500.json'])

    def test_non_object_existing_file_is_rejected(self):
        self.write(500, ['not', 'an', 'object'])
        with self.assertRaises(ValueError):
            prune.write_young_stub({'code': 500, 'isYoung': True, 'category': 'Flexi Cap'})
        self.assertEqual(self.read(500), ['not', 'an', 'object'])

    def test_stub_write_leaves_no_temporary_file(self):
        prune.write_young_stub({'code': 500, 'isYoung': True, 'category': 'Flexi Cap'})
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ['500.json'])


@unittest.skipIf(MISSING, f'numeric packages not installed: {MISSING}')
class ProducerRunTests(unittest.TestCase):
    """Run the real producer over a fixture tree: synthetic NAV in, analytics out."""

    EQUITY = [701, 702, 703, 704, 705, 706]
    DEBT = 801
    THIN = 802

    def setUp(self):
        self.numeric = load('build_analytics_numeric', 'scripts/build_analytics.py')
        self.temp = tempfile.TemporaryDirectory(prefix='ff-producer-', dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.nav = self.base / 'public/nav'
        self.data = self.base / 'src/data'
        self.nav.mkdir(parents=True)
        self.data.mkdir(parents=True)
        for offset, code in enumerate(self.EQUITY):
            self.write_nav(code, drift=0.0004 + offset * 0.00005, days=2200)
        self.write_nav(self.DEBT, drift=0.00018, days=2200)
        self.write_nav(self.THIN, drift=0.0003, days=40)
        funds = [{'code': code, 'name': f'Fund {code}', 'category': 'Flexi Cap',
                  'analytics': {'stale': True}} for code in self.EQUITY]
        funds.append({'code': self.DEBT, 'name': 'Cash Fund', 'category': 'Liquid',
                      'analytics': {'alpha': {'n': 40}, 'regimes': []}})
        funds.append({'code': self.THIN, 'name': 'New Fund', 'category': 'Flexi Cap',
                      'analytics': {'alpha': {'n': 9}}})
        (self.data / 'funds.json').write_text(json.dumps({'funds': funds}), encoding='utf-8')
        self.patcher = patch.multiple(self.numeric, ROOT=str(self.base), NAV_DIR=str(self.nav))
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def write_nav(self, code, drift, days):
        import datetime
        start = datetime.date(2019, 1, 1)
        dates = []
        values = []
        nav = 100.0
        for i in range(days):
            day = start + datetime.timedelta(days=i)
            if day.weekday() >= 5:
                continue
            nav *= 1 + drift + 0.002 * ((i % 7) - 3) / 3
            dates.append(day.isoformat())
            values.append(round(nav, 4))
        (self.nav / f'{code}.json').write_text(json.dumps({'d': dates, 'v': values}), encoding='utf-8')

    def run_producer(self):
        self.numeric.main()
        analytics = json.loads((self.data / 'fund_analytics.json').read_text(encoding='utf-8'))
        index = {str(f['code']): f for f in
                 json.loads((self.data / 'funds.json').read_text(encoding='utf-8'))['funds']}
        return analytics, index

    def test_reduced_surface_fund_is_emitted_under_its_string_code(self):
        analytics, _ = self.run_producer()
        self.assertEqual(analytics[str(self.DEBT)], {})
        self.assertNotIn(self.DEBT, analytics)

    def test_serialized_producer_output_passes_the_merge_guard(self):
        # JSON always stringifies object keys; this tests persisted output shape,
        # not the in-memory integer-key regression. The latter is pinned by the
        # stdlib guard test above and the end-to-end main() tests.
        analytics, _ = self.run_producer()
        self.numeric.merge_analytics_into_index({'funds': [{'code': self.DEBT}]}, analytics)

    def test_reduced_surface_and_short_history_funds_lose_stale_index_analytics(self):
        _, index = self.run_producer()
        self.assertEqual(index[str(self.DEBT)]['analytics'], {})
        self.assertEqual(index[str(self.THIN)]['analytics'], {})

    def test_equity_funds_receive_the_computed_signals(self):
        analytics, index = self.run_producer()
        for code in self.EQUITY:
            record = analytics[str(code)]
            self.assertIn('alpha', record)
            self.assertIn('capture', record)
            self.assertIn('regimes', record)
            self.assertEqual(index[str(code)]['analytics'], record)
            self.assertNotIn('stale', record)

    def test_rerun_is_stable(self):
        first, _ = self.run_producer()
        second, index = self.run_producer()
        self.assertEqual(first, second)
        self.assertEqual(index[str(self.DEBT)]['analytics'], {})


if __name__ == '__main__':
    unittest.main()
