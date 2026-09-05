import { useState, useEffect, useMemo } from 'react'
import { usePageMeta } from '../lib/usePageMeta'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { data, fundsByCategory, categoryOrder } from '../lib/data'
import { pct, signedPct, num, riskColor, alphaColor, fundSlug } from '../lib/format'
import HorizonToggle from '../components/HorizonToggle'
import InfoTip from '../components/InfoTip'
import FundLandscape from '../components/FundLandscape'
import WishlistButton from '../components/WishlistButton'
import type { Horizon, Fund } from '../types'

type SortKey = 'rank' | 'name' | 'cagr' | 'alpha' | 'sharpe' | 'maxDrawdown' | 'score' | 'batting' | 'ter' | 'aum'
type SortDir = 'asc' | 'desc'

// Format an AUM value already expressed in Rs crore.
function fmtCrore(cr: number): string {
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(1)}L Cr`
  if (cr >= 1000) return `₹${(cr / 1000).toFixed(1)}K Cr`
  return `₹${cr.toFixed(0)} Cr`
}

// For each sortable key: default direction when first clicked, and whether higher is "better".
// `tip` (optional) renders an info tooltip next to the header label.
const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right'; defaultDir: SortDir; tip?: React.ReactNode }[] = [
  { key: 'rank', label: '#', align: 'left', defaultDir: 'asc' },
  { key: 'name', label: 'Fund', align: 'left', defaultDir: 'asc' },
  { key: 'cagr', label: 'CAGR', align: 'right', defaultDir: 'desc' },
  { key: 'alpha', label: 'Alpha', align: 'right', defaultDir: 'desc' },
  { key: 'sharpe', label: 'Sharpe', align: 'right', defaultDir: 'desc' },
  { key: 'maxDrawdown', label: 'Max DD', align: 'right', defaultDir: 'desc' }, // less negative = better
  {
    key: 'batting',
    label: 'Consistency',
    align: 'right',
    defaultDir: 'desc',
    tip: (
      <>
        <strong>How often the fund beat its category's median over rolling 3-year windows.</strong>
        <br /><br />Recent form is shown by colour: green climbing the rankings, red fading, grey steady. The %
        is the share of 3-year windows it finished in the better half - higher means more repeatable
        skill, less luck. Full explanation on each fund's page.
      </>
    ),
  },
  {
    key: 'score',
    label: 'Score',
    align: 'right',
    defaultDir: 'desc',
    tip: (
      <>
        <strong>Our overall risk-adjusted rank within the category (0-100 bar).</strong>
        <br /><br />It's the geometric mean of the fund's within-category percentile ranks across
        Sharpe, Sortino, Calmar, drawdown protection, peer-relative alpha, and CAGR - over identical
        fixed windows. We use a geometric mean so a fund can't hide one terrible weakness behind
        strong other numbers. Higher = better all-round, not just high returns.
      </>
    ),
  },
]


// Extra columns shown only for debt categories, where cost/size are the real differentiators.
const DEBT_COLUMNS: { key: SortKey; label: string; align: 'left' | 'right'; defaultDir: SortDir; tip?: React.ReactNode }[] = [
  {
    key: 'ter',
    label: 'Expense',
    align: 'right',
    defaultDir: 'asc',
    tip: (
      <>
        <strong>Total Expense Ratio - the annual fee, deducted daily from NAV.</strong>
        <br /><br />For debt funds where gross returns are near-identical, a lower expense ratio is the
        single biggest driver of what you actually keep. Lower is better.
      </>
    ),
  },
  {
    key: 'aum',
    label: 'AUM',
    align: 'right',
    defaultDir: 'desc',
    tip: (
      <>
        <strong>Assets Under Management (Rs crore).</strong>
        <br /><br />Larger liquid/money-market funds tend to be more stable and liquid, with tighter
        spreads on redemptions. Size matters less for returns here than cost does.
      </>
    ),
  },
]

const TREND_TONE: Record<string, string> = {
  climbing: 'text-emerald-600 dark:text-emerald-400',
  fading: 'text-rose-600 dark:text-rose-400',
  steady: 'text-faint',
}

export default function Explore() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const initial = params.get('cat') ?? 'Flexi Cap'
  const [cat, setCat] = useState(initial)
  const isDebtCat = cat === 'Liquid' || cat === 'Money Market' || cat === 'Arbitrage'
  const EQUITY_ONLY_KEYS = new Set(['alpha', 'sharpe', 'maxDrawdown', 'batting', 'score'])
  const cols = isDebtCat ? [...COLUMNS.filter((c) => !EQUITY_ONLY_KEYS.has(c.key)), ...DEBT_COLUMNS] : COLUMNS
  const [horizon, setHorizon] = useState<Horizon>('3Y')
  const [sortKey, setSortKey] = useState<SortKey>('rank')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    setParams({ cat }, { replace: true })
  }, [cat])

  const baseFunds = fundsByCategory(cat)
  const summary = data.categories[cat]

  function clickHeader(key: SortKey, defaultDir: SortDir) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(defaultDir)
    }
  }

  const funds = useMemo(() => {
    const arr = [...baseFunds]
    const getVal = (f: Fund): number | string => {
      const m = f.metrics[horizon]
      switch (sortKey) {
        case 'rank':
          return m?.catRank ?? 9999
        case 'name':
          return f.name.toLowerCase()
        case 'cagr':
          return m?.cagr ?? -Infinity
        case 'alpha':
          return m?.alpha ?? -Infinity
        case 'sharpe':
          return m?.sharpe ?? -Infinity
        case 'maxDrawdown':
          return m?.maxDrawdown ?? -Infinity
        case 'score':
          return m?.score ?? -Infinity
        case 'batting':
          return f.analytics?.battingAverage?.pct ?? -Infinity
        case 'ter': {
          const t = typeof f.expenseRatio === 'string' ? parseFloat(f.expenseRatio) : f.expenseRatio
          return t == null || isNaN(t) ? Infinity : t
        }
        case 'aum':
          return f.aum?.current ?? -Infinity
        default:
          return 0
      }
    }
    arr.sort((a, b) => {
      // Funds with no data for this horizon always sink to the bottom
      const ma = a.metrics[horizon]
      const mb = b.metrics[horizon]
      if (!ma && !mb) return 0
      if (!ma) return 1
      if (!mb) return -1
      const va = getVal(a)
      const vb = getVal(b)
      let cmp: number
      if (typeof va === 'string' || typeof vb === 'string') {
        cmp = String(va).localeCompare(String(vb))
      } else {
        cmp = va - vb
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [baseFunds, horizon, sortKey, sortDir])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-bold text-fg">Explore Funds by Category</h1>
      <p className="mt-1 text-sm text-muted">
        Ranked by risk-adjusted score within each category. Tap any column header to sort. Alpha shows
        out/under-performance vs the median fund in the same category over the chosen window.
      </p>

      {/* Category tabs */}
      <div className="mt-5 flex flex-wrap gap-2">
        {categoryOrder
          .filter((c) => data.categories[c])
          .map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                cat === c
                  ? 'bg-brand-600 text-white'
                  : 'border border-line bg-surface text-muted hover:border-brand-300'
              }`}
            >
              {data.categories[c].display}
            </button>
          ))}
      </div>

      {isDebtCat && (
        <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 text-sm text-muted dark:border-cyan-900/40 dark:bg-cyan-900/10">
          {cat === 'Arbitrage' ? (
            <>
              <strong className="text-fg">Reading an arbitrage category.</strong> Arbitrage funds hedge every long cash
              position with a matching short future, so net market exposure is near zero and returns are cash-like - gaps
              between funds are small, so judge them on expense ratio, size and consistency rather than risk-adjusted ratios.
              Ratio-based columns (Sharpe, Sortino, alpha) are far less meaningful here. Note they are taxed as equity.
            </>
          ) : (
            <>
              <strong className="text-fg">Reading a debt category.</strong> Liquid and money market funds are cash-equivalent
              products - returns track short-term rates and gaps between funds are small, so judge them on expense ratio and
              consistency rather than risk-adjusted ratios. Ratio-based columns (Sharpe, Sortino, alpha) are far less meaningful here.
            </>
          )}
        </div>
      )}

      {/* Category summary bar */}
      {summary && (
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface p-4">
          <div>
            <div className="text-xs text-faint">Funds analyzed</div>
            <div className="font-bold text-fg">{summary.fundCount}</div>
          </div>
          <div className="h-8 w-px bg-line" />
          <div>
            <div className="text-xs text-faint">Median 5Y CAGR</div>
            <div className="font-bold text-fg">{pct(summary.medianCagr5Y)}</div>
          </div>
          <div className="h-8 w-px bg-line" />
          <div>
            <div className="text-xs text-faint">Best 5Y CAGR</div>
            <div className="font-bold text-emerald-600 dark:text-emerald-400">{pct(summary.topCagr5Y)}</div>
          </div>
          <div className="h-8 w-px bg-line" />
          <div>
            <div className="text-xs text-faint">Risk level</div>
            <span className={`pill ${riskColor(summary.riskLevel)}`}>{summary.riskLevel}</span>
          </div>
          <div className="ml-auto">
            <HorizonToggle value={horizon} onChange={setHorizon} />
          </div>
        </div>
      )}

      {/* Category risk-vs-return map */}
      <FundLandscape category={cat} />

      {/* Fund table */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
        <span className="font-semibold uppercase tracking-wide">What the columns mean:</span>
        {cols.filter((c) => c.tip).map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1 text-muted">
            {c.label}
            <InfoTip align="left" width={290} label={`What ${c.label} means`}>
              {c.tip}
            </InfoTip>
          </span>
        ))}
      </div>
      <div className="relative mt-2 overflow-hidden rounded-2xl border border-line bg-surface after:pointer-events-none after:absolute after:right-0 after:top-0 after:h-full after:w-8 after:bg-gradient-to-l after:from-surface after:to-transparent after:content-[''] md:after:hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface2 text-xs uppercase tracking-wide text-faint">
                {cols.map((col) => {
                  const active = sortKey === col.key
                  return (
                    <th
                      key={col.key}
                      onClick={() => clickHeader(col.key, col.defaultDir)}
                      className={`cursor-pointer select-none px-4 py-3 transition hover:text-brand-600 ${
                        col.align === 'right' ? 'text-right' : 'text-left'
                      } ${active ? 'text-brand-600 dark:text-brand-400' : ''}`}
                      title={`Sort by ${col.label}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                        {col.label}
                        <SortArrow active={active} dir={sortDir} />
                      </span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {funds.map((f) => {
                const m = f.metrics[horizon]
                if (!m) {
                  const si = f.si
                  const launched = f.inceptionDate
                    ? new Date(f.inceptionDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
                    : null
                  return (
                    <tr
                      key={f.code}
                      onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
                      className="cursor-pointer border-b border-line text-faint transition hover:bg-brand-50/40 dark:hover:bg-brand-900/20"
                    >
                      <td className="px-4 py-3">
                        {f.isYoung ? (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-[10px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">NEW</span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <WishlistButton code={f.code} compact />
                          <div className="min-w-0">
                            <div className="font-semibold text-fg truncate">{f.name}</div>
                            <div className="text-xs text-faint">{f.amc}</div>
                          </div>
                        </div>
                      </td>
                      {f.isYoung && si ? (
                        <td colSpan={isDebtCat ? 3 : 6} className="px-4 py-3 text-right text-xs">
                          <span className="font-semibold text-fg">{si.totalReturn >= 0 ? '+' : ''}{si.totalReturn.toFixed(1)}% since launch</span>
                          {launched && <span className="text-faint"> · new fund, launched {launched}, too new for a {horizon} rank</span>}
                        </td>
                      ) : (
                        <td colSpan={isDebtCat ? 3 : 6} className="px-4 py-3 text-center text-xs">Insufficient {horizon} data</td>
                      )}
                    </tr>
                  )
                }
                return (
                  <tr
                    key={f.code}
                    onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
                    className="cursor-pointer border-b border-line transition hover:bg-brand-50/40 dark:hover:bg-brand-900/20"
                  >
                    <td className="px-4 py-3">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        m.catRank <= 3 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : m.catRank <= 5 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-surface2 text-muted'
                      }`}>
                        {m.catRank}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <WishlistButton code={f.code} compact />
                        <div className="min-w-0">
                          <div className="font-semibold text-fg truncate">{f.name}</div>
                          <div className="text-xs text-faint">{f.amc}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-fg">{pct(m.cagr)}</td>
                    {isDebtCat && (() => {
                      const ter = typeof f.expenseRatio === 'string' ? parseFloat(f.expenseRatio) : f.expenseRatio
                      return <td className="px-4 py-3 text-right font-semibold text-fg">{ter != null && !isNaN(ter) ? `${ter.toFixed(2)}%` : <span className="text-faint">-</span>}</td>
                    })()}
                    {isDebtCat && (
                      <td className="px-4 py-3 text-right text-muted">{f.aum?.current != null ? fmtCrore(f.aum.current) : <span className="text-faint">-</span>}</td>
                    )}
                    {!isDebtCat && <td className={`px-4 py-3 text-right font-semibold ${alphaColor(m.alpha)}`}>{signedPct(m.alpha)}</td>}
                    {!isDebtCat && <td className="px-4 py-3 text-right text-muted">{num(m.sharpe)}</td>}
                    {!isDebtCat && <td className="px-4 py-3 text-right text-rose-500">{pct(m.maxDrawdown)}</td>}
                    {!isDebtCat && (
                    <td className="px-4 py-3 text-right">
                      {f.analytics?.battingAverage ? (
                        <span className={`font-semibold ${TREND_TONE[f.analytics.rankTrajectory?.direction ?? 'steady']}`}>{f.analytics.battingAverage.pct}%</span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    )}
                    {!isDebtCat && (
                    <td className="px-4 py-3 text-right">
                      <div className="ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-surface2">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${m.score * 100}%` }} />
                      </div>
                    </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active)
    return (
      <svg className="h-3 w-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M8 15l4 4 4-4" />
      </svg>
    )
  return (
    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      {dir === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      )}
    </svg>
  )
}
