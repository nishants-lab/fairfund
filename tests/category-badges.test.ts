import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryBadges } from '../src/lib/categoryBadges'
import { data, categoryOrder } from '../src/lib/data'
import type { FundsData } from '../src/types'
const clone = () => JSON.parse(JSON.stringify(data)) as FundsData

test('released snapshot gives the eight return and volatility badges without changing the dataset', () => {
  const before = JSON.stringify(data)
  const result = categoryBadges(data, categoryOrder)
  assert.equal(result.size, 8)
  const keys = (kind: string) => [...result].filter(([, b]) => b.kind === kind).map(([k]) => k).sort()
  assert.deepEqual(keys('return'), ['Index-MidCap', 'Small Cap'])
  assert.deepEqual(keys('volatility'), ['Arbitrage', 'Liquid', 'Money Market'])
  assert.deepEqual(keys('return3Y'), ['Index-Other', 'International', 'Mid Cap'])
  assert.ok([...result.values()].every(b => !b.label.includes('fund choice')))
  assert.match(result.get('International')!.explanation, /26.74%.*51 eligible funds, 2023-09-29 to 2026-09-29/)
  assert.match(result.get('Index-Other')!.explanation, /16.10%/)
  assert.match(result.get('Mid Cap')!.explanation, /3-year annualised returns: 15.68%/)
  assert.doesNotMatch(result.get('Mid Cap')!.explanation, /5Y|5-year/)
  assert.match(result.get('Index-MidCap')!.explanation, /3 eligible funds \(small sample\)/)
  assert.match(result.get('Liquid')!.explanation, /credit or liquidity risk/)
  assert.equal(JSON.stringify(data), before)
})
test('no forced half coverage or duplicate keys on sparse input', () => {
  assert.equal(categoryBadges(data, []).size, 0)
  assert.equal(categoryBadges(data, ['Liquid', 'Liquid', 'unknown']).size, 0)
  assert.ok(categoryBadges(data, ['Small Cap', 'Mid Cap', 'Index-MidCap', 'Liquid']).size <= 2)
})
test('bad dates, partial windows and mismatched category periods cannot earn performance badges', () => {
  for (const change of [
    { windowStart: 'bad' }, { windowEnd: '2999-01-01' }, { windowStart: '2023-09-30' },
  ]) {
    const d = clone()
    for (const f of d.funds) if (f.category === 'Small Cap' && f.metrics['5Y']) Object.assign(f.metrics['5Y'], change)
    assert.notEqual(categoryBadges(d, categoryOrder).get('Small Cap')?.kind, 'return')
  }
  const d = clone();const f = d.funds.find(f => f.category === 'Small Cap' && f.metrics['5Y'])!
  f.metrics['5Y']!.windowStart = '2021-09-29'
  assert.notEqual(categoryBadges(d, categoryOrder).get('Small Cap')?.kind, 'return')
})
test('held and previous-only histories do not enter current samples', () => {
  const d = clone()
  for (const f of d.funds.filter(f => f.category === 'Index-MidCap' && f.metrics['5Y']).slice(0, 1)) {
    f.dataQuality = { status: 'quarantined', issues: [] }
    f.previousRankings = { '5Y': f.metrics['5Y'] }
  }
  assert.notEqual(categoryBadges(d, categoryOrder).get('Index-MidCap')?.kind, 'return')
})
test('missing, nonfinite and stale category medians never earn return badges', () => {
  for (const value of [undefined, NaN, Infinity, 99]) {
    const d = clone();d.categories['Small Cap'].medianCagr5Y = value
    assert.notEqual(categoryBadges(d, categoryOrder).get('Small Cap')?.kind, 'return')
  }
})
test('overlapping return winners prefer 3Y without promoting fourth place or depending on fund counts', () => {
  const d = clone();d.categories['Sectoral/Thematic'].fundCount = 1000
  const result = categoryBadges(d, categoryOrder)
  assert.equal(result.get('Mid Cap')!.kind, 'return3Y')
  assert.equal(result.get('Small Cap')!.kind, 'return')
  assert.equal(result.has('Sectoral/Thematic'), false)
  assert.deepEqual([...result], [...categoryBadges(data, categoryOrder)])
})
test('a 3Y cutoff tie is omitted rather than arbitrarily split; order remains stable', () => {
  const d = clone()
  for (const f of d.funds) if (['Mid Cap', 'Small Cap'].includes(f.category) && f.metrics['3Y']) f.metrics['3Y']!.cagr = 15.68
  const a = categoryBadges(d, categoryOrder)
  assert.equal(a.get('Mid Cap')!.kind, 'return')
  assert.equal(a.get('Small Cap')!.kind, 'return')
  assert.deepEqual([...a], [...categoryBadges(d, [...categoryOrder].reverse())])
})
test('3Y badges reject invalid dates, partial or mixed windows, and nonfinite returns', () => {
  for (const change of [
    { windowStart: 'bad' }, { windowEnd: '2999-01-01' }, { windowStart: '2024-09-29' },
    { cagr: NaN }, { cagr: Infinity },
  ]) {
    const d = clone()
    for (const f of d.funds) if (f.category === 'International' && f.metrics['3Y']) Object.assign(f.metrics['3Y'], change)
    assert.notEqual(categoryBadges(d, categoryOrder).get('International')?.kind, 'return3Y')
  }
  const d = clone()
  d.funds.find(f => f.category === 'International' && f.metrics['3Y'])!.metrics['3Y']!.windowStart = '2023-09-28'
  assert.notEqual(categoryBadges(d, categoryOrder).get('International')?.kind, 'return3Y')
})
test('3Y requires three current eligible funds and ignores held and previous-only histories', () => {
  for (const held of [true, false]) {
    const d = clone()
    for (const f of d.funds.filter(f => f.category === 'International' && f.metrics['3Y']).slice(2)) {
      f.previousRankings = { '3Y': f.metrics['3Y'] }
      if (held) f.dataQuality = { status: 'quarantined', issues: [] }
      else delete f.metrics['3Y']
    }
    assert.notEqual(categoryBadges(d, categoryOrder).get('International')?.kind, 'return3Y')
  }
})
test('3Y median averages the middle pair and does not depend on 5Y history', () => {
  const d = clone()
  const members = d.funds.filter(f => f.category === 'International' && f.metrics['3Y'])
  for (const [i, f] of members.entries()) {
    delete f.metrics['5Y']
    if (i < 4) f.metrics['3Y']!.cagr = [20, 30, 40, 90][i]
    else delete f.metrics['3Y']
  }
  const badge = categoryBadges(d, categoryOrder).get('International')!
  assert.equal(badge.kind, 'return3Y')
  assert.match(badge.explanation, /35.00%.*4 eligible funds \(small sample\)/)
})
test('invalid volatility cannot create a lower-volatility badge', () => {
  const d = clone()
  for (const f of d.funds) if (f.category === 'Liquid' && f.metrics['5Y']) f.metrics['5Y']!.volatility = -1
  assert.notEqual(categoryBadges(d, categoryOrder).get('Liquid')?.kind, 'volatility')
})

test('3Y winners retain precedence when the badge budget is full', () => {
  const result = categoryBadges(data, ['International', 'Index-Other', 'Mid Cap', 'Small Cap', 'Index-MidCap', 'Liquid'])
  assert.equal(result.size, 3)
  assert.ok([...result.values()].every(b => b.kind === 'return3Y'))
  assert.deepEqual([...result.keys()].sort(), ['Index-Other', 'International', 'Mid Cap'])
})
