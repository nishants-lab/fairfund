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

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 font-bold text-fg">
          Price moves after disclosure
          <InfoTip align="left" width={280} label="About portfolio changes">
            Monthly disclosures identify newly disclosed and removed holdings. Price changes use monthly
            price points around the disclosure month. Actual trade dates and execution prices are unavailable.
            Coverage is capped at ten additions and ten exits; up to seven of each are displayed below.
            Favourable means a newly disclosed holding rose, or a removed holding fell or stayed flat.
            This is an unweighted price-direction count.
          </InfoTip>
        </h3>
        {hasScore && (
          <span className={`rounded-lg px-2.5 py-1 text-xs font-bold ${vs.tone} ${vs.bg}`}>
            {moves.smartScore}% favourable price moves
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-muted">
        Changes between {fmtMonth(moves.fromDate)} and {fmtMonth(moves.toDate)} disclosures.
        {!hasScore && ' Price data is unavailable for enough positions to calculate the summary.'}
      </p>
      <p className="mt-1 text-xs text-muted">
        {hasScore && `Based on ${moves.smartBasis} positions with price data. `}
        Price direction does not measure the contribution to the fund's return.
      </p>
      <p className="mt-1 text-xs text-faint">
        Price-period endpoints and the last price date are unavailable in the current dataset.
        Disclosure dates do not establish price coverage or actual trade dates.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Stocks ADDED */}
        {moves.added.length > 0 && (
          <div className="min-w-0">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              Added ({moves.added.length})
            </div>
            <div className="space-y-1.5">
              {moves.added.filter(s => s.name).slice(0, 7).map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-line bg-surface2/40 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-fg">{s.name}</div>
                    {s.ticker && <div className="text-xs text-faint">{s.ticker} · {s.pct.toFixed(1)}% weight</div>}
                    {!s.ticker && <div className="text-xs text-faint">{s.pct.toFixed(1)}% weight</div>}
                  </div>
                  {s.postReturn != null ? (
                    <span className={`ml-2 whitespace-nowrap text-xs font-bold ${s.postReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {s.postReturn >= 0 ? '+' : ''}{s.postReturn.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-faint">no price</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stocks EXITED */}
        {moves.exited.length > 0 && (
          <div className="min-w-0">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
              Exited ({moves.exited.length})
            </div>
            <div className="space-y-1.5">
              {moves.exited.filter(s => s.name).slice(0, 7).map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-line bg-surface2/40 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-fg">{s.name}</div>
                    {s.ticker && <div className="text-xs text-faint">{s.ticker} · was {s.pct.toFixed(1)}%</div>}
                    {!s.ticker && <div className="text-xs text-faint">was {s.pct.toFixed(1)}%</div>}
                  </div>
                  {s.postReturn != null ? (
                    <span className={`ml-2 whitespace-nowrap text-xs font-bold ${s.postReturn <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {s.postReturn >= 0 ? '+' : ''}{s.postReturn.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="ml-2 text-xs text-faint">no price</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-faint">
        Price changes use monthly stock-price data from Yahoo Finance.
        Past price movements do not guarantee future returns.
      </p>
    </div>
  )
}
