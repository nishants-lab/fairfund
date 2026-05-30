import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getFund, fundsByCategory } from '../lib/data'
import { pct, signedPct, num, alphaColor } from '../lib/format'
import { fetchNavHistory } from '../lib/nav'
import { computeMetrics, sliceByRange, presetRange, fmtDate } from '../lib/metrics'
import MetricCard from '../components/MetricCard'
import RangeChart from '../components/RangeChart'
import RangeSelector, { type Preset } from '../components/RangeSelector'
import RiskBadge from '../components/RiskBadge'
import type { Fund, NavPoint } from '../types'

export default function FundDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const fund = getFund(Number(code))

  const [allNav, setAllNav] = useState<NavPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [chartMode, setChartMode] = useState<'nav' | 'drawdown'>('nav')

  // Range state
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [preset, setPreset] = useState<Preset>('3Y')

  useEffect(() => {
    if (!fund) return
    let cancelled = false
    setLoading(true)
    setError(false)
    fetchNavHistory(fund.code)
      .then((pts) => {
        if (cancelled) return
        setAllNav(pts)
        if (pts.length > 0) {
          const earliest = pts[0].date
          const latest = pts[pts.length - 1].date
          const [s, e] = presetRange('3Y', earliest, latest)
          setStart(s)
          setEnd(e)
        }
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [fund?.code])

  const earliest = allNav[0]?.date ?? ''
  const latest = allNav[allNav.length - 1]?.date ?? ''

  const slice = useMemo(
    () => (start && end ? sliceByRange(allNav, start, end) : []),
    [allNav, start, end],
  )
  const live = useMemo(() => computeMetrics(slice), [slice])

  if (!fund) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <div className="text-2xl font-bold text-fg">Fund not found</div>
        <Link to="/explore" className="mt-4 inline-block text-brand-600 hover:underline">
          ← Back to Explore
        </Link>
      </div>
    )
  }

  const peers = fundsByCategory(fund.category).filter((f) => f.code !== fund.code).slice(0, 4)

  function handleRange(s: string, e: string, p: Preset) {
    setStart(s)
    setEnd(e)
    setPreset(p)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link to={`/explore?cat=${encodeURIComponent(fund.category)}`} className="text-sm text-muted hover:text-brand-600">
        ← {fund.categoryDisplay}
      </Link>

      {/* Header */}
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill bg-surface2 text-muted">{fund.categoryDisplay}</span>
            <RiskBadge level={fund.riskLevel} />
            {fund.metrics['3Y'] && (
              <span className="pill bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                Rank #{fund.metrics['3Y'].catRank} of {fund.categorySize} (3Y)
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-extrabold text-fg md:text-3xl">{fund.name}</h1>
          <div className="text-sm text-muted">{fund.amc} · Direct · Growth</div>
        </div>
        <button onClick={() => navigate(`/compare?codes=${fund.code}`)} className="btn-ghost">
          ⚖️ Compare
        </button>
      </div>

      {/* Range selector — the differentiator */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">
            Analysis period — pick any range
          </h2>
          {live && (
            <span className="text-xs text-faint">
              {live.points} trading days · {live.years.toFixed(2)} yrs
            </span>
          )}
        </div>
        {earliest && (
          <RangeSelector
            earliest={earliest}
            latest={latest}
            start={start}
            end={end}
            onChange={handleRange}
            activePreset={preset}
          />
        )}
      </div>

      {/* Live metrics computed for the chosen range */}
      {loading ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card h-20 animate-pulse" />
          ))}
        </div>
      ) : live ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard
              label={live.years >= 1 ? 'CAGR' : 'Return (period)'}
              value={live.years >= 1 ? pct(live.cagr) : pct(live.totalReturn)}
              sub={live.years >= 1 ? `${pct(live.totalReturn)} total` : `${live.years.toFixed(2)} yrs`}
              tone={live.cagr >= 0 ? 'good' : 'bad'}
            />
            <MetricCard
              label="Sharpe Ratio"
              value={num(live.sharpe)}
              tone={live.sharpe >= 1 ? 'good' : live.sharpe >= 0.5 ? 'default' : 'warn'}
              hint="Return per unit of total risk in this exact period. Above 1 is excellent."
            />
            <MetricCard
              label="Max Drawdown"
              value={pct(live.maxDrawdown)}
              tone={live.maxDrawdown > -15 ? 'good' : live.maxDrawdown < -25 ? 'bad' : 'warn'}
              hint="Worst peak-to-trough fall within the selected period."
            />
            <MetricCard
              label="Volatility"
              value={pct(live.volatility)}
              hint="Annualized standard deviation of daily returns in this period."
            />
            <MetricCard label="Sortino Ratio" value={num(live.sortino)} hint="Like Sharpe, but only penalizes downside moves." />
            <MetricCard label="Calmar Ratio" value={num(live.calmar)} hint="Return relative to the worst drawdown. Higher is better." />
            <MetricCard label="Best Month" value={signedPct(live.best1M)} tone="good" hint="Best rolling 1-month return in this period." />
            <MetricCard label="Worst Month" value={signedPct(live.worst1M)} tone="bad" hint="Worst rolling 1-month return in this period." />
          </div>
          <p className="mt-2 text-xs text-faint">
            ↑ All metrics are computed live from daily NAV for exactly{' '}
            <strong className="text-muted">{fmtDate(live.startDate)} → {fmtDate(live.endDate)}</strong>. Change the range
            above and every number updates. This is the core of FairFund — no fund can hide behind a
            cherry-picked window.
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-xl bg-surface2 p-6 text-center text-sm text-muted">
          {error ? 'Live NAV data unavailable right now.' : 'Select a wider range to compute metrics.'}
        </div>
      )}

      {/* Chart */}
      <div className="mt-6 card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="inline-flex rounded-xl border border-line bg-surface2 p-1">
            <button
              onClick={() => setChartMode('nav')}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${chartMode === 'nav' ? 'bg-surface text-brand-700 shadow-sm dark:text-brand-300' : 'text-muted'}`}
            >
              NAV Growth
            </button>
            <button
              onClick={() => setChartMode('drawdown')}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${chartMode === 'drawdown' ? 'bg-surface text-rose-600 shadow-sm dark:text-rose-400' : 'text-muted'}`}
            >
              Drawdowns
            </button>
          </div>
          <span className="text-xs text-faint">Live · selected range</span>
        </div>
        <RangeChart points={slice} mode={chartMode} loading={loading} error={error} />
      </div>

      {/* Baseline verdict (from fixed-window analysis) */}
      <div className="mt-6 card border-l-4 border-l-brand-500 p-5">
        <h3 className="font-bold text-fg">Our take (3-year fixed-window basis)</h3>
        <p className="mt-2 text-muted">{fund.verdict}</p>
      </div>

      {/* Peers */}
      {peers.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-fg">Top peers in {fund.categoryDisplay}</h3>
            <button
              onClick={() => navigate(`/compare?codes=${fund.code},${peers[0].code}`)}
              className="text-sm font-semibold text-brand-600 hover:underline"
            >
              Compare with #1 peer →
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {peers.map((p) => {
              const pm = p.metrics['3Y']
              return (
                <button key={p.code} onClick={() => navigate(`/fund/${p.code}`)} className="card p-4 text-left transition hover:shadow-md">
                  <div className="text-xs text-faint">#{pm?.catRank} in category</div>
                  <div className="mt-1 font-semibold text-fg line-clamp-2">{p.name}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-muted">{pct(pm?.cagr)}</span>
                    <span className={`text-sm font-semibold ${alphaColor(pm?.alpha ?? 0)}`}>{signedPct(pm?.alpha)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
