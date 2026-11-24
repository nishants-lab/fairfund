/**
 * The monthly holdings report, built by scripts/build_holdings_report.py: what Indian
 * mutual funds bought and sold, estimated from their monthly portfolio disclosures.
 * The full file loads lazily with the report page; holdings_summary.json is the small
 * part the home page shows.
 */
import { withChunkReload } from './staleChunk'
import { displayStockName, stockSlug } from './stockNames'
import { MONTHS } from './dates'

export interface StockRow {
  key: string
  name: string
  sector: string
  /** Estimated net buying, crore (negative = net selling). */
  net: number
  active: number
  index: number
  /** Value held at the start, at end-of-month prices, crore. */
  held: number
  /** Active funds that raised / cut the position beyond its price move. */
  added: number
  cut: number
  /** Active funds that opened / closed the position. */
  new: number
  exited: number
  buyers: [string, number][]
  sellers: [string, number][]
  addedPct?: number
  overseas?: boolean
  /** Slug of the stock's research page, when it has one. */
  page?: string
}
export interface Totals {
  net: number
  active: number
  index: number
  inflow: number
  cashUsed: number
  funds: number
  houses: number
  fallbackValue: number
  overseasNet: number
}
/** [stock key, net crore, funds adding (buys) or cutting (sells)] */
export type GroupStock = [string, number, number]
export interface Group {
  name: string
  funds: number
  net: number
  inflow: number
  buys: GroupStock[]
  sells: GroupStock[]
}
export type ListKey = 'buys' | 'sells' | 'widest' | 'widestCut' | 'conviction' | 'newEntries' | 'exits' | 'overseasBuys' | 'overseasSells'
export interface MonthReport {
  month: string
  from: string
  coverage: { funds: number; of: number; complete: boolean }
  totals: Totals
  stocks: Record<string, StockRow>
  lists: Record<ListKey, string[]>
  sectors: [string, number][]
  categories: Group[]
  houses: Group[]
  /** Names for stocks that appear only in category / fund-house lists: [name, sector, page slug?] */
  refs: Record<string, [string, string, string?]>
}
export interface TrendPoint {
  month: string
  net: number
  active: number
  index: number
  inflow: number
  cashUsed: number
  funds: number
  complete: boolean
}
export interface HoldingsReport {
  generatedAt: string
  lead: string | null
  trend: TrendPoint[]
  months: Record<string, MonthReport>
  /** code -> [name, fund house, category] for funds named in the lists */
  funds: Record<string, [string, string, string]>
}

let reportPromise: Promise<HoldingsReport> | null = null
export function loadHoldingsReport(): Promise<HoldingsReport> {
  reportPromise ??= withChunkReload(() => import('../data/holdings_report.json'))()
    .then(m => (m.default ?? m) as unknown as HoldingsReport, e => { reportPromise = null; throw e })
  return reportPromise
}

/** "2026-10" -> "October 2026" (long) or "Oct 2026". */
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function monthLabel(ym: string, long = true): string {
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  return `${long ? LONG[m - 1] : MONTHS[m - 1]} ${y}`
}
export const monthName = (ym: string) => LONG[Number(ym.split('-')[1]) - 1] ?? ym

/** Crore with Indian grouping: 35680.2 -> "₹35,680 cr"; signed adds + / − (true minus). */
export function crore(n: number, signed = false): string {
  const v = Math.round(Math.abs(n)).toLocaleString('en-IN')
  const sign = signed ? (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') : (n < 0 ? '−' : '')
  return `${sign}₹${v} cr`
}
/** Compact crore for tight rows: 35680 -> "₹35.7K cr", 950 -> "₹950 cr". */
export function croreShort(n: number, signed = false): string {
  const a = Math.abs(n)
  const sign = signed ? (n > 0.5 ? '+' : n < -0.5 ? '−' : '') : (n < 0 ? '−' : '')
  const body = a >= 100000 ? `${(a / 100000).toFixed(2)}L` : a >= 10000 ? `${(a / 1000).toFixed(1)}K` : Math.round(a).toLocaleString('en-IN')
  return `${sign}₹${body} cr`
}

export function stockName(m: MonthReport, key: string): string {
  const s = m.stocks[key]
  return displayStockName(key, s?.name ?? m.refs[key]?.[0] ?? key)
}
export function stockPage(m: MonthReport, key: string): string | null {
  const slug = m.stocks[key]?.page ?? m.refs[key]?.[2]
  return slug && slug === stockSlug(key) ? slug : slug ?? null
}

/** How far the estimate is from new money + cash moved into shares, as a share of the estimate. */
export function checkGap(t: Pick<Totals, 'net' | 'inflow' | 'cashUsed'>): number | null {
  if (!t.net) return null
  return Math.abs(t.net - (t.inflow + t.cashUsed)) / Math.abs(t.net)
}
