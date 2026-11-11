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
                quarantine = body.find('python scripts/quarantine_nav.py --apply')
                self.assertGreaterEqual(quarantine, 0, f'{filename}/{name}')
                self.assertLess(quarantine, sync)
                metrics = body.index('python pipeline/compute_metrics.py')
                rankings = body.index('python pipeline/compute_rankings.py')
                analytics = body.index('python scripts/build_analytics.py')
                rolling = body.index('python scripts/build_rolling_alpha.py')
                self.assertLess(metrics, rankings)
                self.assertLess(rankings, analytics)
                self.assertLess(analytics, quarantine)
                self.assertLess(sync, rolling)
                self.assertLess(rolling, body.index('uses: ./.github/actions/validate'))
                for producer in ('pipeline/compute_metrics.py', 'pipeline/compute_rankings.py',
                                 'scripts/build_analytics.py', 'migrations/split-analytics/split_funds.py',
                                 'scripts/prune_pending.py'):
                    if producer in body:
                        self.assertLess(body.index(producer), quarantine)
                self.assertIn('python scripts/sync_analytics_to_shells.py --check', body)
                self.assertLess(sync, body.index('uses: ./.github/actions/validate'))
                if 'python scripts/build_rolling_alpha.py' in body:
                    self.assertLess(sync, body.index('python scripts/build_rolling_alpha.py'))
                if 'python scripts/prune_pending.py' in body:
                    self.assertLess(body.index('python scripts/prune_pending.py'), analytics)
                    self.assertLess(body.index('python scripts/prune_pending.py'), body.rindex('python pipeline/compute_metrics.py'))
                    self.assertLess(body.rindex('python pipeline/compute_rankings.py'), analytics)

    def test_weekly_and_discovery_refresh_metrics_before_analytics(self):
        for filename in ('weekly-analytics.yml', 'discover-funds.yml'):
            text = (WORKFLOWS / filename).read_text(encoding='utf-8')
            self.assertLess(text.index('python pipeline/compute_metrics.py'), text.index('python pipeline/compute_rankings.py'))
            self.assertLess(text.index('python pipeline/compute_rankings.py'), text.index('python scripts/build_analytics.py'))
        discovery = (WORKFLOWS / 'discover-funds.yml').read_text(encoding='utf-8')
        recompute = discovery.split('- name: Recompute metrics and rankings', 1)[1].split('- name:', 1)[0]
        self.assertNotIn('if:', recompute)

    def test_monthly_ranking_follows_cost_and_size_enrichment(self):
        body = (WORKFLOWS / 'refresh-data.yml').read_text(encoding='utf-8').split('  monthly-holdings:', 1)[1]
        self.assertLess(body.index('scripts/enrich_fund_data.py'), body.index('pipeline/compute_metrics.py'))
        self.assertLess(body.index('scripts/build_manager_signals.py'), body.index('pipeline/compute_rankings.py'))

    def test_monthly_holdings_are_published_in_the_same_run(self):
        # A push made with GITHUB_TOKEN does not start deploy.yml, so without its own
        # deploy the monthly holdings went live only with the next daily refresh.
        text = (WORKFLOWS / 'refresh-data.yml').read_text(encoding='utf-8')
        jobs = re.split(r'^  ([a-zA-Z0-9_-]+):\s*$', text.split('jobs:', 1)[1], flags=re.M)
        bodies = {jobs[i]: jobs[i + 1] for i in range(1, len(jobs), 2)}
        monthly = bodies['monthly-holdings']
        self.assertIn('changed: ${{ steps.commit-holdings.outputs.changed }}', monthly)
        self.assertIn('id: commit-holdings', monthly)
        push = monthly.index('git push')
        self.assertLess(push, monthly.index('echo "changed=true" >> "$GITHUB_OUTPUT"'))
        build = monthly.index('npm run build')
        upload = monthly.index('actions/upload-pages-artifact@')
        self.assertLess(push, build)
        self.assertLess(build, upload)
        self.assertIn('name: github-pages-holdings', monthly[upload:])
        # Artifact names must be unique within a run; the daily job uses the default.
        self.assertNotIn('github-pages-holdings', bodies['daily-nav'])
        deploy = bodies['deploy-holdings']
        self.assertRegex(deploy, r'needs:\s*\[deploy-pages, monthly-holdings\]')
        self.assertIn("needs.monthly-holdings.outputs.changed == 'true'", deploy)
        self.assertIn("needs.monthly-holdings.result == 'success'", deploy)
        self.assertIn('actions/deploy-pages@v4', deploy)
        self.assertIn('artifact_name: github-pages-holdings', deploy)
        self.assertIn('name: github-pages', deploy)

    def test_common_action_runs_the_release_gate(self):
        action = (ROOT / '.github/actions/validate/action.yml').read_text(encoding='utf-8')
        for command in ('actions/setup-node@v4', 'actions/setup-python@v5',
                        'python -m pip install -r pipeline/requirements.txt',
                        'npm ci', 'bash scripts/ci/install-browser.sh', 'npm run check:release'):
            self.assertIn(command, action)
        self.assertLess(action.index('npm ci'), action.index('scripts/ci/install-browser.sh'))
        self.assertLess(action.index('scripts/ci/install-browser.sh'), action.index('npm run check:release'))
        # --with-deps fails the whole gate when Ubuntu's archive is unreachable (2026-11-11).
        self.assertNotIn('--with-deps', action)

    def test_browser_install_survives_an_unreachable_package_archive(self):
        script = (ROOT / 'scripts/ci/install-browser.sh').read_text(encoding='utf-8')
        self.assertTrue(script.startswith('#!/usr/bin/env bash'))
        code = '\n'.join(l for l in script.splitlines() if not l.lstrip().startswith('#'))
        self.assertNotIn('--with-deps', code)
        self.assertNotIn('set -e', script.replace('set -uo pipefail', ''))
        # Browser download is retried and a failure there still fails the gate.
        self.assertIn('retry npx playwright install chromium || {', script)
        download = script.index('retry npx playwright install chromium')
        self.assertIn('exit 1', script[download:download + 200])
        # System packages: normal archive first, a second mirror on failure.
        self.assertIn('npx playwright install-deps chromium', script)
        self.assertIn('http://mirrors.edge.kernel.org/ubuntu/', script)
        self.assertIn('getent hosts', script)
        self.assertIn('timeout --kill-after', script)
        flow = script[download:]
        self.assertLess(flow.index('install_deps'), flow.index('use_fallback_mirror\n  install_deps'))
        # The gate continues without packages only once Chromium has rendered a page,
        # and fails when it cannot.
        self.assertIn('await page.screenshot()', script)
        self.assertIn('if chromium_renders; then', flow)
        self.assertTrue(flow.rstrip().endswith('exit 1'))
        self.assertEqual(flow.count('exit 0'), 1)
        self.assertLess(flow.index('if chromium_renders; then'), flow.index('exit 0'))

    def test_every_workflow_installs_browsers_through_the_resilient_script(self):
        for path in sorted(WORKFLOWS.glob('*.yml')):
            text = path.read_text(encoding='utf-8')
            self.assertNotIn('--with-deps', text, path.name)

    def test_browser_gate_includes_all_supported_journeys(self):
        runner = (ROOT / 'tests/run-browser-regressions.mjs').read_text(encoding='utf-8')
        for journey in ('hydration-browser.cjs', 'homepage-browser.cjs', 'portfolio-browser.cjs', 'copy-browser.cjs'):
            self.assertIn(journey, runner)
        self.assertIn('await server.close()', runner)

    def test_release_gate_includes_new_private_local_feature_journeys(self):
        runner = (ROOT / 'scripts/check_release.mjs').read_text(encoding='utf-8')
        for journey in ('saved-comparisons-browser.mjs', 'portfolio-import-browser.mjs',
                        'fund-changes-browser.mjs', 'usage-browser.cjs', 'reliability-browser.mjs', 'dated-ranking-browser.mjs', 'app-ux-browser.mjs'):
            self.assertIn(journey, runner)
            self.assertTrue((ROOT / 'tests' / journey).is_file())

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
        self.assertIn("run(python, ['scripts/quarantine_nav.py', '--check'])", runner)
        self.assertLess(runner.index('scripts/quarantine_nav.py'), runner.index('tests/run-regressions.mjs'))
        self.assertNotIn('--apply', runner)
        self.assertNotIn('pipeline/compute_metrics.py', runner)
        self.assertNotIn('git push', runner)


if __name__ == '__main__':
    unittest.main()
