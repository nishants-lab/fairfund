import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Fund, ManagerInfo } from '../types'
import { signedPct, fundSlug } from '../lib/format'

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

/** Background detail for one manager, opened from the compact name row. */
function ManagerModal({ m, onClose }: { m: ManagerInfo; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={m.name}
        className="relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-3xl bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-lg font-bold text-fg">{m.name}</h4>
            {m.sinceYears != null && (
              <div className="mt-0.5 text-xs text-faint">
                {m.sinceYears} {m.sinceYears === 1 ? 'yr' : 'yrs'} managing this fund
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-faint hover:bg-surface2 hover:text-fg"
          >
            &#10005;
          </button>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          {m.education && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">Education</div>
              <p className="mt-0.5 leading-relaxed text-muted">{m.education}</p>
            </div>
          )}
          {m.experience && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-faint">Experience</div>
              <p className="mt-0.5 leading-relaxed text-muted">{m.experience}</p>
            </div>
          )}
          {!m.education && !m.experience && (
            <p className="text-muted">No background details available from public sources.</p>
          )}
        </div>
      </div>
    </div>
  )
}

const CHIP_LIMIT = 6

export default function ManagementCard({ fund }: { fund: Fund }) {
  const navigate = useNavigate()
  const [openMgr, setOpenMgr] = useState<ManagerInfo | null>(null)
  const [allChips, setAllChips] = useState(false)
  const mgmt = fund.management

  if (!mgmt || !mgmt.available) {
    return (
      <div className="mt-6 card p-5">
        <h3 className="font-bold text-fg">Management</h3>
        <p className="mt-2 text-sm text-muted">
          Fund manager information isn't available for this fund from public sources.
        </p>
      </div>
    )
  }

  const s = signalStyle(mgmt.signal)
  const tr = mgmt.trackRecord
  const managers = mgmt.managers ?? []
  const anyBio = managers.some((m) => m.education || m.experience)
  const chips = tr?.sampleFunds ?? []
  const shownChips = allChips ? chips : chips.slice(0, CHIP_LIMIT)

  return (
    <div className={`mt-6 card border-l-4 ${s.ring} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-fg">Management quality</h3>
        <span className={`text-sm font-bold ${s.tone}`}>{mgmt.signal}</span>
      </div>

      <p className="mt-1 text-sm text-muted">{mgmt.note}</p>

      {/* Managers: one compact row each; background lives in a modal */}
      {managers.length > 0 && (
        <div className="mt-4 divide-y divide-line rounded-xl border border-line">
          {managers.map((m) => {
            const hasBio = !!(m.education || m.experience)
            return (
              <div key={m.name} className="flex items-center justify-between gap-3 px-3 py-2">
                {hasBio ? (
                  <button
                    onClick={() => setOpenMgr(m)}
                    className="text-left text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400"
                  >
                    {m.name}
                  </button>
                ) : (
                  <span className="text-sm font-semibold text-fg">{m.name}</span>
                )}
                {m.sinceYears != null && (
                  <span className="shrink-0 text-xs text-faint">
                    {m.sinceYears} {m.sinceYears === 1 ? 'yr' : 'yrs'} here
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {anyBio && <p className="mt-1.5 text-xs text-faint">Tap a name for their background.</p>}

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
              <div className="text-xs text-faint">Beat their category</div>
              <div className={`font-bold ${tr.beatRate >= 0.6 ? 'text-emerald-600 dark:text-emerald-400' : tr.beatRate >= 0.4 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {Math.round(tr.beatRate * 100)}%
              </div>
              <div className="mt-0.5 text-xs text-faint">of their funds</div>
            </div>
            <div className="rounded-lg bg-surface2 p-2">
              <div className="text-xs text-faint">In category top 25%</div>
              <div className={`font-bold ${tr.topRankShare == null ? 'text-faint' : tr.topRankShare >= 0.5 ? 'text-emerald-600 dark:text-emerald-400' : tr.topRankShare > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {tr.topRankShare != null ? `${Math.round(tr.topRankShare * 100)}%` : '—'}
              </div>
              <div className="mt-0.5 text-xs text-faint">of their funds</div>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-xs text-faint">Their funds (peer-relative alpha):</div>
              <div className="flex flex-wrap gap-2">
                {shownChips.map((sf) => (
                  <button
                    key={sf.code}
                    onClick={() => navigate(`/fund/${sf.code}/${fundSlug(sf.name)}`)}
                    className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs hover:border-brand-300"
                    title={sf.name}
                  >
                    <span className="text-muted">{sf.name.length > 26 ? sf.name.slice(0, 26) + '…' : sf.name}</span>{' '}
                    <span className={`font-semibold ${(sf.alpha ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {sf.alpha != null ? signedPct(sf.alpha) : '—'}
                    </span>
                  </button>
                ))}
                {chips.length > CHIP_LIMIT && (
                  <button
                    onClick={() => setAllChips((v) => !v)}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
                  >
                    {allChips ? 'Show fewer' : `+${chips.length - CHIP_LIMIT} more`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        Forward-looking context, not a guarantee. We judge managers by how their <em>other</em> funds have
        done versus peers, but past performance doesn't assure future results.
      </p>

      {openMgr && <ManagerModal m={openMgr} onClose={() => setOpenMgr(null)} />}
    </div>
  )
}
