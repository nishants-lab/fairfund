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
  loading?: boolean
}

export default function CompareChart({ funds, navData, start, end, colors, loading }: Props) {
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
    return loading ? (
      <div className="space-y-3">
        <div className="skeleton h-[300px] w-full" />
        <div className="flex items-center justify-center gap-2 text-xs text-faint">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-500" />
          Loading live NAV for the chart…
        </div>
      </div>
    ) : (
      <div className="flex h-64 items-center justify-center text-center text-sm text-faint">
        Live NAV for this chart is unavailable right now. The metrics above still stand.
      </div>
    )

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: axis }} minTickGap={40} />
        <YAxis tick={{ fontSize: 11, fill: axis }} tickFormatter={(v) => `₹${v}`} width={50} domain={['auto', 'auto']} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload || !payload.length) return null
            // Sort entries descending by value so the top fund is listed first.
            const items = [...payload]
              .filter((p) => p.value != null)
              .sort((a, b) => (b.value as number) - (a.value as number))
            return (
              <div
                style={{
                  background: theme === 'dark' ? '#0f172a' : '#fff',
                  border: `1px solid ${grid}`,
                  borderRadius: 12,
                  fontSize: 12,
                  padding: '8px 12px',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4, color: theme === 'dark' ? '#f1f5f9' : '#0f172a' }}>{label}</div>
                {items.map((p) => {
                  const idx = Number(String(p.dataKey).replace('f', ''))
                  return (
                    <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, color: p.color }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 9999, background: p.color }} />
                      <span>{funds[idx]?.name ?? p.dataKey} : ₹{p.value as number}</span>
                    </div>
                  )
                })}
              </div>
            )
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
