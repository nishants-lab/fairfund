import { useState, useEffect } from 'react'
import { fetchNavHistory } from '../lib/nav'
import type { NavPoint } from '../types'

/** Indices to show, using benchmark proxy fund NAVs (track the index within bps). */
const INDICES = [
  { code: 147666, label: 'Nifty 100', sub: 'Large Cap' },
  { code: 147622, label: 'Midcap 150', sub: 'Mid Cap' },
  { code: 147623, label: 'Smallcap 250', sub: 'Small Cap' },
  { code: 147625, label: 'Nifty 500', sub: 'Broad market' },
] as const

interface IndexData {
  label: string
  sub: string
  nav: number
  date: string
  chg1D: number | null
  chg1W: number | null
  chg1M: number | null
  chgYTD: number | null
  spark: number[] // last 30 nav values for sparkline
}

function pctChange(now: number, then: number): number {
  return ((now - then) / then) * 100
}

function findNavAtOrBefore(pts: NavPoint[], targetDate: string): NavPoint | null {
  let lo = 0, hi = pts.length - 1, best: NavPoint | null = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (pts[mid].date <= targetDate) { best = pts[mid]; lo = mid + 1 }
    else hi = mid - 1
  }
  return best
}

function computeIndex(pts: NavPoint[], label: string, sub: string): IndexData | null {
  if (pts.length < 2) return null
  const latest = pts[pts.length - 1]
  const prev = pts[pts.length - 2]

  const now = new Date()
  const d1w = new Date(now); d1w.setDate(d1w.getDate() - 7)
  const d1m = new Date(now); d1m.setMonth(d1m.getMonth() - 1)
  const dYtd = `${now.getFullYear()}-01-01`

  const p1w = findNavAtOrBefore(pts, d1w.toISOString().slice(0, 10))
  const p1m = findNavAtOrBefore(pts, d1m.toISOString().slice(0, 10))
  const pYtd = findNavAtOrBefore(pts, dYtd)

  return {
    label, sub,
    nav: latest.nav,
    date: latest.date,
    chg1D: pctChange(latest.nav, prev.nav),
    chg1W: p1w ? pctChange(latest.nav, p1w.nav) : null,
    chg1M: p1m ? pctChange(latest.nav, p1m.nav) : null,
    chgYTD: pYtd ? pctChange(latest.nav, pYtd.nav) : null,
    spark: pts.slice(-30).map(p => p.nav),
  }
}

/** Tiny SVG sparkline, green if up, red if down. */
function MiniSpark({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null
  const w = 56, h = 24, pad = 2
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - 2 * pad)
    const y = pad + (1 - (v - min) / range) * (h - 2 * pad)
    return `${x},${y}`
  }).join(' ')
  const up = data[data.length - 1] >= data[0]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`shrink-0 ${className ?? ''}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? '#10b981' : '#ef4444'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function fmtPct(v: number | null): string {
  if (v == null) return '--'
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function chgColor(v: number | null): string {
  if (v == null) return 'text-faint'
  return v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

export default function MarketPulse() {
  const [indices, setIndices] = useState<IndexData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const results = await Promise.allSettled(
        INDICES.map(async (idx) => {
          const pts = await fetchNavHistory(idx.code)
          return computeIndex(pts, idx.label, idx.sub)
        })
      )
      if (cancelled) return
      const data = results
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter(Boolean) as IndexData[]
      setIndices(data)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[0,1,2,3].map(i => (
          <div key={i} className="animate-pulse rounded-xl bg-surface2/60 h-20" />
        ))}
      </div>
    )
  }

  if (indices.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {indices.map((idx) => (
        <div key={idx.label} className="overflow-hidden rounded-xl border border-line bg-surface px-3 py-2.5">
          {/* Row 1: label + sparkline */}
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold leading-tight text-fg">{idx.label}</div>
              <div className="text-[9px] leading-tight text-faint">{idx.sub}</div>
            </div>
            <MiniSpark data={idx.spark} className="h-5 w-10" />
          </div>
          {/* Row 2: 1D change prominent */}
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className={`text-base font-bold tabular-nums leading-none ${chgColor(idx.chg1D)}`}>
              {fmtPct(idx.chg1D)}
            </span>
            <span className="text-[9px] text-faint">1D</span>
          </div>
          {/* Row 3: secondary returns */}
          <div className="mt-1 flex gap-2 text-[9px] tabular-nums text-muted">
            <span>1W <span className={chgColor(idx.chg1W)}>{fmtPct(idx.chg1W)}</span></span>
            <span>1M <span className={chgColor(idx.chg1M)}>{fmtPct(idx.chg1M)}</span></span>
            <span>YTD <span className={chgColor(idx.chgYTD)}>{fmtPct(idx.chgYTD)}</span></span>
          </div>
        </div>
      ))}
    </div>
  )
}
