/**
 * Spectrum models - pure, testable helpers that turn a raw metric value into a
 * gradient + marker layout for the <Spectrum> component.
 *
 * DESIGN BAR (must hold for every model):
 *  1. The scale never lies. The bar's left and right edges are REAL values
 *     (exposed as `minLabel`/`maxLabel`), and every marker's position is that
 *     value's true linear position on that scale. If a fund is the category
 *     best, its marker sits at the right edge - never floating mid-bar under a
 *     "highest" label.
 *  2. Self-explanatory without reading prose. Every marker carries its own
 *     value: the fund (primary marker `label`), the category median (median
 *     marker `label`), and the "good ≥ pivot" reference (`pivotLabel`). The
 *     <Spectrum> component renders each value AT its marker, so the reader never
 *     has to hover or hunt in a legend. The bar's two ends print their real
 *     numeric values plus a one-word direction (e.g. "Worse – Better"), which
 *     replaces the old, uninformative "weakest peer / strongest peer" strings.
 *
 * Two flavours:
 *  - THRESHOLD bands (fixed 0..100 domain): colour changes at meaningful cut-offs
 *    so the green zone is only as wide as "good" actually is (skill, consistency).
 *    The ends are self-evident (0..100), so no numeric endpoint labels are set -
 *    only the direction words (leftLabel/rightLabel).
 *  - CATEGORY range (domain = real peer min..max): the bar spans the category's
 *    actual spread, so both ends are real peer values (set as minLabel/maxLabel)
 *    and the fund's marker shows its true rank among peers. A "good ≥ pivot"
 *    reference tick is drawn ONLY if the pivot falls within the real range.
 *
 * All functions are deterministic and side-effect free – unit-tested in qa_spectrum.
 */

export const SPECTRUM_RED = '#f43f5e'
export const SPECTRUM_AMBER = '#f59e0b'
export const SPECTRUM_GREEN = '#10b981'

export type Tone = 'good' | 'warn' | 'bad' | 'neutral'

export interface SpectrumStop {
  pos: number // 0..1
  color: string
}
export interface SpectrumMarker {
  pos: number // 0..1 (already scaled)
  kind: 'primary' | 'median' | 'best'
  label?: string // value shown AT the marker, e.g. "1.04", "med 0.70", "best 92%"
  tick?: boolean // render as a thin vertical tick rather than a dot
}
export interface SpectrumModel {
  stops: SpectrumStop[]
  markers: SpectrumMarker[]
  leftLabel: string
  rightLabel: string
  /** Real value at the bar's left edge (e.g. weakest peer), shown under the end. */
  minLabel?: string
  /** Real value at the bar's right edge (e.g. strongest peer), shown under the end. */
  maxLabel?: string
  pivotPos?: number // optional reference tick position (e.g. the "1.0 = good" line)
  pivotLabel?: string
  /** Render the primary (this-fund) marker as a caret + value ABOVE the bar. */
  primaryAbove?: boolean
  /** Tone for the primary marker + its value (good/bad/warn/neutral). */
  primaryTone?: Tone
  /** Plain-English "where it sits" line, shown under the bar (extra context). */
  gloss?: string
  glossTone?: Tone
  /** Short peer-comparison verdict (e.g. "Better than most peers"), shown in card header. */
  verdict?: string
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** Linear position of v in [min,max]. */
export function linPos(v: number, min: number, max: number): number {
  if (max === min) return 0.5
  return clamp01((v - min) / (max - min))
}

export interface CategoryStats {
  median?: number | null
  best?: number | null // "best" in the metric's good direction
}

/**
 * Threshold-band spectrum for a 0..100 confidence/percentage value where higher
 * is better. `lowMid` and `midHigh` are the red–amber and amber–green cut-offs.
 * The green band is only (100 - midHigh)% wide - small when the bar for "good"
 * is high (e.g. skill needs ≥90%), which is the honest signal.
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
  if (cat?.median != null) markers.push({ pos: p(cat.median), kind: 'median', label: `med ${fmt(cat.median)}`, tick: true })
  if (cat?.best != null) markers.push({ pos: p(cat.best), kind: 'best', label: `best ${fmt(cat.best)}`, tick: true })

  const primaryTone: Tone = value >= midHigh ? 'good' : value >= lowMid ? 'warn' : 'bad'
  const gloss =
    value >= midHigh
      ? `Strong. in the green zone (≥${fmt(midHigh)}).`
      : value >= lowMid
        ? `Middling. amber zone (${fmt(lowMid)}–${fmt(midHigh)}).`
        : `Weak. red zone (below ${fmt(lowMid)}).`
  // Fixed 0..100 domain – the ends are self-evident, so we don't print numeric
  // endpoint values; the direction words alone carry the meaning.
  return { stops, markers, leftLabel, rightLabel, primaryAbove: true, primaryTone, gloss, glossTone: primaryTone }
}

/**
 * Build the "where does it sit vs peers" gloss + tone for a category-range metric.
 * `higherBetter` flips the language (a high ratio is good; high volatility is bad).
 * The fund's OWN value is intentionally left out of the gloss. it is already shown
 * large in the card headline and again on the bar's caret. so we don't print the
 * same number three times. The category median (which is NOT shown elsewhere as a
 * sentence) is named so the comparison is concrete even in prose.
 */
function categoryGloss(
  value: number,
  stat: { min: number; max: number; median: number },
  fmt: (n: number) => string,
  higherBetter: boolean,
): { gloss: string; verdict: string; tone: Tone } {
  const { min, max, median } = stat
  const eps = 1e-9
  const med = fmt(median)
  const isTop = higherBetter ? value >= max - eps : value <= min + eps
  const isBottom = higherBetter ? value <= min + eps : value >= max - eps
  const beatsMedian = higherBetter ? value > median : value < median
  if (higherBetter) {
    if (isTop) return { gloss: `Above the category median (${med}).`, verdict: 'Best in category', tone: 'good' }
    if (isBottom) return { gloss: `Below the category median (${med}).`, verdict: 'Lowest in category', tone: 'bad' }
    if (beatsMedian) return { gloss: `Above the category median (${med}).`, verdict: 'Better than most peers', tone: 'good' }
    return { gloss: `Below the category median (${med}).`, verdict: 'Trails most peers', tone: 'warn' }
  }
  if (isTop) return { gloss: `Below the category median (${med}).`, verdict: 'Steadiest in category', tone: 'good' }
  if (isBottom) return { gloss: `Above the category median (${med}).`, verdict: 'Swingiest in category', tone: 'bad' }
  if (beatsMedian) return { gloss: `Below the category median (${med}).`, verdict: 'Steadier than most peers', tone: 'good' }
  return { gloss: `Above the category median (${med}).`, verdict: 'Swingier than most peers', tone: 'warn' }
}

/**
 * Category-range spectrum for a risk-adjusted ratio (Sharpe/Sortino/Calmar) where
 * HIGHER is better. The bar spans the category's REAL [min,max] (padded to include
 * this fund if it is an outlier), coloured worst–best (red–green). The fund's value
 * sits at its true position; the category median is a tick. A "good ≥ pivot" tick
 * (1.0 by default) is drawn ONLY if the pivot is within the real range, so we never
 * imply a green "good" zone that no peer actually reaches. The bar's ends carry the
 * real min/max peer values (minLabel/maxLabel).
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
  const median = opts.cat?.median ?? (opts.min + opts.max) / 2
  // Honest domain: the real peer range, widened only if THIS fund sits outside it.
  const lo = Math.min(opts.min, opts.value)
  const hi = Math.max(opts.max, opts.value)
  const sc = (v: number) => linPos(v, lo, hi)
  // Anchor the amber midpoint at the category median so colour = median-relative
  // quality: left of median reads red (worse half), right reads green (better
  // half). This keeps the dot's colour consistent with the value's tone.
  const medPos = clamp01(sc(median))
  const stops: SpectrumStop[] = [
    { pos: 0, color: SPECTRUM_RED },
    { pos: medPos, color: SPECTRUM_AMBER },
    { pos: 1, color: SPECTRUM_GREEN },
  ]
  const markers: SpectrumMarker[] = [{ pos: sc(opts.value), kind: 'primary', label: fmt(opts.value) }]
  if (opts.cat?.median != null) markers.push({ pos: sc(opts.cat.median), kind: 'median', label: `med ${fmt(opts.cat.median)}`, tick: true })

  const { gloss, verdict, tone } = categoryGloss(opts.value, { min: lo, max: hi, median }, fmt, true)
  // primary tone: absolute quality (negative is bad, ≥pivot is good) so the caret
  // colour carries the absolute read even when the bar shows peer ranking.
  const relPos = sc(opts.value)
  const primaryTone: Tone = opts.value < 0 ? 'bad' : (opts.value >= pivot || relPos >= 0.75) ? 'good' : relPos >= 0.4 ? 'warn' : 'bad'

  const model: SpectrumModel = {
    stops,
    markers,
    leftLabel: opts.leftLabel ?? 'Worst',
    rightLabel: opts.rightLabel ?? 'Best',
    minLabel: fmt(lo),
    maxLabel: fmt(hi),
    primaryAbove: true,
    primaryTone,
    gloss,
    glossTone: tone,
    verdict,
  }
  // Draw the "good ≥ 1.0" reference only where it truly falls on the scale.
  if (pivot >= lo && pivot <= hi) {
    model.pivotPos = sc(pivot)
    model.pivotLabel = fmt(pivot)
  }
  return model
}

/**
 * Category-range spectrum for a "lower is better" metric (volatility): domain is
 * the real peer [min,max] (padded to include this fund), coloured green at the LOW
 * (steady) end – red at the high (swingy) end. Markers: this fund (caret) + median.
 * The bar's ends carry the real min/max peer values (minLabel/maxLabel).
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
  const median = opts.cat?.median ?? (opts.min + opts.max) / 2
  const lo = Math.min(opts.min, opts.value)
  const hi = Math.max(opts.max, opts.value)
  const sc = (v: number) => linPos(v, lo, hi)
  // Anchor the amber midpoint at the category median (Option A): left of median
  // = steadier-than-peers (green), right = swingier-than-peers (red). Keeps the
  // dot's colour consistent with the value's tone (above median = red).
  const medPos = clamp01(sc(median))
  const stops: SpectrumStop[] = [
    { pos: 0, color: SPECTRUM_GREEN },
    { pos: medPos, color: SPECTRUM_AMBER },
    { pos: 1, color: SPECTRUM_RED },
  ]
  const markers: SpectrumMarker[] = [{ pos: sc(opts.value), kind: 'primary', label: fmt(opts.value) }]
  if (opts.cat?.median != null) markers.push({ pos: sc(opts.cat.median), kind: 'median', label: `med ${fmt(opts.cat.median)}`, tick: true })

  const { gloss, verdict } = categoryGloss(opts.value, { min: lo, max: hi, median }, fmt, false)
  // Honor the established rule: below the category median = good (green),
  // above = bad (red). Keep the caret and its gloss tone identical so the
  // colour signal is never mixed (no amber caret over a red value).
  const eps = 1e-9
  const primaryTone: Tone =
    opts.value < median - eps ? 'good' : opts.value > median + eps ? 'bad' : 'neutral'

  return {
    stops,
    markers,
    leftLabel: opts.leftLabel ?? 'Steadiest',
    rightLabel: opts.rightLabel ?? 'Swingiest',
    minLabel: fmt(lo),
    maxLabel: fmt(hi),
    primaryAbove: true,
    primaryTone,
    gloss,
    glossTone: primaryTone,
    verdict,
  }
}

/** CSS linear-gradient string from position stops. */
export function gradientCss(stops: SpectrumStop[]): string {
  const parts = stops.map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}
