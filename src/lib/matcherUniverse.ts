/**
 * CAMS matcher universe: every open-ended Growth scheme AMFI prices, across
 * Direct and Regular plans and all asset classes. Built by
 * pipeline/build_matcher_universe.py.
 *
 * This is an identification superset of funds.json (the curated Direct-Growth
 * equity analytics universe). It lets the CAMS parser recognise Regular-plan
 * and debt/hybrid holdings that will never enter the analytics universe, so
 * they can be named and classified correctly instead of falling through as
 * raw statement text.
 */
import universe from '../data/matcher_universe.json'

export interface UniverseFund {
  code: number
  name: string
  amc: string
  amfiCategory: string
  planType: 'direct' | 'regular'
  optionType: string
}

export const universeFunds: UniverseFund[] = (universe as {
  funds: UniverseFund[]
}).funds

let byCode: Map<number, UniverseFund> | null = null

export function getUniverseFund(code: number): UniverseFund | undefined {
  if (!byCode) byCode = new Map(universeFunds.map(f => [f.code, f]))
  return byCode.get(code)
}

/** "Open Ended Schemes(Equity Scheme - Mid Cap Fund)" -> "Mid Cap Fund" */
export function universeCategoryLabel(amfiCategory: string): string {
  const m = amfiCategory.match(/\(([^)]+)\)/)
  if (!m) return amfiCategory
  const parts = m[1].split(' - ')
  return (parts.length > 1 ? parts.slice(1).join(' - ') : m[1]).trim()
}
