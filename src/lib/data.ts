import fundsJson from '../data/funds.json'
import type { FundsData, Fund } from '../types'

export const data = fundsJson as unknown as FundsData
export const funds: Fund[] = data.funds

// Build a quick lookup by code
const byCode = new Map<number, Fund>()
funds.forEach((f) => byCode.set(f.code, f))

// --- Lazy-load per-fund detail (analytics, holdings, management, stockMoves) ---
const detailCache = new Map<number, Promise<Partial<Fund>>>()

export function fetchFundDetail(code: number): Promise<Partial<Fund>> {
  if (detailCache.has(code)) return detailCache.get(code)!
  const base = import.meta.env.BASE_URL || './'
  const p = fetch(base + 'fund-data/' + code + '.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
  detailCache.set(code, p)
  return p
}

// Merge fetched detail into a fund object (mutates for caching)
export function mergeFundDetail(fund: Fund, detail: Partial<Fund>): Fund {
  if (detail.analytics) fund.analytics = detail.analytics
  if (detail.holdings) fund.holdings = detail.holdings
  if (detail.holdingsMeta) fund.holdingsMeta = detail.holdingsMeta
  if (detail.management) fund.management = detail.management
  if (detail.stockMoves !== undefined) fund.stockMoves = detail.stockMoves
  if (detail.aum !== undefined) fund.aum = detail.aum
  if (detail.expenseRatio !== undefined) fund.expenseRatio = detail.expenseRatio
  return fund
}

export function getFund(code: number): Fund | undefined {
  return byCode.get(code)
}

// Fuzzy-ish search: matches on name, AMC, category. Ranked by relevance.
export function searchFunds(query: string, limit = 8): Fund[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const tokens = q.split(/\s+/)

  const scored = funds.map((f) => {
    const hay = `${f.name} ${f.amc} ${f.categoryDisplay}`.toLowerCase()
    let score = 0
    // Exact prefix on name is strongest
    if (f.name.toLowerCase().startsWith(q)) score += 100
    if (f.amc.toLowerCase().startsWith(q)) score += 60
    // All tokens present
    const allMatch = tokens.every((t) => hay.includes(t))
    if (allMatch) score += 40
    // Partial token matches
    tokens.forEach((t) => {
      if (hay.includes(t)) score += 10
    })
    // Boost better-ranked funds slightly so good funds surface first
    const rank3y = f.metrics['3Y']?.catRank ?? 99
    score += Math.max(0, 10 - rank3y)
    return { f, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.f)
}

export function fundsByCategory(category: string): Fund[] {
  return funds
    .filter((f) => f.category === category)
    .sort(
      (a, b) =>
        (a.metrics['3Y']?.catRank ?? 999) - (b.metrics['3Y']?.catRank ?? 999),
    )
}

export const categoryOrder = [
  'Large Cap',
  'Flexi Cap',
  'Multi Cap',
  'Large & Mid Cap',
  'Mid Cap',
  'Small Cap',
  'Value/Contra',
  'Focused',
  'ELSS',
  'Dividend Yield',
  'Sectoral/Thematic',
  'International',
  'FoF-Equity (Domestic)',
  'Index Funds',
  'Index-MidCap',
  'Index-SmallCap',
  'Index-Sectoral/Thematic',
  'Index-Other',
]

export function topFundsForCategory(category: string, n = 5): Fund[] {
  return fundsByCategory(category).slice(0, n)
}

export interface CatMetricStats {
  min: number
  max: number
  median: number
  /** "best" value in the metric's good direction (max if higherBetter else min) */
  best: number
  n: number
}

/**
 * Distribution of a stored metric across a category, for spectrum peer-context.
 * Reads from each fund's 3Y window (the canonical baseline). `higherBetter`
 * decides which extreme counts as "best". Returns null if too few peers.
 */
export function categoryMetricStats(
  category: string,
  metric: 'volatility' | 'sharpe' | 'sortino' | 'calmar' | 'cagr' | 'alpha',
  higherBetter = true,
): CatMetricStats | null {
  const vals = funds
    .filter((f) => f.category === category)
    .map((f) => f.metrics['3Y']?.[metric])
    .filter((v): v is number => typeof v === 'number' && !isNaN(v))
    .sort((a, b) => a - b)
  if (vals.length < 3) return null
  const mid = Math.floor(vals.length / 2)
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
  const min = vals[0]
  const max = vals[vals.length - 1]
  return { min, max, median, best: higherBetter ? max : min, n: vals.length }
}

// Category search – returns categories whose display name or key matches the query
export interface CategoryResult {
  key: string
  display: string
  fundCount: number
  medianCagr5Y?: number
}

export function searchCategories(query: string): CategoryResult[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const tokens = q.split(/\s+/)
  return categoryOrder
    .filter((c) => {
      const cat = data.categories[c]
      if (!cat) return false
      const hay = `${cat.display ?? c} ${c}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
    .map((c) => ({
      key: c,
      display: data.categories[c].display ?? c,
      fundCount: data.categories[c].fundCount,
      medianCagr5Y: data.categories[c].medianCagr5Y ?? undefined,
    }))
}
