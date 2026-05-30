import type { NavPoint } from '../types'

const RF_ANNUAL = 0.07
const RF_DAILY = RF_ANNUAL / 252

export interface ComputedMetrics {
  cagr: number // %
  totalReturn: number // %
  volatility: number // %
  sharpe: number
  sortino: number
  maxDrawdown: number // % (negative)
  maxDrawdownStart: string // ISO date of the peak before the worst fall
  maxDrawdownEnd: string // ISO date of the trough
  calmar: number
  best1M: number // %
  best1MStart: string // ISO date — start of the best rolling 1M window
  best1MEnd: string // ISO date — end of the best rolling 1M window
  worst1M: number // %
  worst1MStart: string
  worst1MEnd: string
  startDate: string
  endDate: string
  startNav: number
  endNav: number
  points: number
  years: number
}

/** Filter NAV points to [start, end] inclusive (ISO yyyy-mm-dd strings). */
export function sliceByRange(points: NavPoint[], start: string, end: string): NavPoint[] {
  return points.filter((p) => p.date >= start && p.date <= end)
}

/** Daily simple returns from a NAV series. */
function dailyReturns(points: NavPoint[]): number[] {
  const r: number[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].nav
    const cur = points[i].nav
    if (prev > 0) {
      const ret = cur / prev - 1
      if (Math.abs(ret) < 0.5) r.push(ret) // guard against data errors
    }
  }
  return r
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1)
  return Math.sqrt(v)
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

/**
 * Compute full metrics for an arbitrary NAV slice.
 * Returns null if the slice is too small to be meaningful.
 */
export function computeMetrics(slice: NavPoint[]): ComputedMetrics | null {
  if (slice.length < 10) return null

  const startNav = slice[0].nav
  const endNav = slice[slice.length - 1].nav
  const startDate = slice[0].date
  const endDate = slice[slice.length - 1].date

  const msPerDay = 86400000
  const days = (new Date(endDate).getTime() - new Date(startDate).getTime()) / msPerDay
  const years = days / 365.25

  const totalReturn = (endNav / startNav - 1) * 100
  const cagr = years > 0.05 ? (Math.pow(endNav / startNav, 1 / years) - 1) * 100 : totalReturn

  const rets = dailyReturns(slice)
  const dvol = std(rets)
  const volatility = dvol * Math.sqrt(252) * 100

  const sharpe = dvol > 0 ? ((mean(rets) - RF_DAILY) / dvol) * Math.sqrt(252) : 0

  const downside = rets.filter((r) => r < RF_DAILY)
  const dDev = downside.length > 5 ? std(downside) * Math.sqrt(252) : 0.0001
  const sortino = dDev > 0 ? (cagr / 100 - RF_ANNUAL) / dDev : 0

  // Max drawdown — track the peak (start) and trough (end) dates of the worst fall.
  // cumSeries[i] corresponds to slice[i] (cumSeries[0] = 1 at slice[0]; each
  // subsequent point multiplies by that day's return).
  let cum = 1
  const cumSeries = [1]
  for (const r of rets) {
    cum *= 1 + r
    cumSeries.push(cum)
  }
  let peak = cumSeries[0]
  let peakIdx = 0
  let maxDd = 0
  let ddPeakIdx = 0
  let ddTroughIdx = 0
  for (let i = 0; i < cumSeries.length; i++) {
    if (cumSeries[i] > peak) {
      peak = cumSeries[i]
      peakIdx = i
    }
    const dd = (cumSeries[i] - peak) / peak
    if (dd < maxDd) {
      maxDd = dd
      ddPeakIdx = peakIdx
      ddTroughIdx = i
    }
  }
  const maxDrawdown = maxDd * 100
  // Map cumSeries indices back to slice dates (cumSeries length == slice length
  // when all daily returns passed the guard; clamp to be safe).
  const idxToDate = (i: number) => slice[Math.min(i, slice.length - 1)].date
  const maxDrawdownStart = idxToDate(ddPeakIdx)
  const maxDrawdownEnd = idxToDate(ddTroughIdx)

  const calmar = maxDrawdown !== 0 ? (cagr / 100 - RF_ANNUAL) / Math.abs(maxDrawdown / 100) : 0

  // Best / worst rolling 1-month (21 trading days) — track the window endpoints.
  let best1M = -Infinity
  let worst1M = Infinity
  let bestStartIdx = 0
  let bestEndIdx = 0
  let worstStartIdx = 0
  let worstEndIdx = 0
  const navs = slice.map((p) => p.nav)
  for (let i = 21; i < navs.length; i++) {
    const r = (navs[i] / navs[i - 21] - 1) * 100
    if (r > best1M) {
      best1M = r
      bestStartIdx = i - 21
      bestEndIdx = i
    }
    if (r < worst1M) {
      worst1M = r
      worstStartIdx = i - 21
      worstEndIdx = i
    }
  }
  let best1MStart = slice[bestStartIdx]?.date ?? startDate
  let best1MEnd = slice[bestEndIdx]?.date ?? endDate
  let worst1MStart = slice[worstStartIdx]?.date ?? startDate
  let worst1MEnd = slice[worstEndIdx]?.date ?? endDate
  if (!isFinite(best1M)) {
    best1M = totalReturn
    best1MStart = startDate
    best1MEnd = endDate
  }
  if (!isFinite(worst1M)) {
    worst1M = totalReturn
    worst1MStart = startDate
    worst1MEnd = endDate
  }

  return {
    cagr,
    totalReturn,
    volatility,
    sharpe,
    sortino,
    maxDrawdown,
    maxDrawdownStart,
    maxDrawdownEnd,
    calmar,
    best1M,
    best1MStart,
    best1MEnd,
    worst1M,
    worst1MStart,
    worst1MEnd,
    startDate,
    endDate,
    startNav,
    endNav,
    points: slice.length,
    years,
  }
}

/** Preset range helpers — return [startISO, endISO] given the latest available date. */
export function presetRange(
  preset: '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y' | 'MAX',
  earliest: string,
  latest: string,
): [string, string] {
  const end = new Date(latest)
  const start = new Date(latest)
  switch (preset) {
    case '1M':
      start.setMonth(start.getMonth() - 1)
      break
    case '3M':
      start.setMonth(start.getMonth() - 3)
      break
    case '6M':
      start.setMonth(start.getMonth() - 6)
      break
    case 'YTD':
      start.setMonth(0, 1)
      break
    case '1Y':
      start.setFullYear(start.getFullYear() - 1)
      break
    case '3Y':
      start.setFullYear(start.getFullYear() - 3)
      break
    case '5Y':
      start.setFullYear(start.getFullYear() - 5)
      break
    case 'MAX':
      return [earliest, latest]
  }
  const startISO = start.toISOString().slice(0, 10)
  return [startISO < earliest ? earliest : startISO, end.toISOString().slice(0, 10)]
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Compact month-year, e.g. "Mar 2020" — for tight metric sub-lines. */
export function fmtMonth(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}
