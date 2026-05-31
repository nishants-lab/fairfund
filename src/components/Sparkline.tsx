/** Mini rank-trajectory chart for a 0-100 within-category percentile series
 *  (higher = better rank). Unlike a bare sparkline it draws labelled axes so a
 *  fund pinned near the top reads as "consistently top-ranked" rather than a
 *  broken flat line:
 *    - y-axis: 0 / 50 / 100 percentile gridlines with "Top"/"Bottom" hints
 *    - x-axis: month labels derived from `endDate` (the data anchor) + monthly
 *      cadence, so the series is anchored in real time
 *  Optionally overlays a second (peer) series for comparison. */

function fmtMon(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

export default function Sparkline({
  data,
  peer,
  width = 240,
  height = 96,
  stroke = '#2563eb',
  peerStroke = '#94a3b8',
  endDate,
  stepMonths = 1,
}: {
  data: number[]
  peer?: number[]
  width?: number
  height?: number
  stroke?: string
  peerStroke?: string
  /** ISO date (e.g. "2026-05-29") of the most recent point, for the time axis. */
  endDate?: string
  stepMonths?: number
}) {
  if (!data || data.length < 2) return null

  // plot area insets: room for y labels (left) and month labels (bottom)
  const PL = 30
  const PR = 8
  const PT = 8
  const PB = 18
  const plotW = width - PL - PR
  const plotH = height - PT - PB
  const min = 0
  const max = 100

  const xAt = (i: number, n: number) => PL + (n <= 1 ? 0 : (i / (n - 1)) * plotW)
  const yAt = (v: number) => PT + plotH - ((v - min) / (max - min)) * plotH

  const toPath = (series: number[]) => {
    const n = series.length
    const pts = series.map((v, i) => [xAt(i, n), yAt(v)] as [number, number])
    return { d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '), last: pts[pts.length - 1] }
  }
  const main = toPath(data)
  // align peer to the same trailing window as `data` (both end at the anchor)
  const peerSeries = peer && peer.length >= 2 ? peer.slice(-data.length) : null
  const peerPath = peerSeries ? toPath(peerSeries) : null

  // month labels for the x-axis (oldest, middle, newest)
  let labels: { x: number; text: string }[] = []
  if (endDate) {
    const end = new Date(endDate)
    if (!isNaN(end.getTime())) {
      const n = data.length
      const idxs = [0, Math.floor((n - 1) / 2), n - 1]
      labels = idxs.map((i) => {
        const d = new Date(end)
        d.setMonth(d.getMonth() - (n - 1 - i) * stepMonths)
        return { x: xAt(i, n), text: fmtMon(d) }
      })
    }
  }

  const gridYs = [0, 50, 100]

  return (
    <svg width={width} height={height} className="overflow-visible" role="img" aria-label="Rank percentile over time">
      {/* y gridlines + labels (percentile rank; higher = better) */}
      {gridYs.map((g) => (
        <g key={g}>
          <line x1={PL} y1={yAt(g)} x2={width - PR} y2={yAt(g)} stroke="currentColor" strokeWidth={0.5} className="text-line" strokeDasharray={g === 0 || g === 100 ? '0' : '2 3'} opacity={0.6} />
          <text x={PL - 4} y={yAt(g) + 3} textAnchor="end" className="fill-faint text-[8px]">{g}</text>
        </g>
      ))}

      {/* peer line (dashed) */}
      {peerPath && (
        <path d={peerPath.d} fill="none" stroke={peerStroke} strokeWidth={1.5} strokeDasharray="3 3" strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      )}
      {/* main line */}
      <path d={main.d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={main.last[0]} cy={main.last[1]} r={2.5} fill={stroke} />
      {peerPath && <circle cx={peerPath.last[0]} cy={peerPath.last[1]} r={2} fill={peerStroke} />}

      {/* x-axis month labels */}
      {labels.map((l, i) => (
        <text
          key={i}
          x={Math.max(PL, Math.min(width - PR, l.x))}
          y={height - 5}
          textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
          className="fill-faint text-[8px]"
        >
          {l.text}
        </text>
      ))}
    </svg>
  )
}
