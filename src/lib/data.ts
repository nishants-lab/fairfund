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
  const p = fetch(base + 'fund-data/' + code + '.json?v=' + __DATA_VERSION__)
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
  if (detail.investInfo !== undefined) fund.investInfo = detail.investInfo
  return fund
}

export function getFund(code: number): Fund | undefined {
  return byCode.get(code)
}

// Fuzzy-ish search: matches on name, AMC, category. Ranked by relevance.
/**
 * Trigram similarity: fraction of shared 3-char slices between two strings.
 * Gives fuzzy tolerance for typos (e.g. "paragh" still matches "parag").
 */
function trigramSim(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return a.includes(b) || b.includes(a) ? 0.8 : 0
  const tris = (s: string) => {
    const t = new Set<string>()
    for (let i = 0; i <= s.length - 3; i++) t.add(s.slice(i, i + 3))
    return t
  }
  const setA = tris(a)
  const setB = tris(b)
  let shared = 0
  setA.forEach((t) => { if (setB.has(t)) shared++ })
  return shared / Math.max(setA.size, setB.size)
}

export function searchFunds(query: string, limit = 8): Fund[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const tokens = q.split(/\s+/)

  const scored = funds.map((f) => {
    const nameLow = f.name.toLowerCase()
    const amcLow = f.amc.toLowerCase()
    const hay = `${nameLow} ${amcLow} ${f.categoryDisplay?.toLowerCase() ?? ''}`
    let score = 0

    // Exact prefix on name is strongest
    if (nameLow.startsWith(q)) score += 100
    if (amcLow.startsWith(q)) score += 60

    // All tokens present (exact substring)
    const allMatch = tokens.every((t) => hay.includes(t))
    if (allMatch) score += 40 + tokens.length * 5

    // Per-token: exact substring OR fuzzy trigram match
    tokens.forEach((t) => {
      if (hay.includes(t)) {
        score += 10
        // Bonus if token starts a word boundary
        if (nameLow.includes(' ' + t) || nameLow.startsWith(t)) score += 5
      } else {
        // Fuzzy: compare token against each word in the haystack
        const words = hay.split(/\s+/)
        let bestSim = 0
        for (const w of words) {
          const sim = trigramSim(t, w)
          if (sim > bestSim) bestSim = sim
        }
        // Only count fuzzy if similarity is strong enough (>= 0.55)
        if (bestSim >= 0.55) score += Math.round(bestSim * 10)
      }
    })

    // Penalize if zero exact token hits (pure fuzzy match = lower confidence)
    const exactHits = tokens.filter((t) => hay.includes(t)).length
    if (exactHits === 0 && score > 0) score = Math.round(score * 0.5)

    // Boost better-ranked funds slightly so top funds surface first
    const rank3y = f.metrics['3Y']?.catRank ?? 99
    score += Math.max(0, 10 - rank3y)

    return { f, score }
  })

  return scored
    .filter((s) => s.score > 10)
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
