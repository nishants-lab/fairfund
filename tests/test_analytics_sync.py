"""Shared analytics synchronization tested on synthetic files only."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('analytics_sync', ROOT/'scripts/sync_analytics_to_shells.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class AnalyticsSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ff-sync-', dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name); self.details=self.base/'details'; self.details.mkdir()
        self.source={'1': {'alpha': {'n': 100, 'confidence': 80}}, '2': {}}
        self.write('analytics.json',self.source)
        self.write('funds.json',{'funds':[{'code':int(c),'analytics':a} for c,a in self.source.items()]})
        self.write('details/1.json', {'analytics': {'alpha': {'n':99}, 'regimes': ['stale'], 'rollingAlpha': {'spark':[['2026-09',1]], 'windowM':36}, 'extension': {'keep':True}}, 'aum':{'current':771.5,'asOf':'2026-08-31'}, 'investInfo':{'availability':{'sip':False}}})
        self.write('details/2.json', {'analytics': {'alpha': {'n': 10}, 'rollingAlpha': {'keep':True}}, 'holdings':[]})
        self.patcher=patch.multiple(sync,FA_PATH=self.base/'analytics.json',FUNDS_PATH=self.base/'funds.json',DETAIL_DIR=self.details)
        self.patcher.start(); self.addCleanup(self.patcher.stop)
    def write(self,path,data): (self.base/path).write_text(json.dumps(data),encoding='utf-8')
    def read(self,code): return json.loads((self.details/f'{code}.json').read_text(encoding='utf-8'))
    def fingerprints(self): return {p.name:(p.read_bytes(),p.stat().st_mtime_ns) for p in self.details.glob('*.json')}

    def test_sync_replaces_shared_fields_preserving_extensions_and_other_data(self):
        before=self.read(1); self.assertEqual(sync.main([]),0); after=self.read(1)
        self.assertEqual(sync.shared(after['analytics']),self.source['1'])
        for key in ('rollingAlpha','extension'): self.assertEqual(before['analytics'][key],after['analytics'][key])
        for key in ('aum','investInfo'): self.assertEqual(before[key],after[key])

    def test_empty_record_clears_stale_shared_fields(self):
        sync.main([])
        self.assertEqual(self.read(2)['analytics'], {'rollingAlpha':{'keep':True}})

    def test_missing_analytics_object_is_created(self):
        self.write('details/1.json',{'holdings':[]}); sync.main([])
        self.assertEqual(self.read(1),{'holdings':[],'analytics':self.source['1']})

    def test_source_index_disagreement_fails_before_any_write(self):
        self.write('funds.json',{'funds':[{'code':1,'analytics':self.source['1']},{'code':2,'analytics':{'alpha':{'n':44}}}]})
        before=self.fingerprints()
        with self.assertRaises(ValueError): sync.main([])
        self.assertEqual(before,self.fingerprints())

    def test_missing_later_shell_fails_preflight_before_any_write(self):
        (self.details/'2.json').unlink(); before=self.fingerprints()
        with self.assertRaises(FileNotFoundError): sync.main([])
        self.assertEqual(before,self.fingerprints())

    def test_dry_run_and_check_are_read_only(self):
        before=self.fingerprints()
        self.assertEqual(sync.main(['--dry-run']),0)
        self.assertEqual(sync.main(['--check']),1)
        self.assertEqual(before,self.fingerprints())

    def test_second_sync_is_idempotent_and_check_passes(self):
        sync.main([]); before=self.fingerprints()
        self.assertEqual(sync.main([]),0); self.assertEqual(sync.main(['--check']),0)
        self.assertEqual(before,self.fingerprints())

    def test_absent_source_is_allowed_only_for_empty_index_analytics(self):
        self.write('analytics.json', {'1':self.source['1']})
        self.assertEqual(sync.main([]),0)
        self.assertEqual(sync.shared(self.read(2)['analytics']), {})
        self.write('analytics.json', {})
        before=self.fingerprints()
        with self.assertRaises(ValueError): sync.main([])
        self.assertEqual(before,self.fingerprints())

    def test_bundle_rolling_alpha_is_rejected(self):
        self.source['1']['rollingAlpha']={'bad':True}
        self.write('analytics.json',self.source)
        self.write('funds.json',{'funds':[{'code':1,'analytics':self.source['1']},{'code':2,'analytics':{}}]})
        before=self.fingerprints()
        with self.assertRaises(ValueError): sync.main([])
        self.assertEqual(before,self.fingerprints())

if __name__ == '__main__': unittest.main()
