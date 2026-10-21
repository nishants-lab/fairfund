/**
 * Fund Landscape bubble size must come from the canonical index AUM.
 *
 * Run from the repo root:  node tests/run-regressions.mjs tests/landscape.test.ts
 *
 * Before this test existed the chart fetched public/aum-index.json, a file no
 * pipeline step rebuilt. It covered 674 of 993 funds and disagreed with the fund
 * page by more than 5% for 371 of them (ICICI Prudential US Bluechip showed
 * 50,032 Cr against a true 3,797.5 Cr). These cases pin the fix.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { funds, getFund } from '../src/lib/data'
import { formatAumCr, landscapeAum } from '../src/lib/landscape'

test('landscapeAum returns the index AUM, and undefined for missing or invalid sizes', () => {
  assert.equal(landscapeAum({ aum: { current: 3797.5, asOf: '2026-09-30' } }), 3797.5)
  assert.equal(landscapeAum({ aum: null }), undefined)
  assert.equal(landscapeAum({}), undefined)
  assert.equal(landscapeAum({ aum: { current: 0, asOf: null } }), undefined)
  assert.equal(landscapeAum({ aum: { current: -5, asOf: null } }), undefined)
  assert.equal(landscapeAum({ aum: { current: Number.NaN, asOf: null } }), undefined)
  assert.equal(landscapeAum({ aum: { current: Number.POSITIVE_INFINITY, asOf: null } }), undefined)
})

test('formatAumCr matches the fund page format at each threshold', () => {
  assert.equal(formatAumCr(86.8978), '₹87 Cr')
  assert.equal(formatAumCr(999.4), '₹999 Cr')
  assert.equal(formatAumCr(1000), '₹1.0K Cr')
  assert.equal(formatAumCr(3797.5), '₹3.8K Cr')
  assert.equal(formatAumCr(99999), '₹100.0K Cr')
  assert.equal(formatAumCr(100000), '₹1.0L Cr')
  assert.equal(formatAumCr(125432), '₹1.3L Cr')
})

test('every fund with a published AUM gets exactly that bubble size (real data)', () => {
  let sized = 0
  for (const f of funds) {
    const a = f.aum?.current
    if (typeof a === 'number' && a > 0) {
      assert.equal(landscapeAum(f), a, `bubble AUM for ${f.code} differs from its index AUM`)
      sized++
    } else {
      assert.equal(landscapeAum(f), undefined, `${f.code} has no AUM but would get a sized bubble`)
    }
  }
  // Coverage must be near the whole universe, not the 674-fund stale file.
  assert.ok(sized / funds.length > 0.95, `only ${sized}/${funds.length} funds have a bubble size`)
})

test('the worst stale case now shows its real size', () => {
  const f = getFund(120186)
  assert.ok(f, 'ICICI Prudential US Bluechip (120186) is in the index')
  const a = landscapeAum(f!)
  assert.ok(a != null && a < 20000, `120186 bubble AUM ${a} still looks like the stale 50,032 Cr`)
  assert.equal(a, f!.aum!.current)
})

test('no source file fetches the retired aum-index.json, and the file is gone', () => {
  // run-regressions.mjs runs every bundled test with cwd = repo root.
  const repo = process.cwd()
  assert.ok(existsSync(join(repo, 'src')), `cwd ${repo} is not the repo root`)
  assert.equal(existsSync(join(repo, 'public', 'aum-index.json')), false,
    'public/aum-index.json is back; nothing rebuilds it, so it goes stale')
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && readFileSync(p, 'utf8').includes('aum-index')) hits.push(p)
    }
  }
  walk(join(repo, 'src'))
  assert.deepEqual(hits, [])
})
