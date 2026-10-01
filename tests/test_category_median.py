"""Real category benchmark writer, isolated NAV fixtures and no network."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('category_benchmark', ROOT / 'scripts/build_category_median.py')
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)
TODAY = '2026-10-01'

class CategoryMedianTests(unittest.TestCase):
    def test_generator_tracks_latest_usable_nav_date(self):
        with tempfile.TemporaryDirectory(prefix='ff-median-', dir=ROOT.parent) as tmp:
            base = Path(tmp); nav = base/'nav'; nav.mkdir(); out = base/'out'
            funds = [{'code': i, 'category': 'Liquid'} for i in range(5)]
            (base/'funds.json').write_text(json.dumps({'funds': funds}))
            (base/'bench.json').write_text(json.dumps({'medianCategories': {'Liquid': 'liquid'}}))
            for fund in funds:
                (nav/f"{fund['code']}.json").write_text(json.dumps({'d': ['2026-09-28','2026-09-29','2026-09-30',TODAY,'2026-10-02','2026-02-30'], 'v': [100,101,102,103,104,90]}))
            with patch.multiple(benchmark, FUNDS_JSON=str(base/'funds.json'), BENCH_JSON=str(base/'bench.json'), NAV_DIR=str(nav), OUT_DIR=str(out)), patch.object(benchmark, 'ist_today', return_value=TODAY):
                benchmark.main()
                first = (out/'liquid.json').read_text()
                benchmark.main()
                self.assertEqual(first, (out/'liquid.json').read_text())
            result=json.loads(first)
            self.assertEqual(result['d'], ['2026-09-29','2026-09-30',TODAY])
            self.assertEqual(result['asOf'], TODAY)
            self.assertEqual(result['generated'], TODAY)
            self.assertAlmostEqual(result['v'][-1], 100*103/101, places=4)

    def test_missing_category_data_fails_instead_of_silently_keeping_stale_file(self):
        with tempfile.TemporaryDirectory(prefix='ff-median-', dir=ROOT.parent) as tmp:
            base=Path(tmp); out=base/'out'; out.mkdir()
            (out/'liquid.json').write_text('{"stale":true}')
            (base/'funds.json').write_text('{"funds":[]}')
            (base/'bench.json').write_text('{"medianCategories":{"Liquid":"liquid"}}')
            with patch.multiple(benchmark, FUNDS_JSON=str(base/'funds.json'), BENCH_JSON=str(base/'bench.json'), NAV_DIR=str(base), OUT_DIR=str(out)):
                with self.assertRaises(RuntimeError): benchmark.main()
            self.assertEqual((out/'liquid.json').read_text(), '{"stale":true}')

if __name__ == '__main__': unittest.main()
