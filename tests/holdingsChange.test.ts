/**
 * Month-on-month column: shown only when a previous snapshot exists.
 * Run: node tests/run-regressions.mjs tests/holdingsChange.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import { hasMonthOnMonth } from '../src/lib/holdingsChange'

test('all-null changes (no previous snapshot) hide the column', () => {
  assert.equal(hasMonthOnMonth([{ change: null }, { change: null }]), false)
  assert.equal(hasMonthOnMonth([{}, {}]), false)
  assert.equal(hasMonthOnMonth([]), false)
  assert.equal(hasMonthOnMonth([{ change: Number.NaN }]), false)
})

test('one real change shows the column; nulls then mean genuinely new', () => {
  assert.equal(hasMonthOnMonth([{ change: null }, { change: 0 }]), true)
  assert.equal(hasMonthOnMonth([{ change: -0.23 }, { change: null }]), true)
})

// Real data, as an invariant. The column depends on how many monthly snapshots a
// fund has, and that grows every month, so the rule is checked against the
// holdings history itself. A fixed list of single-snapshot funds broke the
// monthly refresh on 2026-11-11, when SBI Nifty IT Index (153320) got its
// second month and correctly gained the column.
test('real data: the month-on-month column appears exactly when a previous snapshot exists', () => {
  const dir = 'public/holdings-history'
  let single = 0
  let multi = 0
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue
    const code = file.slice(0, -5)
    let detail
    try { detail = JSON.parse(readFileSync(`public/fund-data/${code}.json`, 'utf8')) } catch { continue }
    const snapshots = Object.keys(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')).snapshots ?? {})
    if (snapshots.length < 2) {
      single++
      // No earlier month to compare with: never claim every stock is new.
      assert.equal(hasMonthOnMonth(detail.holdings ?? []), false, `${code}: ${snapshots.length} snapshot(s)`)
    } else if ((detail.holdings ?? []).length) {
      multi++
    }
  }
  // A fund with a long history keeps its column, and the data set is the real one.
  const hdfcMid = JSON.parse(readFileSync('public/fund-data/118989.json', 'utf8'))
  assert.equal(hasMonthOnMonth(hdfcMid.holdings), true)
  assert.ok(multi > 800, `only ${multi} funds with history`)
  assert.ok(single + multi > 900)
  assert.ok(readdirSync('public/fund-data').length > 900)
})
