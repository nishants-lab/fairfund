import test from 'node:test'
import assert from 'node:assert/strict'
import { categoryBadges } from '../src/lib/categoryBadges'
import { data, categoryOrder } from '../src/lib/data'
import type { FundsData } from '../src/types'
const clone = () => JSON.parse(JSON.stringify(data)) as FundsData

test('released snapshot gives the approved nine badges without changing the dataset', () => {
  const before = JSON.stringify(data)
  const result = categoryBadges(data, categoryOrder)
  assert.equal(result.size, 9)
  const keys = (kind: string) => [...result].filter(([, b]) => b.kind === kind).map(([k]) => k).sort()
  assert.deepEqual(keys('return'), ['Index-MidCap', 'Mid Cap', 'Small Cap'])
  assert.deepEqual(keys('volatility'), ['Arbitrage', 'Liquid', 'Money Market'])
  assert.deepEqual(keys('choice'), ['Index-Other', 'Index-Sectoral/Thematic', 'Sectoral/Thematic'])
  assert.match(result.get('Index-MidCap')!.explanation, /3 eligible funds \(small sample\)/)
  assert.match(result.get('Liquid')!.explanation, /credit or liquidity risk/)
  assert.match(result.get('Sectoral/Thematic')!.explanation, /availability for purchase/)
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
test('overlapping winners have one badge, with no promotion of a fourth-place category', () => {
  const d = clone();d.categories['Small Cap'].fundCount = 1000
  const result = categoryBadges(d, categoryOrder)
  assert.equal(result.get('Small Cap')!.kind, 'return')
  assert.equal([...result.values()].filter(b => b.kind === 'choice').length, 2)
  assert.equal(result.has('International'), false)
})
test('a cutoff tie is omitted rather than arbitrarily split; order remains stable', () => {
  const d = clone();d.categories['International'].fundCount = d.categories['Index-Sectoral/Thematic'].fundCount
  const a = categoryBadges(d, categoryOrder)
  assert.equal(a.get('International')?.kind, undefined)
  assert.equal(a.get('Index-Sectoral/Thematic')?.kind, undefined)
  assert.deepEqual([...a], [...categoryBadges(d, [...categoryOrder].reverse())])
})
test('invalid volatility cannot create a lower-volatility badge', () => {
  const d = clone()
  for (const f of d.funds) if (f.category === 'Liquid' && f.metrics['5Y']) f.metrics['5Y']!.volatility = -1
  assert.notEqual(categoryBadges(d, categoryOrder).get('Liquid')?.kind, 'volatility')
})
