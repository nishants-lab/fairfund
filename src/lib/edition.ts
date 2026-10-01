import type { Fund, FundsData } from '../types'
import { fundSlug } from './format'

export interface EditionFact {
  label: string
  value: string
  text: string
  note?: string
  explanation: string
  to: string
}
export interface Edition {
  spotlight: Fund | null
  facts: EditionFact[]
  leaders: Fund[]
}
export const CONSISTENCY_EXPLANATION = 'Each 3-year period starts one month after the previous one, so most of their return history is shared.'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const fundPath = (f: Fund) => `/fund/${f.code}/${fundSlug(f.name)}`
function shuffled<T>(items: T[], seed: number): T[] {
  let state = seed >>> 0
  const result = [...items]
  const random = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function validConsistency(f: Fund) {
  const b = f.analytics?.battingAverage
  return b && finite(b.pct) && b.pct >= 0 && b.pct <= 100 && Number.isInteger(b.n) && b.n > 0 && b.windowM === 36 ? b : null
}

/** Selection is for browsing; no skill test, forecast or score calculation happens here. */
export function makeEdition(seed: number, data: FundsData, previousSpotlight?: number): Edition {
  const pool = data.funds.filter(f => !f.isYoung && !f.isDebt && !f.isArbitrage && finite(f.metrics['3Y']?.cagr))
  const ordered = shuffled(pool, seed)
  const spotlight = ordered.find(f => f.code !== previousSpotlight) ?? ordered[0] ?? null
  const facts: EditionFact[] = []
  const categories = shuffled(Object.keys(data.categories), seed + 1)
  const spreadCat = categories.find(c => pool.filter(f => f.category === c).length >= 2)
  if (spreadCat) {
    const returns = pool.filter(f => f.category === spreadCat).map(f => f.metrics['3Y']?.cagr).filter(finite)
    facts.push({
      label: '3-year return range', value: `${Math.round((Math.max(...returns) - Math.min(...returns)) * 100).toLocaleString('en-IN')} bps`,
      text: `${data.categories[spreadCat].display ?? spreadCat}: gap between the highest and lowest annualised returns.`,
      note: 'Fund periods can differ.',
      explanation: '100 basis points (bps) = 1 percentage point. This range describes the available 3-year returns, not the difference in risk.',
      to: `/explore?cat=${encodeURIComponent(spreadCat)}&h=3Y`,
    })
  }
  const consistent = shuffled(pool.filter(f => !!validConsistency(f)), seed + 2)[0]
  if (consistent) {
    const b = validConsistency(consistent)!
    facts.push({ label: 'Rolling 3-year comparison', value: `${Math.round(b.pct)}%`,
      text: `${consistent.name} beat its category median in this share of measured 3-year periods.`,
      note: b.limited ? 'Limited history.' : undefined,
      explanation: `Based on ${b.n} measured periods. ${CONSISTENCY_EXPLANATION}`, to: fundPath(consistent) })
  }
  const leaders = categories.map(category => pool.find(f => f.category === category && f.metrics['3Y']?.catRank === 1))
    .filter((f): f is Fund => !!f).slice(0, 6)
  return { spotlight, facts: shuffled(facts, seed + 3), leaders }
}
