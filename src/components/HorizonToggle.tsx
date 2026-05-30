import type { Horizon } from '../types'

interface Props {
  value: Horizon
  onChange: (h: Horizon) => void
  available?: Horizon[]
}

const all: Horizon[] = ['1Y', '3Y', '5Y']

export default function HorizonToggle({ value, onChange, available }: Props) {
  const opts = available ?? all
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface2 p-1">
      {opts.map((h) => (
        <button
          key={h}
          onClick={() => onChange(h)}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            value === h ? 'bg-surface text-brand-700 shadow-sm dark:text-brand-300' : 'text-muted hover:text-fg'
          }`}
        >
          {h}
        </button>
      ))}
    </div>
  )
}
