import type { FundsData, WindowMetrics } from '../../src/types'

interface BadgeCategory {
  key: string
  return3Y?: number
  return5Y?: number
  volatility?: number
}

const categories: BadgeCategory[] = [
  { key: 'Three Alpha', return3Y: 30, return5Y: 10, volatility: 1 },
  { key: 'Three Beta', return3Y: 25, return5Y: 9, volatility: 9 },
  { key: 'Overlap', return3Y: 20, return5Y: 30, volatility: 8 },
  { key: 'Five Alpha', return5Y: 25, volatility: 7 },
  { key: 'Five Beta', return5Y: 20, volatility: 2 },
  { key: 'Quiet', return5Y: 5, volatility: 3 },
  { key: 'Reserve Return', return5Y: 15, volatility: 6 },
  { key: 'Reserve Quiet', return5Y: 4, volatility: 4 },
  { key: 'Reserve Three', return3Y: 15, return5Y: 3, volatility: 5 },
  ...Array.from({ length: 9 }, (_, i) => ({ key: `Unscored ${i}` })),
]

export function createBadgeFixture(rows: BadgeCategory[] = categories, anchor = '2024-06-14'): FundsData {
  const data: FundsData = {
    generatedAt: `${anchor}T00:00:00Z`, anchor, methodology: 'Synthetic badge test fixture',
    totalFunds: rows.length * 3, categories: {}, funds: [],
  }
  const metric = (years: number, cagr: number, volatility: number): WindowMetrics => ({
    windowStart: `${Number(anchor.slice(0, 4)) - years}${anchor.slice(4)}`, windowEnd: anchor,
    cagr, volatility, alpha: 0, sharpe: 1, sortino: 1, maxDrawdown: -1,
    calmar: 1, catRank: 1, catSize: 3, catMedianCagr: cagr, score: 50,
  })
  for (const row of rows) {
    data.categories[row.key] = {
      display: row.key, riskLevel: 'High', fundCount: 3,
      medianCagr5Y: row.return5Y ?? null, topCagr5Y: row.return5Y ?? null,
    }
    for (let i = 0; i < 3; i++) {
      const name = `${row.key} fixture ${i}`
      data.funds.push({
        code: -(data.funds.length + 1), name, fullName: name, amc: 'Fixture',
        category: row.key, categoryDisplay: row.key, riskLevel: 'High', categorySize: 3,
        metrics: {
          ...(row.return3Y === undefined ? {} : { '3Y': metric(3, row.return3Y, 0) }),
          ...(row.return5Y === undefined && row.volatility === undefined ? {}
            : { '5Y': metric(5, row.return5Y ?? 0, row.volatility ?? 0) }),
        },
      })
    }
  }
  return data
}
