import fundsJson from '../data/funds.json'
import type { FundsData, Fund } from '../types'
import { FILLER, MODIFIERS, amcAliases, normalizeSearch, otherNames, wantsIndex } from './searchText'

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
  if (fund.dataQuality?.status === 'quarantined') { merged.analytics = {}; merged.metrics = {}; delete merged.si; delete merged.previousRankings }
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

/** Search text for one fund, normalised once. */
interface SearchEntry {
  f: Fund
  name: string
  nameWords: string[]
  hay: string
  /** hay plus every other name: for per-word matching. */
  hayAll: string
  amcAndAlias: string
  others: string[]
  othersRaw: string[]
  isIndex: boolean
}
let searchIndex: SearchEntry[] | null = null
/** Every word in the search text, with how many funds use it (for spelling fixes). */
let vocabulary: Map<string, number> | null = null
function getSearchIndex(): SearchEntry[] {
  if (searchIndex) return searchIndex
  searchIndex = funds.map((f) => {
    const name = normalizeSearch(f.name)
    const amc = normalizeSearch(f.amc)
    const alias = amcAliases(name)
    const othersRaw = otherNames(f.code)
    const others = othersRaw.map(normalizeSearch)
    const hay = `${name} ${amc} ${normalizeSearch(f.categoryDisplay ?? '')} ${alias}`.trim()
    return {
      f,
      name,
      nameWords: name.split(' '),
      hay,
      hayAll: others.length ? `${hay} ${others.join(' ')}` : hay,
      amcAndAlias: `${amc} ${alias}`.trim(),
      others,
      othersRaw,
      isIndex: (f.category ?? '').startsWith('Index'),
    }
  })
  vocabulary = new Map()
  for (const e of searchIndex) {
    for (const w of new Set(e.hayAll.split(' '))) {
      if (w) vocabulary.set(w, (vocabulary.get(w) ?? 0) + 1)
    }
  }
  return searchIndex
}

/** Edit distance with adjacent swaps ("axsi" -> "axis" is 1), capped at max + 1. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

/**
 * Spelling fix for one query word: when no fund's search text contains it, the
 * closest word that does ("paragh" -> "parag", "midcp" -> "midcap", "kotk" ->
 * "kotak"). One edit allowed from 4 letters, two from 9; a word still being
 * typed is compared with the same-length start of each word ("emergn" ->
 * "emerging"). Ties go to the word more funds use. Numbers and words of under 4
 * letters are left alone, so "50" never becomes "30".
 */
function correctToken(t: string): { token: string; fixed: boolean } {
  const vocab = vocabulary!
  if (t.length < 4 || /\d/.test(t) || vocab.has(t)) return { token: t, fixed: false }
  for (const w of vocab.keys()) if (w.includes(t)) return { token: t, fixed: false }
  // Two edits from 7 letters turned "unicorn" into "union" (QA round 2).
  const max = t.length >= 9 ? 2 : 1
  let best = ''
  let bestDist = max + 1
  let bestCount = 0
  for (const [w, count] of vocab) {
    if (w.length < 4) continue
    let dist = editDistance(t, w, max)
    if (dist > 0 && w.length > t.length && t.length >= 5) dist = Math.min(dist, editDistance(t, w.slice(0, t.length), max))
    if (dist < bestDist || (dist === bestDist && count > bestCount)) {
      best = w
      bestDist = dist
      bestCount = count
    }
  }
  return bestDist <= max ? { token: best, fixed: true } : { token: t, fixed: false }
}

/** The query as search tokens, typos fixed, and how many words were fixed. */
function queryTokens(query: string): { tokens: string[]; fixes: number } {
  getSearchIndex()
  const raw = normalizeSearch(query).split(' ').filter(Boolean)
  let fixes = 0
  const tokens = raw.map((t) => {
    const c = correctToken(t)
    if (c.fixed) fixes++
    return c.token
  })
  return { tokens, fixes }
}

/**
 * The other name (a former name, or the AMC's) through which `query` matched
 * `fund`, when its current name alone does not contain every query word. The
 * search box shows it, so a result for "axis bluechip" says why Axis Large Cap
 * Fund came up. Null when the current name already explains the match.
 */
export function matchedOtherName(fund: Fund, query: string): string | null {
  const { tokens } = queryTokens(query)
  if (!tokens.length) return null
  const e = getSearchIndex().find((x) => x.f.code === fund.code)
  if (!e || tokens.every((t) => e.hay.includes(t))) return null
  const i = e.others.findIndex((n) => tokens.every((t) => `${n} ${e.amcAndAlias}`.includes(t)))
  return i >= 0 ? e.othersRaw[i] : null
}

export function searchFunds(query: string, limit = 8): Fund[] {
  if (normalizeSearch(query).replace(/ /g, '').length < 2 || query.trim().length < 2) return []
  // Misspelt words are replaced by the closest word in the fund data and cost
  // a little, so an exact spelling of another fund still ranks above a fix.
  const { tokens, fixes } = queryTokens(query)
  const q = tokens.join(' ')
  const indexAsked = wantsIndex(tokens)

  const scored = getSearchIndex().map((e) => {
    const { f, name, hay, hayAll } = e
    let score = 0

    // Exact prefix on name is strongest; a prefix of another name the fund
    // is known by comes next; then the AMC or its abbreviation. Exclusive: the
    // amc field is cut from the name with varying length ("UTI", "UTI Nifty"),
    // so stacking it on a name prefix favoured funds by how the cut fell.
    if (name.startsWith(q)) score += 100
    else if (e.others.some((n) => n.startsWith(q))) score += 70
    else if (e.amcAndAlias.startsWith(q) || e.amcAndAlias.split(' ').includes(q)) score += 60

    // All tokens present in the current name, AMC, category or AMC alias.
    const allMatch = tokens.every((t) => hay.includes(t))
    if (allMatch) score += 40 + tokens.length * 5
    // Or all present in one other name of the fund (plus its AMC): "kotak emerging".
    else if (e.others.some((n) => tokens.every((t) => `${n} ${e.amcAndAlias}`.includes(t)))) {
      score += 35 + tokens.length * 5
    }

    // Per-token: exact substring OR fuzzy trigram match
    tokens.forEach((t) => {
      if (hayAll.includes(t)) {
        score += 10
        // Bonus if token starts a word boundary
        if (name.includes(' ' + t) || name.startsWith(t)) score += 5
      } else {
        // Fuzzy: compare token against each word in the haystack
        const words = hayAll.split(/\s+/)
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
    const exactHits = tokens.filter((t) => hayAll.includes(t)).length
    if (exactHits === 0 && score > 0) score = Math.round(score * 0.5)

    // The query as a phrase in the name ("nifty 50" in "UTI Nifty 50 Index Fund",
    // not in "Axis Nifty Midcap 50"), and a first word that starts the name
    // (people lead with the AMC: "canara bluechip" is a Canara fund).
    if (tokens.length > 1 && ` ${name} `.includes(` ${q} `)) score += 15
    if (tokens.length > 1 && (name.startsWith(tokens[0] + ' ') || e.amcAndAlias.split(' ').includes(tokens[0]))) score += 10

    // Fit: when every token is in the name, prefer the name with the fewest
    // other distinctive words ("nifty 50" -> a Nifty 50 index fund before a
    // Nifty 50 Equal Weight one).
    if (tokens.every((t) => name.includes(t))) {
      const extra = e.nameWords.filter((w) => !FILLER.has(w) && !tokens.some((t) => w.includes(t) || t.includes(w))).length
      score += Math.max(0, 12 - 3 * extra)
      score -= 6 * e.nameWords.filter((w) => MODIFIERS.has(w) && !tokens.includes(w)).length
    }

    // An index fund only leads when the query asks for one ("hdfc midcap"
    // means the active HDFC Mid Cap Fund; "hdfc midcap 150" the index fund).
    if (e.isIndex && !indexAsked && score > 0) score -= 8

    if (fixes && score > 0) score -= 5 * fixes

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
