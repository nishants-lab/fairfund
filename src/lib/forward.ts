/**
 * Client-side forward-looking analytics computed from a fund's NAV series.
 * These are the interactive, single-fund analytics (recomputed when the user
 * changes a horizon), per the forward-looking-analytics spec:
 *   - Rolling-returns distribution (Requirement 3)
 *   - Drawdown recovery time (Requirement 5)
 *   - Probabilistic outcome cone (Requirement 9)
 *
 * All are PURE FUNCTIONS over a NavPoint[] (oldest->newest) so they are unit-
 * testable and work offline from self-hosted NAV. Cross-fund analytics
 * (rank trajectory, batting average, capture, alpha, mean-reversion, regimes)
 * are precomputed at build time and shipped in funds.json (`analytics` block).
 */
import type { NavPoint } from '../types'

// ---- helpers ----
function monthEndSeries(points: NavPoint[]): { date: string; nav: number }[] {
  // collapse to last NAV per calendar month
  const byMonth = new Map<string, { date: string; nav: number }>()
  for (const p of points) {
    const m = p.date.slice(0, 7)
    byMonth.set(m, p) // later overwrites earlier -> last of month
  }
  return Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function monthlyReturns(points: NavPoint[]): number[] {
  const me = monthEndSeries(points)
  const r: number[] = []
  for (let i = 1; i < me.length; i++) {
    if (me[i - 1].nav > 0) r.push(me[i].nav / me[i - 1].nav - 1)
  }
  return r
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// ===== Requirement 3: Rolling-returns distribution =====
export interface RollingDist {
  horizonY: number
  n: number
  min: number // annualized %
  median: number
  max: number
  p10: number
  p90: number
  negPct: number // % of windows with negative annualized return
}

export function rollingReturnsDistribution(points: NavPoint[], horizonY: number): RollingDist | null {
  const me = monthEndSeries(points)
  const wm = horizonY * 12
  if (me.length <= wm) return null
  const anns: number[] = []
  for (let i = wm; i < me.length; i++) {
    const n0 = me[i - wm].nav
    const n1 = me[i].nav
    if (n0 > 0) {
      const ann = Math.pow(n1 / n0, 1 / horizonY) - 1
      anns.push(ann * 100)
    }
  }
  if (anns.length < 1) return null
  const sorted = [...anns].sort((a, b) => a - b)
  const neg = anns.filter((a) => a < 0).length
  return {
    horizonY,
    n: anns.length,
    min: sorted[0],
    median: percentile(sorted, 0.5),
    max: sorted[sorted.length - 1],
    p10: percentile(sorted, 0.1),
    p90: percentile(sorted, 0.9),
    negPct: (neg / anns.length) * 100,
  }
}

// ===== Requirement 5: Drawdown recovery time =====
export interface DrawdownInfo {
  depthPct: number // negative %
  troughDate: string
  peakDate: string
  recovered: boolean
  recoveryDays: number | null // null if still recovering
  daysSinceTrough: number
}

export function deepestDrawdown(points: NavPoint[]): DrawdownInfo | null {
  if (points.length < 10) return null
  let peak = points[0].nav
  let peakDate = points[0].date
  let curPeakDate = points[0].date
  let maxDd = 0
  let troughNav = points[0].nav
  let troughDate = points[0].date
  let troughPeakDate = points[0].date
  for (const p of points) {
    if (p.nav > peak) {
      peak = p.nav
      curPeakDate = p.date
    }
    const dd = (p.nav - peak) / peak
    if (dd < maxDd) {
      maxDd = dd
      troughNav = p.nav
      troughDate = p.date
      troughPeakDate = curPeakDate
      peakDate = curPeakDate
    }
  }
  if (maxDd === 0) return null
  // recovery: first date after trough where nav >= the peak that preceded the trough
  const peakNav = points.find((p) => p.date === troughPeakDate)?.nav ?? peak
  const afterTrough = points.filter((p) => p.date > troughDate)
  const recPoint = afterTrough.find((p) => p.nav >= peakNav)
  const msDay = 86400000
  const troughT = new Date(troughDate).getTime()
  const lastT = new Date(points[points.length - 1].date).getTime()
  return {
    depthPct: maxDd * 100,
    troughDate,
    peakDate,
    recovered: !!recPoint,
    recoveryDays: recPoint ? Math.round((new Date(recPoint.date).getTime() - troughT) / msDay) : null,
    daysSinceTrough: Math.round((lastT - troughT) / msDay),
  }
}

// ===== Requirement 9: Probabilistic outcome cone (block bootstrap) =====
export interface OutcomeCone {
  horizonY: number
  sims: number
  p10: number // growth multiple of initial investment
  p50: number
  p90: number
  history: number // months of monthly returns used
}

// Mulberry32 — small deterministic PRNG so results are reproducible (seed fixed).
function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CONE_SEED = 12345
const CONE_SIMS = 10000
const BLOCK = 6 // months per block — preserves short-term autocorrelation

export function outcomeCone(points: NavPoint[], horizonY: number): OutcomeCone | null {
  const rets = monthlyReturns(points)
  if (rets.length < 36) return null
  const months = horizonY * 12
  const maxStart = Math.max(0, rets.length - BLOCK)
  const rand = mulberry32(CONE_SEED + horizonY)
  const finals: number[] = []
  for (let s = 0; s < CONE_SIMS; s++) {
    let growth = 1
    let m = 0
    while (m < months) {
      const start = Math.floor(rand() * (maxStart + 1))
      for (let b = 0; b < BLOCK && m < months; b++, m++) {
        const idx = Math.min(start + b, rets.length - 1)
        growth *= 1 + rets[idx]
      }
    }
    finals.push(growth)
  }
  finals.sort((a, b) => a - b)
  return {
    horizonY,
    sims: CONE_SIMS,
    p10: percentile(finals, 0.1),
    p50: percentile(finals, 0.5),
    p90: percentile(finals, 0.9),
    history: rets.length,
  }
}
