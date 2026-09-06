import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getFund, fundsByCategory, categoryMetricStats, fetchFundDetail, mergeFundDetail, usesReducedSurface } from '../lib/data'
import { data } from '../lib/data'
import { pct, signedPct, num, alphaColor, fundSlug } from '../lib/format'
import { getCategoryColor } from '../lib/categoryColors'
import { fetchNavHistory } from '../lib/nav'
import { computeMetrics, sliceByRange, presetRange, fmtDate, fmtMonth } from '../lib/metrics'
import { ratioSpectrum, lowerBetterSpectrum } from '../lib/spectrum'
import MetricCard from '../components/MetricCard'
import RangeChart from '../components/RangeChart'
import RollingAlpha from '../components/RollingAlpha'
import RangeSelector, { type Preset } from '../components/RangeSelector'
import RiskBadge from '../components/RiskBadge'
import HoldingsTable from '../components/HoldingsTable'
import ManagementCard from '../components/ManagementCard'
import PortfolioMoves from '../components/PortfolioMoves'
import ForwardAnalytics from '../components/ForwardAnalytics'
import FundLandscape from '../components/FundLandscape'
import VerdictCard from '../components/VerdictCard'
import FundMeta from '../components/FundMeta'
import SectorBreakdown from '../components/SectorBreakdown' 
import type { NavPoint } from '../types'
import ShareButton from '../components/ShareButton'
import TaxCard from '../components/TaxCard'
import WishlistButton from '../components/WishlistButton'
import { usePageMeta } from '../lib/usePageMeta'

// Regime data imported from auto-generated regimes.json (pipeline/detect_regimes.py)
import { fallReason, riseContext } from '../lib/regimes'

export default function FundDetail() {
  const { code, slug } = useParams()
  const navigate = useNavigate()
  const fund = getFund(Number(code))

  usePageMeta(
    fund ? `${fund.name} - ${fund.categoryDisplay}` : 'Fund not found',
    fund ? (fund.isArbitrage
      ? `${fund.name} by ${fund.amc}: expense ratio, category rank, fund size and cost context for this arbitrage fund over any period.`
      : fund.isDebt
      ? `${fund.name} by ${fund.amc}: returns, category rank, NAV variability and expense-ratio context for this debt fund over any period.`
      : `${fund.name} by ${fund.amc}: CAGR, Sharpe, Sortino, max drawdown, peer alpha and forward-looking signals over any time period.`) : undefined
  )

  const [allNav, setAllNav] = useState<NavPoint[]>([])
  const [peerNav, setPeerNav] = useState<NavPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [chartMode, setChartMode] = useState<'nav' | 'drawdown' | 'alpha'>('nav')
  useEffect(() => setChartMode('nav'), [fund?.code]) // reset to NAV when navigating between funds

  // Range state
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [preset, setPreset] = useState<Preset>('3Y')
  const [, setDetailTick] = useState(0)

  // Lazy-load heavy per-fund data (analytics, holdings, management, stockMoves)
  useEffect(() => {
    if (!fund) return
    if (fund.holdingsMeta) return
    fetchFundDetail(fund.code).then((detail) => {
      mergeFundDetail(fund, detail)
      setDetailTick((t) => t + 1)
    })
  }, [fund?.code])

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
          const isDebtOrArb = fund.isDebt || fund.isArbitrage
        const defPreset: Preset = isDebtOrArb ? '1Y' : fund.isYoung ? 'MAX' : '3Y'
          const [s, e] = presetRange(defPreset, earliest, latest)
          setStart(s)
          setEnd(e)
          setPreset(defPreset)
        }
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [fund?.code])

  // Fetch the benchmark peer's NAV for the chart overlay (#16). Kept separate so
  // the main metrics never wait on it; failures are silent (overlay just hides).
  useEffect(() => {
    if (!fund) return
    const ranked = fundsByCategory(fund.category).filter((f) => f.metrics['3Y']?.catRank != null)
    const top = ranked[0]
    const peer = top && top.code !== fund.code ? top : ranked[1]
    if (!peer) {
      setPeerNav([])
      return
    }
    let cancelled = false
    fetchNavHistory(peer.code)
      .then((pts) => !cancelled && setPeerNav(pts))
      .catch(() => !cancelled && setPeerNav([]))
    return () => {
      cancelled = true
    }
  }, [fund?.code, fund?.category])

  const earliest = allNav[0]?.date ?? ''
  const latest = allNav[allNav.length - 1]?.date ?? ''

  const slice = useMemo(
    () => (start && end ? sliceByRange(allNav, start, end) : []),
    [allNav, start, end],
  )
  const peerSlice = useMemo(
    () => (start && end && peerNav.length ? sliceByRange(peerNav, start, end) : []),
    [peerNav, start, end],
  )
  const live = useMemo(() => computeMetrics(slice), [slice])

  // Baseline stored metrics (from funds.json) - shown when live NAV is
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
          Back to Explore
        </Link>
      </div>
    )
  }

  const peers = fundsByCategory(fund.category).filter((f) => f.code !== fund.code).slice(0, 4)
  const catDisplay = fund.categoryDisplay // captured (narrowed) for use inside helpers below

  // Benchmark peer for the NAV / drawdown charts (#16): there's no index NAV, so
  // we overlay the category LEADER as a reference - #1 by 3Y rank, or #2 if this
  // fund itself is #1. Gives an honest "vs the best in class" comparison.
  const benchmarkPeer = useMemo(() => {
    const ranked = fundsByCategory(fund.category).filter((f) => f.metrics['3Y']?.catRank != null)
    if (!ranked.length) return null
    const top = ranked[0]
    if (top.code !== fund.code) return top
    return ranked[1] ?? null
  }, [fund.category, fund.code])

  // Category metric distributions (from stored 3Y metrics) for spectrum peer
  // context: each gives {min,max,median,best} so a metric's marker is placed
  // among real peers, with the category median and best also marked.
  const catStats = useMemo(
    () => ({
      volatility: categoryMetricStats(fund.category, 'volatility', false),
      sharpe: categoryMetricStats(fund.category, 'sharpe', true),
      sortino: categoryMetricStats(fund.category, 'sortino', true),
      calmar: categoryMetricStats(fund.category, 'calmar', true),
    }),
    [fund.category],
  )
  const catMedianVol = catStats.volatility?.median ?? null

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
  // Volatility vs category: steadier (below median) = good/green; more volatile
  // (above median) = bad/red, per the user's ask ("> category should be red").
  // A near-tie reads neutral so tiny differences don't flip color.
  function volatilityTone(v: number | undefined): 'default' | 'good' | 'bad' {
    if (v == null || catMedianVol == null) return 'default'
    if (v < catMedianVol) return 'good'
    if (v > catMedianVol) return 'bad'
    return 'default'
  }
  // Drawdown is ALWAYS a loss - never green. Neutral when shallow, amber when
  // moderate, red when deep. (A "good" drawdown would be a contradiction.)
  function drawdownTone(v: number | undefined): 'default' | 'warn' | 'bad' {
    if (v == null) return 'default'
    if (v <= -25) return 'bad'
    if (v <= -10) return 'warn'
    return 'default'
  }
  // Risk-adjusted ratios (Sharpe / Sortino / Calmar): negative means it lost
  // money per unit of risk - always red. 0-1 neutral, >=1 good. Consistent
  // across all three so a negative ratio never renders black or amber.
  function ratioTone(v: number | undefined): 'default' | 'good' | 'bad' {
    if (v == null || isNaN(v)) return 'default'
    if (v < 0) return 'bad'
    if (v >= 0.7) return 'good'
    return 'default'
  }

  // Build a category-pivot spectrum for a risk-adjusted ratio: domain = category
  // [min,max], the "good" line (1.0) pinned to centre, this fund + category
  // median + best marked. Returns undefined if no category stats.
  function ratioSpec(v: number | undefined, stat: ReturnType<typeof categoryMetricStats>) {
    if (v == null || isNaN(v) || !stat) return undefined
    return ratioSpectrum({
      value: v,
      min: stat.min,
      max: stat.max,
      pivot: 1,
      cat: { median: stat.median, best: stat.best },
      fmt: (n) => n.toFixed(2),
    })
  }
  // Volatility spectrum: lower is better, green at the steady (low) end.
  function volSpec(v: number | undefined) {
    const stat = catStats.volatility
    if (v == null || isNaN(v) || !stat) return undefined
    return lowerBetterSpectrum({
      value: v,
      min: stat.min,
      max: stat.max,
      cat: { median: stat.median, best: stat.best },
      fmt: (n) => `${n.toFixed(1)}%`,
    })
  }

  function handleRange(s: string, e: string, p: Preset) {
    setStart(s)
    setEnd(e)
    setPreset(p)
  }


  // Redirect to canonical URL with slug
  useEffect(() => {
    if (fund) {
      const correctSlug = fundSlug(fund.name)
      if (slug !== correctSlug) {
        navigate(`/fund/${fund.code}/${correctSlug}`, { replace: true })
      }
    }
  }, [fund, slug, navigate])

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">

      {/* Header */}
      <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/explore?cat=${encodeURIComponent(fund.category)}`} className={`pill ${getCategoryColor(fund.category).bg} ${getCategoryColor(fund.category).text} hover:opacity-80 transition-opacity`}>{fund.categoryDisplay}</Link>
            <RiskBadge level={fund.riskLevel} />
            {fund.sebiRisk && fund.sebiRisk !== fund.riskLevel && (
              <span className="pill border border-line bg-surface2/60 text-muted" title="SEBI regulatory riskometer, as published by the AMC. Post-2021 nearly all equity funds are rated Very High, so this label rarely differentiates funds - FairFund's own risk grade (left) is the more useful comparison.">
                SEBI: {fund.sebiRisk}
              </span>
            )}
            {fund.metrics['3Y'] && (
              <span className="pill bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                Rank #{fund.metrics['3Y'].catRank} of {fund.metrics['3Y'].catSize ?? fund.categorySize} (3Y)
              </span>
            )}
            {fund.isYoung && fund.inceptionDate && !fund.isDebt && !fund.isArbitrage && (
              <span
                className="pill bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                title={`Launched ${fmtDate(fund.inceptionDate)} · ${fund.navPoints ?? 0} trading days of history. Long-window metrics (3Y/5Y) and category rank are not yet available; judged on since-inception performance.`}
              >
                New fund · since {new Date(fund.inceptionDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-bold text-fg md:text-3xl">{fund.name}</h1>
          <div className="text-sm text-muted">{fund.amc} · Direct · Growth</div>

          {/* Latest NAV with day change */}
          {allNav.length >= 2 && (() => {
            const curr = allNav[allNav.length - 1]
            const prev = allNav[allNav.length - 2]
            const change = curr.nav - prev.nav
            const changePct = (change / prev.nav) * 100
            const isUp = change >= 0
            return (
              <div className="mt-2 flex items-baseline flex-wrap gap-x-3 gap-y-1">
                <span className="text-xl font-bold text-fg">{`\u20B9${curr.nav.toFixed(2)}`}</span>
                <span className={`text-sm font-semibold ${isUp ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {isUp ? '+' : ''}{change.toFixed(2)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%)
                </span>
                <span className="text-xs text-muted">
                  NAV as of {new Date(curr.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
            )
          })()}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <WishlistButton code={fund.code} />
          <ShareButton fund={fund} />
          <button onClick={() => navigate(`/compare?codes=${fund.code}`)} className="btn-ghost">
            ⚖️ Compare
          </button>
        </div>
      </div>

      <FundMeta fund={fund} />

      {/* Range selector - the differentiator */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">
            Analysis period - pick any range
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
              sub={live.years >= 1 ? `${pct(live.totalReturn)} absolute over ${live.years.toFixed(1)} yrs` : `${live.years.toFixed(2)} yrs`}
              tone={live.cagr >= 0 ? 'good' : 'bad'}
              hint={live.years >= 1
                ? `CAGR is the annualized (per-year) return. "${pct(live.totalReturn)} absolute" is the cumulative (point-to-point) return over the whole ${live.years.toFixed(1)}-year period - e.g. Rs 1L would have become Rs ${(100000 * (1 + live.totalReturn / 100) / 1000).toFixed(0)}K.`
                : 'Total return over the selected sub-1-year period (not annualized).'}
            />
            {!usesReducedSurface(fund) && (
            <MetricCard
              label="Sharpe Ratio"
              value={num(live.sharpe)}
              tone={ratioTone(live.sharpe)}
              spectrum={ratioSpec(live.sharpe, catStats.sharpe)}
              hint="Return per unit of total risk in this exact period. Above 1 is excellent; below 0 means it underperformed cash on a risk-adjusted basis. The bar spans this fund's category range, with the real worst and best peer values printed at each end; the coloured caret (with its value above it) is this fund, the tick marked 'med' is the category median, and a dashed line marked '≥1.00' is the 'good' level (shown only when it falls in range)."
            />
            )}
            {!usesReducedSurface(fund) && (
            <MetricCard
              label="Max Drawdown"
              value={pct(live.maxDrawdown)}
              sub={`${fmtDate(live.maxDrawdownStart)} – ${fmtDate(live.maxDrawdownEnd)}`}
              tone={drawdownTone(live.maxDrawdown)}
              note={fallReason(live.maxDrawdownStart, live.maxDrawdownEnd) ?? undefined}
              hint="Worst peak-to-trough fall within the selected period. The dates are the prior peak month and the trough month. A drawdown is always a loss; shallower is better."
            />
            )}
            <MetricCard
              label={usesReducedSurface(fund) ? 'NAV Variability' : 'Volatility'}
              value={pct(live.volatility)}
              tone={volatilityTone(live.volatility)}
              spectrum={volSpec(live.volatility)}
              hint={volatilityHint(live.volatility)}
            />
            {!usesReducedSurface(fund) && (
            <MetricCard
              label="Sortino Ratio"
              value={num(live.sortino)}
              tone={ratioTone(live.sortino)}
              spectrum={ratioSpec(live.sortino, catStats.sortino)}
              hint="Like Sharpe, but only penalizes downside moves. Above 1 is strong; below 0 is poor. The bar spans the category range, with the real worst and best peer values at each end; the coloured caret (value above) is this fund, the 'med' tick is the category median, and a dashed '≥1.00' line marks the 'good' level when it falls in range."
            />
            )}
            {!usesReducedSurface(fund) && (
            <MetricCard
              label="Calmar Ratio"
              value={num(live.calmar)}
              tone={ratioTone(live.calmar)}
              spectrum={ratioSpec(live.calmar, catStats.calmar)}
              hint="Return relative to the worst drawdown. Higher is better (above 1 strong, above 3 excellent); below 0 means it lost money. The bar spans the category range, with the real worst and best peer values at each end; the coloured caret (value above) is this fund, the 'med' tick is the category median, and a dashed '≥1.00' line marks the 'good' level when it falls in range."
            />
            )}
            <MetricCard
              label="Best Month"
              value={signedPct(live.best1M)}
              sub={`${fmtDate(live.best1MStart)} – ${fmtDate(live.best1MEnd)}`}
              tone="good"
              note={riseContext(live.best1MStart, live.best1MEnd) ?? undefined}
              hint="Best rolling 1-month return in this period, and when it happened."
            />
            <MetricCard
              label="Worst Month"
              value={signedPct(live.worst1M)}
              sub={`${fmtDate(live.worst1MStart)} – ${fmtDate(live.worst1MEnd)}`}
              tone="bad"
              note={fallReason(live.worst1MStart, live.worst1MEnd) ?? undefined}
              hint="Worst rolling 1-month return in this period, and when it happened."
            />
          </div>
          <p className="mt-2 text-xs text-faint">
            All metrics are computed live from daily NAV for exactly{' '}
            <strong className="text-muted">{fmtDate(live.startDate)} – {fmtDate(live.endDate)}</strong>. Change the range
            above and every number updates. This is the core of FairFund - no fund can hide behind a
            cherry-picked window.
          </p>
        </>
      ) : baseline ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="CAGR" value={pct(baseline.cagr)} sub={`${baselineHorizon} window`} tone={baseline.cagr >= 0 ? 'good' : 'bad'} />
            {!usesReducedSurface(fund) && (
            <MetricCard label="Alpha vs peers" value={signedPct(baseline.alpha)} tone={baseline.alpha >= 0 ? 'good' : 'bad'} hint="Excess CAGR over the median fund in the same category." />
            )}
            {!usesReducedSurface(fund) && (
            <MetricCard label="Sharpe Ratio" value={num(baseline.sharpe)} tone={ratioTone(baseline.sharpe)} hint="Return per unit of total risk. Above 1 is excellent; below 0 means it underperformed cash on a risk-adjusted basis." />
            )}
            {!usesReducedSurface(fund) && (
            <MetricCard label="Max Drawdown" value={pct(baseline.maxDrawdown)} tone={drawdownTone(baseline.maxDrawdown)} hint="Worst peak-to-trough fall in the window. A drawdown is always a loss - shallower is better." />
            )}
            {!usesReducedSurface(fund) && (
            <MetricCard label="Sortino Ratio" value={num(baseline.sortino)} tone={ratioTone(baseline.sortino)} hint="Like Sharpe, but only penalizes downside moves. Above 1 is strong; below 0 is poor." />
            )}
            {!usesReducedSurface(fund) && (
            <MetricCard label="Calmar Ratio" value={num(baseline.calmar)} tone={ratioTone(baseline.calmar)} hint="Return relative to the worst drawdown. Higher is better; below 0 means it lost money over the window." />
            )}
            <MetricCard label={usesReducedSurface(fund) ? 'NAV Variability' : 'Volatility'} value={pct(baseline.volatility)} hint="Annualized standard deviation of daily returns." />
            <MetricCard label="Category Rank" value={`#${baseline.catRank} / ${baseline.catSize ?? fund.categorySize}`} tone={baseline.catRank <= 3 ? 'good' : 'default'} hint="Rank within category on our composite score." />
          </div>
          <p className="mt-2 text-xs text-faint">
            Our <strong className="text-muted">{baselineHorizon} fixed-window</strong> metrics (anchor {data.anchor}).{' '}
            {error
              ? 'Live custom-range analysis is unavailable right now (NAV source not responding) - these baseline numbers still stand.'
              : 'Pick a range above to recompute everything live from daily NAV.'}
          </p>
        </>
      ) : (
        <div className="mt-4 rounded-xl bg-surface2 p-6 text-center text-sm text-muted">
          {error ? 'Live NAV data unavailable right now.' : 'Select a wider range to compute metrics.'}
        </div>
      )}

      {/* Category landscape: risk-vs-return scatter. Hidden for debt funds, where
          returns are near-identical and volatility is ~0, so the plot is meaningless. */}
      {!usesReducedSurface(fund) && <FundLandscape fund={fund} />}

      {/* Chart */}
      <div className="mt-6 card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-line bg-surface2 p-0.5">
            <button
              onClick={() => setChartMode('nav')}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${chartMode === 'nav' ? 'bg-surface text-brand-700 shadow-sm dark:text-brand-300' : 'text-muted'}`}
            >
              NAV Growth
            </button>
            {!usesReducedSurface(fund) && (
            <button
              onClick={() => setChartMode('drawdown')}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${chartMode === 'drawdown' ? 'bg-surface text-rose-600 shadow-sm dark:text-rose-400' : 'text-muted'}`}
            >
              Drawdowns
            </button>
            )}
            {fund.analytics?.rollingAlpha && fund.analytics.rollingAlpha.spark.length >= 3 && (
              <button
                onClick={() => setChartMode('alpha')}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${chartMode === 'alpha' ? 'bg-surface text-emerald-600 shadow-sm dark:text-emerald-400' : 'text-muted'}`}
              >
                Alpha vs peers
              </button>
            )}
          </div>
          {chartMode !== 'alpha' && benchmarkPeer && peerSlice.length > 1 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-faint">
              <span className="inline-block h-0.5 w-4 rounded bg-brand-600" /> {fund.name.length > 16 ? 'This fund' : fund.name}
              <span className="ml-1 inline-block h-0.5 w-4 rounded" style={{ background: 'repeating-linear-gradient(90deg,#94a3b8 0 3px,transparent 3px 6px)' }} />
              {benchmarkPeer.metrics['3Y']?.catRank === 1 ? 'Category leader' : 'Top peer (risk-adj)'}
            </span>
          )}
        </div>
        {chartMode !== 'alpha' && (
          <p className="mb-2 text-xs text-faint">
            Live, selected range{benchmarkPeer && peerSlice.length > 1 ? ` · dashed line = ${benchmarkPeer.name}` : ''}
          </p>
        )}
        {chartMode === 'alpha' ? (
          <RollingAlpha fund={fund} />
        ) : (
          <RangeChart points={slice} peer={peerSlice} peerName={benchmarkPeer?.name} mode={chartMode} loading={loading} error={error} />
        )}
      </div>

      {/* Overall verdict - fuses backward metrics + forward signals + management */}
      <VerdictCard fund={fund} />

      {usesReducedSurface(fund) && (() => {
        const ter = typeof fund.expenseRatio === 'string' ? parseFloat(fund.expenseRatio) : fund.expenseRatio
        const hasTer = ter != null && !isNaN(ter)
        const exit = fund.investInfo?.exit_load
        const aum = fund.aum?.current
        const anyFact = hasTer || !!exit || aum != null
        return (
          <div className="mt-6 card p-5">
            <h3 className="font-bold text-fg">Costs matter most here</h3>
            <p className="mt-2 text-sm text-muted">
              {fund.isArbitrage
                ? 'For an arbitrage fund, returns come from the price gap between the cash and futures markets on fully hedged positions, so net market exposure is near zero and returns are cash-like and similar across peers. That makes the expense ratio, exit load and fund size the real differentiators, not risk-adjusted return metrics. That is why the ranking here leans on these facts rather than on Sharpe, alpha or drawdown.'
                : 'For a debt fund, gross returns are driven largely by prevailing short-term rates and are near-identical across peers, so the expense ratio, exit load and fund size are the real differentiators, not risk-adjusted return metrics. That is why the ranking here leans on these facts rather than on Sharpe, alpha or drawdown.'}
            </p>
            {anyFact ? (
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-line bg-surface2/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-faint">Expense ratio</div>
                  <div className="mt-1 text-lg font-bold text-fg">{hasTer ? `${ter.toFixed(2)}%` : '—'}</div>
                  <div className="mt-0.5 text-xs text-muted">Annual fee, deducted daily. Lower is better.</div>
                </div>
                <div className="rounded-lg border border-line bg-surface2/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-faint">Exit load</div>
                  <div className="mt-1 text-lg font-bold text-fg">{exit ? exit.replace(/^exit\s*load\s*(of\s*)?/i, '').replace(/^,\s*/, '') : '—'}</div>
                  <div className="mt-0.5 text-xs text-muted">Charge on early redemption.</div>
                </div>
                <div className="rounded-lg border border-line bg-surface2/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-faint">Fund size (AUM)</div>
                  <div className="mt-1 text-lg font-bold text-fg">{aum != null ? (aum >= 100000 ? `₹${(aum/100000).toFixed(1)}L Cr` : aum >= 1000 ? `₹${(aum/1000).toFixed(1)}K Cr` : `₹${aum.toFixed(0)} Cr`) : '—'}</div>
                  <div className="mt-0.5 text-xs text-muted">Larger tends to mean steadier liquidity.</div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-faint">Cost and size data not yet available for this scheme.</p>
            )}
            <p className="mt-3 text-xs text-faint">
              {fund.isArbitrage
                ? 'Sector, management and forward-return components are hidden here because the book is fully hedged (long cash equities offset by short futures) with net market exposure near zero, so equity-style analysis is not meaningful.'
                : 'Holdings, sector, management and forward-return components are hidden here because they are not meaningful for a cash-equivalent portfolio.'}
            </p>
          </div>
        )
      })()}

      {!usesReducedSurface(fund) && (
        <>
          {/* Portfolio holdings */}
          <HoldingsTable fund={fund} peerCode={peers[0]?.code} />

          <SectorBreakdown fund={fund} />

          {/* Portfolio changes (stock-picking intelligence) */}
          <PortfolioMoves fund={fund} />

          {/* Management quality */}
          <ManagementCard fund={fund} />

          {/* Forward-looking analytics (v3): "If you stay invested for..." + signals */}
          <ForwardAnalytics fund={fund} nav={allNav} />
        </>
      )}

      {/* Arbitrage: fully-hedged equity book + exposure summary */}
      {fund.isArbitrage && fund.holdings && fund.holdings.length > 0 && (() => {
        const hedge = fund.holdingsMeta?.hedge
        const netTxt = hedge ? (Math.abs(hedge.netEquity) < 1 ? '\u22480%' : `${hedge.netEquity.toFixed(1)}%`) : ''
        return (
          <>
            {hedge && (
              <div className="mt-6 card border-l-4 border-l-teal-400 p-5">
                <h3 className="font-bold text-fg">The equity book is fully hedged</h3>
                <p className="mt-2 text-sm text-muted">
                  This fund holds the stocks below long and sells a matching stock future against each one, locking in the
                  small price gap between the cash and futures markets. Because every long position is offset by a short,
                  net equity exposure is near zero and returns are cash-like, not equity-like. The bulk of the corpus sits
                  in cash margin, short-term debt and liquid funds as collateral for the futures positions.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-lg border border-line bg-surface2/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-faint">Gross long equity</div>
                    <div className="mt-1 text-lg font-bold text-fg">{hedge.grossLong.toFixed(1)}%</div>
                    <div className="mt-0.5 text-xs text-muted">Each hedged by a short future.</div>
                  </div>
                  <div className="rounded-lg border border-line bg-surface2/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-faint">Net equity exposure</div>
                    <div className="mt-1 text-lg font-bold text-fg">{netTxt}</div>
                    <div className="mt-0.5 text-xs text-muted">After hedging. Near zero.</div>
                  </div>
                  <div className="rounded-lg border border-line bg-surface2/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-faint">Cash margin</div>
                    <div className="mt-1 text-lg font-bold text-fg">{hedge.cash.toFixed(1)}%</div>
                    <div className="mt-0.5 text-xs text-muted">Collateral for the futures.</div>
                  </div>
                  <div className="rounded-lg border border-line bg-surface2/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-faint">Debt + liquid funds</div>
                    <div className="mt-1 text-lg font-bold text-fg">{(hedge.debt + hedge.liquidMf).toFixed(1)}%</div>
                    <div className="mt-0.5 text-xs text-muted">Short-term, cash-equivalent.</div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-faint">
                  The table below lists the gross long equity positions only. The percentages are share of total corpus
                  before hedging, so they sum to the gross long figure above, not to 100%.
                </p>
              </div>
            )}
            <HoldingsTable fund={fund} />
          </>
        )
      })()}

      {/* Taxation */}
      <TaxCard fund={fund} />

      {/* Peers */}
      {peers.length > 0 && (
        <div className="mt-6">
          <div className="mb-3">
            <h3 className="font-bold text-fg">Top peers in {fund.categoryDisplay}</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            {peers.map((p) => {
              const pm = p.metrics['3Y']
              return (
                <button key={p.code} onClick={() => navigate(`/fund/${p.code}/${fundSlug(p.name)}`)} className="card p-4 text-left transition hover:shadow-md">
                  <div className="text-xs text-faint">#{pm?.catRank} in category</div>
                  <div className="mt-1 font-semibold text-fg line-clamp-2">{p.name}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-muted">{pct(pm?.cagr)}</span>
                    {!usesReducedSurface(fund) && <span className={`text-sm font-semibold ${alphaColor(pm?.alpha ?? 0)}`}>{signedPct(pm?.alpha)}</span>}
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
