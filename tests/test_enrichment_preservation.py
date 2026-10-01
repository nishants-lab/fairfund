"""Monthly enrichment must not erase data owned by another producer."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('monthly_enrichment',ROOT/'scripts/enrich_fund_data.py')
enrich=importlib.util.module_from_spec(spec);spec.loader.exec_module(enrich)

class EnrichmentPreservationTests(unittest.TestCase):
    def test_monthly_enrichment_preserves_separately_dated_availability(self):
        with tempfile.TemporaryDirectory(prefix='ff-enrich-',dir=ROOT.parent) as tmp:
            base=Path(tmp);hist=base/'history';details=base/'details';hist.mkdir();details.mkdir()
            availability={'sip':False,'lumpsum':False,'redemption':True,'asOf':'2026-09-01','source':'fixture'}
            detail={'investInfo':{'availability':availability,'exit_load':'unchanged','min_sip':1000},'holdings':[{'name':'preserve'}],'analytics':{'rollingAlpha':{'spark':[['2026-08',1]]}}}
            (details/'1.json').write_text(json.dumps(detail))
            (hist/'1.json').write_text(json.dumps({'snapshots':{'2026-08-31':{'min_sip':500,'min_lumpsum':None,'aum':123,'expense_ratio':0.3}}}))
            with patch.multiple(enrich,HISTORY_DIR=hist,DETAIL_DIR=details):
                enrich.main(); first=(details/'1.json').read_bytes();enrich.main()
            after=json.loads(first)
            self.assertEqual(after['investInfo']['availability'],availability)
            self.assertEqual(after['investInfo']['exit_load'],'unchanged')
            self.assertEqual(after['investInfo']['min_sip'],500)
            self.assertNotIn('min_lumpsum',after['investInfo'])
            self.assertEqual(after['holdings'],detail['holdings'])
            self.assertEqual(after['analytics'],detail['analytics'])
            self.assertEqual(after['aum'],{'current':123.0,'asOf':'2026-08-31'})
            self.assertEqual(first,(details/'1.json').read_bytes())

if __name__ == '__main__': unittest.main()
