/**
 * New fund offers (NFOs) in FairFund's categories: src/data/nfo.json, built daily
 * by scripts/build_nfo.py from AMFI's scheme master and NAV file.
 *
 * Every NFO is shown with what already exists: index NFOs with the funds that
 * already track the same index, active NFOs with the size of their category.
 * Facts only; nothing here ranks or recommends an offer.
 */
import nfoJson from '../data/nfo.json'
import type { Fund } from '../types'

export type NfoStatus = 'upcoming' | 'offer' | 'closed' | 'trading'

export interface Nfo {
  code: number
  name: string
  amc: string
  amfiCategory: string
  category: string
  launchDate: string
  closeDate: string | null
  minAmount: number | null
  status: NfoStatus
  nav: { date: string; value: number } | null
  details?: {
    benchmark?: string | null
    manager?: string | null
    exitLoad?: string | null
    minSip?: number | null
    lockInYears?: number | null
    groww?: string | null
  } | null
  detailsAsOf?: string | null
}

export interface NfoData {
  generatedAt: string
  window: { lookbackDays: number; lookaheadDays: number }
  source: string
  nfos: Nfo[]
}

export const nfoData = nfoJson as unknown as NfoData

/** Today's date in India, as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10)
}

/**
 * Status as of `today`, from the dates and AMFI's NAV file. The list is rebuilt
 * on weekdays; recomputing here keeps a Saturday opening from showing as
 * "upcoming" until Monday. "trading" only comes from AMFI listing a NAV.
 */
export function statusOn(n: Pick<Nfo, 'launchDate' | 'closeDate' | 'nav'>, today: string): NfoStatus {
  if (n.nav) return 'trading'
  if (n.launchDate > today) return 'upcoming'
  if (n.closeDate && n.closeDate < today) return 'closed'
  return 'offer'
}

/** "NIFTY 50 Total Return Index", "Nifty 50 TRI" and "Nifty50 Index" are one index. */
export function normalizeBenchmark(s?: string | null): string {
  let t = (s ?? '').toLowerCase()
  t = t.replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ')
  t = t.replace(/\btotal return index\b|\btotal returns index\b|\btri\b|\bindex\b|\bprice return\b/g, ' ')
  t = t.replace(/[^a-z0-9]+/g, ' ')
  t = t.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
  t = t.replace(/\blarge mid ?cap\b/g, 'largemidcap').replace(/\bmid cap\b/g, 'midcap').replace(/\bsmall cap\b/g, 'smallcap')
  return t.replace(/\s+/g, ' ').trim()
}

export const isIndexCategory = (category: string) => category.startsWith('Index')

/** Years between a date (DD-Mon-YYYY or YYYY-MM-DD) and `today`, or null. */
export function yearsSince(d: string | undefined, today: string): number | null {
  if (!d) return null
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : (() => {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(d)
    if (!m) return null
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase())
    return mon < 0 ? null : `${m[3]}-${String(mon + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  })()
  if (!iso) return null
  const ms = Date.parse(today + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')
  return Number.isFinite(ms) && ms >= 0 ? ms / (365.25 * 86_400_000) : null
}

// Exchange and plan words a fund name may leave out without changing the index.
const NAME_OPTIONAL = new Set(['s', 'p', 'and', 'bse', 'nse'])
const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)

/**
 * True when a fund's own name carries every word of its stored benchmark. The
 * stored field has known mislabels (2026-10-22 audit: "ICICI Prudential Nifty
 * 500 Index Fund" stored as NIFTY 50, "SBI Nifty IT" as NIFTY 50), so a match
 * on the field alone could list a fund under an index it does not track.
 */
export function nameAgreesWithBenchmark(name: string, benchmark?: string | null): boolean {
  const want = normalizeBenchmark(benchmark)
  if (!want) return false
  const have = new Set(normalizeBenchmark(name).split(' ').map(stem))
  return want.split(' ').every((w) => NAME_OPTIONAL.has(w) || have.has(stem(w)))
}

/**
 * Index funds FairFund already covers that track the same index as an index NFO,
 * longest record first. Empty when the NFO's benchmark is unknown or new to the
 * site; an NFO's own code is never its peer.
 */
export function sameIndexFunds(n: Nfo, all: Fund[]): Fund[] {
  const want = normalizeBenchmark(n.details?.benchmark)
  if (!want || !isIndexCategory(n.category)) return []
  const start = (f: Fund) => f.inceptionDate ?? '9999'
  return all
    .filter((f) => f.code !== n.code && isIndexCategory(f.category) && normalizeBenchmark(f.benchmark) === want
      && nameAgreesWithBenchmark(f.name, f.benchmark))
    .sort((a, b) => start(a).localeCompare(start(b)) || a.name.localeCompare(b.name))
}

export interface CategoryContext {
  category: string
  display: string
  count: number
  withThreeYears: number
}

/**
 * How many funds the NFO's category already has, and how many have a 3-year
 * record. Only for active NFOs: index buckets such as "Index - Other" mix
 * unrelated indices, so a count there says nothing about the NFO's index.
 */
export function categoryContext(n: Nfo, all: Fund[]): CategoryContext | null {
  if (isIndexCategory(n.category)) return null
  const peers = all.filter((f) => f.category === n.category && f.code !== n.code)
  if (!peers.length) return null
  return {
    category: n.category,
    display: peers[0].categoryDisplay,
    count: peers.length,
    withThreeYears: peers.filter((f) => f.metrics['3Y']?.cagr !== undefined).length,
  }
}

/** NFOs grouped for display as of `today`. */
export function groupNfos(list: Nfo[], today: string): Record<NfoStatus, Nfo[]> {
  const g: Record<NfoStatus, Nfo[]> = { offer: [], upcoming: [], closed: [], trading: [] }
  for (const n of list) g[statusOn(n, today)].push(n)
  g.offer.sort((a, b) => b.launchDate.localeCompare(a.launchDate))
  g.upcoming.sort((a, b) => a.launchDate.localeCompare(b.launchDate))
  g.closed.sort((a, b) => b.launchDate.localeCompare(a.launchDate))
  g.trading.sort((a, b) => b.launchDate.localeCompare(a.launchDate))
  return g
}
