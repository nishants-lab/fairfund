/** Tiny dependency-free SVG sparkline for a 0-100 percentile series. */
export default function Sparkline({
  data,
  width = 120,
  height = 32,
  stroke = '#2563eb',
}: {
  data: number[]
  width?: number
  height?: number
  stroke?: string
}) {
  if (!data || data.length < 2) return null
  const min = 0
  const max = 100
  const n = data.length
  const pts = data.map((v, i) => {
    const x = (i / (n - 1)) * (width - 2) + 1
    const y = height - 1 - ((v - min) / (max - min)) * (height - 2)
    return [x, y]
  })
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={stroke} />
    </svg>
  )
}
