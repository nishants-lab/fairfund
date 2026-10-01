/** Shared local/CI correctness gate. Does not regenerate financial data or deploy.
 * Python 3, installed npm dependencies and Playwright Chromium are prerequisites.
 * Covers currently implemented contracts; not a certification of financial methods.
 */
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = (bin, args) => execFileSync(bin, args, { cwd: root, stdio: 'inherit' })
const node = (...args) => run(process.execPath, args)
const python = process.env.FF_PYTHON || 'python'
run(python, ['scripts/quarantine_nav.py', '--check'])
node(join(root, 'tests/run-regressions.mjs'))
run(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v'])
run(python, ['tests/test_market_date.py'])
run(python, ['tests/smoke.py'])
run(python, ['scripts/sync_analytics_to_shells.py', '--check'])
node(join(root, 'node_modules/typescript/bin/tsc'), '--project', 'tsconfig.json', '--noEmit', '--incremental', 'false')
node(join(root, 'tests/run-browser-regressions.mjs'))
for (const file of ['saved-comparisons-browser.mjs', 'portfolio-import-browser.mjs', 'fund-changes-browser.mjs', 'usage-browser.cjs', 'reliability-browser.mjs']) {
  node(join(root, 'tests', file))
}
