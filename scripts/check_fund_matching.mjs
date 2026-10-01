/**
 * Fund-matching acceptance check (CI + local).
 *
 * Thin wrapper: it runs tests/fund-matching.test.ts through the shared
 * regression runner, which bundles and executes the REAL production matcher in
 * src/lib/camsParser.ts. This file deliberately holds no matching logic of its
 * own - it used to carry a copy of matchFundCode(), which could drift from
 * production and report green while the shipped parser was wrong.
 *
 * Run: node scripts/check_fund_matching.mjs   (exits non-zero on any miss)
 * Extra arguments are passed through to the runner as additional test paths.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runner = join(root, 'tests', 'run-regressions.mjs')
if (!existsSync(runner)) {
  console.error(`Missing regression runner: ${runner}`)
  process.exit(1)
}

const tests = ['tests/fund-matching.test.ts', ...process.argv.slice(2)]
const result = spawnSync(process.execPath, [runner, ...tests], { cwd: root, stdio: 'inherit' })
if (result.error) {
  console.error(`Fund matching check could not run: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error('\nFund matching check FAILED')
  process.exit(result.status ?? 1)
}
console.log('\nFund matching check PASSED')
