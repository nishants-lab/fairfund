/**
 * Debt / liquid / arbitrage verdict — a category-appropriate read that does NOT
 * borrow equity methodology (no Sharpe/alpha/momentum; those are meaningless for
 * cash-equivalent and hedged funds). Reviewed and shaped by an India MF domain
 * expert. Three safety tiers govern whether a numeric score is shown at all:
 *
 *  Tier 1 (full scoring): Liquid, Overnight, Money Market, Ultra Short Duration.
 *    SEBI caps duration + credit so tightly that cost + return-vs-peers + size is
 *    a legitimate basis to rank.
 *  Tier 2 (score + caveat): Banking & PSU, Short Duration, Floater, Corporate Bond.
 *    Duration range is SEBI-constrained; we score but banner that duration/YTM
 *    are not in the data.
 *  Tier 3 (NO score): Credit Risk, Gilt, Gilt 10Y, Long/Medium/Medium-to-Long
 *    Duration, Dynamic Bond. Rate/credit sensitivity dominates and we lack
 *    duration/YTM/credit-quality data, so a score would mislead. We show the data
 *    and point users to the AMC factsheet instead.
 *
 * Every score is ranked WITHIN the SEBI sub-category peer set only (a Liquid fund
 * is never scored against a Gilt fund), and the rank label always names the peer
 * set so nothing looks cross-comparable.
 */
import type { Fund, Horizon } from '../types'

export type DebtTier = 1 | 2 | 3

// Match on the FairFund `category` string (authoritative AMFI-derived).
const TIER1 = ['Liquid', 'Overnight', 'Money Market', 'Ultra Short Duration', 'Ultra Short']
const TIER2 = ['Banking & PSU', 'Banking and PSU', 'Short Duration', 'Floater', 'Floating Rate', 'Corporate Bond']
const TIER3 = [
  'Credit Risk', 'Gilt', 'Gilt with 10 year Constant Duration', 'Gilt 10Y',
  'Long Duration', 'Medium Duration', 'Medium to Long Duration', 'Medium-to-Long Duration',
  'Dynamic Bond',
]

function matchAny(cat: string, list: string[]): boolean {
  const c = cat.toLowerCase()
  return list.some((x) => c === x.toLowerCase() || c.includes(x.toLowerCase()))
}

/** Debt scoring tier for a fund, or null if it is not a scored debt category. */
export function debtTier(fund: { category?: string; categoryDisplay?: string; isArbitrage?: boolean }): DebtTier | null {
  const cat = fund.category ?? fund.categoryDisplay ?? ''
  if (matchAny(cat, TIER3)) return 3
  if (matchAny(cat, TIER2)) return 2
  if (matchAny(cat, TIER1)) return 1
  return null
}

/** What each SEBI sub-category is, its typical duration, and who it suits. */
export const SUBCATEGORY_INFO: Record<string, { blurb: string; horizon: string; forWhom: string }> = {
  Liquid: { blurb: 'Invests in debt maturing within 91 days.', horizon: '1 day to 3 months', forWhom: 'Parking money you may need soon; emergency buffer.' },
  Overnight: { blurb: 'Invests in securities maturing in 1 day.', horizon: 'A few days', forWhom: 'The safest parking for very short-term cash; near-zero risk.' },
  'Money Market': { blurb: 'Invests in money-market instruments up to 1 year.', horizon: '3 to 12 months', forWhom: 'Short goals where you want a shade more return than liquid.' },
  'Ultra Short Duration': { blurb: 'Portfolio duration of 3 to 6 months.', horizon: '3 to 9 months', forWhom: 'Slightly longer parking; a step up from liquid on both return and risk.' },
  'Banking & PSU': { blurb: 'Min 80% in bonds of banks, PSUs and PFIs.', horizon: '2 to 4 years', forWhom: 'Relatively high credit quality with moderate rate risk.' },
  'Short Duration': { blurb: 'Portfolio duration of 1 to 3 years.', horizon: '2 to 3 years', forWhom: 'Core debt allocation with limited rate sensitivity.' },
  Floater: { blurb: 'Min 65% in floating-rate instruments.', horizon: '1 to 3 years', forWhom: 'Investors wanting some protection when rates are rising.' },
  'Corporate Bond': { blurb: 'Min 80% in the highest-rated (AA+ and above) corporate bonds.', horizon: '2 to 4 years', forWhom: 'High-quality corporate credit with moderate duration.' },
  'Credit Risk': { blurb: 'Min 65% in below-highest-rated (AA and below) corporate bonds.', horizon: '3 years+', forWhom: 'Higher yield for higher credit risk; know what you own.' },
  Gilt: { blurb: 'Min 80% in government securities across maturities.', horizon: '3 to 7 years', forWhom: 'No credit risk, but high sensitivity to interest-rate moves.' },
  'Long Duration': { blurb: 'Portfolio duration over 7 years.', horizon: '7 years+', forWhom: 'A rate view; large gains if rates fall, large losses if they rise.' },
  'Dynamic Bond': { blurb: 'Manager moves duration freely based on the rate outlook.', horizon: '3 years+', forWhom: 'Outsourcing the rate call to the manager.' },
}

export function subcategoryInfo(fund: { category?: string; categoryDisplay?: string }) {
  const cat = fund.category ?? fund.categoryDisplay ?? ''
  const key = Object.keys(SUBCATEGORY_INFO).find((k) => cat.toLowerCase().includes(k.toLowerCase()))
  return key ? SUBCATEGORY_INFO[key] : null
}

export interface DebtPillar { label: string; detail: string; tone: 'good' | 'bad' | 'neutral' }
export interface DebtVerdict {
  tier: DebtTier | 'arbitrage'
  scored: boolean
  score?: number // 0..100
  label?: string // positioning (debt) or evaluative (arb) label
  tone: 'good' | 'warn' | 'bad' | 'neutral'
  rankLabel?: string // "Ranked #3 of 39 Liquid funds"
  peerSet: string
  peerCount: number
  pillars: DebtPillar[]
  caveat?: string // Tier 2 banner
  oneLiner: string
}

function bestWindow(f: Fund) {
  return f.metrics?.['1Y'] ?? f.metrics?.['3Y'] ?? f.metrics?.['5Y']
}
function cagrOf(f: Fund): number | null {
  const m = bestWindow(f)
  return m?.cagr ?? null
}
function aumOf(f: Fund): number | null {
  return f.aum?.current ?? null
}
function terOf(f: Fund): number | null {
  return typeof f.expenseRatio === 'number' ? f.expenseRatio : null
}

// Fraction of peers this fund is at-least-as-good-as (0..1). dir 'low' = lower better.
function percentile(val: number, vals: number[], dir: 'low' | 'high'): number {
  if (!vals.length) return 0.5
  const worseOrEqual = vals.filter((v) => (dir === 'low' ? v >= val : v <= val)).length
  return worseOrEqual / vals.length
}

/**
 * Composite debt score for one fund within its sub-category peer set.
 * Weights: cost 45%, return-vs-peers 35%, size/stability 20% (arbitrage: 40/40/20).
 */
function compositeScore(f: Fund, peers: Fund[], isArb: boolean, horizon?: Horizon): number | null {
  const retOf = (x: Fund) => (horizon ? (x.metrics?.[horizon]?.cagr ?? null) : cagrOf(x))
  const ter = terOf(f), ret = retOf(f), aum = aumOf(f)
  // In horizon mode a fund with no return for the selected window is not rankable
  // at that horizon - keeps the rank consistent with the "too new for a {horizon}
  // rank" row shown for young funds.
  if (horizon && ret == null) return null
  const ters = peers.map(terOf).filter((v): v is number => v != null)
  const rets = peers.map(retOf).filter((v): v is number => v != null)
  const aums = peers.map(aumOf).filter((v): v is number => v != null)
  let wSum = 0, s = 0
  const wCost = isArb ? 0.4 : 0.45, wRet = isArb ? 0.4 : 0.35, wSize = 0.2
  if (ter != null && ters.length) { s += wCost * percentile(ter, ters, 'low'); wSum += wCost }
  if (ret != null && rets.length) { s += wRet * percentile(ret, rets, 'high'); wSum += wRet }
  if (aum != null && aums.length) { s += wSize * percentile(aum, aums, 'high'); wSum += wSize }
  if (wSum === 0) return null
  return Math.round((s / wSum) * 100)
}

/**
 * Build the debt/arbitrage verdict. `allFunds` is the full universe; peers are
 * derived as same-category funds. Tier 3 returns scored:false (data-limitations).
 */
export function buildDebtVerdict(fund: Fund, allFunds: Fund[]): DebtVerdict {
  const isArb = !!fund.isArbitrage
  const tier = isArb ? 'arbitrage' : debtTier(fund)
  const peerSet = fund.categoryDisplay || fund.category || 'debt'
  const peers = allFunds.filter((f) => f.category === fund.category)
  const peerCount = peers.length

  // Tier 3: never score.
  if (tier === 3) {
    return {
      tier: 3, scored: false, tone: 'neutral', peerSet, peerCount, pillars: [],
      oneLiner: `Rate and credit sensitivity drive returns for ${peerSet.toLowerCase()} funds. We do not have duration, yield-to-maturity or credit-quality data, so we deliberately show no score here rather than mislead.`,
    }
  }

  const ter = terOf(fund), ret = cagrOf(fund), aum = aumOf(fund)
  const base = bestWindow(fund)
  const catMedian = base?.catMedianCagr ?? null

  const pillars: DebtPillar[] = []
  // Cost pillar
  if (ter != null) {
    const ters = peers.map(terOf).filter((v): v is number => v != null).sort((a, b) => a - b)
    const cheaperThan = ters.filter((v) => v > ter).length
    const cheapPct = ters.length ? cheaperThan / ters.length : 0.5
    pillars.push({
      label: `Expense ${ter.toFixed(2)}%`,
      detail: cheapPct >= 0.6 ? 'cheaper than most peers, the biggest edge in this category' : cheapPct <= 0.35 ? 'pricier than most peers; cost drags returns here' : 'around the category average on cost',
      tone: cheapPct >= 0.6 ? 'good' : cheapPct <= 0.35 ? 'bad' : 'neutral',
    })
  }
  // Return pillar (vs category median)
  if (ret != null && catMedian != null) {
    const bps = Math.round((ret - catMedian) * 100)
    pillars.push({
      label: `${ret.toFixed(2)}% return`,
      detail: `${bps >= 0 ? '+' : ''}${bps} bps vs the ${peerSet.toLowerCase()} median`,
      tone: bps >= 15 ? 'good' : bps <= -15 ? 'bad' : 'neutral',
    })
  } else if (ret != null) {
    pillars.push({ label: `${ret.toFixed(2)}% return`, detail: 'annualised, latest window', tone: 'neutral' })
  }
  // Size pillar
  if (aum != null) {
    pillars.push({
      label: `${aum >= 1000 ? '₹' + (aum / 1000).toFixed(1) + 'k Cr' : '₹' + Math.round(aum) + ' Cr'} AUM`,
      detail: aum >= 1000 ? 'large, stable book' : aum < 100 ? 'small book; watch for concentration' : 'moderate size',
      tone: aum >= 1000 ? 'good' : aum < 100 ? 'bad' : 'neutral',
    })
  }

  const score = compositeScore(fund, peers, isArb)
  // Rank within peer set by composite score.
  let rankLabel: string | undefined
  if (score != null && peerCount > 1) {
    const scored = peers
      .map((p) => ({ code: p.code, s: compositeScore(p, peers, isArb) }))
      .filter((x) => x.s != null)
      .sort((a, b) => (b.s! - a.s!))
    const pos = scored.findIndex((x) => x.code === fund.code)
    if (pos >= 0) rankLabel = `Ranked #${pos + 1} of ${scored.length} ${peerSet} funds`
  }

  // Tier-1 / Tier-2 debt: positioning labels (cost-efficiency framing), never alarming tone.
  // Arbitrage: evaluative labels; still no 'bad' tone — lowest is 'neutral'.
  const label: DebtVerdict['label'] = score == null ? undefined
    : isArb
    ? (score >= 80 ? 'Standout' : score >= 66 ? 'Strong' : score >= 50 ? 'Solid' : score >= 34 ? 'Average' : 'Below par')
    : (score >= 80 ? 'Top value' : score >= 66 ? 'Strong value' : score >= 50 ? 'Solid' : score >= 34 ? 'Mid-pack' : 'Costlier option')
  const tone: DebtVerdict['tone'] =
    score == null ? 'neutral' : score >= 66 ? 'good' : isArb && score >= 50 ? 'warn' : 'neutral'

  const caveat = tier === 2
    ? 'Duration and yield-to-maturity are not in our data. This score reflects cost, return-vs-peers and size only. Check the AMC factsheet for rate sensitivity.'
    : undefined

  const lead = pillars.find((p) => p.tone === 'good')?.label ?? pillars[0]?.label ?? ''
  const oneLiner = isArb
    ? `Judge this arbitrage fund on cost, steadiness and size, not equity conviction. ${lead ? lead + ' stands out.' : ''}`
    : `${label ?? 'Mid-pack'} among ${peerSet.toLowerCase()} funds on cost, return-vs-peers and size. ${lead ? lead + ' is the key driver.' : ''}`

  return { tier: tier as DebtTier | 'arbitrage', scored: true, score: score ?? undefined, label, tone, rankLabel, peerSet, peerCount, pillars, caveat, oneLiner }
}

/**
 * Rank every fund in `peers` by composite debt score. Returns a map from fund
 * code to { rank (1 = best), count, score }. Used by Explore to drive the
 * rank badge and sort order for debt/arbitrage categories.
 */
export function computeDebtRanks(
  peers: Fund[],
  isArb: boolean,
  horizon?: Horizon,
): Map<number, { rank: number; count: number; score: number | null }> {
  // Only rank funds that produced a non-null composite score (same logic as buildDebtVerdict).
  // Funds with no TER / return / AUM data are excluded so counts match the verdict card.
  // When a horizon is passed, ranking uses that window's return and a fund lacking
  // data for it is left unranked (sinks to the bottom of the table).
  const all = peers.map((f) => ({ code: f.code, s: compositeScore(f, peers, isArb, horizon) }))
  const scored = all.filter((x): x is { code: number; s: number } => x.s != null)
  scored.sort((a, b) => b.s - a.s)
  const result = new Map<number, { rank: number; count: number; score: number | null }>()
  scored.forEach(({ code, s }, idx) => result.set(code, { rank: idx + 1, count: scored.length, score: s }))
  return result
}
