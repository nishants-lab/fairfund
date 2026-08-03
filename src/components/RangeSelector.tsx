import { useMemo } from 'react'
import { presetRange, fmtDate } from '../lib/metrics'

export type Preset = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | '5Y' | 'MAX' | 'CUSTOM'

interface Props {
  earliest: string
  latest: string
  start: string
  end: string
  onChange: (start: string, end: string, preset: Preset) => void
  activePreset: Preset
}

const PRESETS: Preset[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'MAX']

export default function RangeSelector({ earliest, latest, start, end, onChange, activePreset }: Props) {
  // Convert dates to slider positions (days since earliest)
  const earliestMs = new Date(earliest).getTime()
  const latestMs = new Date(latest).getTime()
  const totalDays = Math.max(1, Math.round((latestMs - earliestMs) / 86400000))

  const startPos = useMemo(
    () => Math.round((new Date(start).getTime() - earliestMs) / 86400000),
    [start, earliestMs],
  )
  const endPos = useMemo(
    () => Math.round((new Date(end).getTime() - earliestMs) / 86400000),
    [end, earliestMs],
  )

  function posToISO(pos: number): string {
    const d = new Date(earliestMs + pos * 86400000)
    return d.toISOString().slice(0, 10)
  }

  function setPreset(p: Preset) {
    if (p === 'CUSTOM') return
    const [s, e] = presetRange(p as Exclude<Preset, 'CUSTOM'>, earliest, latest)
    onChange(s, e, p)
  }

  function onStartSlider(v: number) {
    const clamped = Math.min(v, endPos - 5)
    onChange(posToISO(Math.max(0, clamped)), end, 'CUSTOM')
  }
  function onEndSlider(v: number) {
    const clamped = Math.max(v, startPos + 5)
    onChange(start, posToISO(Math.min(totalDays, clamped)), 'CUSTOM')
  }

  const leftPct = (startPos / totalDays) * 100
  const rightPct = (endPos / totalDays) * 100

  return (
    <div className="card p-4">
      {/* Preset chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
              activePreset === p
                ? 'bg-brand-600 text-white'
                : 'bg-surface2 text-muted hover:text-fg'
            }`}
          >
            {p}
          </button>
        ))}
        <span
          className={`ml-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${
            activePreset === 'CUSTOM' ? 'bg-accent text-white' : 'text-faint'
          }`}
        >
          {activePreset === 'CUSTOM' ? 'Custom' : ''}
        </span>
      </div>

      {/* Dual-range slider */}
      <div className="relative mt-5 px-1">
        <div className="relative h-1.5 rounded-full bg-surface2">
          <div
            className="absolute h-1.5 rounded-full bg-brand-500"
            style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
          />
        </div>
        {/* Two overlaid range inputs */}
        <input
          type="range"
          min={0}
          max={totalDays}
          value={startPos}
          onChange={(e) => onStartSlider(Number(e.target.value))}
          className="pointer-events-none absolute -top-1.5 left-0 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto"
          style={{ background: 'transparent' }}
          aria-label="Start date"
        />
        <input
          type="range"
          min={0}
          max={totalDays}
          value={endPos}
          onChange={(e) => onEndSlider(Number(e.target.value))}
          className="pointer-events-none absolute -top-1.5 left-0 h-5 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto"
          style={{ background: 'transparent' }}
          aria-label="End date"
        />
      </div>

      {/* Explicit date inputs */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-faint">From</span>
          <input
            type="date"
            min={earliest}
            max={end}
            value={start}
            onChange={(e) => onChange(e.target.value, end, 'CUSTOM')}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-fg"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-faint">To</span>
          <input
            type="date"
            min={start}
            max={latest}
            value={end}
            onChange={(e) => onChange(start, e.target.value, 'CUSTOM')}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-fg"
          />
        </div>
        <span className="ml-auto text-xs text-faint">
          {fmtDate(start)} – {fmtDate(end)}
        </span>
      </div>
    </div>
  )
}
