interface Props {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'good' | 'bad' | 'warn'
  hint?: string
}

const toneClasses: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-fg',
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  warn: 'text-amber-600 dark:text-amber-400',
}

export default function MetricCard({ label, value, sub, tone = 'default', hint }: Props) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-faint">
        {label}
        {hint && (
          <span className="group relative cursor-help">
            <svg className="h-3.5 w-3.5 opacity-50" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-48 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-xs font-normal normal-case text-white shadow-lg group-hover:block dark:bg-slate-700">
              {hint}
            </span>
          </span>
        )}
      </div>
      <div className={`mt-1 text-2xl font-bold ${toneClasses[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}
