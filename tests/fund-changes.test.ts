import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  FUND_CHANGES_KEY, emptyFundChanges, markFundReviewed, observeFundChanges,
  readFundChanges, snapshotFund, writeFundChanges,
} from '../src/lib/fundChanges'
import type { FundSnapshot, FundChangesState } from '../src/lib/fundChanges'
import type { Fund } from '../src/types'

const day = '2026-09-30'
const nextDay = '2026-10-01'
const holding = (date = '2026-08-31', name = 'Example Ltd', pct = 5): FundSnapshot['holdings'] => ({ date, coverage: 'stock_level', items: [{ name, pct }] })
const sample = (): FundSnapshot => ({ cost: 0.5, managers: ['Example Manager'], holdings: holding() })
const observe = (state: FundChangesState, snapshot: FundSnapshot = sample(), when = day) => observeFundChanges(state, { 111549: snapshot }, [111549], when)
const first = () => observe(emptyFundChanges())
const entry = (state: FundChangesState) => state.funds['111549']
function storage(initial: string | null = null) {
  let value = initial
  return { getItem: (key: string) => { assert.equal(key, FUND_CHANGES_KEY); return value }, setItem: (key: string, raw: string) => { assert.equal(key, FUND_CHANGES_KEY); value = raw } }
}

test('first visit saves a baseline and produces no changes', () => {
  const state = first()
  assert.deepEqual(entry(state).baseline, sample())
  assert.deepEqual(entry(state).changes, [])
  assert.equal(entry(state).reviewedOn, day)
})

test('newly saved fund gets a baseline, removed funds are pruned, re-added funds start fresh', () => {
  const added = observeFundChanges(first(), { 42: { cost: 1 } }, [111549, 42], day)
  assert.deepEqual(added.funds['42'].changes, [])
  const removed = observeFundChanges(added, {}, [], day)
  assert.deepEqual(removed.funds, {})
  assert.deepEqual(entry(observe(removed, { cost: 2 })).changes, [])
})

test('cost and manager changes remain explicitly undated; holdings use real report dates', () => {
  const changed = observe(first(), { cost: 0.6, managers: ['New Manager'], holdings: holding('2026-09-30', 'Other Ltd', 6) }, nextDay)
  const changes = entry(changed).changes
  assert.equal(changes.length, 3)
  assert.equal(changes[0].fromDate, null)
  assert.equal(changes[0].toDate, null)
  assert.equal(changes[1].toDate, null)
  assert.equal(changes[2].fromDate, '2026-08-31')
  assert.equal(changes[2].toDate, '2026-09-30')
  assert.equal(changes[2].observedOn, nextDay)
  assert.deepEqual(entry(changed).baseline, sample())
})

test('missing data does not signal removals or erase existing observations', () => {
  const changed = observe(first(), { cost: 0.6 })
  const missing = observe(changed, {})
  assert.deepEqual(entry(missing), entry(changed))
  assert.deepEqual(entry(observeFundChanges(missing, {}, [111549], day)), entry(changed))
})

test('first available field establishes a baseline without claiming change', () => {
  const blank = observe(emptyFundChanges(), {})
  const supplied = observe(blank)
  assert.deepEqual(entry(supplied).changes, [])
  assert.deepEqual(entry(supplied).baseline, sample())
})

test('stale, same-date and changed-coverage holdings do not generate a comparison', () => {
  for (const h of [holding('2026-07-31', 'Other'), holding('2026-08-31', 'Other'), { ...holding('2026-09-30')!, coverage: 'fof_level' }]) {
    const state = observe(first(), { holdings: h })
    assert.deepEqual(entry(state).changes, [])
    assert.deepEqual(entry(state).latest.holdings, holding())
  }
})

test('same snapshot and unchanged newer holdings snapshot do not duplicate changes', () => {
  const snapshot = { cost: 0.6, holdings: holding('2026-09-30') }
  const changed = observe(first(), snapshot)
  assert.equal(entry(changed).changes.length, 1)
  assert.deepEqual(entry(observe(changed, snapshot)), entry(changed))
  assert.equal(entry(changed).latest.holdings?.date, '2026-09-30')
})

test('observations persist across reload, return to prior value, and missing data until explicit review', () => {
  const changed = observe(first(), { cost: 0.6 })
  const reverted = observe(changed, { cost: 0.5 })
  assert.equal(entry(reverted).changes.length, 2)
  const store = storage()
  assert.equal(writeFundChanges(store, reverted), undefined)
  const restored = readFundChanges(store)
  assert.equal(restored.error, undefined)
  assert.deepEqual(restored.state, reverted)
  const reviewed = markFundReviewed(restored.state, 111549, nextDay)
  assert.deepEqual(entry(reviewed).changes, [])
  assert.equal(entry(reviewed).reviewedOn, nextDay)
  assert.deepEqual(entry(reviewed).baseline, entry(reverted).latest)
  assert.equal(entry(reverted).changes.length, 2)
})

test('real detail source dates: expense and manager fields have no report date; portfolio does', () => {
  const detail = JSON.parse(readFileSync('public/fund-data/111549.json', 'utf8'))
  const snapshot = snapshotFund(detail as Fund)
  assert.equal(snapshot.cost, detail.expenseRatio)
  assert.equal(snapshot.holdings?.date, detail.holdingsMeta.portfolioDate)
  assert.ok(snapshot.managers!.length > 0)
  assert.ok(snapshot.holdings!.items.length <= 30)
  assert.equal('expenseRatioDate' in detail, false)
  assert.equal('asOf' in detail.management, false)
})

test('snapshot validates dates and values, canonicalizes managers and retains reduced-surface limits', () => {
  const fund = { expenseRatio: 0, management: { available: true, managers: [{ name: 'B' }, { name: 'A' }] }, holdingsMeta: { coverage: 'stock_level', portfolioDate: '2026-02-30' }, holdings: [{ name: 'Example', pct: 3 }] } as Fund
  assert.deepEqual(snapshotFund(fund), { cost: 0, managers: ['A', 'B'] })
  assert.deepEqual(snapshotFund({ ...fund, isDebt: true }), { cost: 0 })
  assert.deepEqual(snapshotFund({ ...fund, isArbitrage: true }), { cost: 0 })
  assert.deepEqual(snapshotFund({ expenseRatio: NaN, management: { available: true, managers: [null] } } as unknown as Fund), {})
})

test('invalid, oversized or denied storage is reported and never overwritten by reading', () => {
  for (const raw of ['{', JSON.stringify({ version: 2, funds: {} }), 'x'.repeat(1_000_001), '{"version":1,"funds":{"__proto__":{}}}', JSON.stringify({ version: 1, funds: { 1: { reviewedOn: day, baseline: { cost: -1 }, latest: {}, changes: [] } } })]) {
    const store = storage(raw)
    assert.ok(readFundChanges(store).error)
    assert.equal(store.getItem(FUND_CHANGES_KEY), raw)
  }
  assert.ok(readFundChanges({ getItem() { throw new Error('denied') } }).error)
  assert.ok(writeFundChanges({ setItem() { throw new Error('quota') } }, first()))
})

test('bounded fund count and retained history fail explicitly without mutation', () => {
  assert.throws(() => observeFundChanges(emptyFundChanges(), {}, Array.from({ length: 101 }, (_, i) => i + 1), day), /100/)
  let state = first()
  for (let i = 0; i < 60; i++) state = observe(state, { cost: i % 2 ? 0.5 : 0.6 })
  assert.equal(entry(state).changes.length, 60)
  assert.throws(() => observe(state, { cost: 0.7 }), /full/)
  assert.equal(entry(state).changes.length, 60)
  assert.deepEqual(entry(markFundReviewed(state, 111549, nextDay)).changes, [])
})

test('new and removed disclosed positions and managers are represented without trade claims', () => {
  const initial = observe(emptyFundChanges(), { managers: ['A', 'B'], holdings: { date: '2026-08-31', coverage: 'stock_level', items: [{ name: 'Earlier Ltd', pct: 5 }, { name: 'Retained Ltd', pct: 3 }] } })
  const changed = observe(initial, { managers: ['B', 'C'], holdings: { date: '2026-09-30', coverage: 'stock_level', items: [{ name: 'New Ltd', pct: 4 }, { name: 'Retained Ltd', pct: 3 }] } })
  assert.equal(entry(changed).changes.length, 2)
  assert.equal(entry(changed).changes[0].before, 'A, B')
  assert.equal(entry(changed).changes[0].after, 'B, C')
  assert.match(entry(changed).changes[1].before, /Earlier Ltd/)
  assert.match(entry(changed).changes[1].after, /New Ltd/)
  assert.doesNotMatch(entry(changed).changes[1].after, /Earlier Ltd/)
})

test('stored cost dates cannot masquerade as real report dates and malformed holdings dates are rejected', () => {
  const state = observe(first(), { cost: 0.6 })
  entry(state).changes[0].toDate = day
  assert.ok(readFundChanges(storage(JSON.stringify(state))).error)
  const dated = observe(first(), { holdings: holding('2026-09-30', 'Other') })
  entry(dated).changes[0].fromDate = '2026-10-01'
  assert.ok(readFundChanges(storage(JSON.stringify(dated))).error)
})
