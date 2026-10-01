import { trackUsageEvent } from '../lib/usage'
import SavedComparisons from '../components/SavedComparisons'
import {summarizeMaterialDifferences} from '../lib/savedComparisons'
import { NavQualityError } from "../lib/navQuality"
import { useState, useEffect, useMemo, useRef } from 'react'
import { usePageMeta } from '../lib/usePageMeta'
import { useSearchParams, Link, useLocation } from 'react-router-dom'
import { getFund, fetchFundDetail, mergeFundDetail, usesReducedSurface } from '../lib/data'
import SearchBox from '../components/SearchBox'
import RangeSelector, { type Preset } from '../components/RangeSelector'
import CompareChart from '../components/CompareChart'
import ShareButton from '../components/ShareButton'
import InfoTip from '../components/InfoTip'
import HoldingsOverlap from '../components/HoldingsOverlap'
import { fetchNavHistory } from '../lib/nav'
import { computeMetrics, sliceByRange, presetRange, fmtDate, fmtMonth, type ComputedMetrics } from '../lib/metrics'
import { pct, signedPct, num, alphaColor, fundSlug } from '../lib/format'
import { buildVerdict } from '../lib/verdict'
import { buildDebtVerdict } from '../lib/debtVerdict'
import { funds as ALL_FUNDS } from '../lib/data'
import type { Fund, NavPoint } from '../types'

// Up to 5 funds - 5 distinct, theme-safe series colors.
const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']
const MAX_FUNDS = 5

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const [funds, setFunds] = useState<Fund[]>([])
  const [navIssues, setNavIssues] = useState<Record<number, string>>({})
  const [navData, setNavData] = useState<Record<number, NavPoint[]>>({})
  const [loadingCodes, setLoadingCodes] = useState<Set<number>>(new Set())
  // Overlap holdings load (Compare owns this; no dependency on visiting detail pages).
  const [holdingsTick, setHoldingsTick] = useState(0)
  const [holdingsLoading, setHoldingsLoading] = useState(false)

  usePageMeta(
    funds.length ? `Compare: ${funds.map(f => f.name.split(" ")[0]).join(" vs ")}` : 'Compare Funds',
    'Compare mutual funds over a selected period and review overlap in their disclosed holdings.'
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
      if (f.dataQuality?.status !== 'quarantined' && !navIssues[f.code] && !navData[f.code] && !loadingCodes.has(f.code)) {
        setLoadingCodes((prev) => new Set(prev).add(f.code))
        fetchNavHistory(f.code)
          .then((pts) => setNavData((prev) => ({ ...prev, [f.code]: pts })))
          .catch((e) => { if (e instanceof NavQualityError) setNavIssues(prev => ({...prev, [f.code]: e.message})) })
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

  // Fetch per-fund holdings/detail so the overlap always renders, regardless of
  // whether the fund's detail page was ever opened this session. Guards on
  // holdingsMeta (same signal FundDetail uses); fetchFundDetail is cached.
  // Shells are cached by code and applied per fund object: a fund object that has
  // been hydrated is marked, so a cancelled effect (StrictMode double-invoke, or a
  // rapid add/remove) leaves no pending flag behind, and re-adding a fund hydrates
  // again from the cached shell instead of being skipped forever.
  const detailByCode = useRef<Map<number, Partial<Fund>>>(new Map())
  const hydratedObjects = useRef<WeakSet<Fund>>(new WeakSet())
  useEffect(() => {
    const missing = funds.filter((f) => !f.holdingsMeta && !hydratedObjects.current.has(f))
    if (missing.length === 0) {
      setHoldingsLoading(false)
      return
    }
    let cancelled = false
    setHoldingsLoading(true)
    Promise.all(
      missing.map((f) =>
        fetchFundDetail(f.code).then((detail) => detailByCode.current.set(f.code, detail)),
      ),
    )
      .then(() => {
        if (cancelled) return
        // Hydration is page-local: swap in merged copies, leave the index alone.
        setFunds((prev) => {
          let changed = false
          const next = prev.map((f) => {
            const detail = detailByCode.current.get(f.code)
            if (!detail || hydratedObjects.current.has(f)) return f
            const merged = mergeFundDetail(f, detail)
            hydratedObjects.current.add(merged)
            changed = true
            return merged
          })
          return changed ? next : prev
        })
        setHoldingsTick((t) => t + 1)
      })
      .finally(() => {
        if (!cancelled) setHoldingsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [funds])

  // Deep-link: /compare?codes=...#overlap scrolls to the overlap section once
  // holdings have loaded (used by the fund page's "Compare holdings" button).
  const { hash } = useLocation()
  useEffect(() => {
    if (hash === '#overlap' && !holdingsLoading && funds.length >= 2) {
      document.getElementById('overlap')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [hash, holdingsLoading, funds.length])

  // True while any compared fund's live NAV is still being fetched.
  const navLoading = funds.some((f) => loadingCodes.has(f.code))

  const safeNavData = useMemo(() => Object.fromEntries(
    funds.filter(f => f.dataQuality?.status !== 'quarantined' && !navIssues[f.code] && navData[f.code])
      .map(f => [f.code, navData[f.code]]),
  ), [funds, navData, navIssues])

  // Determine the common overlapping date range across all funds
  const { earliest, latest } = useMemo(() => {
    const series = funds.map((f) => safeNavData[f.code]).filter(Boolean) as NavPoint[][]
    if (series.length === 0) return { earliest: '', latest: '' }
    // Common window = latest start, earliest end (intersection)
    const starts = series.map((s) => s[0].date)
    const ends = series.map((s) => s[s.length - 1].date)
    return { earliest: starts.sort().reverse()[0], latest: ends.sort()[0] }
  }, [funds, safeNavData])

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
      const pts = safeNavData[f.code]
      if (pts && start && end) out[f.code] = computeMetrics(sliceByRange(pts, start, end))
      else out[f.code] = null
    })
    return out
  }, [funds, safeNavData, start, end])

  const categories = new Set(funds.map((f) => f.category))
  const crossCategory = categories.size > 1
  const hasDebt = funds.some((f) => usesReducedSurface(f))
  const hasEquity = funds.some((f) => !usesReducedSurface(f))
  const crossAsset = hasDebt && hasEquity

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
    if (navIssues[f.code] || f.dataQuality?.status === "quarantined") return {m:null,live:false}
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

  // Compact "Mon YYYY – Mon YYYY" period for a metric, only when live metrics
  // (which carry the dates) are available. Returns '' otherwise.
  function periodFor(f: Fund, key: keyof ComputedMetrics): string {
    const lm = liveMetrics[f.code]
    if (!lm) return ''
    if (key === 'maxDrawdown') return `${fmtMonth(lm.maxDrawdownStart)} – ${fmtMonth(lm.maxDrawdownEnd)}`
    if (key === 'best1M') return `${fmtMonth(lm.best1MStart)} – ${fmtMonth(lm.best1MEnd)}`
    if (key === 'worst1M') return `${fmtMonth(lm.worst1MStart)} – ${fmtMonth(lm.worst1MEnd)}`
    return ''
  }

  // True only once every fund has live metrics for the chosen custom range.
  const allLive = funds.length > 0 && funds.every((f) => liveMetrics[f.code])

  const rows: { label: string; key: keyof ComputedMetrics; fmt: (v: number) => string; better: 'high' | 'low'; unit: 'pct' | 'ratio'; sub?: 'maxDrawdown' | 'best1M' | 'worst1M' }[] = [
    { label: 'CAGR', key: 'cagr', fmt: (v) => pct(v), better: 'high', unit: 'pct' },
    { label: 'Total Return', key: 'totalReturn', fmt: (v) => pct(v), better: 'high', unit: 'pct' },
    { label: 'Sharpe Ratio', key: 'sharpe', fmt: (v) => num(v), better: 'high', unit: 'ratio' },
    { label: 'Sortino Ratio', key: 'sortino', fmt: (v) => num(v), better: 'high', unit: 'ratio' },
    { label: 'Max Drawdown', key: 'maxDrawdown', fmt: (v) => pct(v), better: 'high', unit: 'pct', sub: 'maxDrawdown' },
    { label: 'Calmar Ratio', key: 'calmar', fmt: (v) => num(v), better: 'high', unit: 'ratio' },
    { label: hasDebt ? 'NAV Variability' : 'Volatility', key: 'volatility', fmt: (v) => pct(v), better: 'low', unit: 'pct' },
    { label: 'Best Month', key: 'best1M', fmt: (v) => signedPct(v), better: 'high', unit: 'pct', sub: 'best1M' },
    { label: 'Worst Month', key: 'worst1M', fmt: (v) => signedPct(v), better: 'high', unit: 'pct', sub: 'worst1M' },
  ]

  // Semantic tone for a metric value (consistent with FundDetail):
  // drawdown never green; negative ratios always red; returns/months by sign.
  function valueToneClass(key: keyof ComputedMetrics, v: number): string {
    if (key === 'maxDrawdown') return v <= -25 ? 'text-rose-600 dark:text-rose-400' : v <= -10 ? 'text-amber-600 dark:text-amber-400' : 'text-fg'
    if (key === 'sharpe' || key === 'sortino' || key === 'calmar') return v < 0 ? 'text-rose-600 dark:text-rose-400' : v >= 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg'
    if (key === 'cagr' || key === 'totalReturn' || key === 'best1M' || key === 'worst1M') return v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-fg'
    return 'text-fg'
  }

  // Gap to the leading fund on a metric row, shown under each non-winning cell.
  // Percentage metrics report the shortfall in basis points; ratios in absolute
  // points. `d` is <= 0 for a non-leader (leader is the best on that metric), so
  // the sign reads as a disadvantage; an exact tie shows "even".
  function fmtDelta(d: number, unit: 'pct' | 'ratio'): string {
    if (unit === 'pct') {
      const bps = Math.round(d * 100)
      return bps === 0 ? 'even' : `${bps > 0 ? '+' : ''}${bps} bps`
    }
    const r = Number(d.toFixed(2))
    return r === 0 ? 'even' : `${r > 0 ? '+' : ''}${r.toFixed(2)}`
  }

  function bestIdx(key: keyof ComputedMetrics, better: 'high' | 'low'): number {
    let best = -1
    let bestVal = better === 'high' ? -Infinity : Infinity
    funds.forEach((f, i) => {
      const m = effective(f).m
      if (!m) return
      const v = m[key] as number | undefined
      if (typeof v !== 'number' || !Number.isFinite(v)) return
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
  const winClass = 'rounded-md bg-emerald-100 px-2 py-0.5 dark:bg-emerald-700/50'

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

  const comparisonSummary = summarizeMaterialDifferences(funds.map(f => navIssues[f.code] || f.dataQuality?.status === 'quarantined' ? null : liveMetrics[f.code]))
  const completedComparisons = useRef(new Set<string>())
  const comparisonIdentity = JSON.stringify([funds.map(f => f.code).sort((a, b) => a - b), start, end])
  const comparisonReady = !comparisonSummary.warning && comparisonSummary.period !== null
  useEffect(() => {
    if (!comparisonReady || completedComparisons.current.has(comparisonIdentity)) return
    completedComparisons.current.add(comparisonIdentity)
    trackUsageEvent('comparison_completed')
  }, [comparisonReady, comparisonIdentity])

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {funds.some(f => navIssues[f.code] || f.dataQuality?.status === 'quarantined') && <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">NAV source verification is needed for {funds.filter(f => navIssues[f.code] || f.dataQuality?.status === 'quarantined').map(f => f.name).join(', ')}. Return and risk calculations are withheld for these funds.</p>}
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-3xl font-bold text-fg">Compare Funds</h1>
        <ShareButton title="Fund comparison" text="Compare funds side by side on FairFund" className="mt-1 shrink-0" />
      </div>
      <p className="mt-1 text-sm text-muted">
        Compare up to 5 funds over a period you choose.
        <InfoTip label="How to read the comparison" align="left" width={290}>
          Green highlights the leading value on each row. The figure below is the gap to that value.
          A row highlight is not an investment recommendation.
        </InfoTip>
      </p>

      {funds.length < MAX_FUNDS && (
        <div className="mt-5 max-w-xl">
          <SearchBox placeholder="Add a fund to compare…" onPick={add} />
        </div>
      )}

      {crossAsset && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-300">
          <span className="text-fg">&#9888;&#65039;</span>
          <div>
            <strong>You&apos;re mixing cash-equivalent and equity funds.</strong> These are different asset classes
            with different goals - a liquid, money market or arbitrage fund is a cash-equivalent parking product,
            not a growth investment. Comparing their CAGR or risk-adjusted ratios side by side is misleading. Judge
            debt and arbitrage funds on expense ratio and consistency, equity funds on long-run risk-adjusted return.
          </div>
        </div>
      )}

      {crossCategory && !crossAsset && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          <span className="text-fg">⚠️</span>
          <div>
            <strong>You're comparing different categories.</strong> These funds carry different risk
            levels, so raw returns aren't apples-to-apples: a small-cap showing a higher CAGR also
            carries more risk. The per-row highlight marks the higher number on that metric only, not
            a better or recommended fund.
          </div>
        </div>
      )}

      <details className="mt-5">
        <summary className="cursor-pointer text-sm font-semibold text-brand-700 dark:text-brand-300">Save or load a comparison</summary>
        <div className="mt-3"><SavedComparisons fundCodes={funds.map(f=>f.code)} start={start} end={end} onLoad={record=>{
          const next=record.fundCodes.map(getFund)
          if(next.some(f=>!f)) return 'A saved fund is no longer available. The comparison was not loaded.'
          sync(next as Fund[]);setStart(record.start);setEnd(record.end);setPreset('CUSTOM')
        }}/></div>
      </details>
      {funds.length >= 2 && <section className="mt-5 rounded-xl border border-line bg-surface p-4" aria-label="Differences over the same period">
        <h2 className="font-semibold text-fg">Differences over the same period</h2>
        {comparisonSummary.warning ? <p className="mt-2 text-sm text-muted">{comparisonSummary.warning}</p> : <>
          <p className="mt-1 text-xs text-muted">{comparisonSummary.period?.start} to {comparisonSummary.period?.end}</p>
          {comparisonSummary.differences.length ? <ul className="mt-2 list-inside list-disc text-sm text-fg">{comparisonSummary.differences.map(text=><li key={text}>{text}</li>)}</ul> : <p className="mt-2 text-sm text-muted">No gaps reach the thresholds below.</p>}
          <p className="mt-2 text-xs text-muted">{comparisonSummary.basis}</p>
        </>}
      </section>}
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
                <span className="text-xs text-faint">Common window: {fmtDate(earliest)} – {fmtDate(latest)}</span>
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
              Available <strong>{storedHorizon} fixed-window</strong> metrics are shown below. Live NAV for a custom
              date range may be loading or unavailable. Funds held for source verification have no return metrics;
              other baseline figures use the published snapshot.
            </div>
          )}

          {/* Basis note when live metrics aren't fully loaded */}
          {earliest && !allLive && (
            <p className="mt-3 text-xs text-faint">
              Showing baseline <strong>{storedHorizon}</strong> metrics where available. Live metrics require valid observations for your
              selected range.
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
                  const leaderV =
                    winner >= 0 ? (effective(funds[winner]).m?.[row.key] as number | undefined) : undefined
                  return (
                    <tr key={row.label} className="border-b border-line">
                      <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">{row.label}</td>
                      {funds.map((f, i) => {
                        const m = effective(f).m
                        const v = m ? (m[row.key] as number | undefined) : undefined
                        const debtNA = usesReducedSurface(f) && ['sharpe', 'sortino', 'maxDrawdown', 'calmar'].includes(row.key)
                        const isWinner = i === winner && funds.length > 1
                        const period = row.sub ? periodFor(f, row.key) : ''
                        return (
                          <td key={f.code} className="px-4 py-3 text-right align-top">
                            {debtNA ? (
                              <span className="text-faint">n/a</span>
                            ) : typeof v !== 'number' || !Number.isFinite(v) ? (
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
                                {!isWinner &&
                                  funds.length > 1 &&
                                  typeof leaderV === 'number' &&
                                  !isNaN(leaderV as number) && (
                                    <div className="mt-0.5 text-xs leading-tight text-faint">
                                      {fmtDelta(
                                        row.better === 'high'
                                          ? (v as number) - (leaderV as number)
                                          : (leaderV as number) - (v as number),
                                        row.unit,
                                      )}
                                    </div>
                                  )}
                                {period && <div className="mt-0.5 text-xs leading-tight text-faint">{period}</div>}
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
                    Manager record
                  </td>
                  {funds.map((f) => {
                    const sig = f.management?.signal
                    const disp =
                      sig === 'Strong' ? 'Above category'
                      : sig === 'Solid' ? 'In line'
                      : sig === 'Mixed' ? 'Mixed record'
                      : sig
                    return (
                      <td key={f.code} className="px-4 py-3 text-right font-semibold text-fg">
                        {f.management?.available ? disp : '—'}
                      </td>
                    )
                  })}
                </tr>
                {/* Consistency (batting average) */}
                <tr className="border-b border-line">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">
                    Consistency
                    <InfoTip label="About consistency" align="left" width={280}>
                      Share of measured, overlapping 3Y periods beating category median.
                      The periods overlap, so the observations are related.
                    </InfoTip>
                  </td>
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
                    const label = dir === 'climbing' ? 'Climbing' : dir === 'fading' ? 'Fading' : dir === 'steady' ? 'Steady' : '—'
                    return <td key={f.code} className={`px-4 py-3 text-right font-semibold ${tone}`}>{label}</td>
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
                  <td className="sticky left-0 z-10 border-r border-line bg-surface px-4 py-3 text-muted">Recent return versus history</td>
                  {funds.map((f) => {
                    const mr = f.analytics?.meanReversion
                    if (!mr) return <td key={f.code} className="px-4 py-3 text-right text-faint">—</td>
                    const label = mr.state === 'hot' ? 'Above historical average' : mr.state === 'cold' ? 'Below historical average' : 'Near historical average'
                    return <td key={f.code} className="px-4 py-3 text-right text-fg">{label}</td>
                  })}
                </tr>
                {/* FINAL VERDICT (#18) - overall conviction fusing backward + forward */}
                <tr className="border-t-2 border-line bg-surface2/40">
                  <td className="sticky left-0 z-10 border-r border-line bg-surface2 px-4 py-3 font-bold text-fg">
                    Composite score
                  </td>
                  {funds.map((f, i) => {
                    if (navIssues[f.code] || f.dataQuality?.status === 'quarantined') return <td key={f.code} className="px-4 py-3 text-right text-faint">No score</td>
                    if (usesReducedSurface(f)) {
                      const dv = buildDebtVerdict(f, ALL_FUNDS)
                      return (
                        <td key={f.code} className="px-4 py-3 text-right align-top">
                          {dv.scored && dv.score != null ? (
                            <div className="inline-flex flex-col items-end">
                              <span className="font-bold text-fg">{dv.score}/100</span>
                              <span className="text-xs text-faint">{dv.peerSet}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-faint">No score<span className="block text-xs">{dv.tier === 3 ? 'rate/credit data unavailable' : 'full-period return unavailable'}</span></span>
                          )}
                        </td>
                      )
                    }
                    if (!f.metrics['3Y'] && !f.metrics['5Y'] && !f.metrics['1Y']) return <td key={f.code} className="px-4 py-3 text-right text-faint">No score</td>
                    const v = verdicts[i]
                    const isWin = i === verdictWinner && funds.length > 1
                    return (
                      <td key={f.code} className="px-4 py-3 text-right align-top">
                        <div className={`inline-flex flex-col items-end ${isWin ? winClass : ''}`}>
                          <span className="font-bold text-fg">{v.score}/100</span>
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
              Each series is rebased to ₹100 using its available NAV observations within the selected period.
              Available dates can differ between funds.
            </p>
            <CompareChart funds={funds} navData={safeNavData} start={start} end={end} colors={COLORS} loading={navLoading} />
          </div>

          {/* Holdings overlap */}
          <div id="overlap">
            <HoldingsOverlap funds={funds} loading={holdingsLoading} loadTick={holdingsTick} />
          </div>
        </>
      )}
    </div>
  )
}
