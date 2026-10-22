/**
 * Data behind the Movers page, built by scripts/build_movers.py. Both files are
 * imported lazily so they ship as their own chunks: movers.json when the page opens,
 * movers_stocks.json only when the portfolio view does.
 */
import type { Fund } from '../types'
import { amcAliases, normalizeSearch, otherNames } from './searchText'
import type { ParseContext } from './moversQuery'
import type { Win } from './moversState'

/** [month YYYY-MM, AUM crore, estimated net flow crore | null, NAV return % | null] */
export type MonthRow = [string, number, number | null, number | null]
/** [AUM change, estimated net flow, market effect, flow as % of starting AUM] */
export type WindowRow = [number, number, number, number]
export interface FundMovers {
  m?: MonthRow[]
  w?: Partial<Record<'1' | '3' | '6', WindowRow>>
  t?: { now: number } & Partial<Record<'1' | '3' | '6', number>>
  mj?: [string, string][]
  stale?: boolean
}
export interface MoversData {
  generatedAt: string
  refMonth: string | null
  windows: number[]
  stockWindows: number[]
  funds: Record<string, FundMovers>
  mgrLog: [string, string, string][]
  stocks: [string, string, string][]
}
/** Per fund: [AUM at start, AUM at end, [[stock index, weight before | null, weight after | null], ...], NAV growth | null] */
export type StockFund = [number | null, number | null, [number, number | null, number | null][], number | null]
export interface StocksData {
  refMonth: string | null
  /** px: per stock index, its estimated price move over the window as a ratio (1.05 = up 5%). */
  pairs: Record<string, { from: string | null; funds: Record<string, StockFund>; px?: Record<string, number> }>
}

let moversPromise: Promise<MoversData> | null = null
let stocksPromise: Promise<StocksData> | null = null
export function loadMovers(): Promise<MoversData> {
  moversPromise ??= import('../data/movers.json').then(m => (m.default ?? m) as unknown as MoversData)
  return moversPromise
}
export function loadStocks(): Promise<StocksData> {
  stocksPromise ??= import('../data/movers_stocks.json').then(m => (m.default ?? m) as unknown as StocksData)
  return stocksPromise
}

export function buildContext(funds: Fund[], data: MoversData | null): ParseContext {
  return {
    categories: [...new Set(funds.map(f => f.category))].sort(),
    amcs: [...new Set(funds.map(f => f.amc).filter(Boolean))].sort(),
    fundNames: funds.map(fundSearchText),
    stocks: (data?.stocks ?? []).map(([key, name, sector]) => ({ key, name, sector })),
    refMonth: data?.refMonth ?? null,
    firstMonth: firstFlowMonth(data),
    ...availableWindows(data),
  }
}

/** A window counts once at least this many funds have a figure for it. */
const MIN_FUNDS_PER_WINDOW = 20
/** The windows with enough figures to show, so 6 months appears once six months of history exist. */
export function availableWindows(data: MoversData | null): { flowWindows: Win[]; costWindows: Win[]; stockWindows: Win[] } {
  const flow: Record<string, number> = {}, cost: Record<string, number> = {}
  for (const fm of Object.values(data?.funds ?? {})) {
    for (const k of Object.keys(fm.w ?? {})) flow[k] = (flow[k] ?? 0) + 1
    for (const k of Object.keys(fm.t ?? {})) if (k !== 'now') cost[k] = (cost[k] ?? 0) + 1
  }
  const pick = (counts: Record<string, number>) => {
    const w = ([1, 3, 6] as Win[]).filter(k => (counts[String(k)] ?? 0) >= MIN_FUNDS_PER_WINDOW)
    return w.length ? w : ([1] as Win[])
  }
  const sw = (data?.stockWindows ?? [1, 3]).filter((k): k is Win => k === 1 || k === 3)
  return { flowWindows: pick(flow), costWindows: pick(cost), stockWindows: sw.length ? sw : [1] }
}

const searchCache = new WeakMap<Fund, string>()
/** A fund's name, former names and AMC abbreviations, normalised; what the "names" filter matches. */
export function fundSearchText(f: Fund): string {
  let t = searchCache.get(f)
  if (t == null) {
    const own = normalizeSearch(f.name)
    t = [own, ...otherNames(f.code).map(normalizeSearch), amcAliases(own)].filter(Boolean).join(' ')
    searchCache.set(f, t)
  }
  return t
}

function firstFlowMonth(data: MoversData | null): string | null {
  let first: string | null = null
  for (const fm of Object.values(data?.funds ?? {})) for (const r of fm.m ?? []) if (r[2] != null && (first == null || r[0] < first)) first = r[0]
  return first
}

export function monthLabel(ym: string | null | undefined): string {
  if (!ym) return ''
  const d = new Date(ym.slice(0, 7) + '-01T00:00:00')
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}
export function addMonths(ym: string, k: number): string {
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const t = y * 12 + (m - 1) + k
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
