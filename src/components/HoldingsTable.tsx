import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Fund } from '../types'
import { fmtDate } from '../lib/metrics'

function coverageLabel(cov?: string): { text: string; tone: string } {
  switch (cov) {
    case 'stock_level':
      return { text: 'Stock-level disclosure', tone: 'text-emerald-600 dark:text-emerald-400' }
    case 'lookthrough_domestic':
    case 'lookthrough_etf':
      return { text: 'Look-through via underlying fund', tone: 'text-emerald-600 dark:text-emerald-400' }
    case 'fof_level':
      return { text: 'Fund-of-fund (underlying funds disclosed)', tone: 'text-sky-600 dark:text-sky-400' }
    case 'feeder_domestic':
      return { text: 'Fund-of-fund (tracks an Indian ETF)', tone: 'text-amber-600 dark:text-amber-400' }
    case 'feeder_foreign':
    case 'feeder_unresolved':
      return { text: 'Overseas feeder fund', tone: 'text-amber-600 dark:text-amber-400' }
    case 'no_disclosure':
    case 'unresolved':
    default:
      return { text: 'Holdings not available', tone: 'text-faint' }
  }
}

function ChangeCell({ change }: { change?: number | null }) {
  if (change === undefined || change === null) {
    return <span className="text-xs text-brand-500 font-medium">New</span>
  }
  if (change === 0) {
    return <span className="text-xs text-faint">—</span>
  }
  const positive = change > 0
  const bps = Math.abs(Math.round(change * 100))
  return (
    <span className={`text-xs font-medium tabular-nums ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
      {positive ? '▲' : '▼'} {bps} bps
    </span>
  )
}

export default function HoldingsTable({ fund, peerCode }: { fund: Fund; peerCode?: number }) {
  const [expanded, setExpanded] = useState(false)
  const meta = fund.holdingsMeta
  const holdings = fund.holdings ?? []
  const cov = coverageLabel(meta?.coverage)

  const NON_TABLE = ['unresolved', 'no_disclosure', 'feeder_domestic', 'feeder_foreign', 'feeder_unresolved']
  const usable = holdings.length > 0 && !NON_TABLE.includes(meta?.coverage ?? '')

  if (!usable) {
    return (
      <div className="mt-6 card p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-fg">Portfolio holdings</h3>
          <span className={`text-xs font-semibold ${cov.tone}`}>{cov.text}</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          {meta?.note ||
            'Stock-level holdings for this fund are not available from the public monthly disclosure. This is common for overseas feeder funds, which invest into a single foreign fund rather than directly into stocks.'}
          {meta?.underlying && (
            <>
              {' '}Underlying: <span className="font-medium text-fg">{meta.underlying}</span>.
            </>
          )}
        </p>
      </div>
    )
  }

  const shown = expanded ? holdings : holdings.slice(0, 10)
  const shownSum = shown.reduce((s, h) => s + h.pct, 0)
  const hasChange = holdings.some((h) => h.change !== undefined)

  return (
    <div className="mt-6 card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-fg">Portfolio holdings</h3>
          {peerCode && (
            <Link
              to={`/compare?codes=${fund.code},${peerCode}#overlap`}
              className="text-sm font-semibold text-brand-600 hover:underline"
            >
              Compare with top peer
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`font-semibold ${cov.tone}`}>{cov.text}</span>
          {meta?.portfolioDate && (
            <span className="text-faint">as of {fmtDate(meta.portfolioDate.slice(0, 10))}</span>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs text-muted">
        Top {Math.min(10, holdings.length)} positions are {holdings.slice(0, 10).reduce((s, h) => s + h.pct, 0).toFixed(1)}% of the portfolio.
        {meta?.count ? ` ${meta.count} holdings disclosed in total.` : ''}
      </p>

      <div className="mt-3 overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface2 text-xs uppercase tracking-wide text-faint">
              <th className="px-3 py-2 text-left">Holding</th>
              <th className="hidden px-3 py-2 text-left sm:table-cell">Sector</th>
              <th className="px-3 py-2 text-right">% of portfolio</th>
              {hasChange && <th className="px-3 py-2 text-right">MoM change</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((h, i) => (
              <tr key={`${h.key || h.name}-${i}`} className="border-b border-line last:border-0">
                <td className="px-3 py-2 font-medium text-fg">{h.name}</td>
                <td className="hidden px-3 py-2 text-muted sm:table-cell">{h.sector || '—'}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface2 sm:block">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.min(100, (h.pct / (holdings[0]?.pct || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="font-semibold text-fg tabular-nums">{h.pct.toFixed(2)}%</span>
                  </div>
                </td>
                {hasChange && (
                  <td className="px-3 py-2 text-right">
                    <ChangeCell change={h.change} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-surface2">
              <td className="px-3 py-2 text-xs font-semibold text-muted" colSpan={2}>
                {expanded ? `All ${shown.length} shown` : `Top ${shown.length}`} total
              </td>
              <td className="px-3 py-2 text-right text-xs font-bold text-fg tabular-nums">
                {shownSum.toFixed(1)}%
              </td>
              {hasChange && <td className="px-3 py-2" />}
            </tr>
          </tfoot>
        </table>
      </div>

      {holdings.length > 10 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 text-sm font-semibold text-brand-600 hover:underline"
        >
          {expanded ? 'Show top 10 only' : `Show all ${holdings.length} holdings`}
        </button>
      )}
      {meta?.count != null && meta.count > holdings.length && (
        <p className="mt-2 text-xs text-faint">
          Showing the {holdings.length} largest of {meta.count} disclosed holdings.
        </p>
      )}
    </div>
  )
}
