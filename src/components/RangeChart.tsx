import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { useMemo } from 'react'
import { drawdownSeries } from '../lib/nav'
import { useTheme } from '../lib/theme'
import type { NavPoint } from '../types'

interface Props {
  points: NavPoint[] // already sliced to the desired range
  peer?: NavPoint[] // optional benchmark peer (category leader), same range
  peerName?: string
  mode?: 'nav' | 'drawdown'
  loading?: boolean
  error?: boolean
}

const FUND_COLOR = '#2563eb'
const PEER_COLOR = '#94a3b8'

/** Rebase a NAV series to start at 100, so a peer on a different price level is
 *  comparable to this fund on the same axis (relative growth, not rupees). */
function rebase(points: NavPoint[]): { date: string; v: number }[] {
  if (!points.length) return []
  const base = points[0].nav
  return points.map((p) => ({ date: p.date, v: base > 0 ? (p.nav / base) * 100 : 100 }))
}

export default function RangeChart({ points, peer, peerName, mode = 'nav', loading, error }: Props) {
  const { theme } = useTheme()
  const grid = theme === 'dark' ? '#1e293b' : '#f1f5f9'
  const axis = theme === 'dark' ? '#64748b' : '#94a3b8'
  const hasPeer = !!peer && peer.length > 1

  // NAV mode merges fund + peer on a rebased (start=100) scale by date.
  const navMerged = useMemo(() => {
    if (mode !== 'nav') return []
    const f = rebase(points)
    const p = hasPeer ? rebase(peer!) : []
    const byDate = new Map<string, any>()
    f.forEach((d) => byDate.set(d.date, { date: d.date, fund: Math.round(d.v * 10) / 10 }))
    p.forEach((d) => {
      const row = byDate.get(d.date) ?? { date: d.date }
      row.peer = Math.round(d.v * 10) / 10
      byDate.set(d.date, row)
    })
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [points, peer, mode, hasPeer])

  // Drawdown mode merges fund + peer drawdown series by date.
  const ddMerged = useMemo(() => {
    if (mode !== 'drawdown') return []
    const f = drawdownSeries(points)
    const p = hasPeer ? drawdownSeries(peer!) : []
    const byDate = new Map<string, any>()
    f.forEach((d: any) => byDate.set(d.date, { date: d.date, fund: d.dd }))
    p.forEach((d: any) => {
      const row = byDate.get(d.date) ?? { date: d.date }
      row.peer = d.dd
      byDate.set(d.date, row)
    })
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [points, peer, mode, hasPeer])

  if (loading)
    return (
      <div className="space-y-3">
        <div className="skeleton h-64 w-full" />
        <div className="flex items-center justify-center gap-2 text-xs text-faint">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
          Loading live NAV…
        </div>
      </div>
    )
  if (error)
    return (
      <div className="flex h-64 items-center justify-center text-faint">
        Couldn’t load NAV chart (live source unavailable).
      </div>
    )
  if (points.length < 2)
    return (
      <div className="flex h-64 items-center justify-center text-faint">
        Not enough data in this range. Try widening it.
      </div>
    )

  const tooltipStyle = {
    background: theme === 'dark' ? '#0f172a' : '#fff',
    border: `1px solid ${grid}`,
    borderRadius: 12,
    fontSize: 12,
  }
  const legendFmt = (val: string) => (val === 'fund' ? 'This fund' : peerName ?? 'Top peer')

  if (mode === 'drawdown') {
    return (
      <ResponsiveContainer width="100%" height={264}>
        <LineChart data={ddMerged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: axis }} tickFormatter={(d) => d.slice(0, 7)} minTickGap={40} />
          <YAxis tick={{ fontSize: 11, fill: axis }} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number, key: string) => [`${v.toFixed(1)}%`, key === 'fund' ? 'This fund' : peerName ?? 'Top peer']}
          />
          {hasPeer && <Legend formatter={legendFmt} />}
          {hasPeer && <Line type="monotone" dataKey="peer" stroke={PEER_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />}
          <Line type="monotone" dataKey="fund" stroke="#f43f5e" strokeWidth={1.8} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={264}>
      <LineChart data={navMerged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: axis }} tickFormatter={(d) => d.slice(0, 7)} minTickGap={40} />
        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: axis }} tickFormatter={(v) => `₹${v.toFixed(0)}`} width={50} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number, key: string) => [`₹${(v as number).toFixed(1)}`, key === 'fund' ? 'This fund' : peerName ?? 'Top peer']}
          labelFormatter={(d) => `${d} · growth of ₹100`}
        />
        {hasPeer && <Legend formatter={legendFmt} />}
        {hasPeer && <Line type="monotone" dataKey="peer" stroke={PEER_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />}
        <Line type="monotone" dataKey="fund" stroke={FUND_COLOR} strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}
