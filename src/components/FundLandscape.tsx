import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ReferenceLine,
  ReferenceArea, ResponsiveContainer, Cell,
} from 'recharts'
import { useTheme } from '../lib/theme'
import { funds as ALL } from '../lib/data'
import { fundSlug } from '../lib/format'
import type { Fund } from '../types'

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'
let aumPromise: Promise<Record<string, number>> | null = null
function loadAum(): Promise<Record<string, number>> {
  if (!aumPromise) {
    const b = BASE.endsWith('/') ? BASE : BASE + '/'
    aumPromise = fetch(`${b}aum-index.json?v=${__DATA_VERSION__}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
  }
  return aumPromise
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function shortName(f: Fund): string {
  let n = f.name
  for (const w of [' Fund', ' - Direct', ' Plan', ' Growth']) n = n.split(w)[0]
  return n.trim()
}

interface Row {
  x: number; y: number; z: number; aum?: number
  code: number; name: string; current: boolean
}

export default function FundLandscape({ fund, category }: { fund?: Fund; category?: string }) {
  const { theme } = useTheme()
  const navigate = useNavigate()
  const [aum, setAum] = useState<Record<string, number>>({})
  useEffect(() => { loadAum().then(setAum) }, [])

  const catKey = fund?.category ?? category
  const currentCode = fund?.code

  const { rows, xDomain, yDomain, xMed, yMed, n, catDisplay } = useMemo(() => {
    const peers = ALL.filter(
      (f) => f.category === catKey && f.metrics['3Y']?.volatility && f.metrics['3Y']?.cagr != null,
    )
    const rows: Row[] = peers.map((f) => {
      const m = f.metrics['3Y']!
      const a = aum[String(f.code)]
      return {
        x: m.volatility, y: m.cagr,
        z: Math.sqrt(a || 120), aum: a,
        code: f.code, name: shortName(f), current: f.code === currentCode,
      }
    })
    const xs = rows.map((r) => r.x), ys = rows.map((r) => r.y)
    const xPad = (Math.max(...xs) - Math.min(...xs)) * 0.08 || 1
    const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 1
    return {
      rows, n: rows.length,
      xDomain: [Math.min(...xs) - xPad, Math.max(...xs) + xPad],
      yDomain: [Math.min(...ys) - yPad, Math.max(...ys) + yPad],
      xMed: median(xs), yMed: median(ys),
      catDisplay: peers[0]?.categoryDisplay ?? catKey ?? '',
    }
  }, [catKey, currentCode, aum])

  if (n < 4) return null

  const grid = theme === 'dark' ? '#1e293b' : '#eef2f7'
  const axis = theme === 'dark' ? '#64748b' : '#94a3b8'
  const dim = theme === 'dark' ? '#3b82f6' : '#2563eb'
  const quadFill = theme === 'dark' ? '#10b981' : '#10b981'

  const tooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d: Row = payload[0].payload
    return (
      <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-md">
        <div className="font-semibold text-fg">{d.name}{d.current ? ' (this fund)' : ''}</div>
        <div className="mt-0.5 text-muted">Return {d.y.toFixed(1)}% · Risk {d.x.toFixed(1)}</div>
        {d.aum ? <div className="text-faint">AUM ₹{d.aum >= 1000 ? `${(d.aum / 1000).toFixed(1)}k` : d.aum} cr</div> : null}
        <div className="mt-1 text-[11px] text-brand-500">Click to open →</div>
      </div>
    )
  }

  return (
    <div className="mt-6 card p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="font-bold text-fg">{fund ? 'Where it stands' : `${catDisplay} landscape`}</h3>
        <span className="text-xs text-faint">{n} {catDisplay} funds</span>
      </div>
      <p className="mb-3 text-xs text-muted">
        Risk vs return over 3 years. Up and to the left is better: more return for less risk. Bubble size = AUM.
        Hover any fund for detail; click to open it.
      </p>
      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 16, right: 16, left: 4, bottom: 16 }}>
          <ReferenceArea
            x1={xDomain[0]} x2={xMed} y1={yMed} y2={yDomain[1]}
            fill={quadFill} fillOpacity={theme === 'dark' ? 0.08 : 0.06} stroke="none"
          />
          <ReferenceLine x={xMed} stroke={axis} strokeDasharray="4 4" strokeOpacity={0.6} />
          <ReferenceLine y={yMed} stroke={axis} strokeDasharray="4 4" strokeOpacity={0.6} />
          <XAxis
            type="number" dataKey="x" domain={xDomain} tick={{ fontSize: 11, fill: axis }}
            tickFormatter={(v) => v.toFixed(0)} axisLine={{ stroke: grid }} tickLine={{ stroke: grid }}
            label={{ value: 'Volatility (risk) →', position: 'insideBottom', offset: -8, fontSize: 11, fill: axis }}
          />
          <YAxis
            type="number" dataKey="y" domain={yDomain} tick={{ fontSize: 11, fill: axis }}
            tickFormatter={(v) => `${v.toFixed(0)}%`} axisLine={{ stroke: grid }} tickLine={{ stroke: grid }}
            width={44}
            label={{ value: '3Y CAGR (return) →', angle: -90, position: 'insideLeft', fontSize: 11, fill: axis, style: { textAnchor: 'middle' } }}
          />
          <ZAxis type="number" dataKey="z" range={[60, 620]} />
          <Tooltip content={tooltip} cursor={{ strokeDasharray: '3 3', stroke: axis }} />
          <Scatter
            data={rows}
            onClick={(d: any) => d?.code && navigate(`/fund/${d.code}/${fundSlug(d.name)}`)}
            style={{ cursor: 'pointer' }}
          >
            {rows.map((r) => (
              <Cell
                key={r.code}
                fill={r.current ? '#059669' : dim}
                fillOpacity={r.current ? 0.95 : fund ? 0.4 : 0.55}
                stroke={r.current ? '#065f46' : dim}
                strokeOpacity={r.current ? 1 : fund ? 0.35 : 0.5}
                strokeWidth={r.current ? 2 : 1}
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center justify-center gap-5 text-xs text-faint">
        {fund ? <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: '#059669' }} />This fund</span> : null}
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: dim, opacity: 0.5 }} />{fund ? 'Category peers' : 'Funds'}</span>
        <span>Green zone = efficient (more return, less risk)</span>
      </div>
    </div>
  )
}
