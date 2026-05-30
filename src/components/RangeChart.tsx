import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Area,
  AreaChart,
} from 'recharts'
import { drawdownSeries } from '../lib/nav'
import { useTheme } from '../lib/theme'
import type { NavPoint } from '../types'

interface Props {
  points: NavPoint[] // already sliced to the desired range
  mode?: 'nav' | 'drawdown'
  loading?: boolean
  error?: boolean
}

export default function RangeChart({ points, mode = 'nav', loading, error }: Props) {
  const { theme } = useTheme()
  const grid = theme === 'dark' ? '#1e293b' : '#f1f5f9'
  const axis = theme === 'dark' ? '#64748b' : '#94a3b8'

  if (loading)
    return (
      <div className="flex h-64 items-center justify-center text-faint">
        <div className="animate-pulse">Loading live NAV data…</div>
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

  if (mode === 'drawdown') {
    const dd = drawdownSeries(points)
    return (
      <ResponsiveContainer width="100%" height={264}>
        <AreaChart data={dd} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.3} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={grid} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: axis }} tickFormatter={(d) => d.slice(0, 7)} minTickGap={40} />
          <YAxis tick={{ fontSize: 11, fill: axis }} tickFormatter={(v) => `${v}%`} />
          <Tooltip
            contentStyle={{
              background: theme === 'dark' ? '#0f172a' : '#fff',
              border: `1px solid ${grid}`,
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v: number) => [`${v.toFixed(1)}%`, 'Drawdown']}
          />
          <Area type="monotone" dataKey="dd" stroke="#f43f5e" strokeWidth={1.5} fill="url(#ddGrad)" />
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={264}>
      <LineChart data={points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={grid} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: axis }} tickFormatter={(d) => d.slice(0, 7)} minTickGap={40} />
        <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: axis }} tickFormatter={(v) => `₹${v.toFixed(0)}`} width={50} />
        <Tooltip
          contentStyle={{
            background: theme === 'dark' ? '#0f172a' : '#fff',
            border: `1px solid ${grid}`,
            borderRadius: 12,
            fontSize: 12,
          }}
          formatter={(v: number) => [`₹${v.toFixed(2)}`, 'NAV']}
        />
        <Line type="monotone" dataKey="nav" stroke="#2563eb" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
