/**
 * Sector concentration chart: horizontal bar breakdown from holdings data.
 */
import { useMemo } from 'react'
import type { Fund } from '../types'

const SECTOR_COLORS: Record<string, string> = {
  Financial: 'bg-blue-500',
  Technology: 'bg-violet-500',
  Healthcare: 'bg-emerald-500',
  Automobile: 'bg-amber-500',
  'Consumer Discretionary': 'bg-orange-400',
  Energy: 'bg-yellow-500',
  'Energy & Utilities': 'bg-yellow-500',
  Construction: 'bg-stone-500',
  'Industrials': 'bg-stone-500',
  'Capital Goods': 'bg-cyan-500',
  Services: 'bg-pink-500',
  Communication: 'bg-indigo-400',
  'Consumer Staples': 'bg-lime-500',
  Insurance: 'bg-teal-500',
  'Metals & Mining': 'bg-gray-500',
  Materials: 'bg-gray-500',
  'Real Estate': 'bg-rose-400',
}

function getColor(sector: string): string {
  return SECTOR_COLORS[sector] || 'bg-slate-400'
}

interface SectorSlice {
  sector: string
  pct: number
  count: number
}

export default function SectorBreakdown({ fund }: { fund: Fund }) {
  const holdings = fund.holdings ?? []
  if (holdings.length === 0) return null

  const sectors = useMemo(() => {
    const map: Record<string, { pct: number; count: number }> = {}
    for (const h of holdings) {
      const s = h.sector || 'Other'
      if (!map[s]) map[s] = { pct: 0, count: 0 }
      map[s].pct += h.pct
      map[s].count += 1
    }
    return Object.entries(map)
      .map(([sector, v]) => ({ sector, pct: Math.round(v.pct * 10) / 10, count: v.count }))
      .sort((a, b) => b.pct - a.pct)
  }, [holdings])

  const topSectors = sectors.slice(0, 6)
  const otherPct = sectors.slice(6).reduce((s, x) => s + x.pct, 0)
  const topPct = topSectors.reduce((s, x) => s + x.pct, 0)
  const concentration = topSectors[0]?.pct ?? 0

  return (
    <div className="mt-6 card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-fg">Sector concentration</h3>
        <span className={`text-xs font-semibold ${concentration > 40 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {concentration > 40 ? 'Concentrated' : 'Diversified'}
        </span>
      </div>

      {/* Stacked bar */}
      <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full">
        {topSectors.map((s) => (
          <div
            key={s.sector}
            className={`${getColor(s.sector)} transition-all`}
            style={{ width: `${(s.pct / (topPct + otherPct)) * 100}%` }}
            title={`${s.sector}: ${s.pct.toFixed(1)}%`}
          />
        ))}
        {otherPct > 0 && (
          <div
            className="bg-slate-300 dark:bg-slate-600"
            style={{ width: `${(otherPct / (topPct + otherPct)) * 100}%` }}
            title={`Others: ${otherPct.toFixed(1)}%`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {topSectors.map((s) => (
          <div key={s.sector} className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-sm ${getColor(s.sector)}`} />
            <span className="text-muted truncate">{s.sector}</span>
            <span className="ml-auto font-semibold text-fg tabular-nums">{s.pct.toFixed(1)}%</span>
          </div>
        ))}
        {otherPct > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-sm bg-slate-300 dark:bg-slate-600" />
            <span className="text-muted">Others</span>
            <span className="ml-auto font-semibold text-fg tabular-nums">{otherPct.toFixed(1)}%</span>
          </div>
        )}
      </div>

      <p className="mt-2 text-[11px] text-faint">
        Top sector ({topSectors[0]?.sector}) is {topSectors[0]?.pct.toFixed(1)}% of portfolio across {topSectors[0]?.count} stocks.
      </p>
    </div>
  )
}
