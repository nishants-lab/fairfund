"""Exercise the remaining shared anchor, metric-reader and NAV-sync boundaries."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

config = load('date_config', 'pipeline/config.py')
metrics = load('date_metrics', 'pipeline/compute_metrics.py')
sync = load('date_sync', 'scripts/sync_nav_files.py')
TODAY = '2026-10-01'

class PipelineDateBoundariesTests(unittest.TestCase):
    def test_anchor_ignores_invalid_tails_and_uses_last_usable_observation(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent, prefix='ff-anchor-') as tmp:
            for code in range(3):
                Path(tmp, f'{code}.json').write_text(json.dumps({'d': ['2026-09-30', TODAY, '2026-10-02', 'bad']}))
            self.assertEqual(config.robust_latest_nav_date(tmp, TODAY, 3), TODAY)

    def test_anchor_default_is_ist_and_not_host_today(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent, prefix='ff-anchor-') as tmp:
            Path(tmp, '1.json').write_text(json.dumps({'d': [TODAY]}))
            with patch.object(config, 'ist_today', return_value=TODAY) as clock:
                self.assertEqual(config.robust_latest_nav_date(tmp, min_funds=1), TODAY)
                clock.assert_called_once()

    def test_metric_reader_filters_future_invalid_and_nonfinite_nav(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent, prefix='ff-metric-date-') as tmp:
            Path(tmp, '1.json').write_text(json.dumps({'d': ['2026-09-29','2026-09-30',TODAY,'2026-10-02','2026-02-30'], 'v':[100, float('inf'), 110, 120, 90]}))
            with patch.object(metrics, 'NAV_DIR', tmp), patch.object(metrics, 'ist_today', return_value=TODAY):
                self.assertEqual(metrics.load_nav(1), [('2026-09-29',100),(TODAY,110)])

    def test_sync_compact_validates_sorts_and_deduplicates(self):
        payload = [{'date': d, 'nav': v} for d,v in [('02-10-2026','12'),('30-09-2026','10'),('01-10-2026','11'),('30-02-2026','9'),('30-09-2026','10'),('29-09-2026','NaN'),('28-09-2026','Infinity')]]
        with patch.object(sync, 'ist_today', return_value=TODAY):
            self.assertEqual(sync.compact(payload), (['2026-09-30',TODAY],[10.0,11.0]))

    def test_sync_future_only_has_no_output(self):
        with patch.object(sync, 'ist_today', return_value=TODAY):
            self.assertEqual(sync.compact([{'date':'02-10-2026','nav':'10'}]), ([],[]))

if __name__ == '__main__':
    unittest.main()
