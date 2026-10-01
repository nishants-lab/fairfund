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
        for name in ['gen-sitemap.mjs','gen-unfurls.mjs','site-config.mjs']:
            shutil.copyfile(ROOT/'scripts'/name, self.base/'scripts'/name)
        self.data = {'funds':[{'code':1,'name':'Example Fund','amc':'Example','category':'Large Cap','categoryDisplay':'Large Cap','metrics':{}}], 'totalFunds':1,'categories':{'Large Cap':{'fundCount':1,'display':'Large Cap'}}}
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
        self.assertEqual(len(locs),7);self.assertEqual(len(set(locs)),7)
        self.assertTrue(all(u.startswith(SITE+'/') and '#' not in u for u in locs))
        self.assertFalse(tree.findall('{*}url/{*}lastmod'))

    def test_missing_pages_fail_without_overwriting_existing_sitemap(self):
        for path in ['index.html','f/1/index.html','c/large-cap/index.html','s/explore/index.html']:
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
        self.assertIn('2023-09-29 to 2026-09-29', html)
        self.assertIn('Rank #2/4', html)

    def test_explorer_metrics_have_scroll_region(self):
        html=(self.base/'dist/s/explore/index.html').read_text()
        self.assertIn('class="metrics-scroll" role="region" aria-label="Category metrics" tabindex="0"><table',html)

    def test_external_names_cannot_break_out_of_jsonld(self):
        name='Example </script><script>alert(1)</script> & Fund'
        self.data['funds'][0]['name']=name;self.save_data()
        result=self.run_script('gen-unfurls.mjs');self.assertEqual(result.returncode,0,result.stderr)
        html=(self.base/'dist/f/1/index.html').read_text()
        scripts=re.findall(r'<script\b[^>]*>(.*?)</script>',html,re.S|re.I)
        self.assertEqual(len(scripts),1)
        self.assertEqual(json.loads(scripts[0])['name'],name)
        self.assertNotIn('<script>alert',html)

if __name__ == '__main__':
    unittest.main()
