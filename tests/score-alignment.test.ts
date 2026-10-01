import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildVerdict } from '../src/lib/verdict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import VerdictCard from '../src/components/VerdictCard'
import type { AlphaSignificance, Fund, Horizon, WindowMetrics } from '../src/types'

const metric: WindowMetrics = {
  cagr: 12, alpha: 2, sharpe: 1, sortino: 1.5, maxDrawdown: -10,
  calmar: 1.2, volatility: 10, catRank: 1, catSize: 8, catMedianCagr: 10, score: 75,
}
function fund(metrics: Fund['metrics'] = {}): Fund {
  return { code: -1, name: 'Score fixture', fullName: 'Score fixture',
    amc: 'Fixture', category: 'test', categoryDisplay: 'Test category', riskLevel: 'High',
    categorySize: 8, metrics }
}
function completeFund(): Fund {
  return { ...fund({ '3Y': { ...metric } }),
    analytics: {
      battingAverage: { pct: 70, n: 30, windowM: 36, limited: false },
      alpha: { confidence: 95, tStat: 1.8, n: 60 },
      capture: { down: 80, up: 100, downMonths: 20, upMonths: 40 },
    },
    management: { available: true, signal: 'Strong' },
  }
}
const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

test('six-pillar score uses exact original relative weights, rounded only after renormalization', () => {
  const f = completeFund()
  const expected = Math.round((100 * 22 + 62 * 18 + 50 * 12 + 70 * 16 + 70 * 10 + 90 * 10) / 88)
  assert.equal(expected, 75)
  assert.equal(buildVerdict(f).score, expected)
  assert.equal(buildVerdict(f).label, 'Composite score')
  assert.equal(buildVerdict(f).tone, 'neutral')
})

test('monthly-test changes do not change the score, reasons or summary', () => {
  const f = completeFund()
  const expected = buildVerdict(f)
  const variants: (AlphaSignificance | undefined)[] = [
    undefined, { n: 0, insufficient: true }, { n: 60 },
    ...[0, 5, 49, 50, 89, 90, 95, 100].flatMap(confidence => [
      { n: 60, confidence, tStat: 1.8 },
      { n: 12, confidence, tStat: -2, insufficient: true },
    ]),
  ]
  for (const alpha of variants) {
    f.analytics!.alpha = alpha
    assert.deepEqual(buildVerdict(f), expected)
  }
  assert.ok([...expected.positives, ...expected.negatives].every(p => !/monthly.test/i.test(p.label)))
})

test('missing inputs and limited consistency history retain neutral defaults', () => {
  assert.equal(buildVerdict(fund()).score, 50)
  const f = fund()
  f.analytics = { battingAverage: { pct: 100, n: 10, windowM: 36, limited: true },
    capture: { down: null, up: null, downMonths: 0, upMonths: 0 } }
  assert.equal(buildVerdict(f).score, 50)
  assert.deepEqual(buildVerdict(f).positives, [])
  assert.deepEqual(buildVerdict(f).negatives, [])
  f.analytics.battingAverage!.limited = false
  assert.equal(buildVerdict(f).score, Math.round((50 * 72 + 100 * 16) / 88))
})

test('each remaining pillar retains its proportion of the score', () => {
  const cases: [string, Fund, number, number][] = [
    ['rank', fund({ '3Y': { ...metric, alpha: 0, catRank: 1 } }), 22, 100],
    ['alpha', fund({ '3Y': { ...metric, catRank: 0, alpha: 5 } }), 18, 80],
    ['Sharpe', fund({ '3Y': { ...metric, catRank: 0, alpha: 0, sharpe: 2 } }), 12, 100],
    ['consistency', { ...fund(), analytics: { battingAverage: { pct: 90, n: 30, windowM: 36, limited: false } } }, 16, 90],
    ['capture', { ...fund(), analytics: { capture: { down: 50, up: 100, downMonths: 20, upMonths: 40 } } }, 10, 100],
    ['manager', { ...fund(), management: { available: true, signal: 'Strong' } }, 10, 90],
  ]
  for (const [label, f, weight, points] of cases) {
    assert.equal(buildVerdict(f).score, Math.round((50 * (88 - weight) + points * weight) / 88), label)
  }
})

test('alpha, Sharpe and downside-capture extremes stay clamped', () => {
  for (const [alpha, sharpe, down, points] of [[100, 100, -100, 100], [-100, -100, 300, 0]]) {
    const f = fund({ '3Y': { ...metric, catRank: 0, alpha, sharpe } })
    f.analytics = { capture: { down, up: 100, downMonths: 20, upMonths: 40 } }
    assert.equal(buildVerdict(f).score, Math.round((50 * 48 + points * 40) / 88))
  }
})

test('baseline window selection remains 3Y, then 5Y, then 1Y', () => {
  const metrics = { '1Y': { ...metric, alpha: -4 }, '5Y': { ...metric, alpha: 0 }, '3Y': metric }
  for (const horizon of ['3Y', '5Y', '1Y'] as Horizon[]) {
    const current = buildVerdict(fund(metrics))
    assert.equal(current.score, buildVerdict(fund({ [horizon]: metrics[horizon] })).score)
    assert.match(current.oneLiner, new RegExp(`on ${horizon} risk-adjusted return`))
    delete (metrics as Fund['metrics'])[horizon]
  }
})

test('unscored momentum caution remains separate from score arithmetic', () => {
  const f = completeFund()
  const before = buildVerdict(f)
  f.analytics!.meanReversion = { state: 'hot', z: 2, recent1Y: 30, norm1Y: 15 }
  const after = buildVerdict(f)
  assert.equal(after.score, before.score)
  assert.ok(after.negatives.some(p => p.label === 'Recent 1Y above own norm'))
})

test('score disclosures agree on six rounded weights and excluded monthly test', () => {
  for (const path of ['src/components/VerdictCard.tsx', 'src/pages/Methodology.tsx']) {
    const text = source(path)
    for (const weight of ['25%', '20.45%', '13.64%', '18.18%', '11.36%']) assert.ok(text.includes(weight), `${path}: ${weight}`)
    assert.match(text, /weights are rounded/)
    assert.match(text, /monthly excess-return test is excluded from this score/)
    assert.doesNotMatch(text, /12% score input|monthly-test statistic \(12%\)/)
  }
  assert.match(source('src/pages/Methodology.tsx'), /\(22, 18, 12, 16, 10 and 10\) by their total of 88/)
})

test('separate monthly-test display retains statistical and provenance caveats', () => {
  const text = source('src/components/ForwardAnalytics.tsx')
  const panel = text.slice(text.indexOf('{a?.alpha && ('), text.indexOf('{/* Capture ratios'))
  for (const copy of ['Monthly excess-return test', 'num(a.alpha.tStat)', 'a.alpha.n',
    'independent monthly observations', 'does not adjust for testing many funds',
    'does not measure the probability of manager skill or future outperformance',
    'Raw p-value and observation dates are unavailable',
    '36 paired monthly returns and non-zero variation',
    'monthly excess-return test is excluded from the equity fund-page composite score']) {
    assert.ok(panel.includes(copy), copy)
  }
  assert.doesNotMatch(panel, /alpha.confidence|12%/)
})

test('current equity index produces bounded scores without mutating source funds', () => {
  const data = JSON.parse(source('src/data/funds.json')) as { funds: Fund[] }
  const equity = data.funds.filter(f => !f.isDebt && !f.isArbitrage)
  assert.ok(equity.length > 0)
  for (const f of equity) {
    const before = JSON.stringify(f)
    const result = buildVerdict(f)
    assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100, String(f.code))
    assert.equal(JSON.stringify(f), before)
    assert.ok([...result.positives, ...result.negatives].every(p => !/monthly.test/i.test(p.label)))
  }
})


test('unscored debt cards distinguish missing return history from tier-3 risk-data gaps', () => {
  for (const category of ['Liquid', 'Money Market', 'Arbitrage']) {
    const f = { ...fund(), category, categoryDisplay: category,
      isDebt: category !== 'Arbitrage', isArbitrage: category === 'Arbitrage' }
    const html = renderToStaticMarkup(createElement(VerdictCard, { fund: f }))
    assert.match(html, /Why we show no score here/)
    assert.match(html, /No [135]Y return is available to score this fund/)
    assert.doesNotMatch(html, /What to look for on the AMC factsheet|credit-quality breakdown/)
  }
  const f = { ...fund(), category: 'Gilt', categoryDisplay: 'Gilt', isDebt: true }
  const html = renderToStaticMarkup(createElement(VerdictCard, { fund: f }))
  assert.match(html, /Why we show no score here/)
  assert.match(html, /What to look for on the AMC factsheet/)
  assert.match(html, /credit-quality breakdown/)
})
