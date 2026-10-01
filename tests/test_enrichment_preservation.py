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
            funds=base/'funds.json';funds.write_text(json.dumps({'funds':[{'code':1,'name':'Keep','metrics':{'1Y':{'cagr':5}}}]}))
            with patch.multiple(enrich,HISTORY_DIR=hist,DETAIL_DIR=details,FUNDS_PATH=funds):
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
            index=json.loads(funds.read_text())['funds'][0]
            self.assertEqual(index['aum'],after['aum'])
            self.assertEqual(index['expenseRatio'],after['expenseRatio'])
            self.assertEqual(index['name'],'Keep')
            self.assertEqual(index['metrics'],{'1Y':{'cagr':5}})

    def test_missing_invalid_disclosures_do_not_copy_arbitrary_detail_or_erase_index(self):
        with tempfile.TemporaryDirectory(prefix='ff-enrich-', dir=ROOT.parent) as tmp:
            base=Path(tmp); hist=base/'history'; details=base/'details'; hist.mkdir(); details.mkdir()
            fund={'code':1,'aum':{'current':100,'asOf':'2026-08-31'},'expenseRatio':0.2}
            funds=base/'funds.json'; funds.write_text(json.dumps({'funds':[fund]}))
            (details/'1.json').write_text(json.dumps({'aum':{'current':999},'expenseRatio':0.8}))
            for er, aum in ((None,None), ('NaN',float('inf')), (-1,True)):
                (hist/'1.json').write_text(json.dumps({'snapshots':{'2026-09-30':{'expense_ratio':er,'aum':aum}}}))
                with patch.multiple(enrich,HISTORY_DIR=hist,DETAIL_DIR=details,FUNDS_PATH=funds):
                    enrich.main()
                self.assertEqual(json.loads(funds.read_text())['funds'][0],fund)

    def test_disclosed_costs_feed_the_next_debt_ranking(self):
        ranking_spec=importlib.util.spec_from_file_location('enriched_rankings',ROOT/'pipeline/compute_rankings.py')
        rankings=importlib.util.module_from_spec(ranking_spec);ranking_spec.loader.exec_module(rankings)
        with tempfile.TemporaryDirectory(prefix='ff-enrich-rank-',dir=ROOT.parent) as tmp:
            base=Path(tmp);hist=base/'history';details=base/'details';hist.mkdir();details.mkdir()
            data={'funds':[{'code':code,'category':'Liquid','expenseRatio':ter,
                            'aum':{'current':100},'metrics':{'1Y':{'cagr':5}}}
                           for code,ter in ((1,0.1),(2,0.9))]}
            rankings.recompute_rankings(data)
            self.assertEqual(data['funds'][0]['metrics']['1Y']['catRank'],1)
            funds=base/'funds.json';funds.write_text(json.dumps(data))
            for code,ter in ((1,0.9),(2,0.1)):
                (details/f'{code}.json').write_text('{}')
                (hist/f'{code}.json').write_text(json.dumps({'snapshots':{'2026-09-30':{'expense_ratio':ter,'aum':100}}}))
            with patch.multiple(enrich,HISTORY_DIR=hist,DETAIL_DIR=details,FUNDS_PATH=funds):
                enrich.main()
            after=json.loads(funds.read_text());rankings.recompute_rankings(after)
            self.assertEqual(after['funds'][1]['metrics']['1Y']['catRank'],1)
            for fund in after['funds']:
                detail=json.loads((details/f"{fund['code']}.json").read_text())
                self.assertEqual(fund['expenseRatio'],detail['expenseRatio'])
                self.assertEqual(fund['aum'],detail['aum'])

if __name__ == '__main__': unittest.main()
