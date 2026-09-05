/**
 * Capital-gains tax strip shown on every fund detail page. Classifies the fund
 * (equity / debt / other) and shows the holding-period rules in plain language.
 * Presentational only - not tax advice.
 */
import type { Fund } from '../types'
import { taxInfo } from '../lib/tax'
import InfoTip from './InfoTip'

const RING: Record<string, string> = {
  equity: 'border-l-emerald-400',
  debt: 'border-l-slate-400',
  other: 'border-l-amber-400',
}

export default function TaxCard({ fund }: { fund: Fund }) {
  const t = taxInfo(fund)
  return (
    <div className={`mt-6 card border-l-4 ${RING[t.cls]} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-fg">Taxation</h3>
        <span className="text-xs font-semibold text-muted">{t.heading}</span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {t.rows.map((r) => (
          <div key={r.label} className="rounded-lg border border-line bg-surface2/40 p-3">
            <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-faint">
              <span>{r.label}</span>
              <InfoTip>{r.hint}</InfoTip>
            </div>
            <div className="mt-1 text-lg font-bold text-fg">{r.value}</div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-sm text-muted">{t.note}</p>

      {t.extras.length > 0 && (
        <ul className="mt-2 space-y-1">
          {t.extras.map((e, i) => (
            <li key={i} className="text-sm text-muted">
              <span className="text-brand-500">-</span> {e}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-faint">
        Rates exclude surcharge and cess and follow the Budget 2024 rules. Your actual liability depends on your
        holding period and the scheme&apos;s real allocation (hybrid, index and fund-of-fund schemes can differ).
        This is general information, not tax advice.
      </p>
    </div>
  )
}
