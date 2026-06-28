// Auto-generated regime data (from pipeline/detect_regimes.py output)
// Imported by ForwardAnalytics and FundDetail for display + drawdown matching.
import regimesData from '../data/regimes.json'

export interface Regime {
  name: string
  start: string
  end: string
  market: 'down' | 'up' | 'mixed'
  desc?: string
  auto?: boolean
}

export const REGIMES: Regime[] = regimesData as Regime[]

/** Which regimes a [start,end] window overlaps. */
export function overlappingRegimes(start: string, end: string): Regime[] {
  return REGIMES.filter((r) => start <= r.end && end >= r.start)
}

/** Short "potential reason" for a fall: did it overlap a market-wide downturn? */
export function fallReason(start: string, end: string): string | null {
  const hits = overlappingRegimes(start, end).filter((r) => r.market !== 'up')
  if (hits.length === 0) return null
  return `Overlaps ${hits[0].name} - likely a market-wide fall, not specific to this fund.`
}

/** Short positive context for a strong month: did it ride a broad rally? */
export function riseContext(start: string, end: string): string | null {
  const hits = overlappingRegimes(start, end).filter((r) => r.market !== 'down')
  if (hits.length === 0) return null
  return `Came during ${hits[0].name} - a broad rally lifted most funds.`
}

/** Match a drawdown peak-to-trough window to the most relevant regime. */
export function matchRegime(peakDate: string, troughDate: string): string | null {
  // Primary: trough lands within a down regime
  for (const r of REGIMES) {
    if (r.market !== 'up' && troughDate >= r.start && troughDate <= r.end) return r.name
  }
  // Fallback: peak-to-trough overlaps any down regime
  for (const r of REGIMES) {
    if (r.market !== 'up' && peakDate <= r.end && troughDate >= r.start) return r.name
  }
  return null
}

/** Build REGIME_INFO lookup for the regime table display. */
export function regimeInfo(name: string): { range: string; desc: string; market: 'down' | 'up' | 'mixed' } | undefined {
  const r = REGIMES.find((x) => x.name === name)
  if (!r) return undefined
  const fmtMon = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  }
  const range = r.end >= new Date().toISOString().slice(0, 10)
    ? `${fmtMon(r.start)} - today`
    : `${fmtMon(r.start)} - ${fmtMon(r.end)}`
  return { range, desc: r.desc || '', market: r.market }
}
