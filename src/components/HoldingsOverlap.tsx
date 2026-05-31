import { useMemo } from 'react'
import type { Fund } from '../types'
import { computeOverlap } from '../lib/overlap'

// Must match the Compare page's series palette (supports up to 5 funds).
const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']

function shortName(f: Fund): string {
  // first 2-3 words for compact headers
  return f.name.split(' ').slice(0, 3).join(' ')
}

function overlapTone(pct: number): string {
  if (pct >= 50) return 'text-rose-600 dark:text-rose-400'
  if (pct >= 25) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function overlapVerdict(pct: number): string {
  if (pct >= 50) return 'High overlap - these funds largely duplicate each other.'
  if (pct >= 25) return 'Moderate overlap - meaningful shared exposure.'
  if (pct > 0) return 'Low overlap - mostly complementary holdings.'
  return 'No shared stock-level holdings.'
}

export default function HoldingsOverlap({ funds }: { funds: Fund[] }) {
  const overlap = useMemo(() => computeOverlap(funds), [funds])
  const usableCount = overlap.hasData.filter(Boolean).length

  if (funds.length < 2) return null

  // Funds without usable holdings (feeders / unresolved) - call out honestly.
  const noData = funds.filter((_, i) => !overlap.hasData[i])

  return (
    <div className="mt-6 card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-bold text-fg">Portfolio overlap</h3>
        <span className="text-xs text-faint">Based on latest disclosed holdings</span>
      </div>
      <p className="mb-3 text-xs text-muted">
        Overlap = sum of the smaller weight on each shared holding. 0% means no common stocks; high
        overlap means you’re buying similar exposure twice (less diversification than it looks).
      </p>

      {noData.length > 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {noData.map((f) => f.name).join(', ')} {noData.length === 1 ? 'does' : 'do'} not disclose
          stock-level holdings (likely overseas feeder funds), so {noData.length === 1 ? 'it is' : 'they are'}{' '}
          excluded from the overlap math.
        </p>
      )}

      {usableCount < 2 ? (
        <div className="rounded-xl bg-surface2 p-4 text-center text-sm text-muted">
          Need at least two funds with stock-level holdings to compute overlap.
        </div>
      ) : (
        <>
          {/* Pairwise overlap cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {funds.map((a, i) =>
              funds.slice(i + 1).map((b, jOffset) => {
                const j = i + 1 + jOffset
                if (!overlap.hasData[i] || !overlap.hasData[j]) return null
                const ov = overlap.pairOverlap[i][j]
                return (
                  <div key={`${a.code}-${b.code}`} className="rounded-xl border border-line bg-surface2/40 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                      <span className="truncate">{shortName(a)}</span>
                      <span className="text-faint">×</span>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[j] }} />
                      <span className="truncate">{shortName(b)}</span>
                    </div>
                    <div className={`mt-1 text-2xl font-extrabold ${overlapTone(ov)}`}>{ov.toFixed(1)}%</div>
                    <div className="text-xs text-faint">{overlapVerdict(ov)}</div>
                  </div>
                )
              }),
            )}
          </div>

          {/* Shared holdings table */}
          {overlap.shared.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm" style={{ minWidth: 320 + funds.length * 90 }}>
                <thead>
                  <tr className="border-b border-line bg-surface2 text-xs uppercase tracking-wide text-faint">
                    <th className="px-3 py-2 text-left">Shared holding</th>
                    {funds.map((f, i) =>
                      overlap.hasData[i] ? (
                        <th key={f.code} className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                            <span className="max-w-[80px] truncate">{shortName(f)}</span>
                          </div>
                        </th>
                      ) : null,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {overlap.shared.slice(0, 20).map((s) => (
                    <tr key={s.name} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium text-fg">{s.name}</div>
                        {s.sector && <div className="text-xs text-faint">{s.sector}</div>}
                      </td>
                      {funds.map((f, i) =>
                        overlap.hasData[i] ? (
                          <td key={f.code} className="px-3 py-2 text-right tabular-nums">
                            {s.weights[i] !== null ? (
                              <span className="font-semibold text-fg">{(s.weights[i] as number).toFixed(2)}%</span>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </td>
                        ) : null,
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-surface2 p-4 text-center text-sm text-muted">
              These funds share no common holdings in their latest disclosures - fully complementary.
            </div>
          )}
          {overlap.shared.length > 20 && (
            <p className="mt-2 text-xs text-faint">Showing the 20 largest shared positions of {overlap.shared.length}.</p>
          )}
        </>
      )}
    </div>
  )
}
