import { useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useTheme } from '../lib/theme'
import type { Fund } from '../types'

// Fraction of the vertical span (top=0 .. bottom=1) at which y=0 falls, so a
// single gradient can be green above the zero line and red below it.
function zeroOffset(max: number, min: number): number {
  if (max <= 0) return 0
  if (min >= 0) return 1
  return max / (max - min)
}

export default function RollingAlpha({ fund }: { fund: Fund }) {
  const { theme } = useTheme()
  const ra = fund.analytics?.rollingAlpha
  const batting = fund.analytics?.battingAverage

  const { rows, off, years } = useMemo(() => {
    const spark = ra?.spark ?? []
    const rows = spark.map(([m, v]) => ({ m, v }))
    const vs = rows.map((r) => r.v)
    const max = vs.length ? Math.max(...vs, 0) : 0
    const min = vs.length ? Math.min(...vs, 0) : 0
    return { rows, off: zeroOffset(max, min), years: Math.round((ra?.windowM ?? 36) / 12) }
  }, [ra])

  if (rows.length < 3) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted">
        Not enough history yet to chart rolling alpha (needs at least {Math.round((ra?.windowM ?? 36) / 12)} years of NAV).
      </div>
    )
  }

  const grid = theme === 'dark' ? '#1e293b' : '#f1f5f9'
  const axis = theme === 'dark' ? '#64748b' : '#94a3b8'
  const green = '#10b981'
  const red = '#ef4444'

  const fmtMonth = (m: string) => {
    const [y, mo] = m.split('-')
    return `${['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+mo]} '${y.slice(2)}`
  }

  const tooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const v: number = payload[0].value
    return (
      <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-md">
        <div className="font-semibold text-fg">{fmtMonth(label)}</div>
        <div className="mt-0.5" style={{ color: v >= 0 ? green : red }}>
          {v >= 0 ? '+' : ''}{v.toFixed(1)} pts vs category median
        </div>
        <div className="text-faint">{v >= 0 ? 'Ahead of peers' : 'Behind peers'}</div>
      </div>
    )
  }

  return (
    <div>
      {batting?.pct != null && (
        <p className="mb-2 text-xs text-muted">
          Beat the category median in <span className="font-semibold text-fg">{batting.pct}%</span> of
          rolling {years}-year windows. Each point is this fund's {years}-year annualized return minus the
          category median at that month; above zero = ahead of peers.
        </p>
      )}
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={rows} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id="alphaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={off} stopColor={green} stopOpacity={0.35} />
              <stop offset={off} stopColor={red} stopOpacity={0.35} />
            </linearGradient>
            <linearGradient id="alphaStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={off} stopColor={green} stopOpacity={1} />
              <stop offset={off} stopColor={red} stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis
            dataKey="m" tick={{ fontSize: 11, fill: axis }} tickFormatter={fmtMonth}
            axisLine={{ stroke: grid }} tickLine={{ stroke: grid }} minTickGap={24}
          />
          <YAxis
            tick={{ fontSize: 11, fill: axis }} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`}
            axisLine={{ stroke: grid }} tickLine={{ stroke: grid }} width={40}
            label={{ value: 'Alpha (pts)', angle: -90, position: 'insideLeft', fontSize: 11, fill: axis, style: { textAnchor: 'middle' } }}
          />
          <ReferenceLine y={0} stroke={axis} strokeWidth={1} />
          <Tooltip content={tooltip} />
          <Area
            type="monotone" dataKey="v" stroke="url(#alphaStroke)" strokeWidth={2}
            fill="url(#alphaFill)" dot={{ r: 2.5, strokeWidth: 0, fill: axis }} activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
