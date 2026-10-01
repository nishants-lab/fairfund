"""Exercise share generators with synthetic data and stubbed image rendering."""
import ast
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which('node')


class GeneratedCopyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ff-copy-', dir=ROOT.parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        for directory in ('scripts/fonts', 'src/data', 'dist'):
            (self.base / directory).mkdir(parents=True)
        for name in ('gen-unfurls.mjs', 'gen-og-images.mjs', 'site-config.mjs'):
            shutil.copyfile(ROOT / 'scripts' / name, self.base / 'scripts' / name)
        self.funds = [self.fund(1, '3Y'), self.fund(2, '5Y'), self.fund(3, '1Y')]
        self.write_data()

    def fund(self, code, window):
        return {'code': code, 'name': f'Example Fund {code}', 'amc': 'Example AMC',
                'category': 'Large Cap', 'categoryDisplay': 'Large Cap',
                'metrics': {window: {'catRank': 2, 'catSize': 10, 'cagr': 12.3,
                                     'alpha': 1.2, 'sharpe': 0.8, 'maxDrawdown': -15}}}

    def write_data(self):
        data = {'funds': self.funds, 'totalFunds': len(self.funds),
                'categories': {'Large Cap': {'display': 'Large Cap', 'fundCount': 3,
                                             'medianCagr5Y': 10.2, 'topCagr5Y': 12.3}}}
        (self.base / 'src/data/funds.json').write_text(json.dumps(data), encoding='utf-8')

    def run_script(self, name, **env):
        self.assertIsNotNone(NODE, 'Node is required for generator tests')
        clean_env = dict(os.environ)
        clean_env.pop('OG_LIMIT', None)
        return subprocess.run([NODE, str(self.base / 'scripts' / name)],
                              cwd=self.base, env={**clean_env, **env},
                              text=True, capture_output=True, timeout=30)

    def stub_renderer(self):
        for font in ('Inter-400', 'Inter-600', 'Inter-700', 'Inter-800', 'Newsreader-600'):
            (self.base / 'scripts/fonts' / f'{font}.woff').write_bytes(b'fixture')
        modules = {
            'satori': 'export default async function(card) { return JSON.stringify(card) }',
            '@resvg/resvg-js': '''export class Resvg {
                constructor(svg) { this.svg = svg }
                render() { return { asPng: () => Buffer.from(this.svg) } }
            }''',
        }
        for name, source in modules.items():
            directory = self.base / 'node_modules' / name
            directory.mkdir(parents=True)
            (directory / 'package.json').write_text(
                json.dumps({'name': name, 'type': 'module', 'exports': './index.js'}),
                encoding='utf-8')
            (directory / 'index.js').write_text(source, encoding='utf-8')

    def test_shell_copy_metadata_disclaimers_and_routes(self):
        result = self.run_script('gen-unfurls.mjs')
        self.assertEqual(result.returncode, 0, result.stderr)
        shells = list((self.base / 'dist').rglob('index.html'))
        self.assertEqual(len(shells), 8)
        for shell in shells:
            text = shell.read_text(encoding='utf-8')
            self.assertNotRegex(text.lower(), r'forward-looking|skill|evidence,? not advice|identical')
            self.assertIn('Indian mutual fund research', text)
            self.assertIn('not investment advice', text)
            self.assertIn('Past performance does not indicate future returns.', text)
            self.assertIn('location.replace', text)
            structured = json.loads(re.search(
                r'<script type="application/ld\+json">(.*?)</script>', text).group(1))
            self.assertIn('description', structured)
        for fund, window in zip(self.funds, ('3Y', '5Y', '1Y')):
            text = (self.base / f'dist/f/{fund["code"]}/index.html').read_text(encoding='utf-8')
            self.assertIn(f'{window} CAGR 12.3%', text)
            self.assertIn('Mutual fund research on FairFund.', text)
            self.assertIn(f'#/fund/{fund["code"]}/example-fund-{fund["code"]}', text)
        category = (self.base / 'dist/c/large-cap/index.html').read_text(encoding='utf-8')
        self.assertIn('Explore 3 Large Cap funds, their historical returns and category comparisons.', category)

    def test_methodology_and_compare_explain_period_limits(self):
        result = self.run_script('gen-unfurls.mjs')
        self.assertEqual(result.returncode, 0, result.stderr)
        method = (self.base / 'dist/s/methodology/index.html').read_text(encoding='utf-8')
        for sentence in (
            'FairFund compares mutual funds within their categories using NAV history and published portfolio data.',
            'Check the dates and available history before comparing results.',
            'Rankings compare funds within the same category.',
            'Simulations reuse past monthly returns to illustrate outcomes under a specified model.',
            'How FairFund calculates returns, compares funds within categories and handles data limitations.',
        ):
            self.assertIn(sentence, method)
        compare = (self.base / 'dist/s/compare/index.html').read_text(encoding='utf-8')
        self.assertIn('Category ranks and portfolio disclosures use their own reporting periods.', compare)
        self.assertIn('Compare mutual funds over a selected period and review overlap in their disclosed holdings.', compare)

    def test_og_success_keeps_metrics_and_uses_factual_copy(self):
        self.stub_renderer()
        result = self.run_script('gen-og-images.mjs')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('wrote 3 OG images (0 errors)', result.stdout)
        for fund, window in zip(self.funds, ('3Y', '5Y', '1Y')):
            text = (self.base / f'dist/og/{fund["code"]}.png').read_text(encoding='utf-8')
            self.assertIn('Indian mutual fund research', text)
            self.assertIn(f'{window} CAGR', text)
            self.assertIn('12.3%', text)
            self.assertIn('#2 of 10', text)
            self.assertNotRegex(text.lower(), r'forward-looking|evidence,? not advice|skill')

    def test_og_limit_keeps_success_behavior(self):
        self.stub_renderer()
        result = self.run_script('gen-og-images.mjs', OG_LIMIT='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('wrote 1 OG images (0 errors)', result.stdout)
        self.assertEqual(len(list((self.base / 'dist/og').glob('*.png'))), 1)

    def test_og_errors_fail_but_continue_and_cap_error_logging(self):
        self.stub_renderer()
        self.funds = [self.fund(code, '3Y') for code in range(1, 6)]
        for fund in self.funds[:4]:
            fund['name'] = None
        self.write_data()
        result = self.run_script('gen-og-images.mjs')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('wrote 1 OG images (4 errors)', result.stdout)
        self.assertEqual(result.stderr.count('[gen-og-images]'), 3)
        self.assertTrue((self.base / 'dist/og/5.png').exists())


class ManagerNoteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT / 'scripts/build_manager_signals.py'
        tree = ast.parse(path.read_text(encoding='utf-8'))
        classify = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'classify')
        namespace = {'MIN_TENURE_YEARS': 1.5}
        # The producer performs real-data IO at module scope, so execute only the pure classifier.
        exec(compile(ast.Module(body=[classify], type_ignores=[]), str(path), 'exec'), namespace)
        cls.classify = staticmethod(namespace['classify'])
        fund_loop = next(n for n in tree.body if isinstance(n, ast.For) and
                         isinstance(n.target, ast.Tuple) and
                         [v.id for v in n.target.elts] == ['code', 'fund'])
        override = next(n for n in fund_loop.body if isinstance(n, ast.If) and
                        ast.unparse(n.test).startswith('team_recently_changed and'))
        cls.override = compile(ast.Module(body=[override], type_ignores=[]), str(path), 'exec')

    def track(self, n=4, alpha=2.5, beat=0.75, other=True):
        return {'funds': n, 'medianAlpha': alpha, 'beatRate': beat, 'usedOtherFunds': other}

    def assert_factual(self, note):
        self.assertNotRegex(note.lower(), r'skill|market timing|looks good|confirmed|macro|fund-specific|inconsistent record|watch|passive/index')

    def test_missing_and_limited_coverage(self):
        self.assertEqual(self.classify(None, None, None, None)[0], 'No data')
        for other in (True, False):
            signal, note = self.classify(self.track(n=2, other=other), None, None, None)
            self.assertEqual(signal, 'Limited evidence')
            self.assert_factual(note)
            self.assertIn('+250 bps per year' if other else 'comparison with other covered funds is unavailable', note)

    def test_classification_branches_keep_signals_and_describe_returns(self):
        for base, alpha, beat in (('Strong', 2.5, .75), ('Solid', 1, .5), ('Mixed', -1, .25)):
            for tenure in (None, .5, 1.2, 2):
                for gap in (None, -6, -4, 0, 4, 6):
                    for flag in (False, True):
                        with self.subTest(base=base, tenure=tenure, gap=gap, flag=flag):
                            perf = None if gap is None else {'alpha': gap, 'fundReturn': 10 + gap,
                                'categoryReturn': 10, 'months': 24, 'categoryUpFundDown': flag}
                            signal, note = self.classify(self.track(alpha=alpha, beat=beat), None, perf, tenure)
                            expected = base
                            if tenure is not None and tenure < 1.5:
                                expected += ' *'
                            elif tenure is not None and gap is not None and gap < -3:
                                expected = 'Mixed'
                            self.assertEqual(signal, expected)
                            self.assert_factual(note)
                            self.assertIn(f'{alpha * 100:+.0f} bps per year', note)
                            if tenure is not None and tenure < 1.5:
                                self.assertIn('short observation period', note)
                            elif tenure is not None and gap is not None and gap >= -3:
                                self.assertIn(f'was {gap * 100:+.0f} bps.', note)
                                self.assertNotIn(f'was {gap * 100:+.0f} bps per year', note)

    def test_turnover_overrides_preserve_signal_and_avoid_causal_claims(self):
        for base in ('Strong', 'Solid', 'Mixed'):
            for changed in (False, True):
                for fading, cold, bottom in ((False, False, False), (True, False, False),
                                              (False, True, False), (False, False, True), (True, True, True)):
                    state = {'team_recently_changed': changed, 'is_fading': fading, 'is_cold': cold,
                             'is_bottom_half': bottom, 'signal_key': base, 'tenures': [.5, 4],
                             'new_mgr_count': 1, 'team_size': 2, 'lead_tenure': 4,
                             'm3y': {'catRank': 8, 'catSize': 10}, 'tr': self.track(), 'note': 'Record.'}
                    exec(self.override, state)
                    expected = 'Mixed' if changed and any((fading, cold, bottom)) and base in ('Strong', 'Solid') else base
                    self.assertEqual(state['signal_key'], expected)
                    self.assert_factual(state['note'])
                    self.assertNotIn('Since the change', state['note'])
                    if changed and base in ('Strong', 'Solid'):
                        self.assertIn('1 of 2 managers joined in the last year', state['note'])


if __name__ == '__main__':
    unittest.main()
