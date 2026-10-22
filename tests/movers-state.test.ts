import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MEASURE, DEFAULT_STATE, VIEW_OF, freshState, paramsToState, stateToParams, type MoversState, type View } from '../src/lib/moversState'

const VIEWS: View[] = ['flows', 'size', 'returns', 'rank', 'momentum', 'cost', 'managers', 'stocks', 'debt']
const round = (s: MoversState) => paramsToState(stateToParams(s))

test('a fresh view writes nothing but its name', () => {
  assert.equal(stateToParams(freshState('flows')).toString(), '')
  for (const v of VIEWS.filter(v => v !== 'flows')) assert.equal(stateToParams(freshState(v)).toString(), `view=${v}`)
  for (const v of VIEWS) assert.deepEqual(round(freshState(v)), freshState(v))
})

test('every view has a default measure that belongs to it', () => {
  for (const v of VIEWS) if (v !== 'debt') assert.equal(VIEW_OF[DEFAULT_MEASURE[v]], v)
  assert.equal(freshState('managers').win, 12)
  assert.equal(DEFAULT_STATE.view, 'flows')
})

test('a full state survives the round trip', () => {
  const s: MoversState = {
    ...freshState('flows'), mode: 'pct', win: 6, horizon: '5Y', order: 'asc', sign: 'neg', groupBy: 'amc',
    categories: ['Small Cap', 'Large & Mid Cap'], notCategories: ['Sectoral/Thematic'], amcs: ['HDFC', 'quant'], notAmcs: ['SBI'],
    themes: ['banking'], notThemes: ['us'], type: 'active', young: 'exclude', risk: ['Very High'],
    thresholds: [{ field: 'flow', op: 'gt', a: 500 }, { field: 'cagr', op: 'between', a: 10, b: 15 }, { field: 'flow', op: 'lt', a: -2.5, pct: true }],
    names: ['parag', 'flexicap'], limit: 10, month: '2026-08', count: true, agg: 'total',
  }
  assert.deepEqual(round(s), s)
  const st: MoversState = { ...freshState('stocks'), stock: 'hdfc-bank-ltd', action: 'sell', stockSectors: ['Financial'], groupBy: 'sector', win: 3 }
  assert.deepEqual(round(st), st)
})

test('bad or hostile parameters fall back to defaults', () => {
  const s = paramsToState(new URLSearchParams('view=hack&measure=__proto__&win=7&horizon=10Y&order=sideways&sign=x&groupBy=planet&limit=9999&month=Sept&count=1&agg=max'))
  assert.deepEqual(s, freshState('flows'))
  // A measure from another view is ignored.
  assert.equal(paramsToState(new URLSearchParams('view=cost&measure=flow')).measure, 'ter')
  // Thresholds: unknown fields, bad numbers, half a range and too many entries are dropped.
  const th = paramsToState(new URLSearchParams('th=' + encodeURIComponent('evil:gt:1||flow:gt:abc|flow:between:5:|aum:gt:100::|flow:zz:1')))
  assert.deepEqual(th.thresholds, [{ field: 'aum', op: 'gt', a: 100 }])
  const many = paramsToState(new URLSearchParams('th=' + Array.from({ length: 30 }, (_, i) => `aum:gt:${i}::`).join('|')))
  assert.equal(many.thresholds.length, 10)
  const lists = paramsToState(new URLSearchParams('categories=' + Array.from({ length: 40 }, (_, i) => `c${i}`).join('|')))
  assert.equal(lists.categories.length, 20)
  assert.equal(paramsToState(new URLSearchParams('limit=0')).limit, null)
  assert.equal(paramsToState(new URLSearchParams('limit=2.5')).limit, null)
})
