/**
 * The crawlable overlap pages (scripts/research-pages.mjs) must report the same
 * overlap the Compare page computes (src/lib/overlap.ts), including repeated lines.
 * Run from the repo root:  node tests/run-regressions.mjs tests/research-overlap.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Fund } from '../src/types'
import { hasUsableHoldings as appUsable, pairOverlapPct } from '../src/lib/overlap'
// @ts-expect-error plain ESM build script without type declarations
import { hasUsableHoldings, overlapPct, weightMap } from '../scripts/research-pages.mjs'

const fund = (holdings: { key?: string; name: string; pct: number }[], coverage = 'stock_level') =>
  ({ holdings, holdingsMeta: { coverage } }) as unknown as Fund

test('overlap matches the Compare page, including repeated and unkeyed lines', () => {
  const a = fund([{ key: 'x', name: 'X', pct: 5 }, { key: 'x', name: 'X', pct: 2 }, { name: 'Cash', pct: 3 }, { key: 'y', name: 'Y', pct: 4 }])
  const b = fund([{ key: 'X', name: 'X', pct: 6 }, { key: 'x', name: 'X', pct: 9 }, { name: 'cash ', pct: 1 }, { key: 'z', name: 'Z', pct: 8 }])
  for (const [p, q] of [[a, b], [b, a]]) {
    assert.equal(overlapPct(weightMap(p.holdings), weightMap(q.holdings)), pairOverlapPct(p, q))
  }
})

test('usable-holdings rule matches the app', () => {
  const cases = [fund([]), fund([{ key: 'a', name: 'A', pct: 95 }]), fund([{ key: 'a', name: 'A', pct: 50 }, { key: 'b', name: 'B', pct: 50 }]),
    ...['feeder_unresolved', 'unresolved', 'no_disclosure', 'fof_level', 'stock_level'].map(c => fund([{ key: 'a', name: 'A', pct: 5 }, { key: 'b', name: 'B', pct: 5 }], c))]
  for (const f of cases) assert.equal(hasUsableHoldings(f), appUsable(f))
})

test('real disclosed portfolios give the same overlap on both paths', () => {
  const codes = (JSON.parse(readFileSync('src/data/funds.json', 'utf-8')).funds as { code: number }[]).map(f => f.code)
  const loaded = codes.map(c => join('public/fund-data', `${c}.json`)).filter(existsSync).slice(0, 80)
    .map(p => JSON.parse(readFileSync(p, 'utf-8')) as Fund).filter(f => appUsable(f))
  assert.ok(loaded.length > 40)
  let checked = 0
  for (let i = 0; i < loaded.length; i++) for (let j = 0; j < loaded.length; j++) {
    if (i === j) continue
    const expected = pairOverlapPct(loaded[i], loaded[j])
    assert.ok(Math.abs(overlapPct(weightMap(loaded[i].holdings), weightMap(loaded[j].holdings)) - expected) < 1e-9)
    checked++
  }
  assert.ok(checked > 1000)
})
