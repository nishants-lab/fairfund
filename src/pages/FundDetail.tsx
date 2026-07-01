import { useState, useEffect, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { getFund, fundsByCategory, categoryMetricStats, fetchFundDetail, mergeFundDetail } from '../lib/data'
import { data } from '../lib/data'
import { pct, signedPct, num, alphaColor, fundSlug } from '../lib/format'
import { getCategoryColor } from '../lib/categoryColors'
import { fetchNavHistory } from '../lib/nav'
import { computeMetrics, sliceByRange, presetRange, fmtDate, fmtMonth } from '../lib/metrics'
import { ratioSpectrum, lowerBetterSpectrum } from '../lib/spectrum'
import MetricCard from '../components/MetricCard'
import RangeChart from '../components/RangeChart'
import RangeSelector, { type Preset } from '../components/RangeSelector'
import RiskBadge from '../components/RiskBadge'
import HoldingsTable from '../components/HoldingsTable'
import ManagementCard from '../components/ManagementCard'
import PortfolioMoves from '../components/PortfolioMoves'
import ForwardAnalytics from '../components/ForwardAnalytics'
import VerdictCard from '../components/VerdictCard'
import type { NavPoint } from '../types'
import ShareButton from '../components/ShareButton'
import { usePageMeta } from '../lib/usePageMeta'

// Regime data imported from auto-generated regimes.json (pipeline/detect_regimes.py)
import { fallReason, riseContext } from '../lib/regimes'

export default function FundDetail() {
  const { code, slug } = useParams()
  const navigate = useNavigate()
  const fund = getFund(Number(code))

  usePageMeta(
    fund ? `${fund.name} - ${fund.categoryDisplay}` : 'Fund not found',
    fund ? `${fund.name} by ${fund.amc}: CAGR, Sharpe, Sortino, max drawdown, peer alpha and forward-looking signals over any time period.` : undefined
  )

  const [allNav, setAllNav] = useState<NavPoint[]>([])
  const [peerNav, setPeerNav] = useState<NavPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [chartMode, setChartMode] = useState<'nav' | 'drawdown'>('nav')

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
          ← Back to Explore
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
            {fund.metrics['3Y'] && (
              <span className="pill bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                Rank #{fund.metrics['3Y'].catRank} of {fund.metrics['3Y'].catSize ?? fund.categorySize} (3Y)
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-extrabold text-fg md:text-3xl">{fund.name}</h1>
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
        <div className="flex shrink-0 gap-2">
          <ShareButton fund={fund} />
          <button onClick={() => navigate(`/compare?codes=${fund.code}`)} className="btn-ghost">
            ⚖️ Compare
          </button>
        </div>
      </div>

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
            <MetricCard
              label="Sharpe Ratio"
              value={num(live.sharpe)}
              tone={ratioTone(live.sharpe)}
              spectrum={ratioSpec(live.sharpe, catStats.sharpe)}
              hint="Return per unit of total risk in this exact period. Above 1 is excellent; below 0 means it underperformed cash on a risk-adjusted basis. The bar spans this fund's category range, with the real worst and best peer values printed at each end; the coloured caret (with its value above it) is this fund, the tick marked 'med' is the category median, and a dashed line marked '≥1.00' is the 'good' level (shown only when it falls in range)."
            />
            <MetricCard
              label="Max Drawdown"
              value={pct(live.maxDrawdown)}
              sub={`${fmtDate(live.maxDrawdownStart)} → ${fmtDate(live.maxDrawdownEnd)}`}
              tone={drawdownTone(live.maxDrawdown)}
              note={fallReason(live.maxDrawdownStart, live.maxDrawdownEnd) ?? undefined}
              hint="Worst peak-to-trough fall within the selected period. The dates are the prior peak month and the trough month. A drawdown is always a loss; shallower is better."
            />
            <MetricCard
              label="Volatility"
              value={pct(live.volatility)}
              tone={volatilityTone(live.volatility)}
              spectrum={volSpec(live.volatility)}
              hint={volatilityHint(live.volatility)}
            />
            <MetricCard
              label="Sortino Ratio"
              value={num(live.sortino)}
              tone={ratioTone(live.sortino)}
              spectrum={ratioSpec(live.sortino, catStats.sortino)}
              hint="Like Sharpe, but only penalizes downside moves. Above 1 is strong; below 0 is poor. The bar spans the category range, with the real worst and best peer values at each end; the coloured caret (value above) is this fund, the 'med' tick is the category median, and a dashed '≥1.00' line marks the 'good' level when it falls in range."
            />
            <MetricCard
              label="Calmar Ratio"
              value={num(live.calmar)}
              tone={ratioTone(live.calmar)}
              spectrum={ratioSpec(live.calmar, catStats.calmar)}
              hint="Return relative to the worst drawdown. Higher is better (above 1 strong, above 3 excellent); below 0 means it lost money. The bar spans the category range, with the real worst and best peer values at each end; the coloured caret (value above) is this fund, the 'med' tick is the category median, and a dashed '≥1.00' line marks the 'good' level when it falls in range."
            />
            <MetricCard
              label="Best Month"
              value={signedPct(live.best1M)}
              sub={`${fmtDate(live.best1MStart)} → ${fmtDate(live.best1MEnd)}`}
              tone="good"
              note={riseContext(live.best1MStart, live.best1MEnd) ?? undefined}
              hint="Best rolling 1-month return in this period, and when it happened."
            />
            <MetricCard
              label="Worst Month"
              value={signedPct(live.worst1M)}
              sub={`${fmtDate(live.worst1MStart)} → ${fmtDate(live.worst1MEnd)}`}
              tone="bad"
              note={fallReason(live.worst1MStart, live.worst1MEnd) ?? undefined}
              hint="Worst rolling 1-month return in this period, and when it happened."
            />
          </div>
          <p className="mt-2 text-xs text-faint">
            ↑ All metrics are computed live from daily NAV for exactly{' '}
            <strong className="text-muted">{fmtDate(live.startDate)} → {fmtDate(live.endDate)}</strong>. Change the range
            above and every number updates. This is the core of FairFund - no fund can hide behind a
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
              ? 'Live custom-range analysis is unavailable right now (NAV source not responding) - these baseline numbers still stand.'
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-line bg-surface2 p-0.5">
            <button
              onClick={() => setChartMode('nav')}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${chartMode === 'nav' ? 'bg-surface text-brand-700 shadow-sm dark:text-brand-300' : 'text-muted'}`}
            >
              NAV Growth
            </button>
            <button
              onClick={() => setChartMode('drawdown')}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition ${chartMode === 'drawdown' ? 'bg-surface text-rose-600 shadow-sm dark:text-rose-400' : 'text-muted'}`}
            >
              Drawdowns
            </button>
          </div>
          {benchmarkPeer && peerSlice.length > 1 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
              <span className="inline-block h-0.5 w-4 rounded bg-brand-600" /> {fund.name.length > 16 ? 'This fund' : fund.name}
              <span className="ml-1 inline-block h-0.5 w-4 rounded" style={{ background: 'repeating-linear-gradient(90deg,#94a3b8 0 3px,transparent 3px 6px)' }} />
              {benchmarkPeer.metrics['3Y']?.catRank === 1 ? 'Category #1' : 'Top peer'}
            </span>
          )}
        </div>
        <p className="mb-2 text-xs text-faint">
          Live, selected range{benchmarkPeer && peerSlice.length > 1 ? ` · dashed line = ${benchmarkPeer.name}` : ''}
        </p>
        <RangeChart points={slice} peer={peerSlice} peerName={benchmarkPeer?.name} mode={chartMode} loading={loading} error={error} />
      </div>

      {/* Overall verdict - fuses backward metrics + forward signals + management */}
      <VerdictCard fund={fund} />

      {/* Portfolio holdings */}
      <HoldingsTable fund={fund} />

      {/* Portfolio changes (stock-picking intelligence) */}
      <PortfolioMoves fund={fund} />

      {/* Management quality */}
      <ManagementCard fund={fund} />

      {/* Forward-looking analytics (v3) — "If you stay invested for…" + signals */}
      <ForwardAnalytics fund={fund} nav={allNav} />

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
                <button key={p.code} onClick={() => navigate(`/fund/${p.code}/${fundSlug(p.name)}`)} className="card p-4 text-left transition hover:shadow-md">
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
