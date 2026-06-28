import type { CSSProperties } from 'react'
import { gradientCss, type SpectrumModel } from '../lib/spectrum'

/**
 * Horizontal spectrum bar with marker(s). Two modes:
 *
 *  - MODEL mode (preferred): pass a `model` from lib/spectrum. The bar spans the
 *    metric's real scale; every marker shows ITS OWN value legibly, with no
 *    hovering and no legend-hunting:
 *      • THIS FUND — a tone-coloured caret on the bar, with its value printed in
 *        the same tone just ABOVE the caret (the hero read).
 *      • CATEGORY MEDIAN — a tick on the bar, with "med <value>" printed under it.
 *      • GOOD ≥ pivot — a dashed reference line, with "≥<value>" printed under it
 *        (drawn only when the pivot falls inside the real range).
 *    The bar's two ends print their REAL numeric values plus a one-word direction
 *    ("Worse → Better" / "Steadier → Swingier"), so the scale is self-describing.
 *    Below-bar value labels are laid out with a deterministic de-collision so they
 *    never overlap, even at ~150px mobile width.
 *
 *  - LEGACY mode: the old simple {value,leftLabel,rightLabel,gradient} API,
 *    kept so existing callers keep working (e.g. the running-hot z-score bar).
 */
export default function Spectrum(
  props:
    | { model: SpectrumModel; className?: string }
    | {
        value: number
        leftLabel: string
        rightLabel: string
        gradient?: 'rose-amber-emerald' | 'emerald-amber-rose'
        caption?: string
        markerLabel?: string
        className?: string
      },
) {
  if ('model' in props) return <ModelSpectrum model={props.model} className={props.className} />
  return <LegacySpectrum {...props} />
}

const TONE_CARET: Record<string, string> = {
  good: 'border-t-emerald-600',
  warn: 'border-t-amber-500',
  bad: 'border-t-rose-600',
  neutral: 'border-t-fg',
}

const cl01 = (x: number) => Math.max(0, Math.min(1, x))

/** Horizontal anchoring for a label centred on `pos`, clamped so it never clips
 *  off either card edge: hug-left near 0, hug-right near 1, else centre. */
function anchor(pos: number): CSSProperties {
  const left = `${cl01(pos) * 100}%`
  if (pos <= 0.12) return { left, transform: 'translateX(0)', textAlign: 'left' }
  if (pos >= 0.88) return { left, transform: 'translateX(-100%)', textAlign: 'right' }
  return { left, transform: 'translateX(-50%)', textAlign: 'center' }
}

interface BelowLabel {
  pos: number
  text: string
  cls: string
  title?: string
}

/**
 * Assign each below-bar value label to a "lane" (stacked row) so no two labels
 * overlap horizontally. Greedy left-to-right; a label that can't fit on an
 * existing lane drops to a new one. Widths are estimated for the TIGHTEST bar
 * (~150px mobile) so the layout is collision-free at every width. Pure function.
 */
const LANE_BAR_PX = 150
const LANE_CHAR_PX = 7
const LANE_GAP = 0.06
function layoutLanes(items: BelowLabel[]): { lane: number; lanes: number; placed: { item: BelowLabel; lane: number }[] } {
  const order = items.map((item, i) => ({ item, i })).sort((a, b) => a.item.pos - b.item.pos)
  const laneRightEdge: number[] = []
  const placed: { item: BelowLabel; lane: number }[] = []
  for (const { item } of order) {
    const halfW = (item.text.length * LANE_CHAR_PX) / LANE_BAR_PX / 2
    const leftEdge = item.pos - halfW
    let lane = laneRightEdge.findIndex((r) => leftEdge >= r + LANE_GAP)
    if (lane === -1) {
      lane = laneRightEdge.length
      laneRightEdge.push(0)
    }
    laneRightEdge[lane] = item.pos + halfW
    placed.push({ item, lane })
  }
  return { lane: 0, lanes: Math.max(1, laneRightEdge.length), placed }
}

const LANE_H = 14 // px per stacked label line

function ModelSpectrum({ model, className }: { model: SpectrumModel; className?: string }) {
  const primary = model.markers.find((m) => m.kind === 'primary')
  const others = model.markers.filter((m) => m.kind !== 'primary')
  const tone = model.primaryTone ?? 'neutral'
  const primaryPos = primary ? cl01(primary.pos) : 0.5
  const medianMarker = others.find((m) => m.kind === 'median')

  const hasEndValues = model.minLabel != null && model.maxLabel != null

  return (
    <div className={`mt-2 ${className ?? ''}`}>
      {/* The bar with gradient, ticks, and caret */}
      <div className="relative h-2.5 w-full rounded-full" style={{ background: gradientCss(model.stops) }}>
        {/* pivot reference (dashed line) */}
        {model.pivotPos != null && (
          <div
            className="absolute top-1/2 h-3.5 w-0 -translate-x-1/2 -translate-y-1/2 border-l border-dashed border-fg/40 dark:border-white/40"
            style={{ left: `${model.pivotPos * 100}%` }}
            title={model.pivotLabel ? `Good ≥ ${model.pivotLabel}` : undefined}
          />
        )}
        {/* category median/best ticks */}
        {others.map((m, i) => (
          <div
            key={i}
            className="absolute top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-slate-600/70 dark:bg-slate-300/70"
            style={{ left: `${cl01(m.pos) * 100}%` }}
            title={m.label}
          />
        ))}
        {/* This fund: tone-coloured dot on the bar */}
        {primary && (
          <div
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm dark:border-slate-900 ${
              tone === 'good' ? 'bg-emerald-500' : tone === 'bad' ? 'bg-rose-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-slate-500'
            }`}
            style={{ left: `${primaryPos * 100}%` }}
            aria-label={`This fund: ${primary.label}`}
          />
        )}
      </div>

      {/* Compact annotation line below bar */}
      <div className="mt-1.5 flex items-center justify-between text-[9px] leading-tight text-faint">
        <span>{hasEndValues ? model.minLabel : ''} <span className="uppercase">{model.leftLabel}</span></span>
        {medianMarker && (
          <span className="text-muted">{medianMarker.label}</span>
        )}
        <span><span className="uppercase">{model.rightLabel}</span> {hasEndValues ? model.maxLabel : ''}</span>
      </div>

      {/* Verdict moved to MetricCard header; gloss hidden to save space */}
    </div>
  )
}

function LegacySpectrum({
  value,
  leftLabel,
  rightLabel,
  gradient = 'rose-amber-emerald',
  caption,
  markerLabel,
}: {
  value: number
  leftLabel: string
  rightLabel: string
  gradient?: 'rose-amber-emerald' | 'emerald-amber-rose'
  caption?: string
  markerLabel?: string
}) {
  const clamped = Math.max(0, Math.min(1, value))
  const grad =
    gradient === 'emerald-amber-rose'
      ? 'linear-gradient(90deg,#10b981 0%,#f59e0b 55%,#f43f5e 100%)'
      : 'linear-gradient(90deg,#f43f5e 0%,#f59e0b 45%,#10b981 100%)'
  return (
    <div className="mt-2">
      <div className="relative h-2.5 w-full rounded-full" style={{ background: grad }}>
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-fg shadow dark:border-slate-900"
          style={{ left: `${clamped * 100}%` }}
          title={markerLabel}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-medium uppercase tracking-wide text-faint">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      {caption && <p className="mt-1 text-xs text-muted">{caption}</p>}
    </div>
  )
}
