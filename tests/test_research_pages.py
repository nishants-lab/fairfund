"""Holdings research pages (richer fund pages, stock pages, overlap pages), synthetic input only."""
import html
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
TEMPLATE = '<!doctype html><html lang="en"><head><title>FairFund</title></head><body><div id="root"></div></body></html>'
STOCK_A = 'A&B <i>Industries</i> Ltd'


def holding(key, name, pct, change=0.1, instrument='Equity', sector='Financial'):
    return {'key': key, 'name': name, 'pct': pct, 'change': change, 'instrument': instrument, 'sector': sector}


class ResearchPageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='ff-research-', dir=ROOT.parent)
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        for folder in ['scripts', 'src/data', 'dist/fund-data', 'dist/holdings-history']:
            (self.base / folder).mkdir(parents=True)
        for name in ['gen-sitemap.mjs', 'gen-unfurls.mjs', 'gen-home.mjs', 'site-config.mjs', 'research-pages.mjs']:
            shutil.copyfile(ROOT / 'scripts' / name, self.base / 'scripts' / name)
        self.funds, self.details, self.cat_overrides = [], {}, {}
        # Snapshot dates per fund, as scripts/add_holdings_change.py leaves them.
        # Fund 12 skipped two months; fund 13's history ends before its portfolio date.
        self.history = {i: ['2026-08-31', '2026-09-30'] for i in range(1, 25)}
        self.history[12] = ['2026-06-30', '2026-09-30']
        self.history[13] = ['2026-07-31', '2026-08-31']
        # 24 large cap funds from different fund houses, largest first.
        for i in range(1, 25):
            hs = [holding('stock-a', STOCK_A, 10 - i * 0.2, change=None if i == 3 else (0.5 if i % 2 else -0.25)),
                  holding(f'own-{i}', f'Own Holding {i} Ltd', 5.0, sector='Technology'),
                  holding('treps', 'TREPS', 2.0, instrument='TREPS', sector=None)]
            if i <= 20:
                hs.insert(1, holding('stock-b', 'Stock B Ltd', 4.0 + i * 0.1))
            if i <= 3:
                hs.append(holding('stock-c', 'Stock C Ltd', 1.0))
            self.add(i, f'Large Fund {i}', f'AMC {i}', 'Large Cap', aum=10000 - i * 100, holdings=hs,
                     metrics={'3Y': {'catRank': i, 'catSize': 25, 'cagr': 20 - i * 0.5, 'alpha': 3 - i * 0.2, 'sharpe': 0.9, 'maxDrawdown': -12.0,
                                     'windowStart': '2023-10-27', 'windowEnd': '2026-10-27'}})
        # A renamed fund is a live fund with a changed name.
        self.add(25, 'Renamed Large Fund', 'AMC 25', 'Large Cap', aum=50, status='renamed',
                 holdings=[holding('stock-a', STOCK_A, 1.0), holding('stock-b', 'Stock B Ltd', 1.0)],
                 metrics={'3Y': {'catRank': 25, 'catSize': 25, 'cagr': 7.5, 'alpha': -2.0, 'sharpe': 0.3, 'maxDrawdown': -20.0}})
        # Quarantined NAV history: no returns or ranks may appear on its page.
        self.add(26, 'Held Fund', 'AMC 26', 'Large Cap', aum=40, quarantined=True,
                 holdings=[holding('stock-a', STOCK_A, 2.0)], metrics={})
        for code in (101, 102):
            self.add(code, f'Nifty Index Fund {code}', f'Index AMC {code}', 'Index Funds', aum=500,
                     holdings=[holding('stock-a', STOCK_A, 9.0), holding('stock-b', 'Stock B Ltd', 8.0)], metrics={})
        # Arbitrage books are hedged: excluded from stock and overlap pages.
        self.add(201, 'Arbitrage Fund', 'AMC 201', 'Arbitrage', aum=9000,
                 holdings=[holding('stock-a', STOCK_A, 30.0)], metrics={})
        self.build()

    def add(self, code, name, amc, category, aum, holdings, metrics, status='active', quarantined=False):
        fund = {'code': code, 'name': name, 'amc': amc, 'category': category, 'categoryDisplay': category,
                'status': status, 'metrics': metrics, 'aum': {'current': aum, 'asOf': '2026-09-30'},
                'expenseRatio': round(0.5 + code * 0.01, 2), 'investInfo': {'exit_load': 'Nil', 'min_lumpsum': 1000.0}}
        if quarantined:
            fund['dataQuality'] = {'status': 'quarantined', 'issues': []}
        self.funds.append(fund)
        self.details[code] = {'holdings': holdings, 'holdingsMeta': {'coverage': 'stock_level', 'portfolioDate': '2026-09-30', 'count': len(holdings)},
                              'management': {'managers': [{'name': f'Manager {code}', 'sinceYears': 4.5}]},
                              'investInfo': {'min_sip': 500.0}}

    def build(self):
        cats = {}
        for f in self.funds:
            cats.setdefault(f['category'], {'display': f['category'], 'fundCount': 0})['fundCount'] += 1
        for key, extra in self.cat_overrides.items():
            cats[key].update(extra)
        data = {'funds': self.funds, 'totalFunds': len(self.funds), 'anchor': '2026-10-28', 'categories': cats}
        (self.base / 'src/data/funds.json').write_text(json.dumps(data), encoding='utf-8')
        for code, detail in self.details.items():
            (self.base / f'dist/fund-data/{code}.json').write_text(json.dumps(detail), encoding='utf-8')
        for code, dates in self.history.items():
            hist = {'code': code, 'snapshots': {d: {'portfolioDate': d, 'holdings': []} for d in dates}}
            (self.base / f'dist/holdings-history/{code}.json').write_text(json.dumps(hist), encoding='utf-8')
        (self.base / 'dist/index.html').write_text(TEMPLATE, encoding='utf-8')
        for script in ('gen-unfurls.mjs', 'gen-home.mjs', 'gen-sitemap.mjs'):
            r = self.run_script(script)
            self.assertEqual(r.returncode, 0, script + r.stderr)

    def run_script(self, name):
        return subprocess.run([NODE, str(self.base / 'scripts' / name)], cwd=self.base, text=True, capture_output=True, timeout=60)

    def page(self, path):
        return (self.base / 'dist' / path / 'index.html').read_text(encoding='utf-8')

    def text(self, path):
        main = re.search(r'<main>(.*)</main>', self.page(path), re.S).group(1)
        return re.sub(r'[ \t\n]+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', main)))

    # ---- stock pages ----
    def test_stock_pages_only_for_widely_held_stocks(self):
        self.assertTrue((self.base / 'dist/st/stock-a/index.html').exists())
        self.assertTrue((self.base / 'dist/st/stock-b/index.html').exists())  # 20 + renamed + 2 index funds
        self.assertFalse((self.base / 'dist/st/stock-c').exists())
        self.assertFalse((self.base / 'dist/st/treps').exists())

    def test_stock_page_counts_split_and_monthly_changes(self):
        text = self.text('st/stock-a')
        # 24 large cap + renamed + quarantined + 2 index funds; the arbitrage fund is excluded.
        self.assertIn('28 of the 28 funds with stock-level portfolios on FairFund hold', text)
        self.assertIn('26 are actively managed and 2 are index funds', text)
        self.assertIn('per disclosures for 30 Sep 2026', text)
        self.assertIn('Actively managed funds holding', text)
        self.assertIn('Index funds holding', text)
        self.assertNotIn('Arbitrage Fund', text)
        self.assertIn('Renamed Large Fund', text)
        self.assertIn('The largest weight is 9.8%', text)
        # Fund 3 has change null in a fund with month-on-month data: a new holding.
        self.assertIn('15 funds had a higher weight, 12 a lower one and 1 had no earlier weight for it (usually a new holding)', text)
        self.assertIn('No earlier weight', text)
        self.assertIn('+50 bps', text)
        self.assertIn('-25 bps', text)

    def test_stock_names_are_escaped_everywhere(self):
        html = self.page('st/stock-a')
        self.assertNotIn('<i>Industries', html)
        self.assertIn('A&amp;B &lt;i&gt;Industries&lt;/i&gt;', html)
        ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html).group(1))
        self.assertIn('<i>Industries</i>', ld['name'])

    # ---- overlap pages ----
    def test_overlap_pairs_are_the_largest_funds_per_category(self):
        pairs = sorted(p.name for p in (self.base / 'dist/o').iterdir())
        self.assertEqual(len(pairs), 28)  # 8 largest large cap funds, every pair once
        self.assertIn('1-vs-2', pairs)
        self.assertIn('7-vs-8', pairs)
        self.assertNotIn('8-vs-9', pairs)
        self.assertFalse(any('101' in p or '201' in p for p in pairs))

    def test_overlap_value_shared_rows_and_side_by_side(self):
        text = self.text('o/1-vs-2')
        # min(9.8, 9.6) stock-a + min(4.1, 4.2) stock-b + stock-c 1.0 + TREPS 2.0 (all lines count, as in the app).
        expected = 9.6 + 4.1 + 1.0 + 2.0
        self.assertIn(f'{expected:.0f}% portfolio overlap', text)
        self.assertIn('with 4 holdings in common', text)
        self.assertIn('Large Fund 1 vs Large Fund 2', text)
        for fact in ('AMC 1 and AMC 2', 'Expense ratio', '3Y return a year', '3Y category rank', '#1 of 25', '#2 of 25'):
            self.assertIn(fact, text)
        self.assertIn('Largest holdings only in Large Fund 1:', text)
        self.assertIn('Own Holding 1 Ltd 5.0%', text)
        self.assertIn('href="../../#/compare?codes=1,2"', self.page('o/1-vs-2'))
        self.assertIn(f'{SITE}/st/stock-a/', self.page('o/1-vs-2'))

    # ---- richer fund pages ----
    def test_fund_page_has_costs_holdings_similar_funds_and_peers(self):
        html, text = self.page('f/12'), self.text('f/12')
        self.assertIn('Expense ratio: 0.62% a year (direct plan)', text)
        self.assertIn('median is', text)
        self.assertIn('Manager 12 (4.5 years on this fund)', text)
        self.assertIn('Minimum investment: SIP Rs\xa0500, lump sum Rs\xa01,000.', text)
        self.assertRegex(text, r'Top [0-9]+ holdings')
        self.assertIn('Change in weight since 30 Jun 2026', text)
        self.assertIn(f'{SITE}/st/stock-a/', html)
        self.assertIn('Funds with the most similar portfolios', text)
        self.assertIn('Closest index fund:', text)
        self.assertIn('Large Cap funds by 3Y rank', text)
        peers = re.search(r'aria-label="Large Cap ranking".*?</table>', html, re.S).group(0)
        self.assertEqual(peers.count('<tr>') - 1, 11)  # top 10 plus this fund at #12
        self.assertIn('<strong>Large Fund 12</strong>', peers)
        self.assertNotIn('Held Fund', peers)
        # The interactive link stays the last app link on the page.
        self.assertEqual(re.findall(r'href="\.\./\.\./#([^"]+)"', html)[-1], '/fund/12/large-fund-12')
        self.assertEqual(html.count('class="metrics-scroll"'), 1)
        self.assertEqual(html.count('<time'), 1)

    def test_similar_funds_link_overlap_pages_when_they_exist(self):
        html = self.page('f/1')
        self.assertIn(f'{SITE}/o/1-vs-2/', html)
        self.assertNotIn('Arbitrage Fund', self.text('f/1'))

    def test_quarantined_fund_page_shows_no_returns_or_ranks(self):
        text = self.text('f/26')
        self.assertIn('NAV history needs source verification', text)
        self.assertNotRegex(text, r'ranks #|CAGR [+-]?[0-9]|by 3Y rank')
        self.assertRegex(text, r'Top [0-9]+ holdings')

    def test_category_page_lists_overlap_pairs(self):
        html = self.page('c/large-cap')
        self.assertIn('Portfolio overlap among the eight largest funds', html)
        self.assertIn(f'{SITE}/o/1-vs-2/', html)

    # ---- hubs, homepage, sitemap ----
    def test_hubs_homepage_and_sitemap_list_every_research_page(self):
        for hub in ('s/stocks', 's/overlap'):
            self.assertIn('<h1', self.page(hub))
        self.assertIn(f'{SITE}/st/stock-b/', self.page('s/stocks'))
        home = (self.base / 'dist/index.html').read_text(encoding='utf-8')
        self.assertIn(f'{SITE}/s/stocks/', home)
        self.assertIn(f'{SITE}/s/overlap/', home)
        locs = [n.text for n in ET.fromstring((self.base / 'dist/sitemap.xml').read_bytes()).findall('{*}url/{*}loc')]
        self.assertEqual(len(locs), len(set(locs)))
        for path in ['s/stocks/', 's/overlap/', 'st/stock-a/', 'st/stock-b/', 'o/1-vs-2/', 'o/7-vs-8/']:
            self.assertIn(f'{SITE}/{path}', locs)
        self.assertEqual(sum('/o/' in u for u in locs), 28)

    def test_sitemap_fails_when_a_research_page_is_missing(self):
        (self.base / 'dist/st/stock-b/index.html').unlink()
        r = self.run_script('gen-sitemap.mjs')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('Missing sitemap page: st/stock-b/', r.stderr)

    def test_every_page_keeps_copy_rules_and_scripts(self):
        for file in (self.base / 'dist').glob('*/*/index.html'):
            html = file.read_text(encoding='utf-8')
            self.assertNotRegex(html.lower(), r'forward-looking|skill|identical', str(file))
            if file.parent.parent.name in ('f', 'st', 'o') or file.parent.name in ('stocks', 'overlap'):
                self.assertNotRegex(html.lower(), r'\bbest\b|recommend|\bbuy\b', str(file))
            self.assertIn('not investment advice', html)
            self.assertNotIn('\u2014', html)
            for attrs, body in re.findall(r'<script\b([^>]*)>(.*?)</script>', html, re.S | re.I):
                self.assertIn('type="application/ld+json"', attrs)
                json.loads(body)

    def test_no_fund_data_means_no_research_pages(self):
        shutil.rmtree(self.base / 'dist')
        (self.base / 'dist').mkdir()
        (self.base / 'dist/index.html').write_text(TEMPLATE, encoding='utf-8')
        for script in ('gen-unfurls.mjs', 'gen-home.mjs', 'gen-sitemap.mjs'):
            self.assertEqual(self.run_script(script).returncode, 0, script)
        self.assertFalse((self.base / 'dist/st').exists())
        self.assertFalse((self.base / 'dist/s/stocks').exists())
        self.assertNotIn('s/stocks/', (self.base / 'dist/index.html').read_text(encoding='utf-8'))
        self.assertIn('Expense ratio: 0.51%', self.text('f/1'))

    def test_index_funds_outside_index_categories_count_as_index_funds(self):
        self.funds[0]['name'] = 'Tax Saver Nifty 50 Index Fund'  # the largest large cap fund
        self.build()
        self.assertIn('25 are actively managed and 3 are index funds', self.text('st/stock-a'))
        pairs = sorted(p.name for p in (self.base / 'dist/o').iterdir())
        self.assertFalse(any(p.startswith('1-vs-') for p in pairs))
        self.assertIn('8-vs-9', pairs)

    def test_no_negative_zero_or_placeholder_sectors(self):
        self.funds[0]['metrics']['3Y'].update({'alpha': -0.02, 'maxDrawdown': -0.04})
        self.details[1]['holdings'][1]['sector'] = 'Unspecified'
        self.details[1]['holdings'][0]['change'] = -0.004
        self.build()
        text = self.text('f/1')
        self.assertNotRegex(text, r'-0\.0+%')
        self.assertIn('(0.0% versus the category median)', text)
        self.assertNotIn('Unspecified', text)
        self.assertIn('-<1 bps', text)
        self.assertNotIn('-0 bps', text)

    def test_stock_and_overlap_pages_are_made_together_or_not_at_all(self):
        for f in self.funds:
            if f['category'] == 'Large Cap':
                f['category'] = f['categoryDisplay'] = 'Sectoral'  # no overlap category left
        self.build()
        self.assertFalse((self.base / 'dist/st').exists())
        self.assertFalse((self.base / 'dist/s/stocks').exists())
        self.assertNotIn('/st/', self.page('f/1'))

    # ---- weight-change dates ----
    def test_weight_change_dates_follow_each_funds_previous_disclosure(self):
        self.assertIn('Change in weight since 31 Aug 2026', self.text('f/1'))
        self.assertIn('Change in weight since 30 Jun 2026', self.text('f/12'))
        # History does not end at the displayed portfolio: no date can be claimed.
        self.assertIn('Change in weight since previous disclosure', self.text('f/13'))
        self.assertNotIn('previous month', self.text('f/1'))
        text = self.text('st/stock-a')
        self.assertIn('Change in weight since 31 Aug 2026', text)
        self.assertIn("Compared with each fund's previous disclosure (31 Aug 2026 for all but", text)
        row12 = re.search(r'Large Fund 12</a>.*?</tr>', self.page('st/stock-a'), re.S).group(0)
        self.assertIn('since 30 Jun 2026', row12)
        row13 = re.search(r'Large Fund 13</a>.*?</tr>', self.page('st/stock-a'), re.S).group(0)
        self.assertIn('since previous disclosure', row13)
        self.assertNotIn('previous month', self.text('s/stocks'))

    def test_different_disclosure_dates_are_described_neutrally(self):
        self.details[5]['holdingsMeta']['portfolioDate'] = '2026-10-31'  # later than the rest
        self.build()
        text = self.text('st/stock-a')
        self.assertIn('(1 has a different disclosure date)', text)
        self.assertNotIn('earlier month', text)

    # ---- rank basis ----
    def test_rank_explanation_matches_the_categorys_ranking_rule(self):
        for code, cat in ((201, 'Arbitrage'), (202, 'Arbitrage'), (301, 'Liquid'), (302, 'Liquid')):
            m = {'3Y': {'catRank': code % 100, 'catSize': 2, 'cagr': 7.0, 'alpha': 0.1, 'sharpe': 1.0, 'maxDrawdown': -0.5}}
            if code == 201:
                self.funds[-1]['metrics'] = m
            else:
                self.add(code, f'{cat} Fund {code}', f'AMC {code}', cat, aum=100, holdings=[], metrics=m)
        self.build()
        arb, liq, eq = self.text('f/201'), self.text('f/301'), self.text('f/1')
        self.assertIn('on cost, fund size and 3Y return', arb)
        self.assertIn('expense ratio (45%), return (35%) and fund size (20%)', arb)
        self.assertIn('expense ratio (70%), fund size (20%) and return (10%)', liq)
        for text in (arb, liq):
            self.assertNotIn('risk-adjusted', text)
            self.assertNotIn('Sharpe, Sortino', text)
        self.assertIn('on 3Y risk-adjusted return', eq)
        self.assertIn('Sharpe, Sortino and Calmar', eq)

    # ---- malformed and hostile input ----
    def test_malformed_holdings_do_not_crash_and_are_left_out(self):
        self.details[5]['holdings'][0]['pct'] = None
        self.details[6]['holdings'] = 'not a list'
        self.details[7]['holdings'] = [None]
        self.build()
        for code in (5, 6, 7):
            self.assertIn('Stock-level holdings for this fund are not available', self.text(f'f/{code}'))
        self.assertIn('25 of the 25 funds with stock-level portfolios on FairFund hold', self.text('st/stock-a'))

    def test_hostile_strings_are_escaped(self):
        bad = '<img src=x onerror=alert(1)>'
        self.funds[0]['amc'] = 'AMC <b>1</b>'
        self.funds[0]['aum'] = {'current': 9900, 'asOf': bad, 'previous': 9000, 'prevDate': bad}
        self.details[1]['holdingsMeta'].update({'portfolioDate': bad, 'count': bad})
        self.details[1]['investInfo']['lock_in'] = {'years': bad, 'months': 3}
        self.funds[0]['metrics']['3Y']['windowStart'] = bad
        self.funds[0]['metrics']['3Y']['sharpe'] = bad
        self.cat_overrides['Large Cap'] = {'riskLevel': bad}
        self.build()
        for path in ('f/1', 'c/large-cap', 'st/stock-a', 'o/1-vs-2'):
            page = self.page(path)
            self.assertNotIn('<img', page, path)
            self.assertNotIn('<b>1', page, path)
        text = self.text('f/1')
        self.assertIn('Lock-in: 3 months.', text)
        self.assertIn(': 5 holdings.', text)  # bad count falls back to the rows

    def test_overlap_endpoints_are_not_shown_as_0_or_100(self):
        self.details[1]['holdings'] = [holding('x', 'X Ltd', 50.0), holding('y', 'Y Ltd', 49.7)]
        self.details[2]['holdings'] = [holding('x', 'X Ltd', 50.0), holding('y', 'Y Ltd', 50.0)]
        self.details[3]['holdings'] = [holding('x', 'X Ltd', 0.3), holding('z', 'Z Ltd', 99.0)]
        self.build()
        self.assertIn('>99% portfolio overlap', self.text('o/1-vs-2'))
        self.assertIn('over 99% portfolio overlap', self.page('o/1-vs-2'))
        self.assertIn('<1% portfolio overlap', self.text('o/1-vs-3'))
        self.assertNotRegex(self.text('o/1-vs-2'), r'\b100% portfolio overlap')
        # Weights can add up to over 100%: an overlap above 100 still reads as over 99%.
        self.details[2]['holdings'] = [holding('x', 'X Ltd', 50.0), holding('y', 'Y Ltd', 50.1)]
        self.details[1]['holdings'] = [holding('x', 'X Ltd', 50.0), holding('y', 'Y Ltd', 50.2)]
        self.build()
        self.assertIn('>99% portfolio overlap', self.text('o/1-vs-2'))


if __name__ == '__main__':
    unittest.main()
