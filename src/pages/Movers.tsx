import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { funds } from '../lib/data'
import { fundSlug } from '../lib/format'
import type { Fund } from '../types'

// "Movers" — one holistic board for every time-shift signal we can measure
// cleanly from the index: fund size (AUM), category rank, and return momentum.
// AUM shift was just one example; this generalises it. All three read straight
// off funds.json (aum trend, analytics.rankTrajectory, metrics[horizon].cagr),
// so no extra data load is needed.

type Metric = 'aum' | 'rank' | 'momentum'
type AumMode = 'pct' | 'abs'
type Dir = 'all' | 'up' | 'down'
type MomPair = '1Y-3Y' | '1Y-5Y'

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

interface Row {
  fund: Fund
  value: number      // signed magnitude used for ranking (abs taken for sort)
  up: boolean
  cells: { label: string; text: string; tone?: 'pos' | 'neg' | 'mute' }[]
}

const METRICS: { key: Metric; label: string; blurb: string }[] = [
  { key: 'aum', label: 'Fund size', blurb: 'Biggest month-over-month change in assets under management.' },
  { key: 'rank', label: 'Category rank', blurb: 'Funds climbing or slipping in their category ranking.' },
  { key: 'momentum', label: 'Return momentum', blurb: 'Funds whose recent return is running ahead of (or behind) their longer-term track record.' },
]

export default function Movers() {
  usePageMeta('Movers', 'Funds ranked by the biggest recent shifts in size, rank and return momentum.')
  const [metric, setMetric] = useState<Metric>('aum')
  const [aumMode, setAumMode] = useState<AumMode>('pct')
  const [momPair, setMomPair] = useState<MomPair>('1Y-3Y')
  const [dir, setDir] = useState<Dir>('all')
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')

  // AUM period label (data-driven; rolls forward automatically).
  const aumPeriod = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of funds) {
      const a = f.aum
      if (a && typeof a === 'object' && a.changePct != null && a.prevDate && a.asOf)
        counts.set(`${a.prevDate}|${a.asOf}`, (counts.get(`${a.prevDate}|${a.asOf}`) || 0) + 1)
    }
    let best = '', bestN = -1
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n }
    const [p, a] = best.split('|')
    return { prevDate: p, asOf: a }
  }, [])

  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const f of funds) {
      if (metric === 'aum') {
        const a = f.aum
        if (!a || typeof a !== 'object' || a.changePct == null || a.previous == null || !a.prevDate || !a.asOf) continue
        const abs = a.current - a.previous
        const up = abs >= 0
        out.push({
          fund: f, up,
          value: aumMode === 'pct' ? a.changePct : abs,
          cells: [
            { label: monthLabel(a.prevDate), text: fmtCrore(a.previous), tone: 'mute' },
            { label: monthLabel(a.asOf), text: fmtCrore(a.current) },
            { label: 'Δ ₹', text: `${up ? '+' : '−'}${fmtCrore(Math.abs(abs))}`, tone: up ? 'pos' : 'neg' },
            { label: 'Δ %', text: `${up ? '+' : ''}${a.changePct.toFixed(1)}%`, tone: up ? 'pos' : 'neg' },
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
            { label: 'Was', text: `#${rt.priorRank}${rt.priorPeers ? ` / ${rt.priorPeers}` : ''}`, tone: 'mute' },
            { label: 'Now', text: `#${rt.currentRank}${rt.currentPeers ? ` / ${rt.currentPeers}` : ''}` },
            { label: 'Move', text: `${up ? '▲ +' : '▼ −'}${Math.abs(move)}`, tone: up ? 'pos' : 'neg' },
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
            { label: '1Y', text: `${short.toFixed(1)}%` },
            { label: momPair === '1Y-3Y' ? '3Y' : '5Y', text: `${long.toFixed(1)}%`, tone: 'mute' },
            { label: 'Gap', text: `${up ? '+' : ''}${spread.toFixed(1)} pts`, tone: up ? 'pos' : 'neg' },
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
    if (dir === 'up') r = r.filter(x => x.up)
    else if (dir === 'down') r = r.filter(x => !x.up)
    if (category !== 'all') r = r.filter(x => x.fund.category === category)
    const q = query.trim().toLowerCase()
    if (q) r = r.filter(x => x.fund.name.toLowerCase().includes(q))
    return [...r].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  }, [rows, dir, category, query])

  const dirLabels: Record<Metric, [string, string]> = {
    aum: ['Inflows', 'Outflows'],
    rank: ['Climbers', 'Fallers'],
    momentum: ['Heating up', 'Cooling'],
  }
  const active = METRICS.find(m => m.key === metric)!
  const colHeaders = filtered[0]?.cells.map(c => c.label) ?? []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Movers</h1>
      <p className="mt-1 text-sm text-muted">
        {active.blurb}
        {metric === 'aum' && aumPeriod.prevDate && (
          <> {' · '}<span className="font-medium text-fg">{monthLabel(aumPeriod.prevDate)} → {monthLabel(aumPeriod.asOf)}</span></>
        )}
      </p>

      {/* Metric selector */}
      <div className="mt-5 flex flex-wrap gap-2">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => { setMetric(m.key); setDir('all') }}
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
            <Pill active={aumMode === 'pct'} onClick={() => setAumMode('pct')}>By % change</Pill>
            <Pill active={aumMode === 'abs'} onClick={() => setAumMode('abs')}>By ₹ change</Pill>
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
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg">
          {categories.map(c => <option key={c} value={c}>{c === 'all' ? 'All categories' : c}</option>)}
        </select>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search fund…"
          className="min-w-[160px] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-faint" />
      </div>

      <p className="mt-3 text-xs text-faint">{filtered.length} funds</p>

      <div className="mt-2 overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface2 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Fund</th>
              {colHeaders.map((h, i) => (
                <th key={i} className="px-4 py-2.5 text-right font-medium">{h}</th>
              ))}
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
                  }`}>{c.text}</td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={2 + colHeaders.length} className="px-4 py-10 text-center text-sm text-muted">No funds match this filter.</td></tr>
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
