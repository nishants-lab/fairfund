import fundsJson from '../data/funds.json'
import type { FundsData, Fund } from '../types'

export const data = fundsJson as unknown as FundsData
export const funds: Fund[] = data.funds

// Build a quick lookup by code
const byCode = new Map<number, Fund>()
funds.forEach((f) => byCode.set(f.code, f))

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
  'Index-LargeCap',
  'Index-MidCap',
  'Index-SmallCap',
  'Index-Sectoral/Thematic',
  'Index-Other',
]

export function topFundsForCategory(category: string, n = 5): Fund[] {
  return fundsByCategory(category).slice(0, n)
}
