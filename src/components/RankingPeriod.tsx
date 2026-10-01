import { isIsoDate, istToday } from '../lib/marketDate'
import type { Fund, Horizon, WindowMetrics } from '../types'

const HORIZONS: Horizon[] = ['1Y', '3Y', '5Y']

export function hasDatedRanking(metric: WindowMetrics | undefined): metric is WindowMetrics & { windowStart: string; windowEnd: string; catSize: number } {
  if (!metric) return false
  return isIsoDate(metric.windowStart) && isIsoDate(metric.windowEnd)
    && metric.windowStart < metric.windowEnd
    && metric.windowEnd <= istToday()
    && Number.isInteger(metric.catRank) && metric.catRank > 0
    && Number.isInteger(metric.catSize) && metric.catSize! >= metric.catRank
    && Number.isFinite(metric.score)
}

export default function RankingPeriod({ fund, horizon, compact = false, withheld = false }: {
  fund: Fund; horizon: Horizon; compact?: boolean; withheld?: boolean
}) {
  if (withheld || fund.dataQuality?.status === 'quarantined') {
    return <span className="text-xs text-faint">Ranking withheld</span>
  }
  const current = fund.metrics[horizon]
  const previous = !current ? fund.previousRankings?.[horizon] : undefined
  const metric = current ?? previous
  if (!hasDatedRanking(metric)) {
    return <span className="text-xs text-faint">No current {horizon} ranking</span>
  }
  const period = `${metric.windowStart} to ${metric.windowEnd}`
  return (
    <span className="inline-flex max-w-full flex-col gap-0.5 text-xs" data-ranking={previous ? 'previous' : 'current'} title={`${horizon} ranking period: ${period}`}>
      <span className={previous ? 'font-medium text-muted' : 'font-semibold text-fg'}>
        {previous ? 'Previous ranking' : 'Rank'} #{metric.catRank} of {metric.catSize} ({horizon})
      </span>
      <span className="font-normal text-faint">{compact ? `Through ${metric.windowEnd}` : period}</span>
    </span>
  )
}

export function PreviousRankings({ fund }: { fund: Fund }) {
  if (fund.dataQuality?.status === 'quarantined') return null
  const horizons = HORIZONS.filter(h => !fund.metrics[h] && hasDatedRanking(fund.previousRankings?.[h]))
  if (!horizons.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3" aria-label="Previous rankings">
      {horizons.map(horizon => <RankingPeriod key={horizon} fund={fund} horizon={horizon} />)}
    </div>
  )
}
