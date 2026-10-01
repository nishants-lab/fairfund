import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import RankingPeriod, { hasDatedRanking, PreviousRankings } from '../src/components/RankingPeriod'
import VerdictCard from '../src/components/VerdictCard'
import { buildVerdict } from '../src/lib/verdict'
import type { Fund, WindowMetrics } from '../src/types'

const today = new Date()
const date = (yearsAgo: number) => new Date(Date.UTC(today.getUTCFullYear() - yearsAgo, 0, 2)).toISOString().slice(0, 10)
const metric: WindowMetrics = {
  windowStart: date(4), windowEnd: date(1), cagr: 12, alpha: 2, sharpe: 1,
  sortino: 1, maxDrawdown: -10, calmar: 1, volatility: 10,
  catRank: 2, catSize: 7, catMedianCagr: 10, score: 75,
}
const fund = (overrides: Partial<Fund> = {}): Fund => ({
  code: -1, name: 'Ranking fixture', fullName: 'Ranking fixture', amc: 'Fixture',
  category: 'Flexi Cap', categoryDisplay: 'Flexi Cap', riskLevel: 'High',
  categorySize: 99, metrics: { '3Y': metric }, ...overrides,
})
const render = (f: Fund, compact = false, withheld = false) => renderToStaticMarkup(createElement(RankingPeriod, { fund: f, horizon: '3Y', compact, withheld }))

test('current rank uses exact cohort count and complete observed period', () => {
  const html = render(fund())
  assert.match(html, /Rank #2 of 7 \(3Y\)/)
  assert.ok(html.includes(`${metric.windowStart} to ${metric.windowEnd}`))
  assert.doesNotMatch(html, /99|Previous ranking/)
  assert.match(render(fund(), true), /title="3Y ranking period:/)
  assert.ok(render(fund(), true).includes(`Through ${metric.windowEnd}`))
})

test('previous rank is display-only and appears only for an absent current horizon', () => {
  const previousRankings = { '3Y': { ...metric, catRank: 1 } }
  const absent = fund({ metrics: {}, previousRankings })
  assert.match(render(absent), /Previous ranking #1 of 7/)
  assert.match(render(absent), /data-ranking="previous"/)
  assert.doesNotMatch(render(fund({ previousRankings })), /Previous ranking/)
  assert.deepEqual(buildVerdict(absent), buildVerdict(fund({ metrics: {} })))
  assert.equal(renderToStaticMarkup(createElement(PreviousRankings, { fund: fund({ previousRankings }) })), '')
})

test('quarantine and runtime NAV holds suppress current and previous evidence', () => {
  for (const metrics of [{}, { '3Y': metric }]) {
    const f = fund({ metrics, previousRankings: { '3Y': metric }, dataQuality: { status: 'quarantined', issues: [] } })
    assert.equal(render(f).includes('Ranking withheld'), true)
    assert.doesNotMatch(render(f), /#|Through|Previous ranking/)
    assert.equal(renderToStaticMarkup(createElement(PreviousRankings, { fund: f })), '')
    assert.doesNotMatch(renderToStaticMarkup(createElement(VerdictCard, { fund: f })), /#2|75|Previous ranking/)
  }
  assert.match(render(fund(), true, true), /Ranking withheld/)
})

test('malformed, future, undated and impossible ranks never become display evidence', () => {
  for (const change of [
    { windowStart: undefined }, { windowEnd: 'garbage' }, { windowEnd: `${today.getUTCFullYear() - 1}-02-30` },
    { windowEnd: date(-1) }, { windowEnd: metric.windowStart },
    { catRank: 0 }, { catRank: 8 }, { catSize: undefined }, { catSize: 1.5 }, { score: NaN },
  ]) {
    const bad = { ...metric, ...change }
    assert.equal(hasDatedRanking(bad), false, JSON.stringify(change))
    assert.doesNotMatch(render(fund({ metrics: {}, previousRankings: { '3Y': bad } })), /Previous ranking/)
    assert.doesNotMatch(render(fund({ metrics: { '3Y': bad }, previousRankings: { '3Y': metric } })), /Previous ranking/)
  }
})

test('long-history excluded equity and debt retain factual since-launch returns without invented youth', () => {
  for (const isDebt of [false, true]) {
    const f = fund({ isDebt, category: isDebt ? 'Liquid' : 'Flexi Cap', categoryDisplay: isDebt ? 'Liquid' : 'Flexi Cap', metrics: {}, previousRankings: { '3Y': metric }, navPoints: 2500,
      si: { since: date(10), days: 3650, totalReturn: 120, cagr: 8 } })
    const html = renderToStaticMarkup(createElement(VerdictCard, { fund: f }))
    assert.match(html, /No matched-period score available/)
    assert.match(html, /2500 NAV observations/)
    assert.match(html, /Previous ranking #2 of 7/)
    assert.match(html, /Annualised over the available since-launch history/)
    assert.match(html, /120.0%/)
    assert.doesNotMatch(html, /Early, small-sample|limited NAV history|\/100/)
  }
})

test('debt scored card displays persisted rank evidence and separate excluded horizon history', async () => {
  const { funds } = await import('../src/lib/data')
  const debt = funds.find(f => f.category === 'Liquid' && !f.dataQuality && hasDatedRanking(f.metrics['1Y']))
  assert.ok(debt)
  const f = { ...debt, metrics: { '1Y': debt.metrics['1Y'] }, previousRankings: { '3Y': metric } }
  const html = renderToStaticMarkup(createElement(VerdictCard, { fund: f }))
  const m = f.metrics['1Y']!
  assert.ok(html.includes(`Rank #${m.catRank} of ${m.catSize} (1Y)`))
  assert.ok(html.includes(`${m.windowStart} to ${m.windowEnd}`))
  assert.match(html, /Previous ranking #2 of 7 \(3Y\)/)
  assert.doesNotMatch(html, /ranks #|Ranked #/)
})

test('debt score metadata identifies actual common horizon and legacy fallback without changing scores', async () => {
  const { buildDebtVerdict } = await import('../src/lib/debtVerdict')
  const make = (code: number, metrics: Fund['metrics']) => fund({ code, category: 'Liquid', categoryDisplay: 'Liquid', isDebt: true, metrics })
  const one = make(1, { '1Y': metric, '3Y': metric })
  const three = make(2, { '3Y': metric })
  const peers = [one, three]
  assert.equal(buildDebtVerdict(one, peers).horizon, '1Y')
  assert.equal(buildDebtVerdict(three, peers).horizon, '1Y')
  assert.equal(buildDebtVerdict(three, peers).scored, false)
  assert.equal(buildDebtVerdict(three, [three]).horizon, '3Y')
  const legacy = { ...three, category: 'Short Duration', categoryDisplay: 'Short Duration' }
  assert.equal(buildDebtVerdict(legacy, [legacy]).horizon, '3Y')
  const tier3 = { ...three, category: 'Gilt' }
  assert.equal(buildDebtVerdict(tier3, [tier3]).horizon, undefined)
})
