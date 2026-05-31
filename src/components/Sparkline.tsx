/** Tiny dependency-free SVG sparkline for a 0-100 percentile series.
 *  Optionally overlays a second (peer) series for comparison. */
export default function Sparkline({
  data,
  peer,
  width = 120,
  height = 32,
  stroke = '#2563eb',
  peerStroke = '#94a3b8',
}: {
  data: number[]
  peer?: number[]
  width?: number
  height?: number
  stroke?: string
  peerStroke?: string
}) {
  if (!data || data.length < 2) return null
  const min = 0
  const max = 100
  const toPath = (series: number[]) => {
    const n = series.length
    const pts = series.map((v, i) => {
      const x = (i / (n - 1)) * (width - 2) + 1
      const y = height - 1 - ((v - min) / (max - min)) * (height - 2)
      return [x, y] as [number, number]
    })
    return { d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '), last: pts[pts.length - 1] }
  }
  const main = toPath(data)
  // align peer to the same number of trailing points as `data`
  const peerSeries = peer && peer.length >= 2 ? peer.slice(-data.length) : null
  const peerPath = peerSeries ? toPath(peerSeries) : null
  return (
    <svg width={width} height={height} className="overflow-visible">
      {peerPath && (
        <path d={peerPath.d} fill="none" stroke={peerStroke} strokeWidth={1.5} strokeDasharray="3 3" strokeLinejoin="round" strokeLinecap="round" opacity={0.8} />
      )}
      <path d={main.d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={main.last[0]} cy={main.last[1]} r={2.5} fill={stroke} />
      {peerPath && <circle cx={peerPath.last[0]} cy={peerPath.last[1]} r={2} fill={peerStroke} />}
    </svg>
  )
}
