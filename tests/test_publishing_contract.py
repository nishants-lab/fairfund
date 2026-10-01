"""Ensure every data-publication path invokes the same correctness gate.
Standard-library only; the narrow checks fail closed if workflow structure changes.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / '.github/workflows'


class PublishingContractTests(unittest.TestCase):
    def test_all_six_writer_or_publisher_jobs_are_gated(self):
        checked = []
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text(encoding='utf-8')
            jobs = re.split(r'^  ([a-zA-Z0-9_-]+):\s*$', text.split('jobs:', 1)[1], flags=re.M)
            for i in range(1, len(jobs), 2):
                name, body = jobs[i:i + 2]
                # Artifact-only deploy jobs depend on gated build jobs. Data writers
                # push commits/PRs, so must validate before that first publication.
                operations = [m.start() for m in re.finditer(r'git push|actions/upload-pages-artifact@|peaceiris/actions-gh-pages@', body)]
                if not operations:
                    continue
                gate = body.find('uses: ./.github/actions/validate')
                self.assertGreaterEqual(gate, 0, f'{path.name}/{name} missing validation')
                self.assertLess(gate, min(operations), f'{path.name}/{name} validates too late')
                self.assertEqual(body.count('uses: ./.github/actions/validate'), 1)
                checked.append((path.name, name))
        self.assertEqual(len(checked), 6, checked)

    def test_each_data_workflow_rebuilds_and_stages_category_benchmarks(self):
        for filename in ('refresh-data.yml', 'weekly-analytics.yml', 'heal-nav-gaps.yml', 'discover-funds.yml'):
            text = (WORKFLOWS / filename).read_text(encoding='utf-8')
            self.assertIn('run: python scripts/build_category_median.py', text, filename)
            for line in text.splitlines():
                if 'git add ' in line:
                    self.assertIn('public/category-median/', line, filename)

    def test_sync_precedes_validation_and_preserves_alpha_builder_order(self):
        for filename in ('refresh-data.yml', 'weekly-analytics.yml', 'heal-nav-gaps.yml', 'discover-funds.yml'):
            text = (WORKFLOWS / filename).read_text(encoding='utf-8')
            jobs = re.split(r'^  ([a-zA-Z0-9_-]+):\s*$', text.split('jobs:', 1)[1], flags=re.M)
            for i in range(1, len(jobs), 2):
                name, body = jobs[i:i + 2]
                if 'uses: ./.github/actions/validate' not in body:
                    continue
                sync = body.find('python scripts/sync_analytics_to_shells.py')
                self.assertGreaterEqual(sync, 0, f'{filename}/{name}')
                self.assertIn('python scripts/sync_analytics_to_shells.py --check', body)
                self.assertLess(sync, body.index('uses: ./.github/actions/validate'))
                if 'python scripts/build_rolling_alpha.py' in body:
                    self.assertLess(sync, body.index('python scripts/build_rolling_alpha.py'))
                if 'python scripts/prune_pending.py' in body:
                    self.assertLess(body.index('python scripts/prune_pending.py'), sync)

    def test_common_action_runs_the_release_gate(self):
        action = (ROOT / '.github/actions/validate/action.yml').read_text(encoding='utf-8')
        for command in ('actions/setup-node@v4', 'actions/setup-python@v5',
                        'python -m pip install -r pipeline/requirements.txt',
                        'npm ci', 'playwright install --with-deps chromium', 'npm run check:release'):
            self.assertIn(command, action)

    def test_browser_gate_includes_all_supported_journeys(self):
        runner = (ROOT / 'tests/run-browser-regressions.mjs').read_text(encoding='utf-8')
        for journey in ('hydration-browser.cjs', 'homepage-browser.cjs', 'portfolio-browser.cjs', 'copy-browser.cjs'):
            self.assertIn(journey, runner)
        self.assertIn('await server.close()', runner)

    def test_test_bundler_uses_cross_platform_api(self):
        runner = (ROOT / 'tests/run-regressions.mjs').read_text(encoding='utf-8')
        self.assertIn("import { buildSync } from 'esbuild'", runner)
        self.assertIn('buildSync({', runner)
        self.assertNotIn("join(root, 'node_modules/esbuild/bin/esbuild')", runner)

    def test_gate_tests_production_paths_without_refreshing_data(self):
        runner = (ROOT / 'scripts/check_release.mjs').read_text(encoding='utf-8')
        for required in ('tests/run-regressions.mjs', 'test_*.py', 'tests/test_market_date.py',
                         'tests/smoke.py', 'scripts/sync_analytics_to_shells.py', '--check',
                         'typescript/bin/tsc', 'tests/run-browser-regressions.mjs'):
            self.assertIn(required, runner)
        self.assertNotIn('pipeline/compute_metrics.py', runner)
        self.assertNotIn('git push', runner)


if __name__ == '__main__':
    unittest.main()
