import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getFund, fundsByCategory } from '../lib/data'
import { data } from '../lib/data'
import { pct, signedPct, num, alphaColor } from '../lib/format'
import { fetchNavHistory } from '../lib/nav'
import { computeMetrics, sliceByRange, presetRange, fmtDate, fmtMonth } from '../lib/metrics'
import MetricCard from '../components/MetricCard'
import RangeChart from '../components/RangeChart'
import RangeSelector, { type Preset } from '../components/RangeSelector'
import RiskBadge from '../components/RiskBadge'
import HoldingsTable from '../components/HoldingsTable'
import ManagementCard from '../components/ManagementCard'
import ForwardAnalytics from '../components/ForwardAnalytics'
import type { NavPoint } from '../types'

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

  // Baseline stored metrics (from funds.json) — shown when live NAV is
  // unavailable so the page is never blank if the NAV API is down/slow.
  const baselineHorizon: '3Y' | '5Y' | '1Y' = fund?.metrics['3Y']
    ? '3Y'
    : fund?.metrics['5Y']
      ? '5Y'
      : '1Y'
  const baseline = fund?.metrics[baselineHorizon] ?? null

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
  const catDisplay = fund.categoryDisplay // captured (narrowed) for use inside helpers below

  // Category-median volatility (from stored 3Y metrics) for a peer-relative
  // read on the live volatility number. Computed once per category.
  const catMedianVol = useMemo(() => {
    const vols = fundsByCategory(fund.category)
      .map((f) => f.metrics['3Y']?.volatility)
      .filter((v): v is number => typeof v === 'number')
      .sort((a, b) => a - b)
    if (!vols.length) return null
    const mid = Math.floor(vols.length / 2)
    return vols.length % 2 ? vols[mid] : (vols[mid - 1] + vols[mid]) / 2
  }, [fund.category])

  // Build a plain-English volatility hint that says how this fund's swings
  // compare to its category peers (lower volatility = steadier ride).
  function volatilityHint(v: number | undefined): string {
    const base =
      'Annualized standard deviation of daily returns - how much the NAV swings. ' +
      'Lower = a steadier ride; higher = bigger ups and downs (not inherently bad for long horizons).'
    if (v == null || catMedianVol == null) return base
    const diff = v - catMedianVol
    const rel = Math.abs(diff) < 1
      ? `about the same as its ${catDisplay} peers (category median ${catMedianVol.toFixed(1)}%)`
      : diff < 0
        ? `steadier than its ${catDisplay} peers (category median ${catMedianVol.toFixed(1)}%) - lower swings`
        : `more volatile than its ${catDisplay} peers (category median ${catMedianVol.toFixed(1)}%) - bigger swings`
    return `${base} This fund is ${rel}.`
  }
  // Volatility tone vs category: steadier=good, much higher=warn.
  function volatilityTone(v: number | undefined): 'default' | 'good' | 'warn' {
    if (v == null || catMedianVol == null) return 'default'
    if (v <= catMedianVol - 1) return 'good'
    if (v >= catMedianVol + 2) return 'warn'
    return 'default'
  }
  // Drawdown is ALWAYS a loss — never green. Neutral when shallow, amber when
  // moderate, red when deep. (A "good" drawdown would be a contradiction.)
  function drawdownTone(v: number | undefined): 'default' | 'warn' | 'bad' {
    if (v == null) return 'default'
    if (v <= -25) return 'bad'
    if (v <= -10) return 'warn'
    return 'default'
  }
  // Risk-adjusted ratios (Sharpe / Sortino / Calmar): negative means it lost
  // money per unit of risk — always red. 0–1 neutral, >=1 good. Consistent
  // across all three so a negative ratio never renders black or amber.
  function ratioTone(v: number | undefined): 'default' | 'good' | 'bad' {
    if (v == null || isNaN(v)) return 'default'
    if (v < 0) return 'bad'
    if (v >= 1) return 'good'
    return 'default'
  }

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
                Rank #{fund.metrics['3Y'].catRank} of {fund.metrics['3Y'].catSize ?? fund.categorySize} (3Y)
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
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-20" />
            ))}
          </div>
          <p className="mt-2 flex items-center gap-2 text-xs text-faint">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
            Fetching live daily NAV to compute metrics for your range…
          </p>
        </>
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
              tone={ratioTone(live.sharpe)}
              hint="Return per unit of total risk in this exact period. Above 1 is excellent; below 0 means it underperformed cash on a risk-adjusted basis."
            />
            <MetricCard
              label="Max Drawdown"
              value={pct(live.maxDrawdown)}
              sub={`${fmtMonth(live.maxDrawdownStart)} → ${fmtMonth(live.maxDrawdownEnd)}`}
              tone={drawdownTone(live.maxDrawdown)}
              hint="Worst peak-to-trough fall within the selected period. The dates show when the fall began (prior peak) and bottomed out (trough). A drawdown is always a loss - shallower is better."
            />
            <MetricCard
              label="Volatility"
              value={pct(live.volatility)}
              sub={catMedianVol != null ? `Category median ${catMedianVol.toFixed(1)}%` : undefined}
              tone={volatilityTone(live.volatility)}
              hint={volatilityHint(live.volatility)}
            />
            <MetricCard label="Sortino Ratio" value={num(live.sortino)} tone={ratioTone(live.sortino)} hint="Like Sharpe, but only penalizes downside moves. Above 1 is strong; below 0 is poor." />
            <MetricCard label="Calmar Ratio" value={num(live.calmar)} tone={ratioTone(live.calmar)} hint="Return relative to the worst drawdown. Higher is better; below 0 means it lost money over the period." />
            <MetricCard
              label="Best Month"
              value={signedPct(live.best1M)}
              sub={`${fmtMonth(live.best1MStart)} → ${fmtMonth(live.best1MEnd)}`}
              tone="good"
              hint="Best rolling 1-month return in this period, and the month-long window it occurred in."
            />
            <MetricCard
              label="Worst Month"
              value={signedPct(live.worst1M)}
              sub={`${fmtMonth(live.worst1MStart)} → ${fmtMonth(live.worst1MEnd)}`}
              tone="bad"
              hint="Worst rolling 1-month return in this period, and the month-long window it occurred in."
            />
          </div>
          <p className="mt-2 text-xs text-faint">
            ↑ All metrics are computed live from daily NAV for exactly{' '}
            <strong className="text-muted">{fmtDate(live.startDate)} → {fmtDate(live.endDate)}</strong>. Change the range
            above and every number updates. This is the core of FairFund — no fund can hide behind a
            cherry-picked window.
          </p>
        </>
      ) : baseline ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="CAGR" value={pct(baseline.cagr)} sub={`${baselineHorizon} window`} tone={baseline.cagr >= 0 ? 'good' : 'bad'} />
            <MetricCard label="Alpha vs peers" value={signedPct(baseline.alpha)} tone={baseline.alpha >= 0 ? 'good' : 'bad'} hint="Excess CAGR over the median fund in the same category." />
            <MetricCard label="Sharpe Ratio" value={num(baseline.sharpe)} tone={ratioTone(baseline.sharpe)} hint="Return per unit of total risk. Above 1 is excellent; below 0 means it underperformed cash on a risk-adjusted basis." />
            <MetricCard label="Max Drawdown" value={pct(baseline.maxDrawdown)} tone={drawdownTone(baseline.maxDrawdown)} hint="Worst peak-to-trough fall in the window. A drawdown is always a loss - shallower is better." />
            <MetricCard label="Sortino Ratio" value={num(baseline.sortino)} tone={ratioTone(baseline.sortino)} hint="Like Sharpe, but only penalizes downside moves. Above 1 is strong; below 0 is poor." />
            <MetricCard label="Calmar Ratio" value={num(baseline.calmar)} tone={ratioTone(baseline.calmar)} hint="Return relative to the worst drawdown. Higher is better; below 0 means it lost money over the window." />
            <MetricCard label="Volatility" value={pct(baseline.volatility)} hint="Annualized standard deviation of daily returns." />
            <MetricCard label="Category Rank" value={`#${baseline.catRank} / ${baseline.catSize ?? fund.categorySize}`} tone={baseline.catRank <= 3 ? 'good' : 'default'} hint="Rank within category on our composite score." />
          </div>
          <p className="mt-2 text-xs text-faint">
            ↑ Our <strong className="text-muted">{baselineHorizon} fixed-window</strong> metrics (anchor {data.anchor}).{' '}
            {error
              ? 'Live custom-range analysis is unavailable right now (NAV source not responding) — these baseline numbers still stand.'
              : 'Pick a range above to recompute everything live from daily NAV.'}
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

      {/* Forward-looking analytics (v3) */}
      <ForwardAnalytics fund={fund} nav={allNav} />

      {/* Portfolio holdings */}
      <HoldingsTable fund={fund} />

      {/* Management quality */}
      <ManagementCard fund={fund} />

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
