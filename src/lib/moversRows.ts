/**
 * Turns a MoversState into the rows the Movers page shows. Pure: funds, the movers
 * data and the state in, rows out, so the table, the question box and the tests all
 * see the same numbers.
 */
import type { Fund } from '../types'
import { addMonths, fundSearchText, monthLabel, type MoversData, type StocksData } from './moversData'
import { nameMatches } from './moversQuery'
import { THEMES } from './moversVocab'
import type { FilterField, Measure, MoversState, Threshold } from './moversState'

export interface FundVals {
  aum: number | null
  startAum: number | null
  aumChange: number | null
  aumChangePct: number | null
  flow: number | null
  flowPct: number | null
  market: number | null
  cagr: number | null
  vsCategory: number | null
  sharpe: number | null
  sortino: number | null
  volatility: number | null
  drawdown: number | null
  alpha: number | null
  score: number | null
  catRank: number | null
  catSize: number | null
  rankNow: number | null
  rankPrior: number | null
  rankMove: number | null
  peersNow: number | null
  peersPrior: number | null
  cagr1Y: number | null
  cagrLong: number | null
  momentum: number | null
  ter: number | null
  terChange: number | null
  age: number | null
  joined: number | null
  left: number | null
  /** Joins plus departures. */
  mgrChanges: number | null
}

export interface FundRow {
  fund: Fund
  value: number
  vals: FundVals
  /** Month-end AUM, oldest first, for the sparkline. */
  aumSeries: number[]
  /** Monthly estimated net flow, oldest first (null where not estimated). */
  flowSeries: (number | null)[]
  joinedList: [string, string][]
  leftList: [string, string][]
  stale: boolean
  /** A fund asked for by name that has no figure here; listed last, left out of totals. */
  missing: boolean
}

export interface GroupRow {
  key: string
  label: string
  n: number
  value: number
  pos: number
  neg: number
  totalAum: number | null
  /** Funds in the group, already sorted. */
  members: FundRow[]
}

/** `up`/`down`: the weight moved but no price estimate exists, so whether the fund traded is not known. */
export type StockAction = 'added' | 'raised' | 'cut' | 'exited' | 'held' | 'up' | 'down'
export interface StockFundMove {
  fund: Fund
  action: StockAction
  before: number | null
  after: number | null
  /** Change in the position beyond the stock's own price move, %, when it can be estimated. */
  active: number | null
  valueChange: number | null
}
export interface StockRow {
  key: string
  name: string
  sector: string
  buyers: number
  sellers: number
  added: number
  exited: number
  netBuyers: number
  valueChange: number
  /** Estimated price move over the window, %, from the funds that held it at both ends. */
  priceMove: number | null
  value: number
  /** The funds behind the row, already sorted; for a named stock, only those doing what was asked. */
  moves: StockFundMove[]
  /** Funds that changed the stock, whatever they did. */
  movers: number
}
export interface SectorRow {
  key: string
  label: string
  stocks: number
  buyers: number
  sellers: number
  netBuyers: number
  added: number
  exited: number
  valueChange: number
  value: number
}

/** Measures whose group figure is a sum; the rest are averaged. */
export const SUM_MEASURES = new Set<Measure>(['flow', 'aum', 'aumChange', 'mgrChanges', 'joined', 'left'])
/** A position change smaller than this, beyond the price move, is read as no trade. */
export const TRADE_TOLERANCE = 0.05

export function isIndexFund(f: Fund): boolean {
  return f.category.startsWith('Index')
}

export function fundThemes(f: Fund): string[] {
  return Object.keys(THEMES).filter(k => THEMES[k].re.test(f.name))
}

/** Every filter that is about which funds count, whatever the view. */
export function passesFundFilters(f: Fund, s: MoversState): boolean {
  if (s.view === 'debt' && !(f.isDebt || f.isArbitrage)) return false
  if (s.categories.length && !s.categories.includes(f.category)) return false
  if (s.notCategories.includes(f.category)) return false
  if (s.amcs.length && !s.amcs.includes(f.amc)) return false
  if (s.notAmcs.includes(f.amc)) return false
  if (s.themes.length && !s.themes.some(t => THEMES[t]?.re.test(f.name))) return false
  if (s.notThemes.some(t => THEMES[t]?.re.test(f.name))) return false
  if (s.type === 'index' && !isIndexFund(f)) return false
  if (s.type === 'active' && isIndexFund(f)) return false
  if (s.young === 'only' && !f.isYoung) return false
  if (s.young === 'exclude' && f.isYoung) return false
  if (s.risk.length && !s.risk.includes(f.riskLevel)) return false
  if (s.names.length && !nameMatches(fundSearchText(f), s.names)) return false
  return true
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round = (v: number | null, d = 2): number | null => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d)

function yearsBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso.slice(0, 10)), b = Date.parse(toIso.slice(0, 10))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return (b - a) / (365.25 * 86400000)
}

/** ISO date `win` calendar months before `iso`. */
function monthsBefore(iso: string, win: number): string {
  return addMonths(iso.slice(0, 7), -win) + iso.slice(7, 10)
}

export function fundVals(f: Fund, data: MoversData, s: MoversState): FundVals {
  const fm = data.funds[String(f.code)] ?? {}
  const m = fm.m ?? []
  const ref = data.refMonth
  let aum: number | null = null, startAum: number | null = null, aumChange: number | null = null
  let flow: number | null = null, market: number | null = null
  if (s.month && (s.view === 'flows' || s.view === 'size')) {
    const row = m.find(r => r[0] === s.month)
    const prev = m.find(r => r[0] === addMonths(s.month!, -1))
    if (row) {
      aum = row[1]
      flow = row[2]
      if (prev) { startAum = prev[1]; aumChange = row[1] - prev[1] }
      if (aumChange != null && flow != null) market = aumChange - flow
    }
  } else {
    const end = m.find(r => r[0] === ref)
    aum = end ? end[1] : num(f.aum?.current)
    const w = s.win === 12 ? undefined : fm.w?.[String(s.win) as '1' | '3' | '6']
    if (w && end) {
      aumChange = w[0]; flow = w[1]; market = w[2]
      startAum = end[1] - w[0]
    }
  }
  const pctOf = (v: number | null) => (v != null && startAum != null && startAum > 0 ? (v / startAum) * 100 : null)
  const mt = f.metrics?.[s.horizon]
  const cagr = num(mt?.cagr)
  const med = num(mt?.catMedianCagr)
  const rt = f.analytics?.rankTrajectory
  const rankNow = num(rt?.currentRank) ?? num(mt?.catRank)
  const rankPrior = rt ? num(rt.priorRank) : null
  const cagr1Y = num(f.metrics?.['1Y']?.cagr)
  const longH = s.horizon === '5Y' ? '5Y' : '3Y'
  const cagrLong = num(f.metrics?.[longH]?.cagr)
  const expense = typeof f.expenseRatio === 'number' ? f.expenseRatio : typeof f.expenseRatio === 'string' ? parseFloat(f.expenseRatio) : NaN
  const ter = Number.isFinite(expense) ? expense : num(fm.t?.now)
  const terChange = s.win === 12 ? null : num(fm.t?.[String(s.win) as '1' | '3' | '6'])
  const asOf = data.generatedAt || new Date().toISOString().slice(0, 10)
  const age = f.inceptionDate ? yearsBetween(f.inceptionDate, asOf) : null
  const joinedList = managerJoins(fm.mj ?? [], s, asOf)
  const leftList = managerExits(data, f.code, s, asOf)
  const dd = num(mt?.maxDrawdown)
  return {
    aum, startAum, aumChange, aumChangePct: round(pctOf(aumChange)), flow, flowPct: round(pctOf(flow)), market: round(market, 1),
    cagr, vsCategory: cagr != null && med != null ? round(cagr - med) : null,
    sharpe: num(mt?.sharpe), sortino: num(mt?.sortino), volatility: num(mt?.volatility),
    drawdown: dd == null ? null : Math.abs(dd), alpha: num(mt?.alpha),
    score: num(mt?.score) == null ? null : Math.round((mt!.score as number) * 1000) / 10,
    catRank: num(mt?.catRank), catSize: num(mt?.catSize),
    rankNow, rankPrior, rankMove: rankNow != null && rankPrior != null && rt ? rankPrior - rankNow : null,
    peersNow: rt ? num(rt.currentPeers) : num(mt?.catSize), peersPrior: rt ? num(rt.priorPeers) : null,
    cagr1Y, cagrLong, momentum: cagr1Y != null && cagrLong != null ? round(cagr1Y - cagrLong) : null,
    ter, terChange, age: round(age), joined: joinedList.length, left: leftList.length, mgrChanges: joinedList.length + leftList.length,
  }
}

function managerJoins(mj: [string, string][], s: MoversState, asOf: string): [string, string][] {
  if (s.month) return mj.filter(([, since]) => since.startsWith(s.month!))
  const cutoff = monthsBefore(asOf, s.win)
  return mj.filter(([, since]) => since >= cutoff && since <= asOf)
}
function managerExits(data: MoversData, code: number, s: MoversState, asOf: string): [string, string][] {
  const mine = data.mgrLog.filter(e => e[0] === String(code)).map(e => [e[1], e[2]] as [string, string])
  if (s.month) return mine.filter(([, d]) => d.startsWith(s.month!))
  const cutoff = monthsBefore(asOf, s.win)
  return mine.filter(([, d]) => d >= cutoff)
}

/** The figure a threshold compares. */
export function fieldValue(v: FundVals, field: FilterField, pct?: boolean): number | null {
  if (field === 'flow') return pct ? v.flowPct : v.flow
  if (field === 'aumChange') return pct ? v.aumChangePct : v.aumChange
  if (field === 'aum') return pct ? v.aumChangePct : v.aum
  return v[field]
}

export function passesThreshold(v: FundVals, t: Threshold): boolean {
  const x = fieldValue(v, t.field, t.pct)
  if (x == null) return false
  if (t.op === 'between') return x >= t.a && x <= (t.b ?? t.a)
  // "top 5 in their category" includes the fifth
  if (t.op === 'lt') return t.inc || t.field === 'rankNow' ? x <= t.a : x < t.a
  return t.inc ? x >= t.a : x > t.a
}

/** The number a row sorts by, in the state's ₹ or % terms. */
export function measureValue(v: FundVals, measure: Measure, mode: MoversState['mode']): number | null {
  switch (measure) {
    case 'flow': return mode === 'pct' ? v.flowPct : v.flow
    case 'aumChange': return mode === 'pct' ? v.aumChangePct : v.aumChange
    case 'aum': return v.aum
    case 'netBuyers': case 'added': case 'exited': case 'valueChange': return null
    default: return v[measure]
  }
}

export function fundRows(funds: Fund[], data: MoversData, s: MoversState): FundRow[] {
  const out: FundRow[] = []
  for (const f of funds) {
    if (!passesFundFilters(f, s)) continue
    const vals = fundVals(f, data, s)
    const raw = s.view === 'debt' ? (vals.aum ?? vals.ter) : measureValue(vals, s.measure, s.mode)
    // "kotak mid cap" should show that fund even where it lacks this window's figure
    const keepMissing = s.names.length > 0 && !s.thresholds.length && s.sign === 'any' && s.view !== 'managers'
    if (raw == null && !keepMissing) continue
    const value = raw ?? 0
    if (s.view === 'managers' && !(value > 0)) continue
    if (!s.thresholds.every(t => passesThreshold(vals, t))) continue
    if (s.sign === 'pos' && !(value > 0)) continue
    if (s.sign === 'neg' && !(value < 0)) continue
    const fm = data.funds[String(f.code)] ?? {}
    const m = fm.m ?? []
    out.push({
      fund: f, value, vals,
      aumSeries: m.map(r => r[1]),
      flowSeries: m.map(r => r[2]),
      joinedList: managerJoins(fm.mj ?? [], s, data.generatedAt),
      leftList: managerExits(data, f.code, s, data.generatedAt),
      stale: !!fm.stale,
      missing: raw == null,
    })
  }
  const dir = s.order === 'asc' ? 1 : -1
  out.sort((a, b) => Number(a.missing) - Number(b.missing) || (a.value - b.value) * dir || (b.vals.aum ?? 0) - (a.vals.aum ?? 0) || a.fund.name.localeCompare(b.fund.name))
  return out
}

function groupKeys(f: Fund, by: MoversState['groupBy']): [string, string][] {
  if (by === 'category') return [[f.category, f.categoryDisplay || f.category]]
  if (by === 'amc') return f.amc ? [[f.amc, f.amc]] : []
  if (by === 'type') return isIndexFund(f) ? [['index', 'Index funds']] : [['active', 'Active funds']]
  if (by === 'theme') return fundThemes(f).map(k => [k, THEMES[k].label])
  return []
}

/** Category, fund house, index vs active or theme figures. Flows, sizes and counts add up and the rest are
 * averaged, unless the question asked for an average or a total. */
export function groupRows(rows: FundRow[], s: MoversState): GroupRow[] {
  const map = new Map<string, GroupRow>()
  for (const r of rows) {
    if (r.missing) continue
    for (const [key, label] of groupKeys(r.fund, s.groupBy)) {
      let g = map.get(key)
      if (!g) { g = { key, label, n: 0, value: 0, pos: 0, neg: 0, totalAum: null, members: [] }; map.set(key, g) }
      g.members.push(r)
    }
  }
  const sum = groupSums(s)
  for (const g of map.values()) {
    g.n = g.members.length
    g.pos = g.members.filter(r => r.value > 0).length
    g.neg = g.members.filter(r => r.value < 0).length
    const aums = g.members.map(r => r.vals.aum).filter((x): x is number => x != null)
    g.totalAum = aums.length ? aums.reduce((a, b) => a + b, 0) : null
    if (s.count) g.value = g.n
    else if (s.mode === 'pct' && (s.measure === 'flow' || s.measure === 'aumChange') && s.agg !== 'average') {
      const k = s.measure === 'flow' ? 'flow' : 'aumChange'
      const both = g.members.filter(r => r.vals[k] != null && r.vals.startAum != null && r.vals.startAum > 0)
      const base = both.reduce((a, r) => a + (r.vals.startAum as number), 0)
      g.value = base > 0 ? Math.round((both.reduce((a, r) => a + (r.vals[k] as number), 0) / base) * 10000) / 100 : 0
    } else {
      const total = g.members.reduce((a, r) => a + r.value, 0)
      g.value = sum ? Math.round(total * 10) / 10 : Math.round((total / g.n) * 100) / 100
    }
  }
  const dir = s.order === 'asc' ? 1 : -1
  return [...map.values()].sort((a, b) => (a.value - b.value) * dir || b.n - a.n || a.label.localeCompare(b.label))
}

/** Whether a group's figure is its members' sum (else their average, or for % flows the combined ratio). */
export function groupSums(s: MoversState): boolean {
  if (s.agg === 'average') return false
  return SUM_MEASURES.has(s.measure) && !(s.mode === 'pct' && (s.measure === 'flow' || s.measure === 'aumChange'))
}
/** The heading over a group's figure. */
export function groupValueLabel(s: MoversState): string {
  if (s.count) return 'Funds'
  const pct = s.mode === 'pct' && (s.measure === 'flow' || s.measure === 'aumChange')
  const kind = s.agg === 'average' ? 'Average' : groupSums(s) ? 'Total' : pct ? 'Combined' : 'Average'
  return `${kind} ${MEASURE_LABEL[s.measure].toLowerCase()}${pct ? ' (% of AUM)' : ''}`
}

export interface Summary { count: number; total: number | null; average: number | null; summable: boolean }
export function summarize(all: { value: number; missing?: boolean }[], s: MoversState): Summary {
  const rows = all.filter(r => !r.missing)
  const n = rows.length
  const total = rows.reduce((a, r) => a + r.value, 0)
  return {
    count: n,
    total: n ? Math.round(total * 10) / 10 : null,
    average: n ? Math.round((total / n) * 100) / 100 : null,
    summable: SUM_MEASURES.has(s.measure) && s.mode === 'abs',
  }
}

// ---- portfolio moves -------------------------------------------------------------
/** "Kanohar Electricals Ltd Equity" -> "Kanohar Electricals Ltd": some disclosures tag the share class. */
export function cleanStockName(name: string): string {
  return name.replace(/\s+(equity|eq|equity shares)\.?$/i, '').trim() || name
}
export function stockWindow(s: MoversState): '1' | '3' {
  return s.win >= 3 ? '3' : '1'
}

const ACTION_OF: Record<Exclude<MoversState['action'], 'any'>, StockAction[]> = {
  buy: ['added', 'raised'], sell: ['cut', 'exited'], added: ['added'], exited: ['exited'],
}

/** Buyers and sellers per stock across the funds that pass the filters, number limits included. */
export function stockRows(funds: Fund[], data: MoversData, sd: StocksData, s: MoversState): StockRow[] {
  const pair = sd.pairs[stockWindow(s)]
  if (!pair) return []
  const byCode = new Map(funds.map(f => [String(f.code), f]))
  const acc = new Map<number, StockRow>()
  for (const [code, rec] of Object.entries(pair.funds)) {
    const f = byCode.get(code)
    if (!f || !passesFundFilters(f, s)) continue
    if (s.thresholds.length) {
      const vals = fundVals(f, data, s)
      if (!s.thresholds.every(t => passesThreshold(vals, t))) continue
    }
    const [a0, a1, rows, growth] = rec
    for (const [idx, before, after] of rows) {
      const st = data.stocks[idx]
      if (!st) continue
      if (s.stockSectors.length && !s.stockSectors.includes(st[2])) continue
      const px = pair.px?.[String(idx)] ?? null
      let action: StockAction
      let active: number | null = null
      if (before == null) action = 'added'
      else if (after == null) action = 'exited'
      else if (px && growth) {
        const r = (after / before) * growth / px
        active = Math.round((r - 1) * 1000) / 10
        action = r >= 1 + TRADE_TOLERANCE ? 'raised' : r <= 1 - TRADE_TOLERANCE ? 'cut' : 'held'
      } else action = after > before ? 'up' : 'down'
      const valueChange = a0 != null && a1 != null ? ((after ?? 0) * a1 - (before ?? 0) * a0) / 100 : null
      let row = acc.get(idx)
      if (!row) {
        row = { key: st[0], name: cleanStockName(st[1]), sector: st[2] || 'Unspecified', buyers: 0, sellers: 0, added: 0, exited: 0, netBuyers: 0,
          valueChange: 0, priceMove: px ? Math.round((px - 1) * 1000) / 10 : null, value: 0, moves: [], movers: 0 }
        acc.set(idx, row)
      }
      if (action === 'added' || action === 'raised') row.buyers++
      if (action === 'cut' || action === 'exited') row.sellers++
      if (action === 'added') row.added++
      if (action === 'exited') row.exited++
      if (valueChange != null) row.valueChange += valueChange
      row.moves.push({ fund: f, action, before, after, active, valueChange: valueChange == null ? null : Math.round(valueChange * 10) / 10 })
    }
  }
  const order: Record<StockAction, number> = { added: 0, raised: 1, up: 2, held: 3, down: 4, cut: 5, exited: 6 }
  const out: StockRow[] = []
  for (const r of acc.values()) {
    r.netBuyers = r.buyers - r.sellers
    r.valueChange = Math.round(r.valueChange * 10) / 10
    r.value = s.measure === 'added' ? r.added : s.measure === 'exited' ? r.exited : s.measure === 'valueChange' ? r.valueChange : r.netBuyers
    if (s.stock && r.key !== s.stock) continue
    r.movers = r.moves.length
    // "who bought hdfc bank": the stock's totals stay whole, its fund list is the buyers
    if (s.stock && s.action !== 'any') r.moves = r.moves.filter(m => ACTION_OF[s.action as keyof typeof ACTION_OF].includes(m.action))
    if (!s.stock) {
      if ((s.measure === 'added' || s.measure === 'exited') && r.value <= 0) continue
      if (s.action === 'buy' && r.netBuyers <= 0) continue
      if (s.action === 'sell' && r.netBuyers >= 0) continue
      if (s.measure === 'netBuyers' && s.action === 'any' && r.buyers + r.sellers === 0) continue
    }
    r.moves.sort((a, b) => order[a.action] - order[b.action] || Math.abs(b.valueChange ?? 0) - Math.abs(a.valueChange ?? 0))
    out.push(r)
  }
  const dir = s.order === 'asc' ? 1 : -1
  out.sort((a, b) => (a.value - b.value) * dir || (b.buyers + b.sellers) - (a.buyers + a.sellers) || a.name.localeCompare(b.name))
  return out
}

/** Stock moves summed by sector. */
export function sectorRows(stocks: StockRow[], s: MoversState): SectorRow[] {
  const map = new Map<string, SectorRow>()
  for (const r of stocks) {
    let g = map.get(r.sector)
    if (!g) { g = { key: r.sector, label: r.sector, stocks: 0, buyers: 0, sellers: 0, netBuyers: 0, added: 0, exited: 0, valueChange: 0, value: 0 }; map.set(r.sector, g) }
    g.stocks++; g.buyers += r.buyers; g.sellers += r.sellers; g.added += r.added; g.exited += r.exited; g.valueChange += r.valueChange
  }
  for (const g of map.values()) {
    g.netBuyers = g.buyers - g.sellers
    g.valueChange = Math.round(g.valueChange * 10) / 10
    g.value = s.measure === 'added' ? g.added : s.measure === 'exited' ? g.exited : s.measure === 'valueChange' ? g.valueChange : g.netBuyers
  }
  const dir = s.order === 'asc' ? 1 : -1
  return [...map.values()].sort((a, b) => (a.value - b.value) * dir || a.label.localeCompare(b.label))
}

// ---- words for what is on screen ---------------------------------------------------
export const MEASURE_LABEL: Record<Measure, string> = {
  flow: 'Estimated net flow', aum: 'AUM', aumChange: 'AUM change',
  cagr: 'Return (CAGR)', vsCategory: 'Return vs category median', sharpe: 'Sharpe ratio', sortino: 'Sortino ratio',
  volatility: 'Volatility', drawdown: 'Max drawdown', alpha: 'Alpha', score: 'FairFund score',
  rankMove: 'Rank change', rankNow: 'Category rank', momentum: '1Y vs long-term return',
  ter: 'Expense ratio', terChange: 'Expense ratio change', mgrChanges: 'Manager changes', joined: 'Managers who joined', left: 'Managers who left',
  netBuyers: 'Net buyers', added: 'Funds that added it', exited: 'Funds that exited it', valueChange: 'Change in value held',
}
const FIELD_LABEL: Record<FilterField, string> = {
  aum: 'AUM', flow: 'Estimated net flow', aumChange: 'AUM change', cagr: 'Return', vsCategory: 'Return vs category median',
  sharpe: 'Sharpe', volatility: 'Volatility', drawdown: 'Max drawdown', alpha: 'Alpha', score: 'FairFund score',
  ter: 'Expense ratio', terChange: 'Expense ratio change', rankNow: 'Category rank', rankMove: 'Rank change', age: 'Fund age',
  momentum: '1Y vs long-term return', sortino: 'Sortino',
}

export function fmtCrore(cr: number, signed = false): string {
  const a = Math.abs(cr)
  const sign = signed ? (cr > 0 ? '+' : cr < 0 ? '-' : '') : cr < 0 ? '-' : ''
  if (a >= 100000) return `${sign}₹${(a / 100000).toFixed(2)}L Cr`
  if (a >= 1000) return `${sign}₹${(a / 1000).toFixed(1)}K Cr`
  if (a >= 10) return `${sign}₹${a.toFixed(0)} Cr`
  return `${sign}₹${a.toFixed(1)} Cr`
}
const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '-' : ''}${Math.abs(v).toFixed(d)}`

/** A measure's value as text, for cells, chips and answers. */
export function fmtMeasure(measure: Measure | FilterField, v: number, mode: MoversState['mode'] = 'abs'): string {
  switch (measure) {
    case 'flow': case 'aumChange': return mode === 'pct' ? `${signed(v, 2)}%` : fmtCrore(v, true)
    case 'aum': return fmtCrore(v)
    case 'valueChange': return fmtCrore(v, true)
    case 'cagr': return `${v.toFixed(1)}%`
    case 'vsCategory': case 'momentum': return `${signed(v)} pts`
    case 'volatility': case 'drawdown': return `${v.toFixed(1)}%`
    case 'alpha': return `${signed(v)}%`
    case 'sharpe': case 'sortino': return v.toFixed(2)
    case 'score': return `${v.toFixed(0)}/100`
    case 'ter': return `${v.toFixed(2)}%`
    case 'terChange': return `${signed(v, 2)} pts`
    case 'rankNow': return `#${v}`
    case 'rankMove': return v === 0 ? '0' : `${v > 0 ? '▲' : '▼'} ${Math.abs(v)}`
    case 'age': return `${v.toFixed(1)} yrs`
    case 'netBuyers': return `${v > 0 ? '+' : ''}${v}`
    default: return String(v)
  }
}

function fmtThresholdValue(t: Threshold, v: number): string {
  if ((t.field === 'flow' || t.field === 'aumChange' || t.field === 'aum') && t.pct) return `${v}%`
  if (t.field === 'flow' || t.field === 'aumChange' || t.field === 'aum') return fmtCrore(v)
  if (t.field === 'terChange') return `${Math.round(v * 100)} bps`
  if (['cagr', 'vsCategory', 'volatility', 'drawdown', 'alpha', 'ter', 'momentum'].includes(t.field)) return `${v}%`
  if (t.field === 'age') return `${v} ${v === 1 ? 'year' : 'years'}`
  return String(v)
}

export function thresholdLabel(t: Threshold): string {
  if (t.field === 'age') {
    if (t.op === 'between') return `Fund age ${fmtThresholdValue(t, t.a)} to ${fmtThresholdValue(t, t.b ?? t.a)}`
    return t.op === 'gt' ? `Older than ${fmtThresholdValue(t, t.a)}` : `Younger than ${fmtThresholdValue(t, t.a)}`
  }
  if (t.field === 'rankNow' && t.op === 'lt') return `Category rank ${t.a} or better`
  if (t.field === 'rankMove' && t.op !== 'between') {
    if (t.op === 'gt' && t.a >= 0) return t.a === 0 ? 'Climbed in rank' : `Climbed ${t.inc ? 'at least' : 'more than'} ${t.a} places`
    if (t.op === 'lt' && t.a <= 0) return t.a === 0 ? 'Fell in rank' : `Fell ${t.inc ? 'at least' : 'more than'} ${-t.a} places`
  }
  const label = FIELD_LABEL[t.field] + (t.pct && t.field === 'aum' ? ' change' : '')
  if (t.op === 'between') return `${label} ${fmtThresholdValue(t, t.a)} to ${fmtThresholdValue(t, t.b ?? t.a)}`
  if (t.a === 0 && t.op === 'gt') return t.inc ? `${label} zero or more` : `${label} positive`
  if (t.a === 0 && t.op === 'lt') return t.inc ? `${label} zero or less` : `${label} negative`
  return `${label} ${t.op === 'gt' ? (t.inc ? 'at least' : 'above') : (t.inc ? 'at most' : 'below')} ${fmtThresholdValue(t, t.a)}`
}

/** "Sep 2026", "Jul to Sep 2026": the months a window covers, ending at the reference month. */
export function windowLabel(refMonth: string | null, win: number, month?: string | null): string {
  if (month) return monthLabel(month)
  if (!refMonth) return `${win}M`
  if (win === 1) return monthLabel(refMonth)
  const first = addMonths(refMonth, -(win - 1))
  const [a, b] = [monthLabel(first), monthLabel(refMonth)]
  return a.slice(-4) === b.slice(-4) ? `${a.slice(0, -5)} to ${b}` : `${a} to ${b}`
}
