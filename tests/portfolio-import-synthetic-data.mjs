// Synthetic scheme identities for the portfolio-import tests. They are merged
// into the matcher universe and the analytics index IN MEMORY (never on disk),
// so the correction path never depends on which real schemes AMFI lists today.
export const SYNTHETIC_DIRECT = { code: 900000001, name: 'Fixture Alpha Equity Fund - Direct Plan - Growth' }
export const SYNTHETIC_REGULAR = { code: 900000002, name: 'Fixture Alpha Equity Fund - Regular Plan - Growth' }
export const directCode = SYNTHETIC_DIRECT.code
export const regularCode = SYNTHETIC_REGULAR.code

export function mergeSynthetic(universe, indexData) {
  const un = universe.funds
  for (const [s, plan] of [[SYNTHETIC_DIRECT, 'direct'], [SYNTHETIC_REGULAR, 'regular']]) {
    if (un.some(f => f.code === s.code)) throw new Error(`synthetic code ${s.code} collides with a real scheme`)
    un.push({ code: s.code, name: s.name, amc: 'Fixture Mutual Fund', amfiCategory: 'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)', planType: plan, optionType: 'growth' })
  }
  if ('count' in universe) universe.count = un.length
  // Only the direct scheme joins the analytics index (as in production, where
  // Regular plans are identification-only). Explicit, complete minimal record:
  // not cloned from live data, so no live flags (isDebt, dataQuality...) leak in.
  indexData.funds.push({
    code: SYNTHETIC_DIRECT.code, name: 'Fixture Alpha Equity Fund', fullName: SYNTHETIC_DIRECT.name,
    amc: 'Fixture Mutual Fund', category: 'Flexi Cap', categoryDisplay: 'Flexi Cap', riskLevel: 'Very High',
    categorySize: 1, metrics: {}, analytics: null, aum: { current: null }, expenseRatio: null,
    investInfo: null, benchmark: 'Fixture TRI', launchDate: '2015-01-01', sebiRisk: 'Very High',
    status: 'active', navPoints: 0, inceptionDate: '2015-01-01', isYoung: false, si: null,
  })
  return { universe, indexData }
}
