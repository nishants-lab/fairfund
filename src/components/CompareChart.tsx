import { useMemo } from 'react'
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
import { sliceByRange, normalizeRange } from '../lib/compareUtil'
import { useTheme } from '../lib/theme'
import type { Fund, NavPoint } from '../types'

interface Props {
  funds: Fund[]
  navData: Record<number, NavPoint[]>
  start: string
  end: string
  colors: string[]
}

export default function CompareChart({ funds, navData, start, end, colors }: Props) {
  const { theme } = useTheme()
  const grid = theme === 'dark' ? '#1e293b' : '#f1f5f9'
  const axis = theme === 'dark' ? '#64748b' : '#94a3b8'

  const merged = useMemo(() => {
    if (!start || !end) return []
    const byMonth = new Map<string, any>()
    funds.forEach((f, fi) => {
      const pts = navData[f.code]
      if (!pts) return
      const sliced = sliceByRange(pts, start, end)
      const normed = normalizeRange(sliced, 100)
      normed.forEach((p, idx) => {
        if (idx % 5 !== 0 && idx !== normed.length - 1) return
        const month = p.date.slice(0, 7)
        if (!byMonth.has(month)) byMonth.set(month, { date: month })
        byMonth.get(month)[`f${fi}`] = Math.round(p.nav * 10) / 10
      })
    })
    return Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [funds, navData, start, end])

  if (merged.length < 2)
    return <div className="flex h-64 items-center justify-center text-faint">Loading comparison…</div>

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: axis }} minTickGap={40} />
        <YAxis tick={{ fontSize: 11, fill: axis }} tickFormatter={(v) => `₹${v}`} width={50} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{
            background: theme === 'dark' ? '#0f172a' : '#fff',
            border: `1px solid ${grid}`,
            borderRadius: 12,
            fontSize: 12,
          }}
          formatter={(v: number, name: string) => {
            const idx = Number(name.replace('f', ''))
            return [`₹${v}`, funds[idx]?.name ?? name]
          }}
        />
        <Legend formatter={(value: string) => funds[Number(value.replace('f', ''))]?.name ?? value} />
        {funds.map((f, i) => (
          <Line key={f.code} type="monotone" dataKey={`f${i}`} stroke={colors[i]} strokeWidth={2} dot={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
