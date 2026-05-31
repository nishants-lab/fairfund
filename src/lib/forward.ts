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
  minStart: string // entry month of the WORST window
  minEnd: string // exit month of the worst window
  maxStart: string // entry month of the BEST window
  maxEnd: string
}

export function rollingReturnsDistribution(points: NavPoint[], horizonY: number): RollingDist | null {
  const me = monthEndSeries(points)
  const wm = horizonY * 12
  if (me.length <= wm) return null
  const anns: { v: number; start: string; end: string }[] = []
  for (let i = wm; i < me.length; i++) {
    const n0 = me[i - wm].nav
    const n1 = me[i].nav
    if (n0 > 0) {
      const ann = Math.pow(n1 / n0, 1 / horizonY) - 1
      anns.push({ v: ann * 100, start: me[i - wm].date, end: me[i].date })
    }
  }
  if (anns.length < 1) return null
  const sorted = [...anns].map((a) => a.v).sort((a, b) => a - b)
  const neg = anns.filter((a) => a.v < 0).length
  let minW = anns[0]
  let maxW = anns[0]
  for (const a of anns) {
    if (a.v < minW.v) minW = a
    if (a.v > maxW.v) maxW = a
  }
  return {
    horizonY,
    n: anns.length,
    min: sorted[0],
    median: percentile(sorted, 0.5),
    max: sorted[sorted.length - 1],
    p10: percentile(sorted, 0.1),
    p90: percentile(sorted, 0.9),
    negPct: (neg / anns.length) * 100,
    minStart: minW.start,
    minEnd: minW.end,
    maxStart: maxW.start,
    maxEnd: maxW.end,
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
  mode: 'lumpsum' | 'sip'
  // For lumpsum: growth MULTIPLE of the one-time investment.
  // For SIP: growth multiple of TOTAL invested (sum of monthly contributions).
  p10: number
  p50: number
  p90: number
  invested: number // total rupees put in (lumpsum amount, or monthly*months)
  endP10: number // ending rupee value at the 10th percentile
  endP50: number
  endP90: number
  history: number // months of monthly returns used
}

// Mulberry32 - small deterministic PRNG so results are reproducible (seed fixed).
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
const BLOCK = 6 // months per block - preserves short-term autocorrelation

/**
 * Probabilistic outcome cone via block bootstrap of the fund's monthly returns.
 *  - mode 'lumpsum': invest `amount` once today.
 *  - mode 'sip': invest `amount` at the START of every month for the horizon;
 *    each contribution compounds by the (resampled) returns of the months that
 *    follow it. This is the standard rupee-cost-averaging math.
 * Returns both the growth multiple (vs total invested) and ending rupee values.
 */
export function outcomeCone(
  points: NavPoint[],
  horizonY: number,
  opts?: { mode?: 'lumpsum' | 'sip'; amount?: number },
): OutcomeCone | null {
  const rets = monthlyReturns(points)
  if (rets.length < 36) return null
  const mode = opts?.mode ?? 'lumpsum'
  const amount = opts?.amount ?? 100000
  const months = horizonY * 12
  const maxStart = Math.max(0, rets.length - BLOCK)
  const rand = mulberry32(CONE_SEED + horizonY + (mode === 'sip' ? 7 : 0))
  const finals: number[] = []

  for (let s = 0; s < CONE_SIMS; s++) {
    // Build one resampled return path of `months` length (block bootstrap).
    const path: number[] = []
    while (path.length < months) {
      const start = Math.floor(rand() * (maxStart + 1))
      for (let b = 0; b < BLOCK && path.length < months; b++) {
        path.push(rets[Math.min(start + b, rets.length - 1)])
      }
    }
    if (mode === 'lumpsum') {
      let g = 1
      for (let m = 0; m < months; m++) g *= 1 + path[m]
      finals.push(g * amount)
    } else {
      // SIP: contribute `amount` at the start of each month; a contribution made
      // at month i then experiences the returns of months i..months-1.
      let value = 0
      for (let m = 0; m < months; m++) {
        value += amount // this month's contribution
        value *= 1 + path[m] // grows by this month's return
      }
      finals.push(value)
    }
  }
  finals.sort((a, b) => a - b)
  const invested = mode === 'lumpsum' ? amount : amount * months
  const endP10 = percentile(finals, 0.1)
  const endP50 = percentile(finals, 0.5)
  const endP90 = percentile(finals, 0.9)
  return {
    horizonY,
    sims: CONE_SIMS,
    mode,
    p10: endP10 / invested,
    p50: endP50 / invested,
    p90: endP90 / invested,
    invested,
    endP10,
    endP50,
    endP90,
    history: rets.length,
  }
}
