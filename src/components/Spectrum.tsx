import { gradientCss, type SpectrumModel } from '../lib/spectrum'

/**
 * Horizontal spectrum bar with marker(s). Two modes:
 *
 *  - MODEL mode (preferred): pass a `model` from lib/spectrum. The bar spans the
 *    metric's real scale and reads mobile-first, no legend-hunting:
 *      THIS FUND is a tone-coloured dot on the bar (green good, amber neutral,
 *      red poor). Its own value lives in the MetricCard header above, so it is
 *      not repeated here. The CATEGORY MEDIAN is a tick with "med <value>" on its
 *      own row. A GOOD-threshold pivot, when it falls inside the real range, is a
 *      dashed reference line (hover for its value).
 *    Labels sit on at most two short rows: the two endpoints share one baseline,
 *    each hugging its own edge so they can never collide; the median value gets
 *    a second row to itself. This holds down to ~150px width with no overlap.
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



function ModelSpectrum({ model, className }: { model: SpectrumModel; className?: string }) {
  const primary = model.markers.find((m) => m.kind === 'primary')
  const others = model.markers.filter((m) => m.kind !== 'primary')
  const tone = model.primaryTone ?? 'neutral'
  const primaryPos = primary ? cl01(primary.pos) : 0.5

  const hasEndValues = model.minLabel != null && model.maxLabel != null
  const medianMarker = others.find((m) => m.kind === 'median')

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

      {/* Row 1: endpoints only (left + right, flex justify-between) */}
      <div className="mt-1.5 flex justify-between text-[9px] leading-tight text-faint">
        <span>{hasEndValues ? model.minLabel + ' ' : ''}<span className="uppercase">{model.leftLabel}</span></span>
        <span className="text-right"><span className="uppercase">{model.rightLabel}</span>{hasEndValues ? ' ' + model.maxLabel : ''}</span>
      </div>
      {/* Row 2: median value, centred (plain flow, no absolute positioning) */}
      {medianMarker?.label && (
        <div className="text-center text-[9px] leading-tight text-muted">{medianMarker.label}</div>
      )}

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
      <div className="mt-1 flex justify-between text-xs font-medium uppercase tracking-wide text-faint">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      {caption && <p className="mt-1 text-xs text-muted">{caption}</p>}
    </div>
  )
}
