/**
 * Spectrum models - pure, testable helpers that turn a raw metric value into a
 * gradient + marker layout for the <Spectrum> component.
 *
 * Two flavours:
 *  1. THRESHOLD bands (fixed 0..100 domain): the colour changes at meaningful
 *     cut-offs, so the green zone is only as wide as "good" actually is. Used
 *     for confidence-style metrics (skill, consistency).
 *  2. CATEGORY pivot (domain = category min..max): the "good" value (e.g. 1.0
 *     for a risk-adjusted ratio) is pinned to the CENTRE of the bar; the fund's
 *     own value, the category median and the category best are placed as markers
 *     on the same scale, so you see where it sits among real peers.
 *
 * All functions are deterministic and side-effect free → unit-tested in qa.
 */

export const SPECTRUM_RED = '#f43f5e'
export const SPECTRUM_AMBER = '#f59e0b'
export const SPECTRUM_GREEN = '#10b981'

export interface SpectrumStop {
  pos: number // 0..1
  color: string
}
export interface SpectrumMarker {
  pos: number // 0..1 (already scaled)
  kind: 'primary' | 'median' | 'best'
  label?: string // short legend label, e.g. "1.04", "med 0.8"
}
export interface SpectrumModel {
  stops: SpectrumStop[]
  markers: SpectrumMarker[]
  leftLabel: string
  rightLabel: string
  pivotPos?: number // optional reference tick (e.g. the "1.0 = good" line)
  pivotLabel?: string
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** Linear position of v in [min,max]. */
export function linPos(v: number, min: number, max: number): number {
  if (max === min) return 0.5
  return clamp01((v - min) / (max - min))
}

/**
 * Piecewise position with a pivot pinned to the centre (0.5). Values at/below
 * the pivot map to [0,0.5], above map to [0.5,1]. So category-min sits at the
 * far left, category-max at the far right, and the pivot (the "good" threshold)
 * is always dead centre regardless of where it falls numerically.
 */
export function pivotPos(v: number, min: number, max: number, pivot: number): number {
  if (v <= pivot) {
    if (pivot <= min) return 0
    return clamp01(0.5 * ((v - min) / (pivot - min)))
  }
  if (max <= pivot) return 1
  return clamp01(0.5 + 0.5 * ((v - pivot) / (max - pivot)))
}

export interface CategoryStats {
  median?: number | null
  best?: number | null // "best" in the metric's good direction
}

/**
 * Threshold-band spectrum for a 0..100 confidence/percentage value where higher
 * is better. `lowMid` and `midHigh` are the red→amber and amber→green cut-offs.
 * The green band is therefore only (100 - midHigh)% wide - small when the bar
 * for "good" is high (e.g. skill needs ≥90%), which is the honest signal.
 */
export function bandSpectrum(opts: {
  value: number
  lowMid: number
  midHigh: number
  leftLabel: string
  rightLabel: string
  cat?: CategoryStats
  fmt?: (n: number) => string
}): SpectrumModel {
  const { value, lowMid, midHigh, leftLabel, rightLabel, cat } = opts
  const fmt = opts.fmt ?? ((n: number) => `${Math.round(n)}%`)
  const p = (n: number) => clamp01(n / 100)
  const stops: SpectrumStop[] = [
    { pos: 0, color: SPECTRUM_RED },
    { pos: p(lowMid), color: SPECTRUM_RED },
    { pos: p(lowMid), color: SPECTRUM_AMBER },
    { pos: p(midHigh), color: SPECTRUM_AMBER },
    { pos: p(midHigh), color: SPECTRUM_GREEN },
    { pos: 1, color: SPECTRUM_GREEN },
  ]
  const markers: SpectrumMarker[] = [{ pos: p(value), kind: 'primary', label: fmt(value) }]
  if (cat?.median != null) markers.push({ pos: p(cat.median), kind: 'median', label: `med ${fmt(cat.median)}` })
  if (cat?.best != null) markers.push({ pos: p(cat.best), kind: 'best', label: `best ${fmt(cat.best)}` })
  return { stops, markers, leftLabel, rightLabel }
}

/**
 * Category-pivot spectrum for a risk-adjusted ratio (Sharpe/Sortino/Calmar):
 * domain is the category's own [min,max]; `pivot` (default 1.0 = the textbook
 * "good" line) is pinned to centre. Left half (below the good line) runs
 * red→amber; right half (at/above good) is green. Markers: this fund, category
 * median, category best.
 */
export function ratioSpectrum(opts: {
  value: number
  min: number
  max: number
  pivot?: number
  cat?: CategoryStats
  fmt?: (n: number) => string
  leftLabel?: string
  rightLabel?: string
}): SpectrumModel {
  const pivot = opts.pivot ?? 1
  const fmt = opts.fmt ?? ((n: number) => n.toFixed(2))
  // pad the domain a touch so the extreme peer isn't jammed against the edge
  const lo = Math.min(opts.min, opts.value, pivot)
  const hi = Math.max(opts.max, opts.value, pivot)
  const sc = (v: number) => pivotPos(v, lo, hi, pivot)
  const stops: SpectrumStop[] = [
    { pos: 0, color: SPECTRUM_RED },
    { pos: 0.42, color: SPECTRUM_AMBER },
    { pos: 0.5, color: SPECTRUM_GREEN },
    { pos: 1, color: SPECTRUM_GREEN },
  ]
  const markers: SpectrumMarker[] = [{ pos: sc(opts.value), kind: 'primary', label: fmt(opts.value) }]
  if (opts.cat?.median != null) markers.push({ pos: sc(opts.cat.median), kind: 'median', label: `med ${fmt(opts.cat.median)}` })
  if (opts.cat?.best != null) markers.push({ pos: sc(opts.cat.best), kind: 'best', label: `best ${fmt(opts.cat.best)}` })
  return {
    stops,
    markers,
    leftLabel: opts.leftLabel ?? 'Cat. lowest',
    rightLabel: opts.rightLabel ?? 'Cat. highest',
    pivotPos: 0.5,
    pivotLabel: fmt(pivot),
  }
}

/**
 * Category spectrum for a "lower is better" metric (volatility): domain is the
 * category [min,max], green at the LOW end. Markers: this fund, median, best
 * (best = lowest).
 */
export function lowerBetterSpectrum(opts: {
  value: number
  min: number
  max: number
  cat?: CategoryStats
  fmt?: (n: number) => string
  leftLabel?: string
  rightLabel?: string
}): SpectrumModel {
  const fmt = opts.fmt ?? ((n: number) => `${n.toFixed(1)}%`)
  const lo = Math.min(opts.min, opts.value)
  const hi = Math.max(opts.max, opts.value)
  const sc = (v: number) => linPos(v, lo, hi)
  const stops: SpectrumStop[] = [
    { pos: 0, color: SPECTRUM_GREEN },
    { pos: 0.5, color: SPECTRUM_AMBER },
    { pos: 1, color: SPECTRUM_RED },
  ]
  const markers: SpectrumMarker[] = [{ pos: sc(opts.value), kind: 'primary', label: fmt(opts.value) }]
  if (opts.cat?.median != null) markers.push({ pos: sc(opts.cat.median), kind: 'median', label: `med ${fmt(opts.cat.median)}` })
  if (opts.cat?.best != null) markers.push({ pos: sc(opts.cat.best), kind: 'best', label: `best ${fmt(opts.cat.best)}` })
  return { stops, markers, leftLabel: opts.leftLabel ?? 'Steadier', rightLabel: opts.rightLabel ?? 'Swingier' }
}

/** CSS linear-gradient string from position stops. */
export function gradientCss(stops: SpectrumStop[]): string {
  const parts = stops.map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}
