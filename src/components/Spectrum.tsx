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

function ModelSpectrum({ model, className }: { model: SpectrumModel; className?: string }) {
  return (
    <div className={`mt-2 ${className ?? ''}`}>
      <div className="relative h-2.5 w-full rounded-full" style={{ background: gradientCss(model.stops) }}>
        {/* optional pivot tick (e.g. the "1.0 = good" line) */}
        {model.pivotPos != null && (
          <div
            className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-fg/40 dark:bg-white/40"
            style={{ left: `${model.pivotPos * 100}%` }}
            title={model.pivotLabel ? `Good ≈ ${model.pivotLabel}` : undefined}
          />
        )}
        {model.markers.map((m, i) => (
          <div
            key={i}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full shadow ${MARKER_STYLE[m.kind]}`}
            style={{ left: `${m.pos * 100}%` }}
            title={m.label}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-medium uppercase tracking-wide text-faint">
        <span>{model.leftLabel}</span>
        <span>{model.rightLabel}</span>
      </div>
      {/* marker legend - only shows the named markers (this fund / median / best) */}
      {model.markers.some((m) => m.kind !== 'primary' && m.label) && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-faint">
          {model.markers.map((m, i) => {
            const dot =
              m.kind === 'primary' ? 'bg-fg dark:bg-white' : m.kind === 'best' ? 'bg-brand-600' : 'bg-slate-500'
            const name = m.kind === 'primary' ? 'This fund' : m.kind === 'best' ? 'Category best' : 'Category median'
            return (
              <span key={i} className="inline-flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                {name}{m.label ? ` (${m.label})` : ''}
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
