"""Sitemap publication and stable landing-page contracts, synthetic input only."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get('FF_NODE') or shutil.which('node')
SITE = 'https://nishants-lab.github.io/fairfund'

class SeoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='ff-seo-', dir=ROOT.parent)
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        for folder in ['scripts', 'src/data', 'dist']:
            (self.base/folder).mkdir(parents=True)
        for name in ['gen-sitemap.mjs','gen-unfurls.mjs','site-config.mjs','research-pages.mjs']:
            shutil.copyfile(ROOT/'scripts'/name, self.base/'scripts'/name)
        shutil.copyfile(ROOT/'src/data/stock_names.json', self.base/'src/data/stock_names.json')
        self.data = {'funds':[{'code':1,'name':'Example Fund','fullName':'Example Fund - Direct Plan - Growth','amc':'Example','category':'Large Cap','categoryDisplay':'Large Cap','metrics':{}}], 'totalFunds':1,'categories':{'Large Cap':{'fundCount':1,'display':'Large Cap'}}}
        self.save_data()
        (self.base/'dist/index.html').write_text('<html><body><h1>FairFund</h1></body></html>')
        self.assertEqual(self.run_script('gen-unfurls.mjs').returncode,0)

    def save_data(self):
        (self.base/'src/data/funds.json').write_text(json.dumps(self.data),encoding='utf-8')

    def run_script(self, name='gen-sitemap.mjs'):
        return subprocess.run([NODE,str(self.base/'scripts'/name)],cwd=self.base,text=True,capture_output=True,timeout=30)

    def test_valid_complete_sitemap_no_invented_modification_dates(self):
        result=self.run_script();self.assertEqual(result.returncode,0,result.stderr)
        tree=ET.fromstring((self.base/'dist/sitemap.xml').read_bytes())
        self.assertEqual(tree.tag,'{http://www.sitemaps.org/schemas/sitemap/0.9}urlset')
        locs=[n.text for n in tree.findall('{*}url/{*}loc')]
        self.assertEqual(len(locs),8);self.assertEqual(len(set(locs)),8)
        self.assertIn(SITE+'/s/nfo/',locs)
        self.assertTrue(all(u.startswith(SITE+'/') and '#' not in u for u in locs))
        self.assertFalse(tree.findall('{*}url/{*}lastmod'))

    def test_missing_pages_fail_without_overwriting_existing_sitemap(self):
        for path in ['index.html','f/1/index.html','c/large-cap/index.html','s/explore/index.html','s/nfo/index.html']:
            with self.subTest(path=path):
                file=self.base/'dist'/path;original=file.read_bytes();file.unlink()
                marker=self.base/'dist/sitemap.xml';marker.write_text('previous artifact')
                result=self.run_script();self.assertNotEqual(result.returncode,0)
                self.assertIn('Missing sitemap page',result.stderr)
                self.assertEqual(marker.read_text(),'previous artifact');file.write_bytes(original)

    def test_duplicate_and_invalid_fund_inventory_fail(self):
        for code in [1,'../bad',0]:
            with self.subTest(code=code):
                self.data['funds'].append({**self.data['funds'][0],'code':code});self.save_data()
                self.assertNotEqual(self.run_script().returncode,0)
                self.data['funds'].pop()

    def test_duplicate_category_slug_fails(self):
        self.data['categories']['Large-Cap']={'fundCount':1};self.save_data()
        result=self.run_script();self.assertNotEqual(result.returncode,0)
        self.assertIn('Duplicate sitemap path',result.stderr)

    def test_redirect_or_canonical_regression_fails(self):
        file=self.base/'dist/f/1/index.html';original=file.read_text()
        for addition in ['<script>location.replace("/")</script>','<meta http-equiv="refresh" content="0;url=/">']:
            file.write_text(original+addition)
            result=self.run_script();self.assertNotEqual(result.returncode,0)
            self.assertIn('Automatic redirect',result.stderr)
        file.write_text(original.replace(SITE+'/f/1/',SITE+'/f/2/'))
        result=self.run_script();self.assertNotEqual(result.returncode,0)
        self.assertIn('Canonical mismatch',result.stderr)

    def test_all_reports_have_only_jsonld_scripts_and_explicit_app_link(self):
        for file in (self.base/'dist').glob('*/*/index.html'):
            html=file.read_text()
            scripts=re.findall(r'<script\b([^>]*)>(.*?)</script>',html,re.S|re.I)
            self.assertTrue(scripts)
            for attrs,body in scripts:
                self.assertIn('type="application/ld+json"',attrs)
                json.loads(body)
            self.assertIn('href="../../#/',html)
            self.assertIn('aria-label="Research pages"',html)
            self.assertNotRegex(html,r'(?i)http-equiv=[\"\']refresh')

    def test_snapshot_date_and_same_category_fund_links(self):
        self.data['anchor'] = '2026-09-30'
        self.data['funds'].append({'code':2,'name':'Other Fund','amc':'Example','category':'Other','metrics':{}})
        self.save_data()
        self.assertEqual(self.run_script('gen-unfurls.mjs').returncode,0)
        html=(self.base/'dist/c/large-cap/index.html').read_text()
        self.assertIn('<time datetime="2026-09-30">2026-09-30</time>',html)
        self.assertIn('Reporting periods can differ.',html)
        self.assertIn(SITE+'/f/1/',html)
        self.assertNotIn(SITE+'/f/2/',html)
        self.data['anchor'] = '<script>invalid</script>'
        self.save_data()
        self.assertEqual(self.run_script('gen-unfurls.mjs').returncode,0)
        self.assertNotIn('<time', (self.base/'dist/c/large-cap/index.html').read_text())

    def test_fund_table_shows_actual_rank_window_not_only_global_anchor(self):
        self.data['anchor'] = '2026-09-30'
        self.data['funds'][0]['metrics'] = {'3Y': {'windowStart': '2023-09-29', 'windowEnd': '2026-09-29', 'cagr': 10, 'alpha': 1, 'catRank': 2, 'catSize': 4, 'sharpe': 1, 'maxDrawdown': -10}}
        self.save_data()
        result = self.run_script('gen-unfurls.mjs')
        self.assertEqual(result.returncode, 0, result.stderr)
        html = (self.base/'dist/f/1/index.html').read_text()
        self.assertIn('29 Sep 2023 to 29 Sep 2026', html)
        self.assertIn('#2 of 4', html)

    def test_explorer_metrics_have_scroll_region(self):
        html=(self.base/'dist/s/explore/index.html').read_text()
        self.assertIn('class="metrics-scroll" role="region" aria-label="Category metrics" tabindex="0"><table',html)

    def test_cash_like_and_arbitrage_fund_pages_leave_out_sharpe_and_drawdown(self):
        m={'3Y':{'cagr':6.9,'alpha':0.1,'catRank':3,'catSize':30,'sharpe':-8.4,'maxDrawdown':-0.1}}
        self.data['funds']=[dict(self.data['funds'][0],code=1,metrics=m),
                            dict(self.data['funds'][0],code=2,name='Liquid Example Fund',category='Liquid',categoryDisplay='Liquid',isDebt=True,metrics=m),
                            dict(self.data['funds'][0],code=3,name='Arbitrage Example Fund',category='Arbitrage',categoryDisplay='Arbitrage',isArbitrage=True,metrics=m)]
        self.data['totalFunds']=3;self.save_data()
        result=self.run_script('gen-unfurls.mjs');self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('Sharpe ratio',(self.base/'dist/f/1/index.html').read_text())
        for code in (2,3):
            html=(self.base/f'dist/f/{code}/index.html').read_text()
            self.assertNotIn('Sharpe ratio',html);self.assertNotIn('-8.4',html);self.assertNotIn('max drawdown',html)
            self.assertIn('#3 of 30',html)

    def test_held_fund_page_withholds_returns_and_ranks(self):
        # The live data may have no held fund (seo-browser then skips its held page), so this keeps the copy covered.
        m={'3Y':{'cagr':14.2,'catRank':2,'catSize':9,'windowStart':'2023-11-04','windowEnd':'2026-11-04'}}
        self.data['funds']=[dict(self.data['funds'][0],metrics=m,dataQuality={'status':'quarantined'})];self.save_data()
        result=self.run_script('gen-unfurls.mjs');self.assertEqual(result.returncode,0,result.stderr)
        html=(self.base/'dist/f/1/index.html').read_text(encoding='utf-8')
        self.assertIn('<p role="status">NAV history needs source verification.',html)
        main=html[html.index('<main>'):]
        self.assertNotRegex(main,r'ranks #|CAGR [+-]?[0-9]|14\.2%')

    def test_nfo_table_has_two_columns_that_fit_a_phone(self):
        nfo={'generatedAt':'2026-11-05','nfos':[{'code':9,'name':'Example Nifty Realty Index Fund','amc':'Example AMC','category':'Index-Sectoral/Thematic',
             'launchDate':'2026-10-26','closeDate':'2099-11-09','nav':None,'details':{'benchmark':'NIFTY Realty TRI'}}]}
        (self.base/'src/data/nfo.json').write_text(json.dumps(nfo),encoding='utf-8')
        result=self.run_script('gen-unfurls.mjs');self.assertEqual(result.returncode,0,result.stderr)
        html=(self.base/'dist/s/nfo/index.html').read_text()
        table=re.search(r'<table.*?</table>',html,re.S).group(0)
        self.assertEqual(len(re.findall(r'<th\b',table)),2)
        self.assertEqual(len(re.findall(r'<td\b',table)),2)
        self.assertIn('Benchmark: NIFTY Realty TRI',table)
        self.assertIn('Index - Sectoral/Thematic',table)
        self.assertIn('Open until 2099-11-09',table)

    def test_external_names_cannot_break_out_of_jsonld(self):
        name='Example </script><script>alert(1)</script> & Fund'
        self.data['funds'][0]['name']=name;self.save_data()
        result=self.run_script('gen-unfurls.mjs');self.assertEqual(result.returncode,0,result.stderr)
        html=(self.base/'dist/f/1/index.html').read_text()
        scripts=re.findall(r'<script\b[^>]*>(.*?)</script>',html,re.S|re.I)
        self.assertEqual(len(scripts),1)
        graph=json.loads(scripts[0])['@graph']
        self.assertEqual(graph[0]['name'],name)
        self.assertEqual(graph[1]['itemListElement'][-1]['name'],name)
        self.assertNotIn('<script>alert',html)

    def test_fund_page_targets_search_and_links_into_the_app(self):
        f=self.data['funds'][0]
        f.update({'expenseRatio':0.55,'aum':{'current':12345.6},'metrics':{'3Y':{'cagr':14.21,'catRank':2,'catSize':9,'windowStart':'2023-11-04','windowEnd':'2026-11-04'}}})
        self.save_data()
        result=self.run_script('gen-unfurls.mjs');self.assertEqual(result.returncode,0,result.stderr)
        html=(self.base/'dist/f/1/index.html').read_text()
        self.assertIn('<title>Example Fund Direct Growth: returns, expense ratio | FairFund</title>',html)
        self.assertIn('Large Cap &middot; Example &middot; Direct &middot; Growth &middot;',html)
        desc=re.search(r'<meta name="description" content="([^"]*)"',html).group(1)
        self.assertTrue(desc.startswith('Example Fund (Example, Large Cap, direct plan): 3Y return 14.2% a year, rank #2 of 9'),desc)
        self.assertIn('expense ratio 0.55%',desc)
        graph=json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>',html,re.S).group(1))['@graph']
        self.assertEqual([c['name'] for c in graph[1]['itemListElement']],['FairFund','Large Cap','Example Fund'])
        self.assertEqual(graph[1]['itemListElement'][1]['item'],SITE+'/c/large-cap/')
        h1=html.index('<h1'); app=html.index('href="../../#/fund/1/')
        self.assertLess(app-h1,1200,'app link sits right under the title')
        self.assertIn('https://wa.me/?text=',html)
        self.assertNotRegex(html,r'<script(?![^>]*application/ld\+json)')

    def test_category_page_ranks_funds_and_shows_sebi_risk(self):
        base={'amc':'Example','category':'Large Cap','categoryDisplay':'Large Cap','sebiRisk':'Very High'}
        self.data['funds']=[
            {**base,'code':1,'name':'Alpha Fund','expenseRatio':0.5,'metrics':{'3Y':{'cagr':15.0,'catRank':1,'catSize':2,'windowEnd':'2026-11-04'}}},
            {**base,'code':2,'name':'Beta Fund','expenseRatio':0.9,'metrics':{'3Y':{'cagr':12.0,'catRank':2,'catSize':2,'windowEnd':'2026-11-04'}}},
            {**base,'code':3,'name':'Young Fund','metrics':{}},
        ]
        self.data['categories']['Large Cap']={'fundCount':3,'display':'Large Cap','riskLevel':'Moderate'}
        self.save_data()
        result=self.run_script('gen-unfurls.mjs');self.assertEqual(result.returncode,0,result.stderr)
        html=(self.base/'dist/c/large-cap/index.html').read_text()
        self.assertIn('<title>Large Cap funds compared: 3Y returns, ranks, expense ratios | FairFund</title>',html)
        self.assertIn('SEBI riskometer for most: Very High',html)
        self.assertNotIn('Moderate risk',html)
        self.assertLess(html.index('Alpha Fund'),html.index('Beta Fund'))
        self.assertIn('#1 of 2',html)
        for code in (1,2,3): self.assertIn(f'{SITE}/f/{code}/',html)
        self.assertIn('Funds without a 3-year rank yet',html)

if __name__ == '__main__':
    unittest.main()
