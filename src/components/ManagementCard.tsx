import { useNavigate } from 'react-router-dom'
import type { Fund } from '../types'
import { signedPct } from '../lib/format'

function signalStyle(signal?: string): { tone: string; ring: string } {
  switch (signal) {
    case 'Strong':
      return { tone: 'text-emerald-700 dark:text-emerald-300', ring: 'border-l-emerald-500' }
    case 'Solid':
      return { tone: 'text-emerald-600 dark:text-emerald-400', ring: 'border-l-emerald-400' }
    case 'Mixed':
      return { tone: 'text-amber-600 dark:text-amber-400', ring: 'border-l-amber-400' }
    case 'Limited evidence':
      return { tone: 'text-muted', ring: 'border-l-slate-300' }
    default:
      return { tone: 'text-faint', ring: 'border-l-slate-300' }
  }
}

export default function ManagementCard({ fund }: { fund: Fund }) {
  const navigate = useNavigate()
  const mgmt = fund.management
  if (!mgmt || !mgmt.available) {
    return (
      <div className="mt-6 card p-5">
        <h3 className="font-bold text-fg">Management</h3>
        <p className="mt-2 text-sm text-muted">
          Fund manager information isn’t available for this fund from public sources.
        </p>
      </div>
    )
  }

  const s = signalStyle(mgmt.signal)
  const tr = mgmt.trackRecord

  return (
    <div className={`mt-6 card border-l-4 ${s.ring} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-fg">Management quality</h3>
        <span className={`text-sm font-bold ${s.tone}`}>{mgmt.signal}</span>
      </div>

      <p className="mt-1 text-sm text-muted">{mgmt.note}</p>

      {/* Managers + tenure */}
      <div className="mt-4 space-y-3">
        {mgmt.managers?.map((m) => (
          <div key={m.name} className="rounded-xl border border-line bg-surface2/40 p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-fg">{m.name}</span>
              {m.sinceYears != null && (
                <span className="text-xs text-faint">{m.sinceYears} yrs on this fund</span>
              )}
            </div>
            {m.education && <div className="mt-1 text-xs text-muted">{m.education}</div>}
            {m.experience && <div className="mt-0.5 text-xs text-faint">{m.experience}</div>}
          </div>
        ))}
      </div>

      {/* Cross-fund track record */}
      {tr && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
            Track record across {tr.funds} fund{tr.funds === 1 ? '' : 's'} they manage ({tr.basis} basis)
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-surface2 p-2">
              <div className="text-xs text-faint">Median alpha</div>
              <div className={`font-bold ${tr.medianAlpha >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {signedPct(tr.medianAlpha)}/yr
              </div>
            </div>
            <div className="rounded-lg bg-surface2 p-2">
              <div className="text-xs text-faint">Beat category</div>
              <div className="font-bold text-fg">{Math.round(tr.beatRate * 100)}%</div>
            </div>
            <div className="rounded-lg bg-surface2 p-2">
              <div className="text-xs text-faint">Top-quartile</div>
              <div className="font-bold text-fg">{tr.topRankShare != null ? `${Math.round(tr.topRankShare * 100)}%` : '—'}</div>
            </div>
          </div>

          {tr.sampleFunds && tr.sampleFunds.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs text-faint">Their funds (peer-relative alpha):</div>
              <div className="flex flex-wrap gap-2">
                {tr.sampleFunds.map((sf) => (
                  <button
                    key={sf.code}
                    onClick={() => navigate(`/fund/${sf.code}`)}
                    className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs hover:border-brand-300"
                    title={sf.name}
                  >
                    <span className="text-muted">{sf.name.length > 26 ? sf.name.slice(0, 26) + '…' : sf.name}</span>{' '}
                    <span className={`font-semibold ${(sf.alpha ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {sf.alpha != null ? signedPct(sf.alpha) : '—'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        Forward-looking context, not a guarantee. We judge managers by how their <em>other</em> funds
        have done versus peers — a sign of repeatable skill — but past performance doesn’t assure future results.
      </p>
    </div>
  )
}
