import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildVerdict } from '../src/lib/verdict'
import type { Fund, Horizon, WindowMetrics } from '../src/types'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const paths = [
  'src/components/ForwardAnalytics.tsx', 'src/components/VerdictCard.tsx',
  'src/components/ManagementCard.tsx', 'src/components/PortfolioMoves.tsx',
  'src/pages/Explore.tsx', 'src/pages/Compare.tsx',
  'src/pages/CategoryDetail.tsx', 'src/pages/FundDetail.tsx', 'src/pages/Methodology.tsx', 'src/lib/verdict.ts',
]
const metric: WindowMetrics = {
  cagr: 12, alpha: 2, sharpe: 1, sortino: 1.5, maxDrawdown: -10,
  calmar: 1.2, volatility: 10, catRank: 1, catSize: 8, catMedianCagr: 10, score: 75,
}
function fund(metrics: Fund['metrics'] = {}): Fund {
  return { code: -1, name: 'Copy contract fixture', fullName: 'Copy contract fixture',
    amc: 'Fixture', category: 'test', categoryDisplay: 'Test category', riskLevel: 'High',
    categorySize: 8, metrics }
}

test('owned copy omits probability-of-skill marketing and fixed-cutoff profile claims', () => {
  const forbidden = /Skill vs luck|Skill confidence|Alpha confidence|Likely skill|Likely luck|statistically skilled|confident it.s skill|chance its edge is just luck|repeatable skill|Top-tier data profile|Above-median profile|Middle of the pack|Below-median profile|a model, not a promise|same window\. Blue box/i
  for (const path of paths) {
    const text = source(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(text, forbidden, path)
  }
})

test('monthly test is absent from the fund analytics while methodology retains its caveats', () => {
  const text = source('src/components/ForwardAnalytics.tsx')
  assert.doesNotMatch(text, /Monthly excess-return test|a\?\.alpha|a\.alpha/)
  const methodology = source('src/pages/Methodology.tsx')
  assert.match(methodology, /independent monthly observations/)
  assert.match(methodology, /does not adjust\s+for testing many funds/)
  assert.match(methodology, /Raw p-values and observation dates are\s+unavailable/)
  assert.match(methodology, /36 paired monthly returns and non-zero variation/)
  assert.match(methodology, /not displayed on the fund page and is excluded from its composite score/)
})

test('consistency explains overlap and comparisons omit the old test leaderboard', () => {
  for (const path of ['src/components/ForwardAnalytics.tsx', 'src/pages/Explore.tsx', 'src/pages/Methodology.tsx', 'src/pages/CategoryDetail.tsx']) {
    assert.match(source(path), /periods overlap, so the observations are related/, path)
  }
  assert.match(source('src/pages/Compare.tsx'), /overlapping 3Y periods beating category median/)
  assert.doesNotMatch(source('src/pages/Compare.tsx'), /alpha\?\.confidence|al.confidence/)
  assert.doesNotMatch(source('src/pages/CategoryDetail.tsx'), /highConfAlpha|alphaConfs/)
})

test('score captions use the actual selected baseline horizon', () => {
  for (const horizon of ['1Y', '3Y', '5Y'] as Horizon[]) {
    assert.match(buildVerdict(fund({ [horizon]: metric })).oneLiner, new RegExp(`on ${horizon} risk-adjusted return`))
  }
  assert.match(buildVerdict(fund({ '1Y': metric, '5Y': metric })).oneLiner, /on 5Y/)
  assert.match(buildVerdict(fund({ '1Y': metric, '3Y': metric, '5Y': metric })).oneLiner, /on 3Y/)
})

test('score copy follows six-pillar arithmetic and neutral defaults', () => {
  assert.equal(buildVerdict(fund()).score, 50)
  const f = fund({ '3Y': metric })
  f.analytics = { battingAverage: { pct: 70, n: 30, windowM: 36, limited: false },
    alpha: { confidence: 95, tStat: 1.8, n: 60 },
    capture: { down: 80, up: 100, downMonths: 20, upMonths: 40 } }
  f.management = { available: true, signal: 'Strong' }
  assert.equal(buildVerdict(f).score, 75)
  assert.ok(!buildVerdict(f).positives.some(p => p.label === 'Monthly-test score input'))
  f.analytics.alpha!.confidence = 5
  assert.equal(buildVerdict(f).score, 75)
  f.analytics.alpha!.insufficient = true
  assert.equal(buildVerdict(f).score, 75)
})

test('monthly-test score exclusion is disclosed in both summary and methodology', () => {
  for (const path of ['src/components/VerdictCard.tsx', 'src/pages/Methodology.tsx']) {
    assert.match(source(path), /monthly excess-return test is excluded from this score/)
    assert.match(source(path), /weights are rounded/)
    assert.doesNotMatch(source(path), /12% score input|monthly-test statistic \(12%\)/)
  }
})

test('short-history copy uses NAV observations and does not invent zero coverage', () => {
  const text = source('src/components/VerdictCard.tsx')
  assert.match(text, /No matched-period score available/)
  assert.match(text, /Short history or a missing endpoint can make a fund ineligible/)
  assert.match(text, /NAV observations/)
  assert.doesNotMatch(text, /trading days|fund.navPoints \?\? 0|We are not\s+hiding/)
})

test('portfolio copy discloses coverage gaps without using today as a price date', () => {
  const text = source('src/components/PortfolioMoves.tsx')
  assert.match(text, /favourable price moves/)
  assert.match(text, /unweighted price-direction count/)
  assert.match(text, /ten additions and ten exits/)
  assert.match(text, /trade dates and execution prices are unavailable/)
  assert.match(text, /Price-period endpoints and the last price date are unavailable/)
  assert.doesNotMatch(text, /new Date\(\)|postMonths|shortWindow|becomes more reliable|daily close prices|\{moves.verdict\}/)
})

test('recent-return descriptions follow sign and simulations disclose out-of-range outcomes', () => {
  const text = source('src/components/ForwardAnalytics.tsx')
  assert.match(text, /meanReversion.z > 0 && ' The latest 1-year return is above/)
  assert.match(text, /meanReversion.z < 0 && ' The latest 1-year return is below/)
  assert.match(text, /Actual results may be lower or higher than the values shown/)
  assert.doesNotMatch(text, /returns tend to revert|Hot streaks tend to|mean-reversion can cut both ways/)
})

test('manager narrative uses typed track-record fields instead of stale generated notes', () => {
  const text = source('src/components/ManagementCard.tsx')
  assert.doesNotMatch(text, /\{mgmt.note\}/)
  assert.match(text, /tr.usedOtherFunds/)
  assert.match(text, /Math.round\(tr.medianAlpha \* 100\)/)
  assert.match(text, /results are related/)
})


test('technical score detail is collapsed while investment warnings remain visible', () => {
  const text = source('src/components/VerdictCard.tsx')
  const disclosure = text.match(/<details[^>]*>[\s\S]*?<\/details>/)?.[0] ?? ''
  assert.match(disclosure, /How this score is calculated/)
  assert.match(disclosure, /monthly excess-return test is excluded from this score/)
  assert.match(disclosure, /weights are rounded/)
  assert.match(disclosure, /Missing inputs and limited consistency history use neutral points/)
  assert.doesNotMatch(disclosure, /<details[^>]*\sopen(?:[\s=>])/)
  const visible = text.replace(disclosure, '')
  assert.match(visible, /This score is not an investment recommendation/)
  assert.match(visible, /Past performance does not guarantee future returns/)
  assert.match(visible, /No matched-period score available/)
})

test('relocated metric definitions stay in tooltips without hiding data warnings', () => {
  for (const [path, label, definition] of [
    ['src/pages/Compare.tsx', 'About consistency', /overlapping 3Y periods beating category median/],
    ['src/pages/CategoryDetail.tsx', 'About category consistency', /periods overlap, so the observations are related/],
    ['src/components/PortfolioMoves.tsx', 'About portfolio changes', /unweighted price-direction count/],
    ['src/components/ForwardAnalytics.tsx', 'About the historical-return simulation', /fixed seed/],
  ] as const) {
    const text = source(path)
    const tooltip = [...text.matchAll(/<InfoTip\b[^>]*>[\s\S]*?<\/InfoTip>/g)]
      .find(([markup]) => markup.includes(`label="${label}"`))?.[0] ?? ''
    assert.match(tooltip, definition, path)
  }
  const visible = (path: string) => source(path).replace(/<InfoTip\b[^>]*>[\s\S]*?<\/InfoTip>/g, '')
  const analytics = visible('src/components/ForwardAnalytics.tsx')
  assert.match(analytics, /Limited history:/)
  assert.match(analytics, /Actual results may be lower or higher than the values shown/)
  assert.match(analytics, /fmtDate\(dd.peakDate\)/)
  const moves = visible('src/components/PortfolioMoves.tsx')
  assert.match(moves, /fmtMonth\(moves.fromDate\)/)
  assert.match(moves, /fmtMonth\(moves.toDate\)/)
  assert.match(moves, /Price-period endpoints and the last price date are unavailable/)
  assert.match(moves, /Price direction does not measure the contribution to the fund's return/)
  assert.match(moves, /Price data is unavailable for enough positions/)
})

test('user-facing methodology omits developer-process copy while preserving distinct formulas', () => {
  const text = source('src/pages/Methodology.tsx')
  assert.doesNotMatch(text, /requires a separate methodology decision|require reconciliation|re-checked at build time|NAV\s+pipeline/)
  assert.match(text, /Rankings and fund-page summaries share these rules/)
  assert.match(text, /geometric mean/)
  assert.match(text, /category rank \(25%\)/)
  assert.match(text, /monthly excess-return test is excluded from this score/)
  assert.match(text, /rate-sensitive and credit-sensitive categories/)
})

test('account and dashboard copy makes no unsupported sync or alert promises', () => {
 const account=source('src/pages/SignIn.tsx')
 assert.doesNotMatch(account,/Coming Soon|coming soon|Never lose|Personalized alerts|Free forever|follow you everywhere/)
 assert.match(account,/signing in does not sync them/)
 assert.match(account,/Sign-in is unavailable/)
 assert.doesNotMatch(source('src/pages/MyDashboard.tsx'),/Deep diagnostics|more insight than you think|coming soon/)
 assert.doesNotMatch(source('src/pages/Wishlist.tsx'),/sync across devices|coming soon/)
 assert.match(source('src/pages/Wishlist.tsx'),/Clearing site data removes your saved funds/)
})


test('ranking methodology discloses publication delay bounds and separates dated previous ranks', () => {
  const text = source('src/pages/Methodology.tsx').replace(/\s+/g, ' ')
  assert.match(text, /full calendar-year history and identical observed start and end dates/)
  assert.match(text, /up to three published NAV dates/)
  assert.match(text, /more than half of recent category histories with at least one year of data and 60 NAV observations/)
  assert.match(text, /dates with the most observations/)
  assert.match(text, /latest four such dates/)
  assert.match(text, /preferring the latest date in a tie/)
  assert.match(text, /within seven calendar days of the dataset's validated NAV snapshot/)
  assert.match(text, /Stale funds are excluded from the current ranking/)
  assert.match(text, /previous ranking is dated and shown separately, never as a current rank/)
  assert.match(text, /do not establish that it is up to date today/)
})
