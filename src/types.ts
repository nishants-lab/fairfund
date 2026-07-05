export interface WindowMetrics {
  cagr: number
  alpha: number
  sharpe: number
  sortino: number
  maxDrawdown: number
  calmar: number
  volatility: number
  catRank: number
  catSize?: number
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
  verdict?: string
  holdings?: Holding[]
  holdingsMeta?: HoldingsMeta
  management?: Management
  analytics?: Analytics
  stockMoves?: StockMoves | null
  aum?: { current: number; asOf: string; previous?: number; prevDate?: string; changePct?: number } | null
  expenseRatio?: number | null
  investInfo?: {
    exit_load?: string
    min_sip?: number
    min_lumpsum?: number
    stamp_duty?: string
    sip_allowed?: boolean
    lumpsum_allowed?: boolean
    available_for_investment?: boolean
    lock_in?: { years?: number | null; months?: number | null; days?: number | null }
  } | null
}

export interface ManagerInfo {
  name: string
  sinceYears: number | null
  education?: string | null
  experience?: string | null
}

export interface ManagerTrackRecord {
  funds: number
  medianAlpha: number
  beatRate: number
  topRankShare: number | null
  basis: string | null
  usedOtherFunds: boolean
  sampleFunds: { name: string; code: number; alpha: number | null; rank: number | null; size: number | null }[]
}

export interface Management {
  available: boolean
  managers?: ManagerInfo[]
  leadManager?: string | null
  avgTenureYears?: number | null
  trackRecord?: ManagerTrackRecord | null
  signal?: 'Strong' | 'Solid' | 'Mixed' | 'Limited evidence' | 'No data'
  note?: string
}

// ---- Forward-looking analytics (precomputed build-time, in funds.json) ----
export interface RankTrajectory {
  spark: number[] // percentile (0-100) series, oldest->newest, for the sparkline
  currentRank: number
  currentPeers: number
  priorRank: number
  priorPeers: number
  direction: 'climbing' | 'fading' | 'steady'
  limited: boolean
}
export interface BattingAverage {
  pct: number
  n: number
  windowM: number
  limited: boolean
}
export interface CaptureRatios {
  up: number | null
  down: number | null
  upMonths: number
  downMonths: number
}
export interface AlphaSignificance {
  tStat?: number
  confidence?: number
  n: number
  couldBeLuck?: boolean
  insufficient?: boolean
}
export interface MeanReversion {
  z: number
  state: 'hot' | 'cold' | 'normal'
  recent1Y: number
  norm1Y: number
}
export interface RegimePerf {
  name: string
  active: boolean
  ret?: number
  alpha?: number | null
}
export interface RollingAlpha {
  spark: [string, number][] // [monthISO 'YYYY-MM', excess return in percentage points]
  windowM: number // rolling window length in months (matches battingAverage)
}
export interface Analytics {
  rankTrajectory?: RankTrajectory
  battingAverage?: BattingAverage
  rollingAlpha?: RollingAlpha
  capture?: CaptureRatios
  alpha?: AlphaSignificance
  meanReversion?: MeanReversion
  regimes?: RegimePerf[]
}

export interface Holding {
  name: string
  pct: number
  sector?: string | null
  instrument?: string | null
  key?: string | null
  change?: number | null
}

export interface HoldingsMeta {
  coverage: string // stock_level | lookthrough_domestic | feeder_unresolved | no_disclosure | unresolved | fetch_failed | unknown
  portfolioDate?: string | null
  note?: string
  underlying?: string | null
  count?: number
}

// ---- Stock-move intelligence (portfolio change analysis) ----
export interface StockMove {
  name: string
  pct: number // weight in the portfolio at that snapshot
  ticker?: string | null
  postReturn?: number | null // % return since the move (null = no price data)
}
export interface StockMoves {
  fromDate: string // earlier snapshot date
  toDate: string // later snapshot date
  added: StockMove[]
  exited: StockMove[]
  smartScore?: number | null // 0-100: % of moves that went the right way
  smartBasis?: number | null // how many moves had price data to judge
  verdict?: string // 'Smart moves' | 'Mixed moves' | 'Questionable moves' | 'Insufficient price data'
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
