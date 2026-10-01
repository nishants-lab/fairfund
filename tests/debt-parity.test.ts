import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { buildDebtVerdict, computeDebtRanks } from '../src/lib/debtVerdict'
import type { Fund, Horizon, WindowMetrics } from '../src/types'

const categories = ['Liquid', 'Money Market', 'Arbitrage']
const metric = (cagr: number): WindowMetrics => ({
  cagr, alpha: 0, sharpe: 0, sortino: null, maxDrawdown: 0,
  calmar: 0, volatility: 0, catRank: 0, catMedianCagr: 6, score: 0,
})
function fund(code: number, category = 'Liquid', metrics: Fund['metrics'] = { '1Y': metric(6) },
  expenseRatio: number | null = null, aum: number | null = null): Fund {
  return { code, name: `Fund ${code}`, fullName: `Fund ${code}`, amc: 'Fixture',
    category, categoryDisplay: category, riskLevel: 'Low', categorySize: 0,
    isDebt: category !== 'Arbitrage', isArbitrage: category === 'Arbitrage',
    metrics, expenseRatio, aum: aum == null ? null : { current: aum, asOf: null } }
}
function nullHistory(code: number, category: string): Fund {
  return fund(code, category, { '1Y': null, '3Y': { ...metric(20), cagr: null } } as unknown as Fund['metrics'], 0, 1e9)
}
function mixedPeers(category: string): Fund[] {
  return [fund(9, category, { '1Y': metric(5), '3Y': metric(10) }, 0.1, 1000),
    fund(3, category, { '1Y': metric(5), '3Y': metric(3) }, 0.1, 1000),
    fund(5, category, { '1Y': metric(9) }, 0.3, 500),
    fund(7, category, { '1Y': metric(7) }),
    fund(11, category, { '3Y': metric(99) }, 0, 1e9),
    fund(13, category, {}, 0, 1e9), nullHistory(15, category)]
}

for (const category of categories) {
  test(`${category}: producer weights distinguish cost, AUM and return`, () => {
    const peers = [fund(1, category, { '1Y': metric(5) }, 0.1, 100),
      fund(2, category, { '1Y': metric(9) }, 0.3, 1000)]
    const ranks = computeDebtRanks(peers, category === 'Arbitrage', '1Y')
    assert.equal(ranks.get(1)?.score, category === 'Arbitrage' ? 45 : 70)
    assert.equal(ranks.get(2)?.score, category === 'Arbitrage' ? 55 : 30)
  })

  test(`${category}: strict ties, neutral metadata and singleton percentiles`, () => {
    const tied = [fund(9, category, { '1Y': metric(6) }, 0.2, 100),
      fund(3, category, { '1Y': metric(6) }, 0.2, 100)]
    const ranks = computeDebtRanks(tied, category === 'Arbitrage')
    assert.deepEqual([...ranks.keys()], [3, 9])
    assert.equal(ranks.get(9)?.score, 0)
    assert.deepEqual([...computeDebtRanks([...tied].reverse(), category === 'Arbitrage')], [...ranks])
    for (const singleton of [fund(1, category), fund(1, category, undefined, 0.1, 100)]) {
      assert.deepEqual(computeDebtRanks([singleton], category === 'Arbitrage').get(1), { rank: 1, count: 1, score: 50 })
      assert.equal(buildDebtVerdict(singleton, [singleton]).score, 50)
    }
    const missing = [fund(1, category, { '1Y': metric(5) }), fund(2, category, { '1Y': metric(9) })]
    const scores = computeDebtRanks(missing, category === 'Arbitrage')
    assert.equal(scores.get(1)?.score, Math.round((category === 'Arbitrage' ? 0.325 : 0.45) * 100))
    assert.equal(scores.get(2)?.score, Math.round((category === 'Arbitrage' ? 0.675 : 0.55) * 100))
  })

  test(`${category}: one common horizon controls default verdict and every percentile peer set`, () => {
    const peers = mixedPeers(category)
    const before = JSON.stringify(peers)
    const ranks = computeDebtRanks(peers, category === 'Arbitrage')
    const eligible = peers.slice(0, 4)
    assert.deepEqual([...ranks], [...computeDebtRanks(eligible, category === 'Arbitrage', '1Y')])
    for (const peer of peers) {
      const verdict = buildDebtVerdict(peer, peers)
      const rank = ranks.get(peer.code)
      assert.equal(verdict.scored, !!rank)
      assert.equal(verdict.score, rank?.score)
      if (rank) assert.equal(verdict.rankLabel, `Ranked #${rank.rank} of 4 ${category} funds`)
      else {
        assert.equal(verdict.rankLabel, undefined)
        assert.match(verdict.oneLiner, /No 1Y return/)
        assert.ok(verdict.pillars.every(pillar => !pillar.label.includes('return')))
      }
    }
    assert.equal(computeDebtRanks(peers, category === 'Arbitrage', '3Y').size, 3)
    assert.equal(computeDebtRanks(peers, category === 'Arbitrage', '5Y').size, 0)
    assert.equal(JSON.stringify(peers), before)
  })
}

test('default falls back once for the peer set, never separately for each fund', () => {
  const peers = [fund(1, 'Liquid', { '3Y': metric(6) }), fund(2, 'Liquid', { '5Y': metric(99) })]
  assert.deepEqual([...computeDebtRanks(peers, false)], [...computeDebtRanks(peers, false, '3Y')])
  assert.equal(buildDebtVerdict(peers[1], peers).scored, false)
  assert.match(buildDebtVerdict(peers[1], peers).oneLiner, /No 3Y return/)
  assert.deepEqual([...computeDebtRanks([peers[1]], false)], [...computeDebtRanks([peers[1]], false, '5Y')])
  assert.equal(computeDebtRanks([fund(3, 'Liquid', {}), nullHistory(4, 'Liquid')], false).size, 0)
})

const invalidMetadataPeers = [
  fund(1, 'Liquid', { '1Y': metric(5) }, 0.1, 100),
  fund(2, 'Liquid', { '1Y': metric(6) }, '0.2' as unknown as number, 200),
  fund(3, 'Liquid', { '1Y': metric(7) }, -0.1, 0),
  fund(4, 'Liquid', { '1Y': metric(8) }, '' as unknown as number, -100),
  fund(5, 'Liquid', { '1Y': metric(9) }, 'invalid' as unknown as number, null),
]
test('invalid metadata is neutral; numeric TER strings match the producer', () => {
  const normalized = invalidMetadataPeers.map(peer => ({ ...peer,
    expenseRatio: peer.code === 1 ? 0.1 : peer.code === 2 ? 0.2 : null,
    aum: peer.code <= 2 ? peer.aum : null }))
  assert.deepEqual([...computeDebtRanks(invalidMetadataPeers, false)], [...computeDebtRanks(normalized, false)])
  for (const value of [NaN, Infinity, -Infinity]) {
    const invalid = { ...fund(6), expenseRatio: value, aum: { current: value, asOf: null } }
    assert.equal(computeDebtRanks([invalid], false).get(6)?.score, 50)
  }
})

test('non-finite selected returns are unranked', () => {
  const peers = [fund(1), ...[NaN, Infinity, -Infinity].map((cagr, index) => fund(index + 2, 'Liquid', { '1Y': metric(cagr) }))]
  assert.deepEqual([...computeDebtRanks(peers, false).keys()], [1])
})

const precisionPeers = Array.from({ length: 401 }, (_, index) => fund(index + 1, 'Liquid', { '1Y': metric(index) }, 0.2, 100))
test('full precision decides rank before displayed integer or stored-three-decimal rounding', () => {
  const ranks = computeDebtRanks(precisionPeers, false)
  assert.equal(ranks.get(401)?.score, ranks.get(400)?.score)
  assert.deepEqual([...ranks.keys()], precisionPeers.map(peer => peer.code).reverse())
  assert.equal(buildDebtVerdict(precisionPeers[399], precisionPeers).rankLabel, 'Ranked #2 of 401 Liquid funds')
})

test('inactive tier-one and tier-two models retain their legacy scores; tier three stays unscored', () => {
  for (const category of ['Overnight', 'Ultra Short Duration', 'Short Duration', 'Corporate Bond']) {
    const peers = [fund(1, category, { '1Y': metric(5) }, 0.1, 100),
      fund(2, category, { '1Y': metric(9) }, 0.3, 1000)]
    assert.equal(computeDebtRanks(peers, false).get(1)?.score, 73)
    assert.equal(computeDebtRanks(peers, false).get(2)?.score, 77)
    assert.equal(buildDebtVerdict(peers[0], peers).score, 73)
  }
  const gilt = fund(1, 'Gilt')
  assert.equal(buildDebtVerdict(gilt, [gilt]).scored, false)
  assert.equal(buildDebtVerdict(gilt, [gilt]).score, undefined)
})

test('real Python producer and browser helpers agree across horizons, null histories, ties and precision', () => {
  const scenarios = categories.flatMap(category => [mixedPeers(category), [fund(1, category)],
    [fund(1, category, undefined, 0.1, 100)]])
  scenarios.push(precisionPeers, invalidMetadataPeers)
  const script = `
import json, sys
sys.path.insert(0, sys.argv[1])
from compute_rankings import recompute_rankings, debt_score, ter_of, aum_of, DEBT_WEIGHTS, ARBITRAGE_WEIGHTS
results = []
for funds in json.load(sys.stdin):
    recompute_rankings({'funds': funds})
    windows = {}
    for horizon in ['1Y', '3Y', '5Y']:
        peers = [f for f in funds if isinstance(f.get('metrics', {}).get(horizon), dict) and f['metrics'][horizon].get('cagr') is not None]
        ters = [value for value in map(ter_of, peers) if value is not None]
        aums = [value for value in map(aum_of, peers) if value is not None]
        returns = [f['metrics'][horizon]['cagr'] for f in peers]
        windows[horizon] = [dict(code=f['code'], rank=f['metrics'][horizon]['catRank'], count=f['metrics'][horizon]['catSize'], stored=f['metrics'][horizon]['score'], raw=debt_score(f, f['metrics'][horizon], ters, aums, returns, ARBITRAGE_WEIGHTS if f['category'] == 'Arbitrage' else DEBT_WEIGHTS)) for f in peers]
    results.append(windows)
print(json.dumps(results))
`
  const result = execFileSync(process.env.FF_PYTHON || process.env.PYTHON || 'python', ['-B', '-c', script, resolve('pipeline')], {
    input: JSON.stringify(scenarios), encoding: 'utf8',
  })
  type ProducerRank = { code: number; rank: number; count: number; stored: number; raw: number }
  const produced = JSON.parse(result) as Record<Horizon, ProducerRank[]>[]
  scenarios.forEach((peers, index) => {
    for (const horizon of ['1Y', '3Y', '5Y'] as Horizon[]) {
      const actual = computeDebtRanks(peers, peers[0].isArbitrage ?? false, horizon)
      assert.equal(actual.size, produced[index][horizon].length)
      for (const expected of produced[index][horizon]) {
        assert.deepEqual(actual.get(expected.code), { rank: expected.rank, count: expected.count,
          score: Math.round(expected.raw * 100) }, `${index}/${horizon}/${expected.code}`)
        assert.ok(Math.abs(expected.stored - expected.raw) <= 0.00050000001)
      }
    }
  })
})
