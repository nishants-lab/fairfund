"""Crawlable homepage (gen-home.mjs) and IndexNow submission contracts, synthetic input only."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get('FF_NODE') or shutil.which('node')
SITE = 'https://nishants-lab.github.io/fairfund'
TEMPLATE = '<!doctype html><html lang="en"><head><title>FairFund</title></head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>'


class CrawlSurfaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='ff-crawl-', dir=ROOT.parent)
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        for folder in ['scripts', 'src/data', 'dist']:
            (self.base/folder).mkdir(parents=True)
        for name in ['gen-sitemap.mjs', 'gen-unfurls.mjs', 'gen-home.mjs', 'site-config.mjs', 'indexnow-submit.mjs']:
            shutil.copyfile(ROOT/'scripts'/name, self.base/'scripts'/name)
        self.data = {'funds': [{'code': 1, 'name': 'Example Fund', 'amc': 'Example', 'category': 'Large Cap', 'categoryDisplay': 'Large Cap', 'metrics': {}},
                               {'code': 2, 'name': 'Other Fund', 'amc': 'Other', 'category': 'Mid Cap', 'categoryDisplay': 'Mid Cap', 'metrics': {}}],
                     'totalFunds': 2,
                     'categories': {'Large Cap': {'fundCount': 1, 'display': 'Large Cap'}, 'Mid Cap': {'fundCount': 1, 'display': 'Mid Cap'}}}
        self.build()

    def build(self):
        (self.base/'src/data/funds.json').write_text(json.dumps(self.data), encoding='utf-8')
        (self.base/'dist/index.html').write_text(TEMPLATE, encoding='utf-8')
        r = self.run_script('gen-unfurls.mjs'); self.assertEqual(r.returncode, 0, r.stderr)

    def run_script(self, name, *args):
        return subprocess.run([NODE, str(self.base/'scripts'/name), *args], cwd=self.base, text=True, capture_output=True, timeout=60)

    def home(self):
        return (self.base/'dist/index.html').read_text(encoding='utf-8')

    # ---- gen-home.mjs ----
    def test_homepage_gets_text_links_canonical_and_jsonld(self):
        r = self.run_script('gen-home.mjs'); self.assertEqual(r.returncode, 0, r.stderr)
        html = self.home()
        self.assertIn('<h1', html)
        self.assertEqual(html.count('rel="canonical"'), 1)
        self.assertIn(f'<link rel="canonical" href="{SITE}/" />', html)
        ld = json.loads(re.search(r'<script type="application/ld\+json" id="ff-home-jsonld">(.*?)</script>', html).group(1))
        self.assertEqual((ld['@type'], ld['url']), ('WebSite', f'{SITE}/'))
        hrefs = re.findall(r'<a href="([^"]+)"', html)
        for path in ['s/explore/', 's/compare/', 's/movers/', 's/methodology/', 'c/large-cap/', 'c/mid-cap/']:
            self.assertIn(f'{SITE}/{path}', hrefs)
        for href in hrefs:
            self.assertTrue(href.startswith(SITE + '/'), href)
            self.assertTrue((self.base/'dist'/href[len(SITE) + 1:]/'index.html').exists(), href)
        # Content lives inside #root so React replaces it on mount; app script untouched.
        self.assertRegex(html, r'<div id="root"><!--crawl-home--><main')
        self.assertIn('<script type="module" src="./app.js"></script>', html)
        self.assertIn('not investment advice', html)

    def test_homepage_injection_is_idempotent(self):
        for _ in range(2):
            r = self.run_script('gen-home.mjs'); self.assertEqual(r.returncode, 0, r.stderr)
        html = self.home()
        self.assertEqual(html.count('<!--crawl-home-->'), 1)
        self.assertEqual(html.count('rel="canonical"'), 1)
        self.assertEqual(html.count('id="ff-home-jsonld"'), 1)

    def test_homepage_fails_on_missing_linked_page(self):
        (self.base/'dist/c/mid-cap/index.html').unlink()
        before = self.home()
        r = self.run_script('gen-home.mjs')
        self.assertNotEqual(r.returncode, 0); self.assertIn('missing page', r.stderr)
        self.assertEqual(self.home(), before)

    def test_homepage_fails_without_exactly_one_root(self):
        for broken in [TEMPLATE.replace('<div id="root"></div>', ''), TEMPLATE.replace('<div id="root"></div>', '<div id="root"></div><div id="root"></div>')]:
            (self.base/'dist/index.html').write_text(broken, encoding='utf-8')
            r = self.run_script('gen-home.mjs')
            self.assertNotEqual(r.returncode, 0)
            self.assertIn('exactly one #root', r.stderr)

    def test_homepage_escapes_category_names(self):
        self.data['categories']['Large Cap']['display'] = 'A&B <script>x</script>'
        self.build()
        r = self.run_script('gen-home.mjs'); self.assertEqual(r.returncode, 0, r.stderr)
        html = self.home()
        self.assertNotIn('<script>x</script>', html)
        self.assertIn('A&amp;B &lt;script&gt;', html)

    def test_sitemap_still_valid_after_homepage_injection(self):
        self.assertEqual(self.run_script('gen-home.mjs').returncode, 0)
        r = self.run_script('gen-sitemap.mjs'); self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f'<loc>{SITE}/</loc>', (self.base/'dist/sitemap.xml').read_text())

    # ---- indexnow-submit.mjs ----
    def write_sitemap(self, urls):
        p = self.base/'sm.xml'
        p.write_text('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(f'<url><loc>{u}</loc></url>' for u in urls) + '</urlset>')
        return str(p)

    def test_indexnow_dry_run_payload(self):
        self.assertEqual(self.run_script('gen-home.mjs').returncode, 0)
        self.assertEqual(self.run_script('gen-sitemap.mjs').returncode, 0)
        r = self.run_script('indexnow-submit.mjs', '--dry-run', '--sitemap', str(self.base/'dist/sitemap.xml'))
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        key = re.search(r"INDEXNOW_KEY = '([^']+)'", (ROOT/'scripts/site-config.mjs').read_text()).group(1)
        self.assertEqual(out['host'], 'nishants-lab.github.io')
        self.assertEqual(out['keyLocation'], f'{SITE}/{key}.txt')
        self.assertEqual(out['urls'], len(ET_locs(self.base/'dist/sitemap.xml')))

    def test_indexnow_rejects_bad_sitemaps(self):
        cases = {'foreign': [f'{SITE}/', 'https://example.com/x/'], 'other project': [f'{SITE}/', 'https://nishants-lab.github.io/other/'],
                 'fragment': [f'{SITE}/#/fund/1'], 'http': ['http://nishants-lab.github.io/fairfund/'], 'empty': []}
        for name, urls in cases.items():
            r = self.run_script('indexnow-submit.mjs', '--dry-run', '--sitemap', self.write_sitemap(urls))
            self.assertNotEqual(r.returncode, 0, name)

    def test_indexnow_key_file_is_published(self):
        key = re.search(r"INDEXNOW_KEY = '([^']+)'", (ROOT/'scripts/site-config.mjs').read_text()).group(1)
        self.assertRegex(key, r'^[a-f0-9]{32}$')
        self.assertEqual((ROOT/'public'/f'{key}.txt').read_text(encoding='utf-8').strip(), key)

    def test_indexnow_retries_only_transient_rejections(self):
        script = self.base/'retry_check.mjs'
        script.write_text("""
import { submitWithRetry } from './scripts/indexnow-submit.mjs'
const body = { urlList: ['u'] }
async function run(seq) {
  const calls = []; let i = 0
  const post = async () => { calls.push(1); return seq[Math.min(i++, seq.length - 1)] }
  try { const s = await submitWithRetry(body, { attempts: 4, waitMs: 1, post, log: () => {} }); return { ok: s, calls: calls.length } }
  catch (e) { return { err: e.message, calls: calls.length } }
}
const verify = { status: 403, text: '{"errorCode":"SiteVerificationNotCompleted"}' }
console.log(JSON.stringify({
  verifyThenOk: await run([verify, verify, { status: 202, text: '' }]),
  rateThenOk: await run([{ status: 429, text: '' }, { status: 200, text: '' }]),
  badKey: await run([{ status: 403, text: '{"errorCode":"InvalidKey"}' }]),
  badRequest: await run([{ status: 422, text: '' }]),
  neverVerified: await run([verify]),
}))
""", encoding='utf-8')
        r = subprocess.run([NODE, str(script)], cwd=self.base, text=True, capture_output=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out['verifyThenOk'], {'ok': 202, 'calls': 3})
        self.assertEqual(out['rateThenOk'], {'ok': 200, 'calls': 2})
        self.assertEqual(out['badKey']['calls'], 1); self.assertIn('HTTP 403', out['badKey']['err'])
        self.assertEqual(out['badRequest']['calls'], 1)
        self.assertEqual(out['neverVerified']['calls'], 4)

    def test_build_runs_home_between_unfurls_and_sitemap(self):
        build = json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['scripts']['build']
        self.assertRegex(build, r'gen-unfurls\.mjs && node scripts/gen-home\.mjs && node scripts/gen-sitemap\.mjs')


def ET_locs(path):
    return re.findall(r'<loc>([^<]+)</loc>', Path(path).read_text())


if __name__ == '__main__':
    unittest.main()
