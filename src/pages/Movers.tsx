import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { funds } from '../lib/data'
import { fundSlug } from '../lib/format'
import type { Fund } from '../types'
import ShareButton from '../components/ShareButton'

// "Movers" — one holistic board for every time-shift signal we can measure
// cleanly from the index: fund size (AUM), category rank, and return momentum.
// For fund size we show the LATEST AUM as an anchor column plus parallel change
// columns over 1M / 3M / 6M (6M appears once history is deep enough), switchable
// between rupee and percent terms. Every numeric column header is sortable.

type Metric = 'aum' | 'rank' | 'momentum' | 'debtView'
type Dir = 'all' | 'up' | 'down'
type MomPair = '1Y-3Y' | '1Y-5Y'
type AumMode = 'abs' | 'pct'
type Tone = 'pos' | 'neg' | 'mute'

function fmtCrore(cr: number): string {
  const a = Math.abs(cr)
  if (a >= 100000) return `₹${(cr / 100000).toFixed(1)}L Cr`
  if (a >= 1000) return `₹${(cr / 1000).toFixed(1)}K Cr`
  return `₹${cr.toFixed(0)} Cr`
}
function monthLabel(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

interface Cell {
  label: string
  text?: string
  sub?: string
  tone?: Tone
  sortVal?: number       // present => column is sortable
  spark?: number[]       // present => render a trend sparkline instead of text
  muted?: boolean        // dim "no data yet" cells
}
interface Row {
  fund: Fund
  value: number          // primary signal magnitude (default sort)
  up: boolean
  cells: Cell[]
}

const METRICS: { key: Metric; label: string; blurb: string }[] = [
  { key: 'aum', label: 'Fund size', blurb: 'Latest assets under management and how the book has grown or shrunk over 1, 3 and 6 months.' },
  { key: 'rank', label: 'Category rank', blurb: 'Funds climbing or slipping in their category ranking.' },
  { key: 'momentum', label: 'Return momentum', blurb: 'Funds whose recent return is running ahead of (or behind) their longer-term track record.' },
  { key: 'debtView', label: 'Debt / Cash', blurb: 'Liquid, money market and arbitrage funds compared by AUM and expense ratio — the two levers that matter most for these categories.' },
]

// AUM change windows shown as parallel columns.
const AUM_WINDOWS: { steps: number; label: string }[] = [
  { steps: 1, label: '1M' },
  { steps: 3, label: '3M' },
  { steps: 6, label: '6M' },
]

export default function Movers() {
  usePageMeta('Movers', 'Funds ranked by the biggest recent shifts in size, rank and return momentum.')
  const [metric, setMetric] = useState<Metric>('aum')
  const [aumMode, setAumMode] = useState<AumMode>('abs')
  const [momPair, setMomPair] = useState<MomPair>('1Y-3Y')
  const [dir, setDir] = useState<Dir>('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  // sortCol = null => default (by primary signal magnitude, desc)
  const [sort, setSort] = useState<{ col: number | null; dir: 'asc' | 'desc' }>({ col: null, dir: 'desc' })

  // Deepest series available, so the 6M column only turns "live" once >=6 months exist.
  const maxSteps = useMemo(
    () => funds.reduce((m, f) => Math.max(m, (f.aum && f.aum.series ? f.aum.series.length - 1 : 0)), 0),
    []
  )

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const f of funds) {
      if (metric === 'aum') {
        const s = f.aum?.series
        if (!s || s.length < 2) continue
        const n = s.length
        const [endDate, endVal] = s[n - 1]
        if (!(endVal > 0)) continue

        // Latest AUM anchor column.
        const cells: Cell[] = [
          { label: 'Latest AUM', text: fmtCrore(endVal), sub: monthLabel(endDate), sortVal: endVal },
        ]
        // Parallel change columns over each window.
        let biggest1m = 0
        for (const w of AUM_WINDOWS) {
          const startIdx = n - 1 - w.steps
          if (startIdx < 0) {
            cells.push({ label: w.label, text: '—', tone: 'mute', muted: true })
            continue
          }
          const startVal = s[startIdx][1]
          if (!(startVal > 0)) { cells.push({ label: w.label, text: '—', tone: 'mute', muted: true }); continue }
          const abs = endVal - startVal
          const pct = (abs / startVal) * 100
          const up = abs >= 0
          const text = aumMode === 'abs'
            ? `${up ? '+' : '−'}${fmtCrore(Math.abs(abs))}`
            : `${up ? '+' : ''}${pct.toFixed(1)}%`
          cells.push({ label: w.label, text, tone: abs === 0 ? 'mute' : up ? 'pos' : 'neg', sortVal: aumMode === 'abs' ? abs : pct })
          if (w.steps === 1) biggest1m = aumMode === 'abs' ? abs : pct
        }
        cells.push({ label: 'Trend', spark: s.map((p) => p[1]) })
        out.push({ fund: f, up: biggest1m >= 0, value: endVal, cells })
      } else if (metric === 'rank') {
        const rt = f.analytics?.rankTrajectory
        if (!rt || rt.currentRank == null || rt.priorRank == null) continue
        const move = rt.priorRank - rt.currentRank // positive = climbed
        if (move === 0) continue
        const up = move > 0
        out.push({
          fund: f, up, value: move,
          cells: [
            { label: 'Was', text: `#${rt.priorRank}${rt.priorPeers ? ` / ${rt.priorPeers}` : ''}`, tone: 'mute', sortVal: rt.priorRank },
            { label: 'Now', text: `#${rt.currentRank}${rt.currentPeers ? ` / ${rt.currentPeers}` : ''}`, sortVal: rt.currentRank },
            { label: 'Move', text: `${up ? '▲ +' : '▼ −'}${Math.abs(move)}`, tone: up ? 'pos' : 'neg', sortVal: move },
          ],
        })
      } else if (metric === 'debtView') {
        if (!f.isDebt && !f.isArbitrage) continue
        const aum = f.aum?.current ?? null
        const ter = typeof f.expenseRatio === 'number' ? f.expenseRatio : typeof f.expenseRatio === 'string' ? parseFloat(f.expenseRatio) : null
        if (aum == null && ter == null) continue
        const cells: Cell[] = [
          {
            label: 'AUM',
            text: aum != null ? fmtCrore(aum) : '—',
            sortVal: aum ?? -Infinity,
            tone: aum != null ? (aum >= 1000 ? 'pos' : aum < 100 ? 'neg' : undefined) : undefined,
          },
          {
            label: 'Expense',
            text: ter != null && !isNaN(ter) ? `${ter.toFixed(2)}%` : '—',
            sortVal: ter != null && !isNaN(ter) ? ter : Infinity,
            tone: ter != null && !isNaN(ter) ? (ter <= 0.15 ? 'pos' : ter >= 0.3 ? 'neg' : undefined) : undefined,
          },
        ]
        out.push({ fund: f, value: aum ?? 0, up: true, cells })
      } else {
        const m = f.metrics
        const short = m?.['1Y']?.cagr
        const long = momPair === '1Y-3Y' ? m?.['3Y']?.cagr : m?.['5Y']?.cagr
        if (short == null || long == null) continue
        const spread = short - long
        const up = spread >= 0
        out.push({
          fund: f, up, value: spread,
          cells: [
            { label: '1Y', text: `${short.toFixed(1)}%`, sortVal: short },
            { label: momPair === '1Y-3Y' ? '3Y' : '5Y', text: `${long.toFixed(1)}%`, tone: 'mute', sortVal: long },
            { label: 'Gap', text: `${up ? '+' : ''}${spread.toFixed(1)} pts`, tone: up ? 'pos' : 'neg', sortVal: spread },
          ],
        })
      }
    }
    return out
  }, [metric, aumMode, momPair])

  const categories = useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) if (r.fund.category) s.add(r.fund.category)
    return ['all', ...Array.from(s).sort()]
  }, [rows])

  const filtered = useMemo(() => {
    let r = rows
    if (dir === 'up') r = r.filter((x) => x.up)
    else if (dir === 'down') r = r.filter((x) => !x.up)
    if (category !== 'all') r = r.filter((x) => x.fund.category === category)
    const q = query.trim().toLowerCase()
    if (q) r = r.filter((x) => x.fund.name.toLowerCase().includes(q))
    const arr = [...r]
    if (sort.col == null) {
      arr.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    } else {
      const c = sort.col
      const mul = sort.dir === 'asc' ? 1 : -1
      arr.sort((a, b) => {
        const av = a.cells[c]?.sortVal ?? 0
        const bv = b.cells[c]?.sortVal ?? 0
        return (av - bv) * mul
      })
    }
    return arr
  }, [rows, dir, category, query, sort])

  const dirLabels: Record<Metric, [string, string]> = {
    aum: ['Inflows', 'Outflows'],
    rank: ['Climbers', 'Fallers'],
    momentum: ['Heating up', 'Cooling'],
    debtView: ['Larger', 'Smaller'],
  }
  const active = METRICS.find((m) => m.key === metric)!
  const headerCells = filtered[0]?.cells ?? rows[0]?.cells ?? []

  function toggleSort(col: number) {
    setSort((s) => {
      if (s.col !== col) return { col, dir: 'desc' }
      if (s.dir === 'desc') return { col, dir: 'asc' }
      return { col: null, dir: 'desc' } // third click clears back to default
    })
  }
  function changeMetric(k: Metric) {
    setMetric(k); setDir('all'); setSort({ col: null, dir: 'desc' })
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">Movers</h1>
        <ShareButton title="Movers" text="Fund size, category rank and return momentum movers on FairFund" className="mt-0.5 shrink-0" />
      </div>
      <p className="mt-1 text-sm text-muted">{active.blurb}</p>

      {/* Metric selector */}
      <div className="mt-5 flex flex-wrap gap-2">
        {METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => changeMetric(m.key)}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              metric === m.key ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-muted hover:text-fg'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Sub-controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {metric === 'aum' && (
          <>
            <div className="inline-flex overflow-hidden rounded-full border border-line">
              <button
                onClick={() => setAumMode('abs')}
                className={`px-3 py-1.5 text-sm font-medium transition ${aumMode === 'abs' ? 'bg-brand-600 text-white' : 'bg-surface text-muted hover:text-fg'}`}
              >₹</button>
              <button
                onClick={() => setAumMode('pct')}
                className={`px-3 py-1.5 text-sm font-medium transition ${aumMode === 'pct' ? 'bg-brand-600 text-white' : 'bg-surface text-muted hover:text-fg'}`}
              >%</button>
            </div>
            <span className="mx-1 h-5 w-px bg-line" />
          </>
        )}
        {metric === 'momentum' && (
          <>
            <Pill active={momPair === '1Y-3Y'} onClick={() => setMomPair('1Y-3Y')}>1Y vs 3Y</Pill>
            <Pill active={momPair === '1Y-5Y'} onClick={() => setMomPair('1Y-5Y')}>1Y vs 5Y</Pill>
            <span className="mx-1 h-5 w-px bg-line" />
          </>
        )}
        <Pill active={dir === 'all'} onClick={() => setDir('all')}>All</Pill>
        {metric !== 'debtView' && (
          <>
            <Pill active={dir === 'up'} onClick={() => setDir('up')}>{dirLabels[metric][0]}</Pill>
            <Pill active={dir === 'down'} onClick={() => setDir('down')}>{dirLabels[metric][1]}</Pill>
          </>
        )}
        <span className="mx-1 h-5 w-px bg-line" />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg">
          {categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fund…"
          className="min-w-[160px] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-faint" />
      </div>

      <p className="mt-3 text-xs text-faint">
        {filtered.length} funds
        {sort.col == null ? (metric === 'aum' ? ' · sorted by latest AUM' : metric === 'debtView' ? ' · sorted by AUM' : ' · sorted by biggest move') : ' · tap a column to re-sort'}
        {metric === 'aum' && maxSteps < 6 && <> · 6M change fills in as history builds</>}
      </p>

      <div className="mt-2 overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface2 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Fund</th>
              {headerCells.map((c, i) => {
                const activeSort = sort.col === i
                const sortable = c.sortVal != null
                return (
                  <th key={i} className="px-4 py-2.5 text-right font-medium">
                    {sortable ? (
                      <button
                        onClick={() => toggleSort(i)}
                        className={`inline-flex items-center gap-1 transition hover:text-fg ${activeSort ? 'text-brand-600 dark:text-brand-400' : ''}`}
                        title={`Sort by ${c.label}`}
                      >
                        {c.label}
                        <span className="text-[10px] leading-none">{activeSort ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.fund.code} className="border-b border-line/60 last:border-0 hover:bg-surface2/60">
                <td className="px-4 py-2.5 text-faint">{i + 1}</td>
                <td className="px-4 py-2.5">
                  <Link to={`/fund/${r.fund.code}/${fundSlug(r.fund.name)}`} className="font-medium text-fg hover:text-brand-600">
                    {r.fund.name}
                  </Link>
                  <div className="text-xs text-faint">{r.fund.categoryDisplay || r.fund.category}</div>
                </td>
                {r.cells.map((c, j) => (
                  <td key={j} className={`px-4 py-2.5 text-right tabular-nums ${
                    c.muted ? 'text-faint'
                    : c.tone === 'pos' ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                    : c.tone === 'neg' ? 'font-semibold text-red-500 dark:text-red-400'
                    : c.tone === 'mute' ? 'text-muted' : 'text-fg'
                  }`}>
                    {c.spark ? (
                      <Spark data={c.spark} up={r.up} />
                    ) : (
                      <>
                        {c.text}
                        {c.sub && <div className="text-[11px] font-normal text-faint">{c.sub}</div>}
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={2 + headerCells.length} className="px-4 py-10 text-center text-sm text-muted">No funds match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {metric === 'aum' && (
        <p className="mt-3 text-xs text-faint">
          AUM is month-end assets under management. The 1M / 3M / 6M columns show the change over that
          many months, in rupees (₹) or percent (%). Toggle above. Debt and liquid funds appear here once
          they have at least two months of AUM history.
        </p>
      )}
      {metric === 'momentum' && (
        <p className="mt-3 text-xs text-faint">
          Momentum compares a fund's recent (1Y) annualised return with its longer-term ({momPair === '1Y-3Y' ? '3Y' : '5Y'}) return.
          A positive gap means it is running hotter than its own track record; negative means it is cooling. This is a
          return signal, not a buy call - a hot short-term number can mean rich valuations as easily as durable improvement.
        </p>
      )}
      {metric === 'debtView' && (
        <p className="mt-3 text-xs text-faint">
          Liquid, money market and arbitrage funds sorted by AUM (largest first by default). For these categories, gross returns
          are near-identical because SEBI caps what they can hold. The expense ratio is the single biggest driver of what you keep,
          and AUM is a proxy for stability and redemption liquidity. Green AUM = Rs 1,000 Cr or more; green expense = 0.15% or
          below. Click any column header to re-sort. Use the category filter to isolate Liquid, Money Market or Arbitrage.
        </p>
      )}
    </div>
  )
}

function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return null
  const w = 62, h = 18, pad = 2
  const min = Math.min(...data), max = Math.max(...data)
  const rng = max - min || 1
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - 2 * pad)
  const y = (v: number) => pad + (1 - (v - min) / rng) * (h - 2 * pad)
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const stroke = up ? '#059669' : '#ef4444'
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="ml-auto block" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r={1.8} fill={stroke} />
    </svg>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-muted hover:text-fg'
      }`}>
      {children}
    </button>
  )
}
