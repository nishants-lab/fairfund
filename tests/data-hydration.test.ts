/**
 * Regression tests for immutable detail hydration in src/lib/data.ts.
 *
 * Run from the repo root:  node tests/run-regressions.mjs tests/data-hydration.test.ts
 *
 * These call the production functions directly. `__DATA_VERSION__` is a Vite
 * define and `fetch` is a browser global, so both are stubbed here; the fetch
 * stub is always restored. Each test uses its own fund code and asserts nothing
 * about other tests, so any test can run alone or in any order.
 */
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'

import { data, funds, getFund, mergeFundDetail, fetchFundDetail } from '../src/lib/data'
import type { Fund } from '../src/types'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** A distinct index code per test, so tests never share hydration state. */
const code = (i: number) => data.funds[i].code

function shell(overrides: Partial<Fund> = {}): Partial<Fund> {
  return {
    aum: 123456,
    expenseRatio: 9.99,
    holdingsMeta: { asOf: '2026-01-31' } as any,
    analytics: { rollingAlpha: { spark: [['2026-01', 1.5]], windowM: 36 } } as any,
    ...overrides,
  }
}

test('getFund returns the shared index entry, and index entries are frozen', () => {
  const c = code(0)
  const f = getFund(c)!
  assert.strictEqual(f, funds.find((x) => x.code === c))
  assert.strictEqual(getFund(c), f) // stable identity across calls
  assert.strictEqual(Object.isFrozen(f), true)
})

test('getFund returns undefined for an unknown code', () => {
  assert.strictEqual(getFund(-1), undefined)
})

test('mergeFundDetail is pure: the shared index entry is never written to', () => {
  const index = getFund(code(1))!
  const before = {
    aum: index.aum,
    expenseRatio: index.expenseRatio,
    analytics: index.analytics,
    investInfo: index.investInfo,
    holdings: index.holdings,
  }

  const merged = mergeFundDetail(index, shell({ investInfo: { minSip: 1 } as any }))

  assert.notStrictEqual(merged, index)
  assert.strictEqual(merged.aum, 123456)
  assert.strictEqual(merged.expenseRatio, 9.99)
  assert.deepStrictEqual(merged.holdingsMeta, { asOf: '2026-01-31' })

  // Index values and references both unchanged...
  assert.strictEqual(index.aum, before.aum)
  assert.strictEqual(index.expenseRatio, before.expenseRatio)
  assert.strictEqual(index.analytics, before.analytics)
  assert.strictEqual(index.investInfo, before.investInfo)
  assert.strictEqual(index.holdings, before.holdings)
  // ...including the object the list/peer views read out of the exported array.
  const fromArray = funds.find((f) => f.code === index.code)!
  assert.strictEqual(fromArray, index)
  assert.strictEqual(fromArray.aum, before.aum)
  assert.strictEqual(fromArray.expenseRatio, before.expenseRatio)
})

test('two views hydrating the same fund get independent copies', () => {
  const index = getFund(code(2))!
  const a = mergeFundDetail(index, shell({ aum: 111 }))
  const b = mergeFundDetail(index, shell({ aum: 222 }))
  assert.notStrictEqual(a, b)
  assert.strictEqual(a.aum, 111)
  assert.strictEqual(b.aum, 222)
  assert.notStrictEqual(index.aum, 111)
  assert.notStrictEqual(index.aum, 222)
})

test('hydration precedence is unchanged: a blank shell cannot erase bundled values', () => {
  const index = getFund(code(3))!
  const empty = mergeFundDetail(index, {})
  assert.strictEqual(empty.aum, index.aum)
  assert.strictEqual(empty.expenseRatio, index.expenseRatio)
  assert.strictEqual(empty.investInfo, index.investInfo)

  const nulls = mergeFundDetail(index, { aum: null, expenseRatio: null, investInfo: null } as any)
  assert.strictEqual(nulls.aum, index.aum)
  assert.strictEqual(nulls.expenseRatio, index.expenseRatio)
  assert.strictEqual(nulls.investInfo, index.investInfo)

  // stockMoves is the one field an explicit value (including null) overrides.
  assert.strictEqual(mergeFundDetail(index, { stockMoves: null } as any).stockMoves, null)
})

test('detail-only rollingAlpha reaches the detail copy and not the index', () => {
  const index = getFund(code(4))!
  const merged = mergeFundDetail(index, shell())
  assert.strictEqual(merged.analytics?.rollingAlpha?.spark.length, 1)
  assert.strictEqual(merged.analytics?.rollingAlpha?.windowM, 36)
  assert.strictEqual(index.analytics?.rollingAlpha, undefined)
})

test('fetchFundDetail caches per code: concurrent callers share a single fetch', async () => {
  const c = code(5)
  const payload = { aum: 42 }
  let calls = 0
  globalThis.fetch = ((url: string) => {
    calls++
    assert.ok(url.includes('fund-data/' + c + '.json'))
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
  }) as any

  const [a, b] = await Promise.all([fetchFundDetail(c), fetchFundDetail(c)])
  const later = await fetchFundDetail(c)

  assert.strictEqual(calls, 1)
  assert.strictEqual(a, payload)
  assert.strictEqual(b, payload)
  assert.strictEqual(later, payload)
})

test('a failed shell fetch yields an empty detail and leaves the index intact', async () => {
  const c = code(6)
  globalThis.fetch = (() => Promise.reject(new Error('offline'))) as any

  const detail = await fetchFundDetail(c)
  assert.deepStrictEqual(detail, {})

  const index = getFund(c)!
  const before = index.aum
  assert.strictEqual(mergeFundDetail(index, detail).aum, before)
  assert.strictEqual(index.aum, before)
})
