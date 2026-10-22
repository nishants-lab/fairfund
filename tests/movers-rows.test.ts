/**
 * Movers rows: what the table shows for a state. Small hand-built funds give exact
 * numbers; the real data is used only for invariants, so the tests do not move when
 * the monthly data does.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import fundsJson from '../src/data/funds.json'
import moversJson from '../src/data/movers.json'
import stocksJson from '../src/data/movers_stocks.json'
import type { Fund } from '../src/types'
import { availableWindows, buildContext, type MoversData, type StocksData } from '../src/lib/moversData'
import { parseQuery } from '../src/lib/moversQuery'
import { freshState, type MoversState, type View } from '../src/lib/moversState'
import {
  fundRows, fundVals, groupRows, groupValueLabel, passesThreshold, sectorRows, stockRows, summarize, thresholdLabel, windowLabel, fmtCrore,
  fmtMeasure, isIndexFund, TRADE_TOLERANCE,
} from '../src/lib/moversRows'
import { moversContext } from './fixtures/movers-context'

function fund(code: number, name: string, category: string, extra: Partial<Fund> = {}): Fund {
  return {
    code, name, fullName: name, amc: name.split(' ')[0], category, categoryDisplay: category, riskLevel: 'Very High', categorySize: 10,
    metrics: {
      '1Y': { cagr: 10 + code, catMedianCagr: 12, catRank: code, catSize: 10, maxDrawdown: -5 * code, score: 0.5 + code / 100 } as never,
      '3Y': { cagr: 15 - code, catMedianCagr: 13, catRank: code, catSize: 10, maxDrawdown: -10, score: 0.8 } as never,
    },
    inceptionDate: '2020-01-01', expenseRatio: 0.5 + code / 10,
    ...extra,
  } as Fund
}

const F = [
  fund(1, 'Alpha Small Cap Fund', 'Small Cap'),
  fund(2, 'Beta Small Cap Fund', 'Small Cap', { isYoung: true, inceptionDate: '2025-06-01' }),
  fund(3, 'Gamma Nifty Bank Index Fund', 'Index-Sectoral/Thematic'),
  fund(4, 'Alpha Liquid Fund', 'Liquid', { isDebt: true, aum: { current: 5000, asOf: null } }),
  fund(5, 'Delta Mid Cap Fund', 'Mid Cap', { analytics: { rankTrajectory: { spark: [], currentRank: 2, currentPeers: 10, priorRank: 7, priorPeers: 10, direction: 'climbing', limited: false } } }),
]

const DATA: MoversData = {
  generatedAt: '2026-10-20', refMonth: '2026-09', windows: [1, 3, 6], stockWindows: [1, 3],
  funds: {
    '1': { m: [['2026-07', 900, 10, 1], ['2026-08', 1000, 50, 5], ['2026-09', 1100, 80, 2]], w: { '1': [100, 80, 20, 8], '3': [250, 140, 110, 16.47] }, t: { now: 0.6, '1': 0.05 } },
    '2': { m: [['2026-08', 200, null, null], ['2026-09', 180, -30, 6]], w: { '1': [-20, -30, 10, -15] }, t: { now: 0.7, '1': -0.1 }, mj: [['New Person', '2026-09-15'], ['Older Person', '2025-12-01']] },
    '3': { m: [['2026-08', 3000, 0, 0], ['2026-09', 3300, 300, 0]], w: { '1': [300, 300, 0, 10] } },
    '5': { m: [['2026-09', 700, null, null]], stale: true },
  },
  mgrLog: [['1', 'Gone Person', '2026-09-30'], ['1', 'Long Gone', '2025-01-01']],
  stocks: [['acme', 'Acme Ltd', 'Industrials'], ['bolt', 'Bolt Ltd', 'Technology'], ['cove', 'Cove Ltd', 'Industrials']],
}
const SD: StocksData = {
  refMonth: '2026-09',
  pairs: {
    '1': {
      from: '2026-08', px: { '0': 1.10 },
      funds: {
        // acme: price +10%; fund 1 NAV +5%: weight 5 -> 6 means position x 6/5 x 1.05 / 1.10 = 1.145 -> raised
        '1': [1000, 1100, [[0, 5, 6], [1, null, 2], [2, 3, null]], 1.05],
        // fund 2: weight 5 -> 5.24, x 1.05 / 1.10 = 1.0002 -> held (price move only)
        '2': [200, 180, [[0, 5, 5.24]], 1.05],
        // fund 3: weight 4 -> 3, no NAV growth known: a weight change only, not counted as selling
        '3': [3000, 3300, [[0, 4, 3], [1, 1, 2]], null],
      },
    },
    '3': { from: '2026-06', funds: {} },
  },
}
const st = (view: View, over: Partial<MoversState> = {}): MoversState => ({ ...freshState(view), ...over })
const names = (rows: { fund: Fund }[]) => rows.map(r => r.fund.code)

test('flows: window figures, % of starting AUM, sorting and sign', () => {
  const rows = fundRows(F, DATA, st('flows'))
  assert.deepEqual(names(rows), [3, 1, 2])                         // fund 4 has no AUM history, fund 5 is stale
  assert.equal(rows[1].vals.flow, 80)
  assert.equal(rows[1].vals.startAum, 1000)
  assert.equal(rows[1].vals.flowPct, 8)
  assert.equal(rows[1].vals.market, 20)
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { order: 'asc' }))), [2, 1, 3])
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { sign: 'neg' }))), [2])
  const pct = fundRows(F, DATA, st('flows', { mode: 'pct' }))
  assert.deepEqual(pct.map(r => r.value), [10, 8, -15])
  const w3 = fundRows(F, DATA, st('flows', { win: 3 }))
  assert.deepEqual(names(w3), [1])
  assert.equal(w3[0].vals.flowPct, 16.47)                          // 140 / (1100 - 250)
})

test('a fund asked for by name stays listed without this window, last and out of totals', () => {
  const s = st('flows', { names: ['delta'] })
  const rows = fundRows(F, DATA, s)
  assert.deepEqual(rows.map(r => [r.fund.code, r.missing]), [[5, true]])
  assert.equal(summarize(rows, s).count, 0)
  assert.deepEqual(groupRows(rows, { ...s, groupBy: 'category' }), [])
  assert.deepEqual(fundRows(F, DATA, { ...s, sign: 'pos' }), [])               // a condition needs the figure
  const both = fundRows(F, DATA, st('flows', { names: ['small'] }))
  assert.deepEqual(both.map(r => r.fund.code), [1, 2])
})

test('windows appear once enough funds have them; the question box uses only those', () => {
  const many: MoversData = { ...DATA, funds: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(i), { w: { '1': [1, 1, 0, 1], ...(i < 19 ? { '3': [1, 1, 0, 1] } : {}) } as never, t: { now: 1, '1': 0 } }])) }
  assert.deepEqual(availableWindows(many), { flowWindows: [1], costWindows: [1], stockWindows: [1, 3] })
  const more: MoversData = { ...many, funds: { ...many.funds, a: { w: { '3': [1, 1, 0, 1] } }, b: { w: { '6': [1, 1, 0, 1] } } } }
  assert.deepEqual(availableWindows(more).flowWindows, [1, 3])
  const ctx = { ...moversContext(), flowWindows: [1, 3] as (1 | 3)[], costWindows: [1, 3] as (1 | 3)[] }
  const six = parseQuery('6 month flows', ctx)
  assert.equal(six.state.win, 3)
  assert.ok(six.notes.some(n => /covers 3 months/.test(n)), six.notes.join(' | '))
  assert.equal(parseQuery('expense ratio cuts in last 6 months', ctx).state.win, 3)
  assert.equal(parseQuery('6 month flows', moversContext()).state.win, 6)         // without the data's windows, all three
  assert.equal(parseQuery('managers who joined in the last 6 months', ctx).state.win, 6)
})

test('a named month reads that month from the monthly rows', () => {
  const rows = fundRows(F, DATA, st('flows', { month: '2026-08' }))
  assert.deepEqual(names(rows), [1, 3])                            // fund 2 had no August estimate
  assert.equal(rows[0].vals.flow, 50)
  assert.equal(rows[0].vals.aumChange, 100)
  assert.equal(rows[0].vals.flowPct, 5.56)
  assert.equal(rows[0].vals.market, 50)
})

test('thresholds: units, the pct flag, inclusive rank cut-off and missing values', () => {
  const v = fundVals(F[0], DATA, st('flows'))
  assert.ok(passesThreshold(v, { field: 'flow', op: 'gt', a: 50 }))
  assert.ok(!passesThreshold(v, { field: 'flow', op: 'gt', a: 10, pct: true }))
  assert.ok(passesThreshold(v, { field: 'aum', op: 'gt', a: 9, pct: true }))      // "aum up 10%" compares the change
  assert.ok(passesThreshold(v, { field: 'aum', op: 'between', a: 1000, b: 1200 }))
  assert.ok(passesThreshold(v, { field: 'rankNow', op: 'lt', a: 1 }))              // "top 1" includes rank 1
  assert.ok(!passesThreshold(v, { field: 'rankMove', op: 'gt', a: 0 }))            // no trajectory: no value, no pass
  assert.ok(passesThreshold(v, { field: 'age', op: 'gt', a: 6 }))
  assert.ok(passesThreshold(v, { field: 'drawdown', op: 'lt', a: 20 }))           // drawdown is a magnitude
  assert.equal(v.score, 80)                                                        // 3Y score 0.8 shown out of 100
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { thresholds: [{ field: 'age', op: 'lt', a: 2 }] }))), [2])
})

test('fund filters: index, young, theme, names, debt view', () => {
  assert.ok(isIndexFund(F[2]) && !isIndexFund(F[0]))
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { type: 'index' }))), [3])
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { type: 'active' }))), [1, 2])
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { young: 'exclude' }))), [3, 1])
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { themes: ['banking'] }))), [3])
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { notThemes: ['banking'] }))), [1, 2])
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { names: ['beta'] }))), [2])
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { notCategories: ['Small Cap'] }))), [3])
  assert.deepEqual(names(fundRows(F, DATA, st('flows', { amcs: ['Alpha'] }))), [1])
  assert.deepEqual(names(fundRows(F, DATA, st('debt'))), [4])
})

test('returns, rank, momentum and cost views', () => {
  assert.deepEqual(fundRows(F, DATA, st('returns', { horizon: '1Y' })).map(r => r.value), [15, 14, 13, 12, 11])
  const vs = fundRows(F, DATA, st('returns', { horizon: '1Y', measure: 'vsCategory', sign: 'pos' }))
  assert.deepEqual(vs.map(r => r.value), [3, 2, 1])
  const rank = fundRows(F, DATA, st('rank'))
  assert.deepEqual(names(rank), [5])
  assert.equal(rank[0].value, 5)
  const mom = fundRows(F, DATA, st('momentum'))
  assert.equal(mom[0].fund.code, 5)                                // 15 vs 10: +5 pts
  assert.equal(mom[0].value, 5)
  const cost = fundRows(F, DATA, st('cost', { measure: 'terChange' }))
  assert.deepEqual(cost.map(r => [r.fund.code, r.value]), [[1, 0.05], [2, -0.1]])
  assert.deepEqual(names(fundRows(F, DATA, st('cost', { order: 'asc' }))).slice(0, 2), [1, 2])
})

test('managers: joins inside the window, departures from the log', () => {
  // any change: fund 2 had two joins, fund 1 one departure and no join
  const any = fundRows(F, DATA, st('managers'))
  assert.deepEqual(any.map(r => [r.fund.code, r.value]), [[2, 2], [1, 1]])
  const j = fundRows(F, DATA, st('managers', { measure: 'joined' }))
  assert.deepEqual(names(j), [2])
  assert.equal(j[0].value, 2)
  assert.deepEqual(fundRows(F, DATA, st('managers', { measure: 'joined', win: 1 })), [])   // 15 Sep is more than a month before 20 Oct
  assert.deepEqual(fundRows(F, DATA, st('managers', { measure: 'joined', win: 3 }))[0].joinedList, [['New Person', '2026-09-15']])
  const left = fundRows(F, DATA, st('managers', { measure: 'left' }))
  assert.deepEqual(left[0].leftList, [['Gone Person', '2026-09-30']])
  assert.deepEqual(names(fundRows(F, DATA, st('managers', { month: '2025-12' }))), [2])
})

test('grouping: an average asked for is an average, and the heading says so', () => {
  const avg = st('flows', { groupBy: 'category', agg: 'average' })
  const g = groupRows(fundRows(F, DATA, avg), avg).find(x => x.label === 'Small Cap')!
  assert.equal(g.value, 25)                                                    // (80 - 30) / 2, not the total 50
  assert.equal(groupValueLabel(avg), 'Average estimated net flow')
  assert.equal(groupValueLabel(st('flows', { groupBy: 'category' })), 'Total estimated net flow')
  const avgPct = st('flows', { groupBy: 'category', agg: 'average', mode: 'pct' })
  assert.equal(groupRows(fundRows(F, DATA, avgPct), avgPct).find(x => x.label === 'Small Cap')!.value, -3.5)   // (8 - 15) / 2
  assert.equal(groupValueLabel(st('flows', { groupBy: 'category', mode: 'pct' })), 'Combined estimated net flow (% of AUM)')
})

test('thresholds: "at least" includes the bound, "above" does not', () => {
  const v = fundVals(F[0], DATA, st('flows'))                                 // flow 80
  assert.equal(passesThreshold(v, { field: 'flow', op: 'gt', a: 80 }), false)
  assert.equal(passesThreshold(v, { field: 'flow', op: 'gt', a: 80, inc: true }), true)
  assert.equal(passesThreshold(v, { field: 'flow', op: 'lt', a: 80 }), false)
  assert.equal(passesThreshold(v, { field: 'flow', op: 'lt', a: 80, inc: true }), true)
  assert.equal(thresholdLabel({ field: 'flow', op: 'gt', a: 1000, inc: true }), 'Estimated net flow at least ₹1.0K Cr')
})

test('grouping: flows add up, % is a ratio of sums, other measures average, count counts', () => {
  const s = st('flows', { groupBy: 'category' })
  const g = groupRows(fundRows(F, DATA, s), s)
  assert.deepEqual(g.map(x => [x.label, x.value, x.n, x.pos, x.neg]), [['Index-Sectoral/Thematic', 300, 1, 1, 0], ['Small Cap', 50, 2, 1, 1]])
  assert.equal(g[1].totalAum, 1280)
  const sp = st('flows', { groupBy: 'category', mode: 'pct' })
  assert.equal(groupRows(fundRows(F, DATA, sp), sp)[1].value, 4.17)             // 50 / 1200
  const r = st('returns', { groupBy: 'category', horizon: '1Y' })
  assert.deepEqual(groupRows(fundRows(F, DATA, r), r).map(x => [x.label, x.value]), [['Liquid', 14], ['Index-Sectoral/Thematic', 13], ['Small Cap', 11.5], ['Mid Cap', 15]].sort((a, b) => (b[1] as number) - (a[1] as number)))
  const c = st('returns', { groupBy: 'category', count: true })
  assert.equal(groupRows(fundRows(F, DATA, c), c)[0].label, 'Small Cap')
  const t = st('flows', { groupBy: 'type' })
  assert.deepEqual(groupRows(fundRows(F, DATA, t), t).map(x => [x.key, x.value]), [['index', 300], ['active', 50]])
  const th = st('flows', { groupBy: 'theme' })
  assert.deepEqual(groupRows(fundRows(F, DATA, th), th).map(x => x.key), ['banking'])
})

test('summary: totals only add up for rupee flows and sizes', () => {
  const s = st('flows')
  assert.deepEqual(summarize(fundRows(F, DATA, s), s), { count: 3, total: 350, average: 116.67, summable: true })
  assert.equal(summarize(fundRows(F, DATA, st('flows', { mode: 'pct' })), st('flows', { mode: 'pct' })).summable, false)
  assert.equal(summarize([], s).total, null)
})

test('stocks: price-adjusted buying, added, exited and the fallback', () => {
  const rows = stockRows(F, DATA, SD, st('stocks'))
  const acme = rows.find(r => r.key === 'acme')!
  assert.deepEqual([acme.buyers, acme.sellers, acme.netBuyers, acme.priceMove], [1, 0, 1, 10])
  assert.deepEqual(acme.moves.map(m => [m.fund.code, m.action]), [[1, 'raised'], [2, 'held'], [3, 'down']])
  assert.equal(acme.moves[0].active, 14.5)
  assert.ok(Math.abs(acme.moves[1].active!) < TRADE_TOLERANCE * 100)
  assert.equal(acme.valueChange, Math.round((66 - 50 + (9.432 - 10) + (99 - 120)) * 10) / 10)   // value held, ₹ Cr, price moves included
  const bolt = rows.find(r => r.key === 'bolt')!
  assert.deepEqual([bolt.buyers, bolt.added, bolt.priceMove], [1, 1, null])   // fund 3's unadjusted rise is not a purchase
  assert.deepEqual(bolt.moves.map(m => m.action), ['added', 'up'])
  assert.deepEqual(rows.map(r => r.key), ['acme', 'bolt', 'cove'])               // net buyers 1, 1, -1
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { action: 'sell', order: 'asc' })).map(r => r.key), ['cove'])
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { measure: 'exited' })).map(r => r.key), ['cove'])
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { stockSectors: ['Technology'] })).map(r => r.key), ['bolt'])
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { categories: ['Small Cap'] })).find(r => r.key === 'acme')!.moves.length, 2)
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { stock: 'acme' })).map(r => r.key), ['acme'])
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { win: 3 })), [])
  const sec = sectorRows(rows, st('stocks', { groupBy: 'sector' }))
  assert.deepEqual(sec.map(x => [x.label, x.netBuyers, x.stocks]), [['Technology', 1, 1], ['Industrials', 0, 2]])
})

test('stocks: number limits apply per fund, and a named stock lists only the funds doing what was asked', () => {
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { thresholds: [{ field: 'aum', op: 'gt', a: 999999 }] })), [])
  const small = stockRows(F, DATA, SD, st('stocks', { thresholds: [{ field: 'aum', op: 'lt', a: 2000 }] }))   // funds 1 and 2, not fund 3 (3,300 Cr)
  assert.deepEqual(small.map(r => [r.key, r.moves.map(m => m.fund.code)]), [['acme', [1, 2]], ['bolt', [1]], ['cove', [1]]])
  // fund 3 alone only has unadjusted weight changes: no stock has evidence of buying or selling
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { thresholds: [{ field: 'aum', op: 'gt', a: 2000 }] })), [])
  const bought = stockRows(F, DATA, SD, st('stocks', { stock: 'acme', action: 'buy' }))[0]
  assert.deepEqual(bought.moves.map(m => [m.fund.code, m.action]), [[1, 'raised']])
  assert.deepEqual([bought.buyers, bought.sellers, bought.movers], [1, 0, 3])  // the stock's totals stay whole
  const sold = stockRows(F, DATA, SD, st('stocks', { stock: 'cove', action: 'sell' }))[0]
  assert.deepEqual(sold.moves.map(m => m.action), ['exited'])
  assert.deepEqual(stockRows(F, DATA, SD, st('stocks', { stock: 'acme', action: 'sell' }))[0].moves, [])
})

test('labels read the way people say them', () => {
  assert.equal(thresholdLabel({ field: 'age', op: 'gt', a: 3 }), 'Older than 3 years')
  assert.equal(thresholdLabel({ field: 'rankNow', op: 'lt', a: 5 }), 'Category rank 5 or better')
  assert.equal(thresholdLabel({ field: 'rankMove', op: 'lt', a: -5 }), 'Fell more than 5 places')
  assert.equal(thresholdLabel({ field: 'terChange', op: 'gt', a: 0.1 }), 'Expense ratio change above 10 bps')
  assert.equal(thresholdLabel({ field: 'flow', op: 'gt', a: 1000 }), 'Estimated net flow above ₹1.0K Cr')
  assert.equal(thresholdLabel({ field: 'flow', op: 'gt', a: 5, pct: true }), 'Estimated net flow above 5%')
  assert.equal(thresholdLabel({ field: 'vsCategory', op: 'gt', a: 0 }), 'Return vs category median positive')
  assert.equal(thresholdLabel({ field: 'cagr', op: 'between', a: 10, b: 15 }), 'Return 10% to 15%')
  assert.equal(windowLabel('2026-09', 1), 'Sept 2026'.replace('Sept', new Date('2026-09-01T00:00:00').toLocaleDateString('en-IN', { month: 'short' })))
  assert.match(windowLabel('2026-09', 3), /^\S+ to \S+ 2026$/)
  assert.match(windowLabel('2026-02', 6), /2025 to .* 2026$/)
  assert.equal(fmtCrore(-1234.5, true), '-₹1.2K Cr')
  assert.equal(fmtCrore(250000), '₹2.50L Cr')
  assert.equal(fmtMeasure('rankMove', -3), '▼ 3')
  assert.equal(fmtMeasure('flow', 2.5, 'pct'), '+2.50%')
  for (const t of [{ field: 'flow', op: 'gt', a: 1 }, { field: 'cagr', op: 'lt', a: 1 }] as const) assert.ok(!/—/.test(thresholdLabel(t)))
})

// ---- the real data, invariants only -------------------------------------------------
const REAL = (fundsJson as unknown as { funds: Fund[] }).funds
const RD = moversJson as unknown as MoversData
const RS = stocksJson as unknown as StocksData
const GOLDEN: { q: string }[] = JSON.parse(readFileSync(new URL('./fixtures/movers-queries.json', 'file://' + process.cwd().replace(/\\/g, '/') + '/tests/'), 'utf-8'))

test(`every golden question gives rows that obey its own state (${GOLDEN.length})`, () => {
  const ctx = buildContext(REAL, RD)
  let empty = 0
  for (const { q } of GOLDEN) {
    const s = parseQuery(q, ctx).state
    if (s.view === 'stocks') {
      const rows = stockRows(REAL, RD, RS, s)
      for (const r of rows) {
        assert.ok(Number.isFinite(r.value), q)
        assert.equal(r.netBuyers, r.buyers - r.sellers, q)
        if (s.stockSectors.length) assert.ok(s.stockSectors.includes(r.sector), q)
      }
      for (let i = 1; i < rows.length; i++) assert.ok(s.order === 'asc' ? rows[i - 1].value <= rows[i].value : rows[i - 1].value >= rows[i].value, q)
      if (!rows.length) empty++
      continue
    }
    const rows = fundRows(REAL, RD, s).filter(r => !r.missing)
    for (const r of rows) {
      assert.ok(Number.isFinite(r.value), q)
      for (const t of s.thresholds) assert.ok(passesThreshold(r.vals, t), `${q}: ${JSON.stringify(t)}`)
      if (s.sign === 'pos') assert.ok(r.value > 0, q)
      if (s.sign === 'neg') assert.ok(r.value < 0, q)
      if (s.categories.length) assert.ok(s.categories.includes(r.fund.category), q)
      if (s.amcs.length) assert.ok(s.amcs.includes(r.fund.amc), q)
      if (s.type === 'index') assert.ok(isIndexFund(r.fund), q)
    }
    for (let i = 1; i < rows.length; i++) assert.ok(s.order === 'asc' ? rows[i - 1].value <= rows[i].value : rows[i - 1].value >= rows[i].value, q)
    if (s.groupBy !== 'fund') {
      const g = groupRows(rows, s)
      for (const x of g) assert.ok(Number.isFinite(x.value) && x.n > 0, q)
    }
    if (!rows.length) empty++
  }
  // Most questions should find something in real data; a jump here means a filter broke.
  assert.ok(empty / GOLDEN.length < 0.2, `${empty} of ${GOLDEN.length} golden questions found nothing`)
})

test('real data: the headline example finds small caps with the biggest estimated inflow', () => {
  const s = parseQuery('which small cap fund had the highest inflow', buildContext(REAL, RD)).state
  const rows = fundRows(REAL, RD, s)
  assert.ok(rows.length > 10)
  assert.ok(rows.every(r => r.fund.category === 'Small Cap'))
  assert.ok(rows[0].value === Math.max(...rows.map(r => r.value)))
  assert.ok(moversContext().refMonth)
})
