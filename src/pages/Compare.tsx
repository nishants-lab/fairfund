import { useState, useEffect, useMemo } from 'react'
import { usePageMeta } from '../lib/usePageMeta'
import { useSearchParams, Link } from 'react-router-dom'
import { getFund } from '../lib/data'
import SearchBox from '../components/SearchBox'
import RangeSelector, { type Preset } from '../components/RangeSelector'
import CompareChart from '../components/CompareChart'
import HoldingsOverlap from '../components/HoldingsOverlap'
import { fetchNavHistory } from '../lib/nav'
import { computeMetrics, sliceByRange, presetRange, fmtDate, fmtMonth, type ComputedMetrics } from '../lib/metrics'
import { pct, signedPct, num, alphaColor, fundSlug } from '../lib/format'
import { buildVerdict } from '../lib/verdict'
import type { Fund, NavPoint } from '../types'

// Up to 5 funds - 5 distinct, theme-safe series colors.
const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
const MAX_FUNDS = 5

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const [funds, setFunds] = useState<Fund[]>([])
  const [navData, setNavData] = useState<Record<number, NavPoint[]>>({})
  const [loadingCodes, setLoadingCodes] = useState<Set<number>>(new Set())

  usePageMeta(
    funds.length ? `Compare: ${funds.map(f => f.name.split(" ")[0]).join(" vs ")}` : 'Compare Funds',
    'Compare up to 5 mutual funds side by side over any time period. Live metrics, growth charts, holdings overlap.'
  )

  // Shared range across all compared funds
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [preset, setPreset] = useState<Preset>('3Y')

  // Load funds from URL whenever the `codes` param changes (mount, link nav,
  // or fund-detail "Compare" button). Only reset when the URL actually differs
  // from what's shown, so in-page add/remove isn't clobbered.
  const codesParam = params.get('codes') ?? ''
  useEffect(() => {
    const codes = codesParam
      .split(',')
      .map((c) => Number(c))
      .filter((c) => !isNaN(c) && c > 0)
    const current = funds.map((f) => f.code).join(',')
    const desired = codes.join(',')
    if (current === desired) return // already in sync (e.g. our own setParams)
    const loaded = codes.map((c) => getFund(c)).filter(Boolean) as Fund[]
    setFunds(loaded)
  }, [codesParam])

  // Fetch NAV for any newly added fund
  useEffect(() => {
    funds.forEach((f) => {
      if (!navData[f.code] && !loadingCodes.has(f.code)) {
        setLoadingCodes((prev) => new Set(prev).add(f.code))
        fetchNavHistory(f.code)
          .then((pts) => setNavData((prev) => ({ ...prev, [f.code]: pts })))
          .catch(() => {})
          .finally(() =>
            setLoadingCodes((prev) => {
              const next = new Set(prev)
              next.delete(f.code)
              return next
            }),
          )
      }
    })
  }, [funds])

  // True while any compared fund's live NAV is still being fetched.
  const navLoading = funds.some((f) => loadingCodes.has(f.code))

  // Determine the common overlapping date range across all funds
  const { earliest, latest } = useMemo(() => {
    const series = funds.map((f) => navData[f.code]).filter(Boolean) as NavPoint[][]
    if (series.length === 0) return { earliest: '', latest: '' }
    // Common window = latest start, earliest end (intersection)
    const starts = series.map((s) => s[0].date)
    const ends = series.map((s) => s[s.length - 1].date)
    return { earliest: starts.sort().reverse()[0], latest: ends.sort()[0] }
  }, [funds, navData])

  // Initialize range once we know the common window
  useEffect(() => {
    if (earliest && latest && !start) {
      const [s, e] = presetRange('3Y', earliest, latest)
      setStart(s)
      setEnd(e)
    }
  }, [earliest, latest])

  function sync(next: Fund[]) {
    setFunds(next)
    setParams({ codes: next.map((f) => f.code).join(',') }, { replace: true })
  }
  function add(fund: Fund) {
    if (funds.find((f) => f.code === fund.code) || funds.length >= MAX_FUNDS) return
    sync([...funds, fund])
  }
  function remove(code: number) {
    sync(funds.filter((f) => f.code !== code))
  }

  // Compute live metrics for each fund over the shared range
  const liveMetrics: Record<number, ComputedMetrics | null> = useMemo(() => {
    const out: Record<number, ComputedMetrics | null> = {}
    funds.forEach((f) => {
      const pts = navData[f.code]
      if (pts && start && end) out[f.code] = computeMetrics(sliceByRange(pts, start, end))
      else out[f.code] = null
    })
    return out
  }, [funds, navData, start, end])

  const categories = new Set(funds.map((f) => f.category))
  const crossCategory = categories.size > 1

  // Map the selected range to the closest stored horizon (1Y/3Y/5Y) so we can
  // show baseline metrics from funds.json even when live NAV is unavailable.
  const storedHorizon: '1Y' | '3Y' | '5Y' = useMemo(() => {
    if (!start || !end) return '3Y'
    const yrs = (new Date(end).getTime() - new Date(start).getTime()) / (365.25 * 86400000)
    if (yrs <= 2) return '1Y'
    if (yrs <= 4) return '3Y'
    return '5Y'
  }, [start, end])

  // Effective metrics for a fund: prefer live (custom range) when present,
  // otherwise fall back to stored fixed-window metrics. Guarantees the table
  // is never blank just because the live NAV API is slow or down.
  function effective(f: Fund): { m: Partial<ComputedMetrics> | null; live: boolean } {
    const lm = liveMetrics[f.code]
    if (lm) return { m: lm, live: true }
    const sm = f.metrics[storedHorizon]
    if (!sm) return { m: null, live: false }
    return {
      m: {
        cagr: sm.cagr,
        sharpe: sm.sharpe,
        sortino: sm.sortino,
        maxDrawdown: sm.maxDrawdown,
        calmar: sm.calmar,
        volatility: sm.volatility,
      },
      live: false,
    }
  }

  // Compact "Mon YYYY → Mon YYYY" period for a metric, only when live metrics
  // (which carry the dates) are available. Returns '' otherwise.
  function periodFor(f: Fund, key: keyof ComputedMetrics): string {
    const lm = liveMetrics[f.code]
    if (!lm) return ''
    if (key === 'maxDrawdown') return `${fmtMonth(lm.maxDrawdownStart)} → ${fmtMonth(lm.maxDrawdownEnd)}`
    if (key === 'best1M') return `${fmtMonth(lm.best1MStart)} → ${fmtMonth(lm.best1MEnd)}`
    if (key === 'worst1M') return `${fmtMonth(lm.worst1MStart)} → ${fmtMonth(lm.worst1MEnd)}`
    return ''
  }

  // True only once every fund has live metrics for the chosen custom range.
  const allLive = funds.length > 0 && funds.every((f) => liveMetrics[f.code])

  const rows: { label: string; key: keyof ComputedMetrics; fmt: (v: number) => string; better: 'high' | 'low'; sub?: 'maxDrawdown' | 'best1M' | 'worst1M' }[] = [
    { label: 'CAGR', key: 'cagr', fmt: (v) => pct(v), better: 'high' },
    { label: 'Total Return', key: 'totalReturn', fmt: (v) => pct(v), better: 'high' },
    { label: 'Sharpe Ratio', key: 'sharpe', fmt: (v) => num(v), better: 'high' },
    { label: 'Sortino Ratio', key: 'sortino', fmt: (v) => num(v), better: 'high' },
    { label: 'Max Drawdown', key: 'maxDrawdown', fmt: (v) => pct(v), better: 'high', sub: 'maxDrawdown' },
    { label: 'Calmar Ratio', key: 'calmar', fmt: (v) => num(v), better: 'high' },
    { label: 'Volatility', key: 'volatility', fmt: (v) => pct(v), better: 'low' },
    { label: 'Best Month', key: 'best1M', fmt: (v) => signedPct(v), better: 'high', sub: 'best1M' },
    { label: 'Worst Month', key: 'worst1M', fmt: (v) => signedPct(v), better: 'high', sub: 'worst1M' },
  ]

  // Semantic tone for a metric value (consistent with FundDetail):
  // drawdown never green; negative ratios always red; returns/months by sign.
  function valueToneClass(key: keyof ComputedMetrics, v: number): string {
    if (key === 'maxDrawdown') return v <= -25 ? 'text-rose-600 dark:text-rose-400' : v <= -10 ? 'text-amber-600 dark:text-amber-400' : 'text-fg'
    if (key === 'sharpe' || key === 'sortino' || key === 'calmar') return v < 0 ? 'text-rose-600 dark:text-rose-400' : v >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg'
    if (key === 'cagr' || key === 'totalReturn' || key === 'best1M' || key === 'worst1M') return v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-fg'
    return 'text-fg'
  }

  function bestIdx(key: keyof ComputedMetrics, better: 'high' | 'low'): number {
    let best = -1
    let bestVal = better === 'high' ? -Infinity : Infinity
    funds.forEach((f, i) => {
      const m = effective(f).m
      if (!m) return
      const v = m[key] as number | undefined
      if (v === undefined || isNaN(v)) return
      if (better === 'high' ? v > bestVal : v < bestVal) {
        bestVal = v
        best = i
      }
    })
    return best
  }

  // Generic winner index for any per-fund numeric value (used by the forward
  // and management rows). `better` decides direction; ties yield the first.
  function bestIdxBy(get: (f: Fund) => number | null | undefined, better: 'high' | 'low'): number {
    let best = -1
    let bestVal = better === 'high' ? -Infinity : Infinity
    funds.forEach((f, i) => {
      const v = get(f)
      if (v == null || isNaN(v)) return
      if (better === 'high' ? v > bestVal : v < bestVal) {
        bestVal = v
        best = i
      }
    })
    return best
  }

  // Green pill class for the winning cell in a row (#17). Applies whenever there
  // is more than one fund; a small caption warns when categories differ.
  const winClass = 'rounded-md bg-emerald-50 px-2 py-0.5 dark:bg-emerald-900/30'

  // Overall verdicts for the final row (#18) - conviction score per fund.
  const verdicts = useMemo(() => funds.map((f) => buildVerdict(f)), [funds])
  const verdictWinner = useMemo(() => {
    let best = -1
    let bestVal = -Infinity
    verdicts.forEach((v, i) => {
      if (v.score > bestVal) {
        bestVal = v.score
        best = i
      }
    })
    return best
  }, [verdicts])

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Compare Funds</h1>
      <p className="mt-1 text-sm text-muted">
        Add up to 5 funds and compare them over <strong>any time period you choose</strong>. Metrics
        recompute live. Same category gives the cleanest comparison; mixing categories is allowed and
        we'll flag it. Green highlights the best fund on each row.
      </p>

      {funds.length < MAX_FUNDS && (
        <div className="mt-5 max-w-xl">
          <SearchBox placeholder="Add a fund to compare…" onPick={add} />
        </div>
      )}

      {crossCategory && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          <span className="text-fg">⚠️</span>
          <div>
            <strong>You’re comparing different categories.</strong> These funds carry different risk
            levels, so raw returns aren’t apples-to-apples. A small-cap "winning" on CAGR is expected;
            it takes more risk. Weigh the risk metrics (drawdown, volatility) alongside returns. The
            per-row green highlight still marks the higher number, not necessarily the better fit.
          </div>
        </div>
      )}

      {funds.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface p-12 text-center text-faint">
          Search above to add funds. Try comparing two funds in the same category.
        </div>
      ) : (
        <>
          {/* Selected fund chips */}
          <div className="mt-5 flex flex-wrap gap-3">
            {funds.map((f, i) => (
              <div key={f.code} className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                <div>
                  <Link
                    to={`/fund/${f.code}/${fundSlug(f.name)}`}
                    className="text-sm font-semibold text-fg hover:text-brand-600 hover:underline"
                    title={`Open ${f.name} - use your browser Back to return here`}
                  >
                    {f.name}
                  </Link>
                  <div className="text-xs text-faint">{f.categoryDisplay}</div>
                </div>
                <button onClick={() => remove(f.code)} className="ml-2 text-faint hover:text-rose-500" aria-label={`Remove ${f.name}`}>✕</button>
              </div>
            ))}
          </div>

          {/* Shared range selector */}
          {earliest ? (
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">Comparison period</h2>
                <span className="text-xs text-faint">Common window: {fmtDate(earliest)} → {fmtDate(latest)}</span>
              </div>
              <RangeSelector
                earliest={earliest}
                latest={latest}
                start={start || earliest}
                end={end || latest}
                onChange={(s, e, p) => {
                  setStart(s)
                  setEnd(e)
                  setPreset(p)
                }}
                activePreset={preset}
              />
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-line bg-surface2/50 p-3 text-xs text-muted">
              Showing our <strong>{storedHorizon} fixed-window</strong> metrics. Live NAV (for a custom
              date range) is loading - if it doesn’t appear, the NAV source is temporarily unavailable
              and these baseline numbers still stand.
            </div>
          )}

          {/* Basis note when live metrics aren't fully loaded */}
          {earliest && !allLive && (
            <p className="mt-3 text-xs text-faint">
              Showing baseline <strong>{storedHorizon}</strong> metrics; recomputing live for your
              selected range…
            </p>
          )}

          {/* Comparison table - sticky first column (metric) stays in view on
              horizontal scroll; sticky header (fund names) stays on vertical
              scroll. The wrapper scrolls internally so the PAGE never scrolls
              horizontally on mobile (the bug class we guard against). */}
          <div className="mt-5 max-h-[70vh] overflow-auto rounded-2xl border border-line bg-surface">
            <table className="border-collapse text-sm" style={{ minWidth: 200 + funds.length * 150 }}>
              <thead>
                <tr className="bg-surface2">
                  <th className="sticky left-0 top-0 z-30 min-w-[140px] border-b border-r border-line bg-surface2 px-4 py-3 text-left text-xs uppercase tracking-wide text-faint">
                    Metric
                  </th>
                  {funds.map((f, i) => (
                    <th key={f.code} className="sticky top-0 z-20 min-w-[130px] border-b border-line bg-surface2 px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                        <Link
                          to={`/fund/${f.code}/${fundSlug(f.name)}`}
                          className="max-w-[110px] truncate text-xs font-semibold text-fg hover:text-brand-600 hover:underline"
                          title={`Open ${f.name}`}
                        >
                          {f.name}
                        </Link>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const winner = bestIdx(row.key, row.better)
                  return (
                    <tr key={row.label} className="border-b border-line">
                      <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">{row.label}</td>
                      {funds.map((f, i) => {
                        const m = effective(f).m
                        const v = m ? (m[row.key] as number | undefined) : undefined
                        const isWinner = i === winner && funds.length > 1
                        const period = row.sub ? periodFor(f, row.key) : ''
                        return (
                          <td key={f.code} className="px-4 py-3 text-right align-top">
                            {v === undefined || isNaN(v as number) ? (
                              <span className="text-faint">—</span>
                            ) : (
                              <>
                                <span
                                  className={`font-semibold ${valueToneClass(row.key, v as number)} ${
                                    isWinner ? winClass : ''
                                  }`}
                                >
                                  {row.fmt(v as number)}
                                </span>
                                {period && <div className="mt-0.5 text-[10px] leading-tight text-faint">{period}</div>}
                              </>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {/* Static category rank row from baseline analysis */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">
                    Category Rank <span className="text-xs text-faint">(3Y baseline)</span>
                  </td>
                  {funds.map((f, i) => {
                    const win = bestIdxBy((x) => x.metrics['3Y'] ? -x.metrics['3Y']!.catRank : null, 'high')
                    return (
                      <td key={f.code} className="px-4 py-3 text-right text-muted">
                        <span className={i === win && funds.length > 1 ? winClass + ' font-semibold text-fg' : ''}>
                          {f.metrics['3Y'] ? `#${f.metrics['3Y'].catRank} / ${f.categorySize}` : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                {/* Manager tenure */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">Manager tenure</td>
                  {funds.map((f, i) => {
                    const win = bestIdxBy((x) => x.management?.avgTenureYears, 'high')
                    return (
                      <td key={f.code} className="px-4 py-3 text-right text-fg">
                        <span className={i === win && funds.length > 1 ? winClass : ''}>
                          {f.management?.avgTenureYears != null ? `${f.management.avgTenureYears} yrs` : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                {/* Management quality signal */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">
                    Management quality <span className="text-xs text-faint">(manager track record)</span>
                  </td>
                  {funds.map((f) => {
                    const sig = f.management?.signal
                    const tone =
                      sig === 'Strong' ? 'text-emerald-700 dark:text-emerald-300'
                      : sig === 'Solid' ? 'text-emerald-600 dark:text-emerald-400'
                      : sig === 'Mixed' ? 'text-amber-600 dark:text-amber-400'
                      : 'text-faint'
                    return (
                      <td key={f.code} className={`px-4 py-3 text-right font-semibold ${tone}`}>
                        {f.management?.available ? sig : '—'}
                      </td>
                    )
                  })}
                </tr>
                {/* Consistency (batting average) */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">Consistency <span className="text-xs text-faint">(% 3Y windows beat peers)</span></td>
                  {funds.map((f, i) => {
                    const win = bestIdxBy((x) => x.analytics?.battingAverage?.pct, 'high')
                    return (
                      <td key={f.code} className="px-4 py-3 text-right font-semibold text-fg">
                        <span className={i === win && funds.length > 1 ? winClass : ''}>
                          {f.analytics?.battingAverage ? `${f.analytics.battingAverage.pct}%` : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                {/* Form / trajectory */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">Form <span className="text-xs text-faint">(rank trend)</span></td>
                  {funds.map((f) => {
                    const dir = f.analytics?.rankTrajectory?.direction
                    const tone = dir === 'climbing' ? 'text-emerald-600 dark:text-emerald-400' : dir === 'fading' ? 'text-rose-600 dark:text-rose-400' : 'text-muted'
                    const arrow = dir === 'climbing' ? '↑ Climbing' : dir === 'fading' ? '↓ Fading' : dir === 'steady' ? '→ Steady' : '—'
                    return <td key={f.code} className={`px-4 py-3 text-right font-semibold ${tone}`}>{arrow}</td>
                  })}
                </tr>
                {/* Skill confidence */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">Skill confidence <span className="text-xs text-faint">(alpha vs luck)</span></td>
                  {funds.map((f, i) => {
                    const al = f.analytics?.alpha
                    if (!al || al.confidence == null) return <td key={f.code} className="px-4 py-3 text-right text-faint">—</td>
                    const win = bestIdxBy((x) => x.analytics?.alpha?.confidence, 'high')
                    const tone = al.couldBeLuck ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                    return <td key={f.code} className={`px-4 py-3 text-right font-semibold ${tone}`}><span className={i === win && funds.length > 1 ? winClass : ''}>{Math.round(al.confidence)}%</span></td>
                  })}
                </tr>
                {/* Down-capture */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">Down-capture <span className="text-xs text-faint">(lower = better)</span></td>
                  {funds.map((f, i) => {
                    const win = bestIdxBy((x) => x.analytics?.capture?.down, 'low')
                    return (
                      <td key={f.code} className="px-4 py-3 text-right font-semibold text-fg">
                        <span className={i === win && funds.length > 1 ? winClass : ''}>
                          {f.analytics?.capture?.down != null ? `${f.analytics.capture.down}%` : '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
                {/* Running hot/cold */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">Momentum state</td>
                  {funds.map((f) => {
                    const mr = f.analytics?.meanReversion
                    if (!mr) return <td key={f.code} className="px-4 py-3 text-right text-faint">—</td>
                    const label = mr.state === 'hot' ? '🔥 Hot' : mr.state === 'cold' ? '❄️ Cold' : 'Normal'
                    return <td key={f.code} className="px-4 py-3 text-right text-fg">{label}</td>
                  })}
                </tr>
                {/* FINAL VERDICT (#18) - overall conviction fusing backward + forward */}
                <tr className="border-t-2 border-line bg-surface2/40">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface2 px-4 py-3 font-bold text-fg">
                    Overall verdict <span className="text-xs font-normal text-faint">(all signals)</span>
                  </td>
                  {funds.map((f, i) => {
                    const v = verdicts[i]
                    const isWin = i === verdictWinner && funds.length > 1
                    const tone = v.tone === 'good' ? 'text-emerald-700 dark:text-emerald-300' : v.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                    return (
                      <td key={f.code} className="px-4 py-3 text-right align-top">
                        <div className={`inline-flex flex-col items-end ${isWin ? winClass : ''}`}>
                          <span className={`font-bold ${tone}`}>{v.label}</span>
                          <span className="text-[11px] text-faint">{v.score}/100{isWin ? ' · best' : ''}</span>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Normalized overlay chart */}
          <div className="mt-6 card p-5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-bold text-fg">Growth of ₹100 (selected period)</h3>
              <span className="text-xs text-faint">Normalized · live NAV</span>
            </div>
            <p className="mb-3 text-xs text-muted">
              All funds start at ₹100 on {start ? fmtDate(start) : 'the start date'} so you can see
              relative growth fairly over the exact same window.
            </p>
            <CompareChart funds={funds} navData={navData} start={start} end={end} colors={COLORS} loading={navLoading} />
          </div>

          {/* Holdings overlap */}
          <HoldingsOverlap funds={funds} />
        </>
      )}
    </div>
  )
}
