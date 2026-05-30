/**
 * Goal-based investment math.
 * Future value of: existing corpus (lump, growing) + monthly SIP (annuity) + one-time lumpsum now.
 */

export interface GoalInputs {
  targetCorpus: number // ₹
  years: number
  currentCorpus: number // ₹ already invested
  monthlySip: number // ₹ per month
  lumpsumNow: number // ₹ one-time now
}

export interface GoalResult {
  projectedCorpus: number
  requiredCagr: number | null // CAGR needed to hit target with given contributions
  achievability: 'comfortable' | 'achievable' | 'stretch' | 'unrealistic'
  shortfall: number // positive if short, negative if surplus
  assumedCagr: number
  breakdown: {
    fromCurrent: number
    fromLumpsum: number
    fromSip: number
  }
}

/** Future value given an annual return rate. */
export function projectCorpus(inputs: GoalInputs, annualReturn: number): number {
  const { years, currentCorpus, monthlySip, lumpsumNow } = inputs
  const r = annualReturn / 100
  const monthlyR = Math.pow(1 + r, 1 / 12) - 1
  const months = Math.round(years * 12)

  const fvCurrent = currentCorpus * Math.pow(1 + r, years)
  const fvLumpsum = lumpsumNow * Math.pow(1 + r, years)
  // FV of ordinary annuity (SIP at end of each month)
  const fvSip =
    monthlyR === 0
      ? monthlySip * months
      : monthlySip * ((Math.pow(1 + monthlyR, months) - 1) / monthlyR)

  return fvCurrent + fvLumpsum + fvSip
}

export function projectBreakdown(inputs: GoalInputs, annualReturn: number) {
  const { years, currentCorpus, monthlySip, lumpsumNow } = inputs
  const r = annualReturn / 100
  const monthlyR = Math.pow(1 + r, 1 / 12) - 1
  const months = Math.round(years * 12)
  const fromCurrent = currentCorpus * Math.pow(1 + r, years)
  const fromLumpsum = lumpsumNow * Math.pow(1 + r, years)
  const fromSip =
    monthlyR === 0
      ? monthlySip * months
      : monthlySip * ((Math.pow(1 + monthlyR, months) - 1) / monthlyR)
  return { fromCurrent, fromLumpsum, fromSip }
}

/** Find the annual return required to exactly hit the target (binary search). */
export function requiredCagr(inputs: GoalInputs): number | null {
  let lo = 0
  let hi = 60
  // If even at 0% we exceed target, no growth needed
  if (projectCorpus(inputs, 0) >= inputs.targetCorpus) return 0
  // If even 60% can't reach it, unrealistic
  if (projectCorpus(inputs, hi) < inputs.targetCorpus) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (projectCorpus(inputs, mid) < inputs.targetCorpus) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Assess achievability. We map required CAGR to realistic expectations:
 * - <= 8%: comfortable (debt/large-cap territory)
 * - <= 13%: achievable (large/flexi-cap)
 * - <= 18%: stretch (mid/small-cap, higher risk)
 * - > 18% or null: unrealistic
 */
export function assessGoal(inputs: GoalInputs, assumedCagr: number): GoalResult {
  const projected = projectCorpus(inputs, assumedCagr)
  const req = requiredCagr(inputs)
  const breakdown = projectBreakdown(inputs, assumedCagr)
  let achievability: GoalResult['achievability']
  if (req === null) achievability = 'unrealistic'
  else if (req <= 8) achievability = 'comfortable'
  else if (req <= 13) achievability = 'achievable'
  else if (req <= 18) achievability = 'stretch'
  else achievability = 'unrealistic'

  return {
    projectedCorpus: projected,
    requiredCagr: req,
    achievability,
    shortfall: inputs.targetCorpus - projected,
    assumedCagr,
    breakdown,
  }
}

export const ACHIEVABILITY_META: Record<
  GoalResult['achievability'],
  { label: string; color: string; advice: string }
> = {
  comfortable: {
    label: 'Comfortable',
    color: 'emerald',
    advice:
      'Your target needs a modest return. Large-cap or index funds (lower risk) can likely get you there. No need to take on excessive risk.',
  },
  achievable: {
    label: 'Achievable',
    color: 'blue',
    advice:
      'A realistic target. A balanced mix of flexi-cap and large-cap funds historically delivers this range. Stay invested through cycles.',
  },
  stretch: {
    label: 'A Stretch',
    color: 'amber',
    advice:
      'This needs mid/small-cap exposure, which is higher risk and more volatile. Consider increasing your SIP or extending the horizon to reduce the return you depend on.',
  },
  unrealistic: {
    label: 'Unrealistic',
    color: 'rose',
    advice:
      'The required return is above what equity funds reliably deliver over the long run. Increase your SIP/lumpsum, extend the timeline, or lower the target. Chasing this with high-risk funds could backfire.',
  },
}
