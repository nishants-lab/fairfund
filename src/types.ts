export interface WindowMetrics {
  cagr: number
  alpha: number
  sharpe: number
  sortino: number
  maxDrawdown: number
  calmar: number
  volatility: number
  catRank: number
  catMedianCagr: number
  score: number
}

export interface Fund {
  code: number
  name: string
  fullName: string
  amc: string
  category: string
  categoryDisplay: string
  riskLevel: string
  categorySize: number
  metrics: {
    '1Y'?: WindowMetrics
    '3Y'?: WindowMetrics
    '5Y'?: WindowMetrics
  }
  verdict: string
  holdings?: Holding[]
  holdingsMeta?: HoldingsMeta
}

export interface Holding {
  name: string
  pct: number
  sector?: string | null
  instrument?: string | null
  key?: string | null
}

export interface HoldingsMeta {
  coverage: string // stock_level | lookthrough_domestic | feeder_unresolved | no_disclosure | unresolved | fetch_failed | unknown
  portfolioDate?: string | null
  note?: string
  underlying?: string | null
  count?: number
}

export interface CategorySummary {
  display: string
  riskLevel: string
  medianCagr5Y: number | null
  topCagr5Y: number | null
  fundCount: number
}

export interface FundsData {
  generatedAt: string
  anchor: string
  methodology: string
  totalFunds: number
  categories: Record<string, CategorySummary>
  funds: Fund[]
}

export type Horizon = '1Y' | '3Y' | '5Y'

export interface NavPoint {
  date: string
  nav: number
}
