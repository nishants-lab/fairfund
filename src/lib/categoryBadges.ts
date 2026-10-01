import type { Fund, FundsData } from '../types'
import { isIsoDate } from './marketDate'

export type CategoryBadgeKind = 'return' | 'return3Y' | 'volatility'
export interface CategoryBadge { kind: CategoryBadgeKind; label: string; explanation: string }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Descriptive category badges only. Never changes fund scores or category metadata.
 * Select independently within each criterion, prefer 3Y return > 5Y return > volatility.
 * Do not backfill overlapping winners or split a tie at the third-place boundary.
 * At most nine badges and no more than half of displayed cards; no coverage quota.
 */
export function categoryBadges(data: FundsData, keys: readonly string[]): Map<string, CategoryBadge> {
  const shown = [...new Set(keys)].filter(key => data.categories[key]?.fundCount > 0)
  const rows = shown.map(key => {
    const members = data.funds.filter(f => f.category === key && f.dataQuality?.status !== 'quarantined')
    const eligible = (years: 3 | 5) => members.map(f => f.metrics[years === 3 ? '3Y' : '5Y']).filter((m): m is NonNullable<Fund['metrics']['5Y']> => {
      if (!m || !isIsoDate(m.windowStart) || !isIsoDate(m.windowEnd) || !isIsoDate(data.anchor)) return false
      const anniversary = new Date(`${m.windowEnd}T00:00:00Z`)
      const month = anniversary.getUTCMonth()
      anniversary.setUTCFullYear(anniversary.getUTCFullYear() - years)
      if (anniversary.getUTCMonth() !== month) anniversary.setUTCDate(0)
      const gap = (anniversary.getTime() - Date.parse(m.windowStart)) / 86400000
      return gap >= 0 && gap <= 7 && m.windowEnd <= data.anchor
    })
    const windows = eligible(5)
    const windows3Y = eligible(3)
    const periods3Y = new Set(windows3Y.map(m => `${m.windowStart} to ${m.windowEnd}`))
    const returns3Y = windows3Y.map(m => m.cagr).filter(finite)
    const periods = new Set(windows.map(m => `${m.windowStart} to ${m.windowEnd}`))
    const returns = windows.map(m => m.cagr).filter(finite)
    const volatility = windows.map(m => m.volatility).filter(n => finite(n) && n >= 0)
    // Match the displayed, two-decimal category return without trusting stale metadata.
    const stored = data.categories[key].medianCagr5Y
    const returnMedian = returns.length >= 3 ? median(returns) : null
    const comparable = periods.size === 1
    return { key, period: [...periods][0],
      period3Y: [...periods3Y][0], return3YN: returns3Y.length,
      return3YValue: periods3Y.size === 1 && returns3Y.length >= 3 ? median(returns3Y) : null,
      returnN: returns.length, volatilityN: volatility.length,
      returnValue: comparable && returnMedian != null && finite(stored) && Math.abs(stored - returnMedian) <= 0.0051 ? stored : null,
      volatilityValue: comparable && volatility.length >= 3 ? median(volatility) : null }
  })
  const result = new Map<string, CategoryBadge>()
  const budget = Math.min(9, Math.floor(shown.length / 2))
  const select = (kind: CategoryBadgeKind, value: (row: typeof rows[number]) => number | null, descending: boolean) => {
    const ordered = rows.filter(row => finite(value(row))).sort((a, b) =>
      (descending ? -1 : 1) * (value(a)! - value(b)!) || a.key.localeCompare(b.key))
    if (ordered.length < 3) return
    const boundary = ordered[2]
    const tiedBoundary = ordered.length > 3 && value(boundary) === value(ordered[3])
    for (const row of ordered.slice(0, 3)) {
      if (tiedBoundary && value(row) === value(boundary)) continue
      if (result.size >= budget || result.has(row.key)) continue
      const common = ' Compared with the categories shown. Category periods can differ. Past data is not an investment recommendation.'
      const sample = (n: number, period = row.period) => `${n} eligible funds${n < 5 ? ' (small sample)' : ''}, ${period}.`
      const badge: CategoryBadge = kind === 'return'
        ? { kind, label: 'Top 3 by 5Y return', explanation: `Among the three highest category median 5-year annualised returns: ${row.returnValue!.toFixed(2)}%. Based on ${sample(row.returnN)} Median means the middle return, averaging the two middle values for an even sample. This comparison does not account for risk or predict future returns.${common}` }
        : kind === 'return3Y'
          ? { kind, label: 'Top 3 by 3Y return', explanation: `Among the three highest category median 3-year annualised returns: ${row.return3YValue!.toFixed(2)}%. Based on ${sample(row.return3YN, row.period3Y)} Median means the middle return, averaging the two middle values for an even sample. This comparison does not account for risk or predict future returns.${common}` }
          : { kind, label: 'Lower NAV volatility', explanation: `Among the three lowest category median NAV volatilities over eligible 5Y histories: ${row.volatilityValue!.toFixed(2)}% annualised. Based on ${sample(row.volatilityN)} Lower historical NAV fluctuations do not mean lower credit or liquidity risk.${common}` }
      result.set(row.key, badge)
    }
  }
  select('return3Y', row => row.return3YValue, true)
  select('return', row => row.returnValue, true)
  select('volatility', row => row.volatilityValue, false)
  return result
}
