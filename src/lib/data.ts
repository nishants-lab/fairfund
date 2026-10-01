import fundsJson from '../data/funds.json'
import type { FundsData, Fund } from '../types'

export const data = fundsJson as unknown as FundsData
export const funds: Fund[] = data.funds

/**
 * Funds that use the reduced, honest analytics surface: debt (cash-equivalent)
 * and arbitrage (fully hedged, market-neutral). For both, equity risk-adjusted
 * metrics (Sharpe, alpha, drawdown, manager skill) are meaningless, so the UI
 * hides those sections. Note arbitrage is still taxed as equity (isDebt=false).
 */
export function usesReducedSurface(f: { isDebt?: boolean; isArbitrage?: boolean }): boolean {
  return !!(f.isDebt || f.isArbitrage)
}

// Build a quick lookup by code over the bundled index snapshot.
const byCode = new Map<number, Fund>()
funds.forEach((f) => byCode.set(f.code, f))

/**
 * The bundled index is a shared singleton: list, category, movers, peer and
 * verdict views all read these objects. Detail hydration used to merge the
 * per-fund shell straight into them, so opening one fund page rewrote aum /
 * expenseRatio / analytics everywhere else in the session and made displayed
 * numbers depend on navigation order. The entries are frozen so that can no
 * longer happen; hydration is a pure merge that returns a new object (see
 * mergeFundDetail), which the hydrating view holds in its own state.
 */
funds.forEach((f) => Object.freeze(f))

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

/**
 * Merge a fetched shell onto a fund, purely: `fund` is never written to, and the
 * returned object is a new one. Callers MUST use the return value (keep it in
 * component state) - there is no in-place hydration any more, because the object
 * handed in is the shared, frozen index entry.
 *
 * The index owns AUM and expense ratio, including missing values, so detail
 * hydration cannot change the inputs used by category rankings. The shell owns
 * analytics, holdings, holdingsMeta, management and stockMoves. A non-null
 * shell investInfo still overrides the bundled value.
 */
export function mergeFundDetail(fund: Fund, detail: Partial<Fund>): Fund {
  const merged: Fund = { ...fund }
  if (detail.analytics) merged.analytics = detail.analytics
  if (fund.dataQuality?.status === 'quarantined') { merged.analytics = {}; merged.metrics = {}; delete merged.si }
  if (detail.holdings) merged.holdings = detail.holdings
  if (detail.holdingsMeta) merged.holdingsMeta = detail.holdingsMeta
  if (detail.management) merged.management = detail.management
  if (detail.stockMoves !== undefined) merged.stockMoves = detail.stockMoves
  if (detail.investInfo != null) merged.investInfo = detail.investInfo
  return merged
}

/** The shared, frozen index entry for a code. Hydration never alters it. */
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
  'Index Funds',
  'Index-MidCap',
  'Index-SmallCap',
  'Index-Sectoral/Thematic',
  'Index-Other',
  // Debt (cash-equivalent) categories, grouped last as a Cash / Debt block.
  'Liquid',
  'Money Market',
  // Arbitrage: hedged equity, cash-like behaviour, equity taxation.
  'Arbitrage',
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
