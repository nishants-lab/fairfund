/** Shared selection rules for the holdings-based research pages.
 *
 * gen-unfurls.mjs renders the pages, gen-sitemap.mjs and gen-home.mjs list them.
 * All three call this module with the same inputs, so the sitemap can check
 * that every expected page exists instead of trusting a list the renderer wrote.
 *
 * Inputs are src/data/funds.json and dist/fund-data/<code>.json (copied from
 * public/ by vite build). Without fund-data files no holdings pages are made.
 *
 * Overlap mirrors src/lib/overlap.ts (pairOverlapPct): the sum, over shared
 * securities, of the smaller of the two portfolio weights.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** Actively managed equity categories that get fund-vs-fund overlap pages. */
export const OVERLAP_CATEGORIES = ['Large Cap', 'Mid Cap', 'Small Cap', 'Flexi Cap', 'Multi Cap', 'Large & Mid Cap', 'Focused', 'Value/Contra', 'ELSS', 'Dividend Yield']
/** Largest funds per category (by AUM) that are paired with each other. */
export const PAIR_TOP_N = 8
/** A stock gets its own page once at least this many covered funds hold it. */
export const STOCK_MIN_HOLDERS = 20
/** Hedged or cash-like books: their stock lists are not comparable portfolios. */
const EXCLUDED_CATEGORIES = new Set(['Arbitrage', 'Liquid', 'Money Market'])

/** Fund statuses that mean the scheme no longer takes part ('renamed' funds are live). */
const INACTIVE_STATUSES = new Set(['merged', 'closed', 'wound-up', 'inactive'])
export const isLiveFund = f => !INACTIVE_STATUSES.has(f.status)

export const isIndexCategory = cat => /^Index/.test(cat || '')
/** Passive funds: index categories, plus index funds and ETF feeders filed under
 * another category (an ELSS fund that tracks the Nifty 50, for example). */
export const isIndexFund = f => isIndexCategory(f?.category) || /\bindex fund\b|\betf\b/i.test(f?.name || '')

/** Every row is an object with a finite weight. A record that fails this is
 * treated as having no usable portfolio rather than half-rendered. */
export const validHoldings = holdings => Array.isArray(holdings)
  && holdings.every(h => h && typeof h === 'object' && typeof h.pct === 'number' && Number.isFinite(h.pct))

/** Same rule as hasUsableHoldings in src/lib/overlap.ts, plus the row check above. */
export function hasUsableHoldings(detail) {
  const holdings = detail?.holdings
  const cov = detail?.holdingsMeta?.coverage
  if (!validHoldings(holdings) || holdings.length === 0) return false
  if (['feeder_unresolved', 'unresolved', 'no_disclosure', 'fof_level'].includes(cov)) return false
  if (holdings.length === 1 && holdings[0].pct >= 80) return false
  return true
}

const normKey = h => String(h.key || h.name || '').trim().toLowerCase()

/** Per-security weights as overlap.ts reads them: `sum` adds repeated lines
 * (how it reads fund A), `first` keeps the first line (how it reads fund B). */
export function weightMap(holdings) {
  const sum = new Map(), first = new Map()
  for (const h of holdings) {
    const k = normKey(h)
    sum.set(k, (sum.get(k) || 0) + h.pct)
    if (!first.has(k)) first.set(k, h.pct)
  }
  return { sum, first }
}

/** pairOverlapPct(a, b) from src/lib/overlap.ts, on weightMap() outputs. */
export function overlapPct(a, b) {
  let total = 0
  for (const [k, w] of b.first) {
    const wa = a.sum.get(k)
    if (wa !== undefined) total += Math.min(wa, w)
  }
  return total
}

export const hasMonthOnMonth = holdings => holdings.some(h => typeof h.change === 'number' && Number.isFinite(h.change))

export function stockSlug(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

/** Companies renamed after the name used in the source disclosures. Verified
 * renames only, keyed by stock slug; the page URL keeps the source slug. */
export const STOCK_RENAMES = {
  // Ministry of Corporate Affairs approved Zomato Ltd -> Eternal Ltd on 20 Mar 2025.
  'zomato-ltd': { name: 'Eternal Ltd', formerly: 'Zomato Ltd' },
  // Renamed in Dec 2022 after the Shriram City Union merger; same ISIN INE721A01013.
  'shriram-transport-finance-company-ltd': { name: 'Shriram Finance Ltd', formerly: 'Shriram Transport Finance Company Ltd' },
}
export function currentStock(h) {
  const r = h?.key ? STOCK_RENAMES[stockSlug(h.key)] : null
  return r ? { name: r.name, formerly: r.formerly } : { name: h?.name ?? '', formerly: null }
}

export function pairPath(codeA, codeB) {
  const [lo, hi] = [codeA, codeB].sort((x, y) => x - y)
  return `o/${lo}-vs-${hi}/`
}

const median = xs => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
export { median }

/** Load fund-data for every active fund and derive stocks and pairs. */
export function buildResearch(root, funds) {
  const dir = join(root, 'dist', 'fund-data')
  const histDir = join(root, 'dist', 'holdings-history')
  const details = new Map()
  // Date of the snapshot each fund's weight change is measured against
  // (scripts/add_holdings_change.py compares the last two snapshots, which are
  // not always one month apart). null when it cannot be confirmed.
  const changeSince = new Map()
  if (existsSync(dir)) {
    for (const f of funds) {
      const file = join(dir, `${f.code}.json`)
      if (!existsSync(file)) continue
      let d
      try { d = JSON.parse(readFileSync(file, 'utf-8')) } catch { continue /* unreadable file: no holdings sections */ }
      if (!d || typeof d !== 'object') continue
      if (d.holdings != null && !validHoldings(d.holdings)) d = { ...d, holdings: [], holdingsInvalid: true }
      details.set(f.code, d)
      changeSince.set(f.code, previousSnapshot(join(histDir, `${f.code}.json`), d.holdingsMeta?.portfolioDate))
    }
  }

  // Funds whose disclosed holdings take part in overlap and stock pages.
  const covered = funds.filter(f => isLiveFund(f)
    && !EXCLUDED_CATEGORIES.has(f.category) && hasUsableHoldings(details.get(f.code)))
  const maps = new Map(covered.map(f => [f.code, weightMap(details.get(f.code).holdings)]))

  // Stocks: equity lines only, one entry per fund. A stock disclosed on more
  // than one line is summed, as overlap.ts sums fund A's repeated lines.
  const byStock = new Map()
  for (const f of covered) {
    const d = details.get(f.code)
    const mom = hasMonthOnMonth(d.holdings)
    const own = new Map()
    for (const h of d.holdings) {
      if (h.instrument !== 'Equity' || !h.key) continue
      const slug = stockSlug(h.key)
      if (!slug) continue
      const c = typeof h.change === 'number' ? h.change : null
      const x = own.get(slug)
      if (!x) own.set(slug, { h, pct: h.pct, change: c })
      else { x.pct += h.pct; x.change = x.change == null ? c : c == null ? x.change : x.change + c }
    }
    for (const [slug, { h, pct, change }] of own) {
      let s = byStock.get(slug)
      if (!s) byStock.set(slug, s = { slug, names: new Map(), sectors: new Map(), holders: [] })
      s.names.set(h.name, (s.names.get(h.name) || 0) + 1)
      if (h.sector && !/^(unspecified|others?|n\/?a|-)$/i.test(String(h.sector).trim())) s.sectors.set(h.sector, (s.sectors.get(h.sector) || 0) + 1)
      s.holders.push({ fund: f, pct, change: mom ? change : undefined,
        date: d.holdingsMeta?.portfolioDate || null, since: mom ? changeSince.get(f.code) ?? null : null })
    }
  }
  const mostCommon = m => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null
  const stocks = [...byStock.values()]
    .filter(s => s.holders.length >= STOCK_MIN_HOLDERS)
    .map(s => ({ slug: s.slug, name: STOCK_RENAMES[s.slug]?.name ?? mostCommon(s.names), formerly: STOCK_RENAMES[s.slug]?.formerly ?? null, sector: mostCommon(s.sectors),
      holders: s.holders.sort((a, b) => b.pct - a.pct || a.fund.name.localeCompare(b.fund.name)) }))
    .sort((a, b) => b.holders.length - a.holders.length || a.name.localeCompare(b.name))
  const stockBySlug = new Map(stocks.map(s => [s.slug, s]))

  // Pairs: the largest funds within each active equity category.
  const aum = f => f.aum?.current ?? 0
  const pairs = []
  for (const cat of OVERLAP_CATEGORIES) {
    const top = covered.filter(f => f.category === cat && !isIndexFund(f) && aum(f) > 0)
      .sort((a, b) => aum(b) - aum(a) || a.code - b.code).slice(0, PAIR_TOP_N)
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
      const [a, b] = [top[i], top[j]] // a is the larger fund
      pairs.push({ a, b, category: cat, path: pairPath(a.code, b.code), overlap: overlapPct(maps.get(a.code), maps.get(b.code)) })
    }
  }
  // Stock pages and overlap pages link to each other and share hub pages: make both or neither.
  if (!stocks.length || !pairs.length) { stocks.length = 0; pairs.length = 0; stockBySlug.clear() }
  const pairByPath = new Map(pairs.map(p => [p.path, p]))

  /** Every covered fund sharing holdings with this one, most similar first, and the closest index fund. */
  function closest(code) {
    const own = maps.get(code)
    if (!own) return { all: [], index: null }
    const scored = []
    for (const f of covered) {
      if (f.code === code) continue
      const ov = overlapPct(own, maps.get(f.code))
      if (ov > 0) scored.push({ fund: f, overlap: ov })
    }
    // Weights carry 4 decimals: compare at that precision so float noise in the
    // sums cannot decide between two funds with the same overlap.
    const q = x => Math.round(x * 10000)
    scored.sort((x, y) => q(y.overlap) - q(x.overlap) || x.fund.code - y.fund.code)
    return { all: scored, index: scored.find(s => isIndexFund(s.fund)) || null }
  }

  const paths = stocks.length && pairs.length
    ? ['s/stocks/', 's/overlap/', ...stocks.map(s => `st/${s.slug}/`), ...pairs.map(p => p.path)]
    : []
  return { details, changeSince, covered, maps, stocks, stockBySlug, pairs, pairByPath, closest, paths }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
/** The snapshot before `current` in a holdings-history file, if the file's
 * latest snapshot is `current` (otherwise the stored change is not provably
 * against it, and null is returned). */
export function previousSnapshot(file, current) {
  if (!ISO_DAY.test(current || '') || !existsSync(file)) return null
  let hist
  try { hist = JSON.parse(readFileSync(file, 'utf-8')) } catch { return null }
  const dates = Object.keys(hist?.snapshots || {}).filter(k => ISO_DAY.test(k)).sort()
  if (dates.length < 2 || dates.at(-1) !== current) return null
  return dates.at(-2)
}
