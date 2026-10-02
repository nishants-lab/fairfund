import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryBadges } from '../src/lib/categoryBadges'
import type { CategoryBadgeKind } from '../src/lib/categoryBadges'
import type { FundsData, WindowMetrics } from '../src/types'
import { createBadgeFixture } from './fixtures/category-badges'

const keys = (data: FundsData) => Object.keys(data.categories)
const members = (data: FundsData, key: string) => data.funds.filter(f => f.category === key)
const badges = (data: FundsData) => categoryBadges(data, keys(data))
const winners = (data: FundsData, kind: CategoryBadgeKind) => [...badges(data)]
  .filter(([, badge]) => badge.kind === kind).map(([key]) => key)
function changeMetrics(data: FundsData, key: string, horizon: '3Y' | '5Y', change: Partial<WindowMetrics>) {
  for (const fund of members(data, key)) Object.assign(fund.metrics[horizon]!, change)
}

function assertInvariants(data: FundsData, shown: string[]) {
  const before = structuredClone(data)
  const beforeKeys = [...shown]
  const result = categoryBadges(data, shown)
  const displayed = [...new Set(shown)].filter(key => data.categories[key]?.fundCount > 0)
  assert.ok(result.size <= Math.min(9, Math.floor(displayed.length / 2)))
  for (const kind of ['return3Y', 'return', 'volatility'] as const) {
    assert.ok([...result.values()].filter(badge => badge.kind === kind).length <= 3)
  }
  for (const [key, badge] of result) {
    assert.ok(displayed.includes(key))
    assert.ok(['return3Y', 'return', 'volatility'].includes(badge.kind))
    assert.ok(badge.label.length > 0 && badge.explanation.length > 0)
    assert.doesNotMatch(badge.explanation, /NaN|Infinity|undefined/)
    assert.doesNotMatch(badge.label, /fund choice/)
  }
  assert.deepEqual([...result], [...categoryBadges(data, [...shown].reverse())])
  assert.deepEqual([...result], [...categoryBadges(data, [...shown, ...shown])])
  assert.deepEqual(data, before)
  assert.deepEqual(shown, beforeKeys)
}

test('synthetic winners prefer 3Y over 5Y over volatility without backfilling overlaps', () => {
  const data = createBadgeFixture()
  assert.deepEqual(winners(data, 'return3Y'), ['Three Alpha', 'Three Beta', 'Overlap'])
  assert.deepEqual(winners(data, 'return'), ['Five Alpha', 'Five Beta'])
  assert.deepEqual(winners(data, 'volatility'), ['Quiet'])
  assert.equal(badges(data).size, 6)
  for (const key of ['Reserve Return', 'Reserve Quiet', 'Reserve Three']) assert.equal(badges(data).has(key), false)
  assert.match(badges(data).get('Three Alpha')!.explanation, /30.00%.*3 eligible funds \(small sample\), 2021-06-14 to 2024-06-14/)
  assert.doesNotMatch(badges(data).get('Overlap')!.explanation, /5Y|5-year/)
  assert.match(badges(data).get('Five Alpha')!.explanation, /25.00%.*2019-06-14 to 2024-06-14/)
  assert.match(badges(data).get('Quiet')!.explanation, /3.00%.*credit or liquidity risk/)
  assertInvariants(data, keys(data))
})

test('sparse input, duplicate keys and empty categories do not force coverage or inflate the budget', () => {
  const data = createBadgeFixture()
  assert.equal(categoryBadges(data, []).size, 0)
  assert.equal(categoryBadges(data, ['Quiet', 'Quiet', 'unknown']).size, 0)
  assert.equal(categoryBadges(data, ['Unscored 0', 'Unscored 1', 'Unscored 2']).size, 0)
  data.categories['Three Beta'].fundCount = 0
  assert.equal(categoryBadges(data, ['Three Alpha', 'Three Beta', 'Overlap', 'unknown']).size, 0)
  assertInvariants(data, ['Three Alpha', 'Overlap', 'Five Alpha', 'Quiet', 'Quiet', 'unknown'])
})

test('category fund counts do not change ranked winners or substitute for eligible histories', () => {
  const data = createBadgeFixture()
  const before = [...badges(data)]
  data.categories['Reserve Return'].fundCount = 1000
  data.categories['Unscored 0'].fundCount = 1000
  assert.deepEqual([...badges(data)], before)
})

for (const [horizon, key, kind] of [
  ['3Y', 'Three Alpha', 'return3Y'], ['5Y', 'Five Alpha', 'return'], ['5Y', 'Quiet', 'volatility'],
] as const) {
  test(`${kind} rejects invalid, missing, future, partial and mismatched periods`, () => {
    const original = members(createBadgeFixture(), key)[0].metrics[horizon]!
    const year = Number(original.windowStart!.slice(0, 4))
    for (const change of [
      { windowStart: 'bad' }, { windowStart: undefined }, { windowEnd: undefined },
      { windowEnd: '2024-02-30' }, { windowEnd: '2024-06-15' },
      { windowStart: `${year}-06-15` }, { windowStart: `${year}-06-06` },
      { windowStart: '2025-06-14' },
    ]) {
      const data = createBadgeFixture()
      changeMetrics(data, key, horizon, change)
      assert.notEqual(badges(data).get(key)?.kind, kind, JSON.stringify(change))
    }
    const data = createBadgeFixture()
    members(data, key)[0].metrics[horizon]!.windowStart = `${year}-06-13`
    assert.notEqual(badges(data).get(key)?.kind, kind)
  })

  test(`${kind} accepts the seven-day start tolerance and periods earlier than the anchor`, () => {
    const data = createBadgeFixture()
    const year = horizon === '3Y' ? 2021 : 2019
    changeMetrics(data, key, horizon, { windowStart: `${year}-06-07` })
    assert.equal(badges(data).get(key)?.kind, kind)
    changeMetrics(data, key, horizon, { windowStart: `${year}-06-13`, windowEnd: '2024-06-13' })
    assert.equal(badges(data).get(key)?.kind, kind)
  })

  test(`${kind} needs three current eligible funds and excludes held or previous-only histories`, () => {
    for (const state of ['missing', 'held', 'previous-only']) {
      const data = createBadgeFixture()
      const fund = members(data, key)[0]
      if (state !== 'missing') fund.previousRankings = { [horizon]: { ...fund.metrics[horizon]!, cagr: 999, volatility: 0 } }
      if (state === 'held') fund.dataQuality = { status: 'quarantined', issues: [] }
      else delete fund.metrics[horizon]
      assert.notEqual(badges(data).get(key)?.kind, kind, state)
    }
  })

  test(`${kind} rejects a cutoff tie without promoting fourth place and is order-independent`, () => {
    const data = createBadgeFixture()
    const [third, fourth, field, value] = kind === 'return3Y'
      ? ['Overlap', 'Reserve Three', 'cagr', 20] as const
      : kind === 'return'
        ? ['Five Beta', 'Reserve Return', 'cagr', 20] as const
        : ['Quiet', 'Reserve Quiet', 'volatility', 3] as const
    changeMetrics(data, fourth, horizon, { [field]: value })
    if (kind === 'return') data.categories[fourth].medianCagr5Y = value
    const result = badges(data)
    assert.notEqual(result.get(third)?.kind, kind)
    assert.notEqual(result.get(fourth)?.kind, kind)
    assert.deepEqual(winners(data, kind), kind === 'return3Y' ? ['Three Alpha', 'Three Beta'] : kind === 'return' ? ['Five Alpha'] : [])
    assertInvariants(data, keys(data))
  })
}

test('invalid anchors suppress every badge criterion', () => {
  for (const anchor of ['', 'bad', '2024-02-30']) {
    const data = createBadgeFixture()
    data.anchor = anchor
    assert.equal(badges(data).size, 0)
  }
})

test('leap-day anniversary is clamped to the last February day for both horizons', () => {
  const data = createBadgeFixture()
  data.anchor = '2024-02-29'
  for (const fund of data.funds) for (const horizon of ['3Y', '5Y'] as const) {
    const metric = fund.metrics[horizon]
    if (metric) Object.assign(metric, { windowStart: `${horizon === '3Y' ? 2021 : 2019}-02-28`, windowEnd: data.anchor })
  }
  assert.deepEqual([...badges(data).keys()], [...badges(createBadgeFixture()).keys()])
})

test('nonfinite returns and invalid volatility do not count toward the three-fund minimum', () => {
  for (const [horizon, key, kind, field] of [
    ['3Y', 'Three Alpha', 'return3Y', 'cagr'], ['5Y', 'Five Alpha', 'return', 'cagr'],
    ['5Y', 'Quiet', 'volatility', 'volatility'],
  ] as const) {
    for (const value of [NaN, Infinity, -Infinity, ...(field === 'volatility' ? [-1] : [])]) {
      const data = createBadgeFixture()
      members(data, key)[0].metrics[horizon]![field] = value
      assert.notEqual(badges(data).get(key)?.kind, kind, `${kind}: ${value}`)
    }
  }
  const data = createBadgeFixture()
  changeMetrics(data, 'Quiet', '5Y', { volatility: 0 })
  assert.equal(badges(data).get('Quiet')?.kind, 'volatility')
})

test('5Y requires a finite stored median matching current returns within rounding tolerance', () => {
  for (const value of [null, NaN, Infinity, -Infinity, 99, 25.006]) {
    const data = createBadgeFixture()
    data.categories['Five Alpha'].medianCagr5Y = value
    assert.notEqual(badges(data).get('Five Alpha')?.kind, 'return', String(value))
  }
  const missing = createBadgeFixture()
  Reflect.deleteProperty(missing.categories['Five Alpha'], 'medianCagr5Y')
  assert.notEqual(badges(missing).get('Five Alpha')?.kind, 'return')
  const rounded = createBadgeFixture()
  changeMetrics(rounded, 'Five Alpha', '5Y', { cagr: 25.0049 })
  assert.equal(badges(rounded).get('Five Alpha')?.kind, 'return')
})

test('odd and even medians use the middle values rather than means or input order', () => {
  for (const [horizon, key, kind, field] of [
    ['3Y', 'Three Alpha', 'return3Y', 'cagr'], ['5Y', 'Five Alpha', 'return', 'cagr'],
    ['5Y', 'Quiet', 'volatility', 'volatility'],
  ] as const) {
    for (const values of field === 'cagr' ? [[90, 30, 20], [90, 20, 40, 30]] : [[9, 0, 1], [9, 0, 2, 1]]) {
      const data = createBadgeFixture()
      if (values.length === 4) {
        const extra = structuredClone(members(data, key)[0])
        extra.code = -1000
        data.funds.push(extra)
        data.totalFunds++
        data.categories[key].fundCount++
      }
      for (const [i, fund] of members(data, key).entries()) {
        fund.metrics[horizon]![field] = values[i]
        if (horizon === '3Y') delete fund.metrics['5Y']
      }
      const expected = field === 'cagr' ? (values.length === 3 ? 30 : 35) : (values.length === 3 ? 1 : 1.5)
      if (kind === 'return') data.categories[key].medianCagr5Y = expected
      const badge = badges(data).get(key)!
      assert.equal(badge.kind, kind)
      assert.ok(badge.explanation.includes(`${expected.toFixed(2)}%`))
      assert.ok(badge.explanation.includes(`${values.length} eligible funds (small sample)`))
    }
  }
})

test('additional quarantined and previous histories cannot contaminate healthy medians or counts', () => {
  const data = createBadgeFixture()
  const before = [...badges(data)]
  for (const held of [true, false]) {
    const extra = structuredClone(members(data, 'Three Alpha')[0])
    extra.code = held ? -1000 : -1001
    for (const metric of Object.values(extra.metrics)) Object.assign(metric, { cagr: 999, volatility: 0 })
    extra.previousRankings = structuredClone(extra.metrics)
    if (held) extra.dataQuality = { status: 'quarantined', issues: [] }
    else extra.metrics = {}
    data.funds.push(extra)
  }
  assert.deepEqual([...badges(data)], before)
})

test('3Y precedence fills a half-card budget before 5Y and volatility', () => {
  const data = createBadgeFixture()
  const shown = ['Three Alpha', 'Three Beta', 'Overlap', 'Five Alpha', 'Five Beta', 'Quiet']
  assert.deepEqual([...categoryBadges(data, shown).keys()], ['Three Alpha', 'Three Beta', 'Overlap'])
  assertInvariants(data, shown)
})

test('nine-badge maximum and odd half-card budgets apply to disjoint winners', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    key: `Category ${i}`, ...(i < 3 ? { return3Y: 30 - i } : {}),
    ...(i >= 3 && i < 6 ? { return5Y: 30 - i, volatility: 20 } : {}),
    ...(i >= 6 && i < 9 ? { volatility: i - 5 } : {}),
  }))
  const data = createBadgeFixture(rows)
  assert.equal(badges(data).size, 9)
  assert.equal(categoryBadges(data, keys(data).slice(0, 17)).size, 8)
  assertInvariants(data, keys(data))
})

test('synthetic refreshes can change values, dates, coverage and winners without changing the contract', () => {
  const original = createBadgeFixture()
  const refreshed = createBadgeFixture(undefined, '2025-08-22')
  changeMetrics(refreshed, 'Reserve Three', '3Y', { cagr: 40.12 })
  changeMetrics(refreshed, 'Reserve Return', '5Y', { cagr: 35.34 })
  refreshed.categories['Reserve Return'].medianCagr5Y = 35.34
  changeMetrics(refreshed, 'Reserve Quiet', '5Y', { volatility: 0.25 })
  for (const fund of members(refreshed, 'Three Alpha')) delete fund.metrics['3Y']
  assert.deepEqual(winners(refreshed, 'return3Y'), ['Reserve Three', 'Three Beta', 'Overlap'])
  assert.deepEqual(winners(refreshed, 'return'), ['Reserve Return', 'Five Alpha'])
  assert.deepEqual(winners(refreshed, 'volatility'), ['Reserve Quiet', 'Three Alpha', 'Five Beta'])
  assert.notDeepEqual([...badges(original)], [...badges(refreshed)])
  assert.match(badges(refreshed).get('Reserve Three')!.explanation, /40.12%.*2022-08-22 to 2025-08-22/)
  assert.match(badges(refreshed).get('Reserve Return')!.explanation, /35.34%.*2020-08-22 to 2025-08-22/)
  for (const data of [original, refreshed]) assertInvariants(data, keys(data))
})

test('current published data satisfies badge invariants without mutation', async () => {
  const { data, categoryOrder } = await import('../src/lib/data')
  assertInvariants(data, categoryOrder)
})
