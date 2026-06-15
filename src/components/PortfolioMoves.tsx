/**
 * Portfolio changes section: shows what the manager ADDED and EXITED between
 * two monthly portfolio snapshots, and how those stocks performed AFTER the move.
 *
 * Designed to grow more useful over time: with only 1-month of post-move data it
 * shows honest caveats; with 3+ months it shows confident verdicts. The data
 * pipeline (build_stock_moves.py) runs monthly and accumulates longer windows.
 */
import type { Fund } from '../types'
import InfoTip from './InfoTip'

function fmtMonth(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

const VERDICT_STYLE: Record<string, { tone: string; bg: string }> = {
  'Smart moves': { tone: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  'Mixed moves': { tone: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20' },
  'Questionable moves': { tone: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-50 dark:bg-rose-900/20' },
  'Insufficient price data': { tone: 'text-faint', bg: 'bg-surface2' },
}

export default function PortfolioMoves({ fund }: { fund: Fund }) {
  const moves = fund.stockMoves
  if (!moves) return null
  if (!moves.added.length && !moves.exited.length) return null

  const vs = VERDICT_STYLE[moves.verdict ?? ''] ?? VERDICT_STYLE['Insufficient price data']
  const hasScore = moves.smartScore != null && moves.smartBasis != null && moves.smartBasis >= 3

  // Determine how long the post-move window is (from toDate to today, roughly)
  const toDate = new Date(moves.toDate + 'T00:00:00')
  const now = new Date()
  const postMonths = Math.max(1, Math.round((now.getTime() - toDate.getTime()) / (30.4 * 86400000)))
  const shortWindow = postMonths <= 2

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-bold text-fg">
          Portfolio changes
          <InfoTip align="left" width={280} label="About portfolio changes">
            Between two monthly portfolio disclosures, we identify what stocks the manager
            <strong> added</strong> (new positions) and <strong>exited</strong> (removed), then track
            how those stocks performed AFTER the move using NSE price data. A high "smart score" means
            most adds went up and most exits went down — the manager's stock-picking added value.
            {shortWindow && (
              <><br /><br /><em>Note:</em> only ~{postMonths} month(s) of post-move data so far. The
              verdict becomes more reliable with 3-6 months of follow-through.</>
            )}
          </InfoTip>
        </h3>
        {hasScore && (
          <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${vs.tone} ${vs.bg}`}>
            {moves.verdict} ({moves.smartScore}%)
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-muted">
        Changes between {fmtMonth(moves.fromDate)} and {fmtMonth(moves.toDate)} disclosures.
        {hasScore && ` Post-move returns tracked for ~${postMonths} month${postMonths > 1 ? 's' : ''} since.`}
        {!hasScore && ' Post-move returns not yet available for enough stocks to score.'}
      </p>

      {shortWindow && hasScore && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          Only ~{postMonths} month of post-move data — treat this as a preliminary read, not a final verdict.
          It becomes more meaningful after 3+ months.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 overflow-hidden">
        {/* Stocks ADDED */}
        {moves.added.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Added ({moves.added.length})
            </div>
            <div className="space-y-1.5">
              {moves.added.filter(s => s.name).slice(0, 7).map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-line bg-surface2/40 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-fg">{s.name}</div>
                    {s.ticker && <div className="text-[10px] text-faint">{s.ticker} · {s.pct.toFixed(1)}% weight</div>}
                    {!s.ticker && <div className="text-[10px] text-faint">{s.pct.toFixed(1)}% weight</div>}
                  </div>
                  {s.postReturn != null ? (
                    <span className={`ml-2 whitespace-nowrap text-xs font-bold ${s.postReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {s.postReturn >= 0 ? '+' : ''}{s.postReturn.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="ml-2 text-[10px] text-faint">no price</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stocks EXITED */}
        {moves.exited.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
              Exited ({moves.exited.length})
            </div>
            <div className="space-y-1.5">
              {moves.exited.filter(s => s.name).slice(0, 7).map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-line bg-surface2/40 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-fg">{s.name}</div>
                    {s.ticker && <div className="text-[10px] text-faint">{s.ticker} · was {s.pct.toFixed(1)}%</div>}
                    {!s.ticker && <div className="text-[10px] text-faint">was {s.pct.toFixed(1)}%</div>}
                  </div>
                  {s.postReturn != null ? (
                    <span className={`ml-2 whitespace-nowrap text-xs font-bold ${s.postReturn <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {s.postReturn >= 0 ? '+' : ''}{s.postReturn.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="ml-2 text-[10px] text-faint">no price</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-faint">
        Post-move returns from NSE daily close prices (Yahoo Finance). "Smart score" = % of moves where
        adds went up and exits went down. Not a guarantee of future stock-picking ability.
      </p>
    </div>
  )
}
