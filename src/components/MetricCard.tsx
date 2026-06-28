import InfoTip from './InfoTip'
import Spectrum from './Spectrum'
import type { SpectrumModel } from '../lib/spectrum'

interface Props {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'good' | 'bad' | 'warn'
  hint?: string
  note?: string
  subTone?: 'default' | 'good' | 'bad' | 'warn'
  /** Optional "where this sits vs peers" spectrum, shown under the value. */
  spectrum?: SpectrumModel
}

const toneClasses: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-fg',
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  warn: 'text-amber-600 dark:text-amber-400',
}

const subToneClasses: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-muted',
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  warn: 'text-amber-600 dark:text-amber-400',
}

const verdictTone: Record<string, string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  warn: 'text-amber-600 dark:text-amber-400',
  neutral: 'text-muted',
}

export default function MetricCard({ label, value, sub, tone = 'default', hint, note, subTone = 'default', spectrum }: Props) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-faint">
        {label}
        {hint && (
          <InfoTip width={240} label={`About ${label}`}>
            {hint}
          </InfoTip>
        )}
        {spectrum?.verdict && (
          <span className={`ml-auto text-[10px] font-semibold normal-case tracking-normal ${verdictTone[spectrum.glossTone ?? 'neutral']}`}>
            {spectrum.verdict}
          </span>
        )}
      </div>
      <div className={`mt-1 text-2xl font-bold ${toneClasses[tone]}`}>{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${subToneClasses[subTone]}`}>{sub}</div>}
      {spectrum && <Spectrum model={spectrum} />}
      {note && <div className="mt-1 text-[11px] leading-snug text-faint">{note}</div>}
    </div>
  )
}
