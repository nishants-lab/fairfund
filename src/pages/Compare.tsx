import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getFund } from '../lib/data'
import SearchBox from '../components/SearchBox'
import RangeSelector, { type Preset } from '../components/RangeSelector'
import CompareChart from '../components/CompareChart'
import HoldingsOverlap from '../components/HoldingsOverlap'
import { fetchNavHistory } from '../lib/nav'
import { computeMetrics, sliceByRange, presetRange, fmtDate, type ComputedMetrics } from '../lib/metrics'
import { pct, signedPct, num, alphaColor } from '../lib/format'
import type { Fund, NavPoint } from '../types'

const COLORS = ['#2563eb', '#10b981', '#f59e0b']

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const [funds, setFunds] = useState<Fund[]>([])
  const [navData, setNavData] = useState<Record<number, NavPoint[]>>({})

  // Shared range across all compared funds
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [preset, setPreset] = useState<Preset>('3Y')

  // Load funds from URL on mount
  useEffect(() => {
    const codes = (params.get('codes') ?? '')
      .split(',')
      .map((c) => Number(c))
      .filter((c) => !isNaN(c) && c > 0)
    const loaded = codes.map((c) => getFund(c)).filter(Boolean) as Fund[]
    setFunds(loaded)
  }, [])

  // Fetch NAV for any newly added fund
  useEffect(() => {
    funds.forEach((f) => {
      if (!navData[f.code]) {
        fetchNavHistory(f.code)
          .then((pts) => setNavData((prev) => ({ ...prev, [f.code]: pts })))
          .catch(() => {})
      }
    })
  }, [funds])

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
    if (funds.find((f) => f.code === fund.code) || funds.length >= 3) return
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

  const rows: { label: string; key: keyof ComputedMetrics; fmt: (v: number) => string; better: 'high' | 'low' }[] = [
    { label: 'CAGR', key: 'cagr', fmt: (v) => pct(v), better: 'high' },
    { label: 'Total Return', key: 'totalReturn', fmt: (v) => pct(v), better: 'high' },
    { label: 'Sharpe Ratio', key: 'sharpe', fmt: (v) => num(v), better: 'high' },
    { label: 'Sortino Ratio', key: 'sortino', fmt: (v) => num(v), better: 'high' },
    { label: 'Max Drawdown', key: 'maxDrawdown', fmt: (v) => pct(v), better: 'high' },
    { label: 'Calmar Ratio', key: 'calmar', fmt: (v) => num(v), better: 'high' },
    { label: 'Volatility', key: 'volatility', fmt: (v) => pct(v), better: 'low' },
    { label: 'Worst Month', key: 'worst1M', fmt: (v) => signedPct(v), better: 'high' },
  ]

  function bestIdx(key: keyof ComputedMetrics, better: 'high' | 'low'): number {
    let best = -1
    let bestVal = better === 'high' ? -Infinity : Infinity
    funds.forEach((f, i) => {
      const m = liveMetrics[f.code]
      if (!m) return
      const v = m[key] as number
      if (better === 'high' ? v > bestVal : v < bestVal) {
        bestVal = v
        best = i
      }
    })
    return best
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Compare Funds</h1>
      <p className="mt-1 text-sm text-muted">
        Add up to 3 funds and compare them over <strong>any time period you choose</strong>. Metrics
        recompute live. Same category gives the cleanest comparison; mixing categories is allowed —
        we’ll flag it.
      </p>

      {funds.length < 3 && (
        <div className="mt-5 max-w-xl">
          <SearchBox placeholder="Add a fund to compare…" onPick={add} />
        </div>
      )}

      {crossCategory && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          <span className="text-fg">⚠️</span>
          <div>
            <strong>You’re comparing different categories.</strong> These funds carry different risk
            levels, so raw returns aren’t apples-to-apples. A small-cap “winning” on CAGR is expected —
            it takes more risk. Weigh the risk metrics (drawdown, volatility) alongside returns.
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
                  <div className="text-sm font-semibold text-fg">{f.name}</div>
                  <div className="text-xs text-faint">{f.categoryDisplay}</div>
                </div>
                <button onClick={() => remove(f.code)} className="ml-2 text-faint hover:text-rose-500">✕</button>
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
            <div className="mt-5 text-sm text-faint">Loading NAV data…</div>
          )}

          {/* Comparison table */}
          <div
            className="mt-5 overflow-x-auto rounded-2xl border border-line bg-surface"
            style={{ maxWidth: 240 + funds.length * 200 }}
          >
            <table className="w-full text-sm" style={{ minWidth: 160 + funds.length * 130 }}>
              <thead>
                <tr className="border-b border-line bg-surface2">
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-faint">Metric</th>
                  {funds.map((f, i) => (
                    <th key={f.code} className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                        <span className="max-w-[120px] truncate text-xs font-semibold text-fg">{f.name}</span>
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
                      <td className="px-4 py-3 text-muted">{row.label}</td>
                      {funds.map((f, i) => {
                        const m = liveMetrics[f.code]
                        const v = m ? (m[row.key] as number) : undefined
                        const isWinner = i === winner && funds.length > 1 && !crossCategory
                        return (
                          <td key={f.code} className="px-4 py-3 text-right">
                            {v === undefined ? (
                              <span className="text-faint">…</span>
                            ) : (
                              <span
                                className={`font-semibold text-fg ${
                                  isWinner ? 'rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : ''
                                }`}
                              >
                                {row.fmt(v)}
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
                {/* Static category rank row from baseline analysis */}
                <tr className="bg-surface2/50">
                  <td className="px-4 py-3 text-muted">
                    Category Rank <span className="text-xs text-faint">(3Y baseline)</span>
                  </td>
                  {funds.map((f) => (
                    <td key={f.code} className="px-4 py-3 text-right text-muted">
                      {f.metrics['3Y'] ? `#${f.metrics['3Y'].catRank} / ${f.categorySize}` : '—'}
                    </td>
                  ))}
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
            <CompareChart funds={funds} navData={navData} start={start} end={end} colors={COLORS} />
          </div>

          {/* Holdings overlap */}
          <HoldingsOverlap funds={funds} />
        </>
      )}
    </div>
  )
}
