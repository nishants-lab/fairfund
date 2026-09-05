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
  score: number // 0..100 conviction
  label: 'Standout' | 'Strong' | 'Solid' | 'Average' | 'Below par' | 'Weak'
  tone: 'good' | 'warn' | 'bad'
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
  // Debt funds are cash-equivalent; equity pillar scoring is meaningless.
  if (fund.isDebt) {
    return {
      score: 0,
      label: 'Average',
      tone: 'warn',
      positives: [],
      negatives: [],
      oneLiner: 'Debt fund: judge on expense ratio and consistency, not equity-style conviction.',
    }
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
    if (base.sharpe >= 1) positives.push({ label: `Sharpe ${base.sharpe.toFixed(2)}`, detail: 'strong return per unit of risk', tone: 'good' })
    else if (base.sharpe < 0) negatives.push({ label: `Sharpe ${base.sharpe.toFixed(2)}`, detail: 'underperformed cash on a risk-adjusted basis', tone: 'bad' })
  }

  // ---- Pillar 4: consistency / batting average (forward) ----
  let consistencyPts = 50
  if (a?.battingAverage && !a.battingAverage.limited) {
    consistencyPts = a.battingAverage.pct
    if (a.battingAverage.pct >= 65) positives.push({ label: `Consistent (${a.battingAverage.pct}%)`, detail: 'beat peers in most rolling 3Y windows', tone: 'good' })
    else if (a.battingAverage.pct < 45) negatives.push({ label: `Inconsistent (${a.battingAverage.pct}%)`, detail: 'beat peers in a minority of 3Y windows', tone: 'bad' })
  }

  // ---- Pillar 5: skill vs luck (forward) ----
  let skillPts = 50
  if (a?.alpha?.confidence != null && !a.alpha.insufficient) {
    skillPts = a.alpha.confidence
    if (a.alpha.confidence >= 90) positives.push({ label: `Skill ${Math.round(a.alpha.confidence)}% conf.`, detail: 'edge over peers looks statistically real', tone: 'good' })
    else if (a.alpha.confidence < 50) negatives.push({ label: `Edge unproven (${Math.round(a.alpha.confidence)}%)`, detail: 'recent outperformance could be luck', tone: 'bad' })
  }

  // ---- Pillar 6: downside capture (forward, risk character) ----
  let capturePts = 50
  if (a?.capture?.down != null) {
    capturePts = clamp(150 - a.capture.down, 0, 100) // 100 down-cap -> 50, 50 -> 100
    if (a.capture.down < 90) positives.push({ label: `Cushions falls (${a.capture.down}% down-capture)`, detail: 'drops less than its category in down months', tone: 'good' })
    else if (a.capture.down > 110) negatives.push({ label: `Falls hard (${a.capture.down}% down-capture)`, detail: 'drops more than its category in down months', tone: 'bad' })
  }

  // ---- Pillar 7: management quality (forward) ----
  let mgmtPts = 50
  const sig = fund.management?.signal
  if (sig === 'Strong') { mgmtPts = 90; positives.push({ label: 'Strong management', detail: 'managers beat peers across their other funds', tone: 'good' }) }
  else if (sig === 'Solid') mgmtPts = 70
  else if (sig === 'Mixed') { mgmtPts = 40; negatives.push({ label: 'Mixed management record', detail: 'managers’ other funds are inconsistent vs peers', tone: 'bad' }) }

  // ---- Momentum caution (not scored, but surfaced) ----
  if (a?.meanReversion?.state === 'hot') {
    negatives.push({ label: 'Running hot', detail: 'recent 1Y well above its own norm - may cool off', tone: 'bad' })
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

  const label: Verdict['label'] =
    score >= 80 ? 'Standout' : score >= 68 ? 'Strong' : score >= 56 ? 'Solid' : score >= 44 ? 'Average' : score >= 32 ? 'Below par' : 'Weak'
  const tone: Verdict['tone'] = score >= 56 ? 'good' : score >= 44 ? 'warn' : 'bad'

  const oneLiner = buildOneLiner(fund, score, label, positives, negatives)

  return { score, label, tone, positives, negatives, oneLiner }
}

function buildOneLiner(fund: Fund, _score: number, label: string, pos: VerdictPillar[], neg: VerdictPillar[]): string {
  const cat = fund.categoryDisplay
  const lead = pos[0]?.label ?? neg[0]?.label ?? 'a mixed record'
  if (label === 'Standout' || label === 'Strong') {
    return `A ${label.toLowerCase()} ${cat} pick on the data - ${lead.toLowerCase()}${pos[1] ? `, ${pos[1].label.toLowerCase()}` : ''}. ${neg[0] ? `Watch: ${neg[0].label.toLowerCase()}.` : 'Few red flags in the data.'}`
  }
  if (label === 'Solid' || label === 'Average') {
    return `A ${label.toLowerCase()} ${cat} option - ${pos[0] ? pos[0].label.toLowerCase() : 'no standout strengths'}${neg[0] ? `, but ${neg[0].label.toLowerCase()}` : ''}. Weigh it against higher-ranked peers.`
  }
  return `Lags its ${cat} peers on the data - ${neg[0] ? neg[0].label.toLowerCase() : 'weak across the board'}. Higher-ranked funds in the category look stronger.`
}
