import { gradientCss, type SpectrumModel } from '../lib/spectrum'

/**
 * Horizontal spectrum bar with marker(s). Two modes:
 *
 *  - MODEL mode (preferred): pass a `model` from lib/spectrum with custom colour
 *    stops, an optional centre pivot tick, and up to three markers (this fund,
 *    category median, category best). The green band is only as wide as "good"
 *    actually is, so a so-so value doesn't sit on green.
 *
 *  - LEGACY mode: the old simple {value,leftLabel,rightLabel,gradient} API,
 *    kept so existing callers keep working.
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

const MARKER_STYLE: Record<string, string> = {
  primary: 'h-4 w-4 border-2 border-white bg-fg dark:border-slate-900 z-20',
  median: 'h-3 w-3 border-2 border-white bg-slate-500 dark:border-slate-900 z-10',
  best: 'h-3 w-3 border-2 border-white bg-brand-600 dark:border-slate-900 z-10',
}

const TONE_TEXT: Record<string, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-fg',
}
const TONE_PILL: Record<string, string> = {
  good: 'bg-emerald-600 text-white',
  warn: 'bg-amber-500 text-white',
  bad: 'bg-rose-600 text-white',
  neutral: 'bg-fg text-canvas',
}
const TONE_CARET: Record<string, string> = {
  good: 'border-t-emerald-600',
  warn: 'border-t-amber-500',
  bad: 'border-t-rose-600',
  neutral: 'border-t-fg',
}

function ModelSpectrum({ model, className }: { model: SpectrumModel; className?: string }) {
  const primary = model.markers.find((m) => m.kind === 'primary')
  const others = model.markers.filter((m) => m.kind !== 'primary')
  const tone = model.primaryTone ?? 'neutral'
  const primaryPos = primary ? Math.max(0, Math.min(1, primary.pos)) : 0.5

  return (
    <div className={`mt-2 ${className ?? ''}`}>
      {/* Floating value pill on the fund's marker — so "where this fund sits" is
          legible at a glance with zero reading. Positioned over the caret. */}
      {model.primaryAbove && primary && (
        <div className="relative h-5">
          <div className="absolute -translate-x-1/2" style={{ left: `${primaryPos * 100}%` }}>
            <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${TONE_PILL[tone]}`}>
              {primary.label}
            </span>
          </div>
        </div>
      )}

      <div className="relative h-2.5 w-full rounded-full" style={{ background: gradientCss(model.stops) }}>
        {/* "good ≥ pivot" reference tick — drawn only when it falls on the real scale */}
        {model.pivotPos != null && (
          <div
            className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-fg/40 dark:bg-white/40"
            style={{ left: `${model.pivotPos * 100}%` }}
            title={model.pivotLabel ? `Good ≈ ${model.pivotLabel}` : undefined}
          />
        )}
        {/* category median / best as thin labelled ticks (secondary) */}
        {others.map((m, i) => (
          <div
            key={i}
            className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-slate-500/80 dark:bg-slate-300/70"
            style={{ left: `${Math.max(0, Math.min(1, m.pos)) * 100}%` }}
            title={m.label}
          />
        ))}
        {/* THIS FUND — an unmistakable downward caret sitting on the bar */}
        {model.primaryAbove && primary && (
          <div
            className={`absolute -top-1.5 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent ${TONE_CARET[tone]}`}
            style={{ left: `${primaryPos * 100}%` }}
            aria-label={`This fund: ${primary.label}`}
          />
        )}
        {/* fallback: if not using the caret style, render the old primary dot */}
        {!model.primaryAbove &&
          model.markers.map((m, i) => (
            <div
              key={i}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow ${MARKER_STYLE[m.kind]}`}
              style={{ left: `${Math.max(0, Math.min(1, m.pos)) * 100}%` }}
              title={m.label}
            />
          ))}
      </div>

      <div className="mt-1 flex justify-between text-[10px] font-medium uppercase tracking-wide text-faint">
        <span>{model.leftLabel}</span>
        <span>{model.rightLabel}</span>
      </div>

      {/* one-line plain-English placement */}
      {model.gloss && (
        <p className={`mt-1.5 text-xs font-medium ${TONE_TEXT[model.glossTone ?? 'neutral']}`}>{model.gloss}</p>
      )}
      {/* compact secondary legend (median / best ticks) */}
      {others.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-faint">
          {others.map((m, i) => {
            const name = m.kind === 'best' ? 'Category best' : 'Category median'
            return (
              <span key={i} className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-[3px] rounded-sm bg-slate-500/80 dark:bg-slate-300/70" />
                {name}{m.label ? ` (${m.label.replace(/^(med|best)\s/, '')})` : ''}
              </span>
            )
          })}
        </div>
      )}
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
