/**
 * Overall verdict synthesis - pure function combining everything FairFund knows
 * about a fund (backward-tested rank/alpha/risk-adjusted ratios PLUS forward-
 * looking consistency, skill, downside capture, momentum and management) into a
 * single 0-100 conviction score, a label, and human-readable reasons.
 *
 * This is deliberately transparent and rule-based (no ML black box): each pillar
 * contributes points; the reasons list spells out what drove the score. Used by
 * the fund-detail verdict card and the Compare verdict row, so they always agree.
 *
 * A weighted reading of the data, framed as conviction.
 */
import type { Fund } from '../types'

export interface VerdictPillar {
  label: string
  detail: string
  tone: 'good' | 'bad' | 'neutral'
}
export interface Verdict {
  score: number // 0..100 composite data score (past risk-adjusted + consistency metrics)
  label: string // neutral caption, never a qualitative rating
  tone: 'good' | 'warn' | 'bad' | 'neutral'
  positives: VerdictPillar[]
  negatives: VerdictPillar[]
  oneLiner: string
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Build the verdict. `m` is the chosen-window metrics (live or baseline); the
 * forward signals come from fund.analytics + fund.management.
 */
export function buildVerdict(fund: Fund): Verdict {
  // Debt and arbitrage funds are scored by buildDebtVerdict (debtVerdict.ts).
  // This guard should never be reached in production; it is a safety net only.
  if (fund.isArbitrage || fund.isDebt) {
    console.warn('[buildVerdict] debt/arb fund reached equity verdict — use buildDebtVerdict instead', fund.code)
    return { score: 0, label: 'Composite score', tone: 'neutral' as const, positives: [], negatives: [], oneLiner: 'Use buildDebtVerdict for this fund type.' }
  }

  const base = fund.metrics['3Y'] ?? fund.metrics['5Y'] ?? fund.metrics['1Y']
  const a = fund.analytics
  const positives: VerdictPillar[] = []
  const negatives: VerdictPillar[] = []

  // ---- Pillar 1: within-category rank (backward, risk-adjusted composite) ----
  let rankPts = 50
  if (base?.catRank && base?.catSize) {
    const pctile = 1 - (base.catRank - 1) / Math.max(1, base.catSize - 1) // 1 = best
    rankPts = pctile * 100
    const topQ = base.catRank <= Math.max(1, base.catSize / 4)
    const p: VerdictPillar = {
      label: `Rank #${base.catRank} of ${base.catSize}`,
      detail: `risk-adjusted composite, ${fund.categoryDisplay}`,
      tone: topQ ? 'good' : base.catRank > base.catSize / 2 ? 'bad' : 'neutral',
    }
    ;(topQ ? positives : base.catRank > base.catSize / 2 ? negatives : positives).push(p)
  }

  // ---- Pillar 2: peer-relative alpha (backward skill) ----
  let alphaPts = 50
  if (base?.alpha != null) {
    alphaPts = clamp(50 + base.alpha * 6, 0, 100) // +8%/yr alpha ~ 98
    const p: VerdictPillar = {
      label: `${base.alpha >= 0 ? '+' : ''}${base.alpha.toFixed(1)}%/yr vs peers`,
      detail: 'vs the category median return',
      tone: base.alpha >= 1 ? 'good' : base.alpha <= -1 ? 'bad' : 'neutral',
    }
    if (base.alpha >= 1) positives.push(p)
    else if (base.alpha <= -1) negatives.push(p)
  }

  // ---- Pillar 3: risk-adjusted quality (Sharpe) ----
  let sharpePts = 50
  if (base?.sharpe != null) {
    sharpePts = clamp(base.sharpe * 50, 0, 100) // 2.0 -> 100, 1.0 -> 50
    if (base.sharpe >= 1) positives.push({ label: `Sharpe ${base.sharpe.toFixed(2)}`, detail: 'return per unit of total risk is above 1.0', tone: 'good' })
    else if (base.sharpe < 0) negatives.push({ label: `Sharpe ${base.sharpe.toFixed(2)}`, detail: 'returned less than cash on a risk-adjusted basis', tone: 'bad' })
  }

  // ---- Pillar 4: consistency / batting average (forward) ----
  let consistencyPts = 50
  if (a?.battingAverage && !a.battingAverage.limited) {
    consistencyPts = a.battingAverage.pct
    if (a.battingAverage.pct >= 65) positives.push({ label: `${a.battingAverage.pct}% of 3Y windows above peers`, detail: 'rolling 3-year windows finishing above the category median', tone: 'good' })
    else if (a.battingAverage.pct < 45) negatives.push({ label: `${a.battingAverage.pct}% of 3Y windows above peers`, detail: 'rolling 3-year windows finishing above the category median', tone: 'bad' })
  }

  // ---- Pillar 5: skill vs luck (forward) ----
  let skillPts = 50
  if (a?.alpha?.confidence != null && !a.alpha.insufficient) {
    skillPts = a.alpha.confidence
    if (a.alpha.confidence >= 90) positives.push({ label: `Alpha confidence ${Math.round(a.alpha.confidence)}%`, detail: 'statistical confidence the peer-relative alpha is not noise', tone: 'good' })
    else if (a.alpha.confidence < 50) negatives.push({ label: `Alpha confidence ${Math.round(a.alpha.confidence)}%`, detail: 'statistical confidence the peer-relative alpha is not noise', tone: 'bad' })
  }

  // ---- Pillar 6: downside capture (forward, risk character) ----
  let capturePts = 50
  if (a?.capture?.down != null) {
    capturePts = clamp(150 - a.capture.down, 0, 100) // 100 down-cap -> 50, 50 -> 100
    if (a.capture.down < 90) positives.push({ label: `Down-capture ${a.capture.down}%`, detail: 'moved down less than the category median in down months', tone: 'good' })
    else if (a.capture.down > 110) negatives.push({ label: `Down-capture ${a.capture.down}%`, detail: 'moved down more than the category median in down months', tone: 'bad' })
  }

  // ---- Pillar 7: management quality (forward) ----
  let mgmtPts = 50
  const sig = fund.management?.signal
  if (sig === 'Strong') { mgmtPts = 90; positives.push({ label: 'Manager track record', detail: 'managers’ other funds rank above their category median across most periods', tone: 'neutral' }) }
  else if (sig === 'Solid') mgmtPts = 70
  else if (sig === 'Mixed') { mgmtPts = 40; negatives.push({ label: 'Manager track record', detail: 'managers’ other funds rank across a wide range vs their category median', tone: 'neutral' }) }

  // ---- Momentum caution (not scored, but surfaced) ----
  if (a?.meanReversion?.state === 'hot') {
    negatives.push({ label: 'Recent 1Y above own norm', detail: 'latest 1Y is well above this fund’s own 3-year average', tone: 'neutral' })
  }

  // Weighted blend. Backward pillars (rank/alpha/sharpe) and forward pillars
  // (consistency/skill/capture/management) each carry meaningful weight so the
  // verdict reflects BOTH what happened and how repeatable it looks.
  const score = Math.round(
    rankPts * 0.22 +
      alphaPts * 0.18 +
      sharpePts * 0.12 +
      consistencyPts * 0.16 +
      skillPts * 0.12 +
      capturePts * 0.1 +
      mgmtPts * 0.1,
  )

  // No qualitative rating: the label is a fixed, neutral caption for the number,
  // and the score itself is shown in a neutral colour (see cards). tone is kept
  // internal-only for ordering/where still needed, defaulted neutral.
  const label = 'Composite score'
  const tone: Verdict['tone'] = 'neutral'

  const oneLiner = buildOneLiner(fund, score, label, positives, negatives)

  return { score, label, tone, positives, negatives, oneLiner }
}

// Factual, non-advisory summary: only statistics (rank, alpha, Sharpe) and the
// composite number. No qualitative labels ('pick', 'option', 'lags') and no
// recommendation ('weigh it against...', 'look stronger').
function buildOneLiner(fund: Fund, score: number, _label: string, _pos: VerdictPillar[], _neg: VerdictPillar[]): string {
  const base = fund.metrics['3Y'] ?? fund.metrics['5Y'] ?? fund.metrics['1Y']
  const cat = fund.categoryDisplay
  const parts: string[] = []
  if (base?.catRank != null && base?.catSize != null) parts.push(`ranks #${base.catRank} of ${base.catSize} in ${cat} on 3Y risk-adjusted return`)
  if (base?.alpha != null) parts.push(`${base.alpha >= 0 ? '+' : ''}${base.alpha.toFixed(1)}%/yr vs the category median`)
  if (base?.sharpe != null) parts.push(`Sharpe ${base.sharpe.toFixed(2)}`)
  const head = parts.length ? parts.join(', ') : 'limited comparable history so far'
  const sentence = head.charAt(0).toUpperCase() + head.slice(1)
  return `${sentence}. Composite score ${score}/100 across past risk-adjusted and consistency metrics, not a rating or recommendation.`
}
