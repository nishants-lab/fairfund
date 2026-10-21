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

test('real data: funds reset to one snapshot do not claim every stock is new', () => {
  for (const code of [146376, 153320, 119231]) {
    const d = JSON.parse(readFileSync(`public/fund-data/${code}.json`, 'utf8'))
    assert.equal(hasMonthOnMonth(d.holdings ?? []), false, `${code}`)
  }
  // A fund with history keeps its column.
  const hdfcMid = JSON.parse(readFileSync('public/fund-data/118989.json', 'utf8'))
  assert.equal(hasMonthOnMonth(hdfcMid.holdings), true)
  assert.ok(readdirSync('public/fund-data').length > 900)
})
