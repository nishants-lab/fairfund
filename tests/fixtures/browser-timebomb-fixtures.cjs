/** Synthetic route fixtures for browser regressions whose behaviour must not depend on the
 * composition of the daily/monthly generated data. Shapes mirror src/types.ts and
 * src/lib/moversData.ts. Codes 9000001+ never occur in the real index. */
const STOCK_NAME = 'Zyxel Synthetic Bank Ltd';
const OTHER_STOCK = 'Quorvex Synthetic Motors Ltd';

/** Movers + portfolio-moves payloads for two real index codes (structure only; any two will do). */
function syntheticMovers(codes) {
  const [a, b] = codes;
  const month = (aum, flow, ret) => ['2026-08', aum, flow, ret];
  const fundsRec = {};
  for (const [i, code] of [a, b].entries()) {
    fundsRec[code] = { m: [['2026-07', 1000 + i, null, null], month(1050 + i, 10, 1.2), ['2026-09', 1100 + i, 12, 2.1]], w: { 1: [50, 12, 38, 1.1] }, t: { now: 1.1 } };
  }
  const movers = {
    generatedAt: '2026-10-01T00:00:00Z', refMonth: '2026-09', windows: [1, 3, 6], stockWindows: [1], funds: fundsRec, mgrLog: [],
    stocks: [['zyxel-synthetic-bank-ltd', STOCK_NAME, 'Financials'], ['quorvex-synthetic-motors-ltd', OTHER_STOCK, 'Consumer']],
  };
  // fund a adds stock 0 and cuts stock 1; fund b raises stock 0 and exits stock 1: stock 0 has only buyers.
  const stocks = { refMonth: '2026-09', pairs: { 1: { from: '2026-08', px: { 0: 1.0, 1: 1.0 }, funds: {
    [a]: [1000, 1100, [[0, null, 2.0], [1, 3.0, 1.0]], 1.0],
    [b]: [1000, 1100, [[0, 1.0, 3.0], [1, 2.0, null]], 1.0],
  } } } };
  return { movers, stocks, STOCK_NAME };
}

function metric(h, windowStart, windowEnd, extra = {}) {
  return { cagr: 12, volatility: 10, sharpe: 1, sortino: 1.2, maxDrawdown: -10, calmar: 1, windowStart, windowEnd, targetStart: windowStart, targetHorizon: h, startOffsetDays: 0, endOffsetDays: 0, alpha: 1, catMedianCagr: 10, catRank: 1, catSize: 7, score: 0.5, ...extra };
}

/** A complete synthetic equity/debt fund record. */
function syntheticFund(code, name, category, overrides = {}) {
  return {
    code, name, fullName: `${name} - Direct Plan - Growth`, amc: 'Synthetic', category, categoryDisplay: category, riskLevel: 'Moderately High',
    categorySize: 7, metrics: {}, analytics: {}, expenseRatio: 0.5, aum: { current: 1000, asOf: null }, investInfo: { exit_load: 'Nil', min_lumpsum: 100 },
    benchmark: 'Synthetic Index TRI', launchDate: '01-Jan-2010', sebiRisk: 'Very High', ratings: { groww: null, crisil: null }, status: 'active',
    navPoints: 4000, inceptionDate: '2010-01-01', isYoung: false, si: { totalReturn: 300, days: 5000, since: '2010-01-01', cagr: 10 }, ...overrides,
  };
}

/** Make sure funds.json metadata names the categories a synthetic fund uses. */
function ensureCategory(data, key, display, riskLevel, extra = {}) {
  data.categories[key] = { display, riskLevel, fundCount: 7, medianCagr5Y: 10, topCagr5Y: 12, ...(data.categories[key] || {}), ...extra };
}

module.exports = { syntheticMovers, syntheticFund, syntheticMetric: metric, ensureCategory, STOCK_NAME, OTHER_STOCK };
