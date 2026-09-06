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
  // SEBI regulatory riskometer (from Groww). Distinct from our own riskLevel:
  // post-2021 nearly all equity funds are "Very High". Shown for reference only.
  sebiRisk?: string
  benchmark?: string
  launchDate?: string
  ratings?: { groww?: number | null; crisil?: number | null }
  // True for debt (cash-equivalent) funds: liquid, money market. When set, the
  // UI hides equity-only sections (holdings, managers, regimes, forward signals,
  // risk-adjusted verdict) and shows a reduced, honest surface.
  isDebt?: boolean
  // True for arbitrage funds: fully hedged equity (long cash + short futures),
  // near-zero net market exposure. Taxed as equity (isDebt stays false) but shares
  // the debt funds' reduced analytics surface since equity risk metrics are noise
  // on a market-neutral book.
  isArbitrage?: boolean
  // True for funds with a short NAV history (< 750 daily points, ~3 years).
  // These get an honest reduced surface: a "New fund" badge, since-inception
  // return instead of the 3Y-anchored verdict, and a "1M" chart preset. isYoung
  // is orthogonal to isDebt/isArbitrage (it is about history depth, not asset class).
  isYoung?: boolean
  navPoints?: number
  inceptionDate?: string
  // Since-inception performance. Stamped for every fund that has a NAV history
  // (compute_metrics), so present in practice, but kept optional and guarded at
  // use sites. Headline metric for young funds that lack a full 3Y/5Y window.
  si?: { totalReturn: number; days: number; since: string; cagr?: number }
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
  aum?: { current: number; asOf: string | null; previous?: number; prevDate?: string; changePct?: number; series?: [string, number][] } | null
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
  // Arbitrage funds only: the exposure split behind the long equity book. The
  // listed stocks are the gross long positions; each is hedged by a matching
  // short future, so net equity exposure is near zero and the corpus sits in
  // cash margin, debt and liquid funds as collateral. All numbers are % of corpus.
  hedge?: { grossLong: number; netEquity: number; cash: number; debt: number; liquidMf: number }
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
