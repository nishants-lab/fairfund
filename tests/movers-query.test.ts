import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { editDistance, nameMatches, parseQuery, tokenize } from '../src/lib/moversQuery'
import { freshState, paramsToState, stateToParams, type MoversState } from '../src/lib/moversState'
import { moversContext } from './fixtures/movers-context'

const ctx = moversContext()
const P = (q: string) => parseQuery(q, ctx)
const S = (q: string) => P(q).state
/** The parts of a state that differ from the fresh state of its view. */
function diff(s: MoversState): Record<string, unknown> {
  const base = freshState(s.view) as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { view: s.view }
  for (const [k, v] of Object.entries(s)) if (JSON.stringify(v) !== JSON.stringify(base[k])) out[k] = v
  return out
}

test('the example question: which small cap fund had the highest inflow', () => {
  const r = P('which small cap fund had the highest inflow')
  assert.equal(r.state.view, 'flows')
  assert.equal(r.state.measure, 'flow')
  assert.equal(r.state.order, 'desc')
  assert.deepEqual(r.state.categories, ['Small Cap'])
  assert.equal(r.singular, true)
  assert.deepEqual(r.unknown, [])
})

test('amounts: units, comparators, ranges and signs', () => {
  assert.deepEqual(S('inflow more than 500 cr').thresholds, [{ field: 'flow', op: 'gt', a: 500 }])
  assert.deepEqual(S('aum above 1 lakh crore').thresholds, [{ field: 'aum', op: 'gt', a: 100000 }])
  assert.deepEqual(S('funds bigger than 50k cr').thresholds, [{ field: 'aum', op: 'gt', a: 50000 }])
  assert.deepEqual(S('inflow more than 1.5k cr').thresholds, [{ field: 'flow', op: 'gt', a: 1500 }])
  assert.deepEqual(S('inflows over ₹2,000 cr').thresholds, [{ field: 'flow', op: 'gt', a: 2000 }])
  assert.deepEqual(S('inflow of rs 1,500 crore').thresholds, [{ field: 'flow', op: 'gt', a: 1500 }])
  assert.deepEqual(S('1,000 cr inflow').thresholds, [{ field: 'flow', op: 'gt', a: 1000 }])
  assert.deepEqual(S('inflow < -200').thresholds, [{ field: 'flow', op: 'lt', a: -200 }])
  assert.deepEqual(S('aum 10000-20000 cr').thresholds, [{ field: 'aum', op: 'between', a: 10000, b: 20000 }])
  assert.deepEqual(S('returns between 12% and 18%').thresholds, [{ field: 'cagr', op: 'between', a: 12, b: 18 }])
  assert.deepEqual(S('inflow above 2% of aum').thresholds, [{ field: 'flow', op: 'gt', a: 2, pct: true }])
  // An outflow "of more than 1k" is a flow below minus 1,000.
  assert.deepEqual(S('outflow of more than 1k cr').thresholds, [{ field: 'flow', op: 'lt', a: -1000 }])
  assert.deepEqual(S('outflows more than 3% of aum in 3 months').thresholds, [{ field: 'flow', op: 'lt', a: -3, pct: true }])
  // Basis points are hundredths of a percentage point.
  assert.deepEqual(S('ter hikes above 10 bps').thresholds, [{ field: 'terChange', op: 'gt', a: 0.1 }])
  assert.deepEqual(S('expense ratio cut by more than 20 bps').thresholds, [{ field: 'terChange', op: 'lt', a: -0.2 }])
})

test('a figure with no measure sorts by the figure it filters', () => {
  assert.equal(S('aum more than 50000 cr').view, 'size')
  assert.equal(S('returns above 20%').view, 'returns')
  assert.equal(S('sharpe > 1').measure, 'sharpe')
  const cost = S('expense ratio below 0.5%')
  assert.equal(cost.view, 'cost')
  assert.equal(cost.order, 'asc')
  // Two figures: flows win, the other stays a filter.
  const both = S('aum > 10k cr and inflow > 100 cr')
  assert.equal(both.view, 'flows')
  assert.equal(both.thresholds.length, 2)
})

test('ranks: cut-offs, places and level-versus-change', () => {
  assert.deepEqual(S('funds ranked in the top 3 of their category').thresholds, [{ field: 'rankNow', op: 'lt', a: 3 }])
  assert.equal(S('funds ranked in the top 3 of their category').groupBy, 'fund')
  assert.deepEqual(S('funds that dropped more than 5 places').thresholds, [{ field: 'rankMove', op: 'lt', a: -5 }])
  assert.equal(S('rank improvers in small cap').measure, 'rankMove')
  assert.equal(S('funds whose rank improved by 5 or more').measure, 'rankMove')
  assert.equal(S('rank changes this month').measure, 'rankMove')
  assert.equal(S('top ranked funds in mid cap').measure, 'rankNow')
  assert.equal(S('top ranked funds in mid cap').order, 'asc')
})

test('levels plus a direction become changes', () => {
  assert.deepEqual([S('ter increased').measure, S('ter increased').sign], ['terChange', 'pos'])
  assert.deepEqual([S('expense ratio cuts in last 6 months').measure, S('expense ratio cuts in last 6 months').win], ['terChange', 6])
  assert.deepEqual([S('decline in assets').measure, S('decline in assets').sign], ['aumChange', 'neg'])
  assert.equal(S('funds whose aum grew the most').measure, 'aumChange')
  assert.equal(S('aum change by amc').sign, 'any')
})

test('secondary conditions become filters', () => {
  const a = S('which mid cap funds had outflows despite good returns')
  assert.deepEqual([a.measure, a.sign, a.order], ['flow', 'neg', 'asc'])
  assert.deepEqual(a.thresholds, [{ field: 'vsCategory', op: 'gt', a: 0 }])
  assert.deepEqual(S('funds with inflow but aum falling').thresholds, [{ field: 'aumChange', op: 'lt', a: 0 }])
  assert.deepEqual(S('funds with new manager and outflows').thresholds, [{ field: 'flow', op: 'lt', a: 0 }])
  assert.deepEqual(S('funds where manager changed and returns fell').thresholds, [{ field: 'momentum', op: 'lt', a: 0 }])
})

test('negation and exclusions', () => {
  assert.deepEqual(S('large cap not hdfc').notAmcs, ['HDFC'])
  assert.deepEqual(S('mid cap except sbi and hdfc').notAmcs, ['SBI', 'HDFC'])
  assert.equal(S('small cap excluding index').type, 'active')
  assert.equal(S('excluding young funds inflows').young, 'exclude')
  assert.deepEqual(S('all funds except sectoral').notCategories, ['Sectoral/Thematic'])
  assert.deepEqual(S('equity funds inflows').notCategories, ['Liquid', 'Money Market', 'Arbitrage'])
})

test('fund age', () => {
  assert.deepEqual(S('funds older than 3 years with outflows').thresholds, [{ field: 'age', op: 'gt', a: 3 }])
  assert.equal(S('funds older than 3 years with outflows').sign, 'neg')
  assert.deepEqual(S('funds launched in last 2 years').thresholds, [{ field: 'age', op: 'lt', a: 2 }])
  assert.deepEqual(S('funds less than a year old').thresholds, [{ field: 'age', op: 'lt', a: 1 }])
  assert.equal(S('young funds with inflows').young, 'only')
})

test('index categories, both types and comparisons', () => {
  assert.deepEqual(S('small cap index funds inflow').categories, ['Index-SmallCap'])
  const t = S('index vs active small cap')
  assert.deepEqual([t.groupBy, t.type], ['type', 'all'])
  assert.deepEqual(t.categories, ['Small Cap', 'Index-SmallCap'])
  assert.equal(S('nippon vs hdfc inflows').groupBy, 'amc')
  const sm = S('small vs mid cap flows')
  assert.deepEqual([sm.groupBy, sm.categories], ['category', ['Small Cap', 'Mid Cap']])
  assert.deepEqual(S('small, mid and large cap flows').categories, ['Small Cap', 'Mid Cap', 'Large Cap'])
  // "large and mid cap" is its own category, not two.
  assert.deepEqual(S('large and mid cap').categories, ['Large & Mid Cap'])
  assert.deepEqual(S('large & mid cap funds outflow').categories, ['Large & Mid Cap'])
})

test('grouping, counting and totals', () => {
  assert.equal(S('which AMC had the highest inflows').groupBy, 'amc')
  assert.deepEqual([S('total inflow by category').groupBy, S('total inflow by category').agg], ['category', 'total'])
  assert.equal(S('how many funds had outflows').count, true)
  assert.equal(S('which category has the most funds').count, true)
  assert.equal(S('which theme got the most inflows').groupBy, 'theme')
  assert.equal(S('inflows by sector').groupBy, 'theme')
  assert.equal(S('top buys by sector').groupBy, 'sector')
  assert.equal(S('how much money went into small caps').agg, 'total')
  assert.deepEqual([S('how big is the small cap category').view, S('how big is the small cap category').agg], ['size', 'total'])
})

test('time: windows, horizons and months', () => {
  assert.equal(S('top 10 mid cap funds by inflow last 3 months').win, 3)
  assert.equal(S('6m inflow').win, 6)
  assert.equal(S('highest 5y cagr in flexi cap').horizon, '5Y')
  assert.equal(S('1 year return between 10 and 15 percent').horizon, '1Y')
  // Two months asked for: the closest window, said out loud.
  const two = P('inflows in the last 2 months')
  assert.equal(two.state.win, 3)
  assert.match(two.notes.join(' '), /Windows are 1, 3 and 6 months/)
  assert.match(P('past year flows').notes.join(' '), /History here covers 6 months/)
  assert.equal(S('inflows in august').month, '2026-08')
  assert.equal(S('inflows in july 2026').month, '2026-07')
  assert.equal(S('inflows in september').month, null)
  const old = P('inflows in december')
  assert.equal(old.state.month, null)
  assert.match(old.notes.join(' '), /starts at May 2026/)
  // Years attached to a return filter are not a flow window.
  const r = P('3 year cagr above 25% small cap with inflows')
  assert.equal(r.state.win, 1)
  assert.deepEqual(r.notes, [])
  assert.equal(S('worst performing funds this year').horizon, '1Y')
  assert.match(P('inflows in q2').notes.join(' '), /Quarters are read as the latest 3 months/)
})

test('portfolio moves: stocks, sectors and buyers', () => {
  assert.deepEqual([S('which funds bought hdfc bank').stock, S('which funds bought hdfc bank').action], ['hdfc-bank-ltd', 'buy'])
  // A stock named on its own is a stock question; "hdfc" alone is the fund house.
  assert.equal(S('hdfc bank').view, 'stocks')
  assert.equal(S('hdfc bank').stock, 'hdfc-bank-ltd')
  assert.deepEqual(S('hdfc bank').amcs, [])
  assert.equal(S('hdfc').view, 'flows')
  assert.equal(S('infosys').stock, 'infosys-ltd')
  assert.equal(S('sbi small cap inflow').view, 'flows')
  assert.equal(S('bought sbi').stock, 'state-bank-of-india')
  assert.deepEqual(S('sbi bought').amcs, ['SBI'])
  assert.deepEqual(S('it stocks sold').stockSectors, ['Technology'])
  assert.deepEqual(S('banking stocks bought').stockSectors, ['Financial'])
  assert.deepEqual(S('pharma stocks bought by small caps').stockSectors, ['Healthcare'])
  assert.equal(S('tata motors buyers').stock, 'tata-motors-ltd')
  assert.equal(S('reliace buyers').stock, 'reliance-industries-ltd')
  assert.equal(S('funds exiting zomato').action, 'exited')
  assert.equal(S('new entries in mid cap portfolios').action, 'added')
  assert.equal(S('who sold reliance').order, 'asc')
  assert.match(P('which funds own adani').notes.join(' '), /Several stocks start with "adani"/)
  // "should i buy" is not a stock purchase.
  assert.equal(S('which fund should i buy').view, 'flows')
  // Investors dumping funds is outflows, not funds selling stocks.
  assert.deepEqual([S('funds investors are dumping').view, S('funds investors are dumping').sign], ['flows', 'neg'])
})

test('managers and costs', () => {
  assert.equal(S('manager changes').view, 'managers')
  assert.equal(S('manager left').measure, 'left')
  assert.equal(S('which funds lost their fund manager').measure, 'left')
  assert.equal(S('fund manager changes last 3 months').win, 3)
  assert.deepEqual([S('cheapest index funds').measure, S('cheapest index funds').order], ['ter', 'asc'])
  assert.deepEqual([S('who cut fees').measure, S('who cut fees').sign], ['terChange', 'neg'])
  assert.equal(S('cost changes').measure, 'terChange')
})

test('returns family', () => {
  assert.equal(S('best performing small cap fund 3 years').measure, 'cagr')
  assert.equal(S('funds beating category by most').measure, 'vsCategory')
  assert.equal(S('funds beating category by most').groupBy, 'fund')
  assert.deepEqual([S('funds with negative returns').measure, S('funds with negative returns').sign], ['cagr', 'neg'])
  assert.deepEqual([S('lowest volatility mid cap').measure, S('lowest volatility mid cap').order], ['volatility', 'asc'])
  assert.deepEqual([S('safest large cap funds').measure, S('safest large cap funds').order], ['volatility', 'asc'])
  assert.equal(S('top losers').order, 'asc')
  assert.equal(S('funds lagging their category').groupBy, 'fund')
})

test('typos are fixed, ordinary words are left alone', () => {
  const r = P('smal cap inflw')
  assert.deepEqual(r.state.categories, ['Small Cap'])
  assert.deepEqual(r.corrected, [['smal', 'small'], ['inflw', 'inflow']])
  for (const q of ['inflow ₹500cr+', 'funds beating category by most', 'funds with negative returns', 'momentum leaders']) {
    assert.deepEqual(P(q).corrected, [], q)
  }
  assert.deepEqual(S('inflow ₹500cr+').themes, [])
})

test('fund names are matched as names', () => {
  const k = S('kotak emerging equity')
  assert.deepEqual(k.names, ['kotak', 'emerging', 'equity'])
  assert.deepEqual([k.themes, k.notCategories], [[], []])
  assert.deepEqual(S('hdfc flexi cap').names, ['hdfc', 'flexicap'])
  assert.deepEqual(S('motilal oswal nifty').names, ['motilal', 'oswal', 'nifty'])
  assert.ok(nameMatches('kotak midcap fund kotak emerging equity fund', ['kotak', 'emer']))
  assert.ok(!nameMatches('kotak midcap fund', ['kotak', 'smallcap']))
})

test('advice, unsupported asks and nonsense are said plainly', () => {
  const a = P('should i invest in small cap')
  assert.equal(a.advice, true)
  assert.match(a.notes[0], /does not recommend funds/)
  assert.deepEqual(a.unknown, [])
  assert.match(P('hybrid funds').notes.join(' '), /Hybrid funds are not part of FairFund/)
  assert.match(P('etf flows').notes.join(' '), /ETFs are not part of FairFund/)
  assert.match(P('direct plan').notes.join(' '), /direct growth plan/)
  assert.match(P('liquid fund inflows').notes.join(' '), /not tracked for liquid and money market/)
  assert.equal(S('liquid fund inflows').view, 'debt')
  for (const q of ['xyz qwerty', '?', '!!!', '', '   ']) assert.equal(P(q).understood, false, JSON.stringify(q))
  assert.deepEqual(P('xyz qwerty').unknown, ['xyz', 'qwerty'])
  assert.equal(P('summary').understood, true)
})

test('tokenizer and edit distance', () => {
  assert.deepEqual(tokenize('Inflow ₹1,500cr+ & 10-15%'), ['inflow', 'rs', '1500', 'cr', 'plus', 'and', '10', 'to', '15', '%'])
  assert.deepEqual(tokenize('returns<0 and ter<=0.5'), ['returns', 'lt', '0', 'and', 'ter', 'lte', '0.5'])
  assert.deepEqual(tokenize('aum ≥ 500 and ter ≤ 1'), ['aum', 'gte', '500', 'and', 'ter', 'lte', '1'])
  assert.deepEqual(tokenize('inflow -200'), ['inflow', '-200'])
  assert.equal(editDistance('inflw', 'inflow'), 1)
  assert.equal(editDistance('flexy', 'flexi'), 1)
  assert.equal(editDistance('outfow', 'outflow'), 1)
  assert.ok(editDistance('kotak', 'sundaram') > 2)
})

test('negative controls: the parser must not invent filters', () => {
  assert.deepEqual(S('where is the money going').sign, 'any')
  assert.deepEqual(S('money market funds aum').categories, ['Money Market'])
  assert.deepEqual(S('sbi small cap inflow').stock, null)
  assert.deepEqual(S('top 10').thresholds, [])
  assert.deepEqual(S('show 20 funds').limit, 20)
  assert.deepEqual(S('which category saw outflows').sign, 'any')
  assert.equal(S('hdfc mid cap opportunities').stock, null)
})

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/movers-queries.json', 'file://' + process.cwd().replace(/\\/g, '/') + '/tests/'), 'utf-8')) as
  { q: string; state: Record<string, unknown>; notes: string[]; unknown: string[]; advice: boolean; understood: boolean }[]

test(`golden questions (${GOLDEN.length}) parse as reviewed`, () => {
  for (const g of GOLDEN) {
    const r = P(g.q)
    assert.deepEqual(diff(r.state), g.state, g.q)
    assert.deepEqual(r.notes, g.notes, g.q)
    assert.deepEqual(r.unknown, g.unknown, g.q)
    assert.equal(r.advice, g.advice, g.q)
    assert.equal(r.understood, g.understood, g.q)
  }
})

test('every golden answer survives the URL round trip', () => {
  for (const g of GOLDEN) {
    const s = P(g.q).state
    assert.deepEqual(paramsToState(stateToParams(s)), s, g.q)
  }
})
