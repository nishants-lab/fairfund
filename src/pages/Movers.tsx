import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { funds } from '../lib/data'
import { fundSlug } from '../lib/format'
import type { Fund } from '../types'
import ShareButton from '../components/ShareButton'

// "Movers" — one holistic board for every time-shift signal we can measure
// cleanly from the index: fund size (AUM), category rank, and return momentum.
// AUM reads the FULL monthly series (aum.series), so the change window is
// user-selectable and the option list auto-extends as history deepens (1M, 3M
// today; 6M / 1Y appear automatically once enough months exist). Every numeric
// column header is clickable to sort.

type Metric = 'aum' | 'rank' | 'momentum'
type Dir = 'all' | 'up' | 'down'
type MomPair = '1Y-3Y' | '1Y-5Y'
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
}
interface Row {
  fund: Fund
  value: number          // primary signal magnitude (default sort)
  up: boolean
  cells: Cell[]
}

const METRICS: { key: Metric; label: string; blurb: string }[] = [
  { key: 'aum', label: 'Fund size', blurb: 'Biggest change in assets under management.' },
  { key: 'rank', label: 'Category rank', blurb: 'Funds climbing or slipping in their category ranking.' },
  { key: 'momentum', label: 'Return momentum', blurb: 'Funds whose recent return is running ahead of (or behind) their longer-term track record.' },
]

export default function Movers() {
  usePageMeta('Movers', 'Funds ranked by the biggest recent shifts in size, rank and return momentum.')
  const [metric, setMetric] = useState<Metric>('aum')
  const [aumWin, setAumWin] = useState('1m')
  const [momPair, setMomPair] = useState<MomPair>('1Y-3Y')
  const [dir, setDir] = useState<Dir>('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  // sortCol = null => default (by primary signal magnitude, desc)
  const [sort, setSort] = useState<{ col: number | null; dir: 'asc' | 'desc' }>({ col: null, dir: 'desc' })

  // AUM window options — derived from the deepest series available, so 6M / 1Y
  // surface on their own once the history is long enough.
  const maxLen = useMemo(
    () => funds.reduce((m, f) => Math.max(m, (f.aum && f.aum.series ? f.aum.series.length : 0)), 0),
    []
  )
  const aumWindows = useMemo(() => {
    const opts: { key: string; steps: number; label: string }[] = [{ key: '1m', steps: 1, label: '1M' }]
    const maxSteps = maxLen - 1
    if (maxSteps >= 3) opts.push({ key: '3m', steps: 3, label: '3M' })
    if (maxSteps >= 6) opts.push({ key: '6m', steps: 6, label: '6M' })
    if (maxSteps >= 12) opts.push({ key: '12m', steps: 12, label: '1Y' })
    if (maxSteps >= 2 && !opts.some((o) => o.steps >= maxSteps)) opts.push({ key: 'max', steps: maxSteps, label: 'Max' })
    return opts
  }, [maxLen])
  const winSteps = (aumWindows.find((o) => o.key === aumWin) ?? aumWindows[0]).steps

  // Global earliest month across all series (for the "Max" window caption).
  const earliestMonth = useMemo(() => {
    let e = ''
    for (const f of funds) {
      const s = f.aum?.series
      if (s && s.length && (!e || s[0][0] < e)) e = s[0][0]
    }
    return e
  }, [])

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const f of funds) {
      if (metric === 'aum') {
        const s = f.aum?.series
        if (!s || s.length < 2) continue
        const n = s.length
        const startIdx = Math.max(0, n - 1 - winSteps)
        if (startIdx >= n - 1) continue
        const [startDate, startVal] = s[startIdx]
        const [endDate, endVal] = s[n - 1]
        if (!(startVal > 0)) continue
        const abs = endVal - startVal
        const pct = (abs / startVal) * 100
        const up = abs >= 0
        out.push({
          fund: f, up, value: pct,
          cells: [
            { label: 'From', text: fmtCrore(startVal), sub: monthLabel(startDate), tone: 'mute', sortVal: startVal },
            { label: 'Now', text: fmtCrore(endVal), sub: monthLabel(endDate), sortVal: endVal },
            { label: 'Trend', spark: s.map((p) => p[1]) },
            { label: 'Δ ₹', text: `${up ? '+' : '−'}${fmtCrore(Math.abs(abs))}`, tone: up ? 'pos' : 'neg', sortVal: abs },
            { label: 'Δ %', text: `${up ? '+' : ''}${pct.toFixed(1)}%`, tone: up ? 'pos' : 'neg', sortVal: pct },
          ],
        })
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
  }, [metric, winSteps, momPair])

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

  const winCaption =
    metric !== 'aum' ? '' :
    aumWin === '1m' ? 'month over month' :
    aumWin === 'max' ? (earliestMonth ? `since ${monthLabel(earliestMonth)}` : 'full history') :
    `over ${winSteps} months`

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">Movers</h1>
        <ShareButton title="Movers" text="Fund size, category rank and return momentum movers on FairFund" className="mt-0.5 shrink-0" />
      </div>
      <p className="mt-1 text-sm text-muted">
        {active.blurb}
        {metric === 'aum' && winCaption && (
          <> {' · '}<span className="font-medium text-fg">{winCaption}</span></>
        )}
      </p>

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
        {metric === 'aum' && aumWindows.length > 1 && (
          <>
            {aumWindows.map((w) => (
              <Pill key={w.key} active={aumWin === w.key} onClick={() => setAumWin(w.key)}>{w.label}</Pill>
            ))}
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
        <Pill active={dir === 'up'} onClick={() => setDir('up')}>{dirLabels[metric][0]}</Pill>
        <Pill active={dir === 'down'} onClick={() => setDir('down')}>{dirLabels[metric][1]}</Pill>
        <span className="mx-1 h-5 w-px bg-line" />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg">
          {categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fund…"
          className="min-w-[160px] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-faint" />
      </div>

      <p className="mt-3 text-xs text-faint">
        {filtered.length} funds{sort.col == null ? ' · sorted by biggest move' : ' · tap a column to re-sort'}
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
                    c.tone === 'pos' ? 'font-semibold text-emerald-600 dark:text-emerald-400'
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

      {metric === 'momentum' && (
        <p className="mt-3 text-xs text-faint">
          Momentum compares a fund's recent (1Y) annualised return with its longer-term ({momPair === '1Y-3Y' ? '3Y' : '5Y'}) return.
          A positive gap means it is running hotter than its own track record; negative means it is cooling. This is a
          return signal, not a buy call - a hot short-term number can mean rich valuations as easily as durable improvement.
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
