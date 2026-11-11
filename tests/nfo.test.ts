/**
 * New fund offers page logic (src/lib/nfo.ts).
 * Run: node tests/run-regressions.mjs tests/nfo.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Fund } from '../src/types'
import { funds, getFund } from '../src/lib/data'
import {
  availableFrom, categoryContext, groupNfos, isListed, nameAgreesWithBenchmark, nfoData, normalizeBenchmark, sameIndexFunds, statusOn, todayIst,
  visibleUntil, yearsSince, type Nfo,
} from '../src/lib/nfo'

const nfo = (o: Partial<Nfo>): Nfo => ({
  code: 999001, name: 'Test Fund', amc: 'Test', amfiCategory: '', category: 'Small Cap', launchDate: '2026-10-12',
  closeDate: null, minAmount: 1000, status: 'offer', nav: null, details: null, ...o,
})

test('status is recomputed from dates and AMFI NAV only', () => {
  assert.equal(statusOn(nfo({ launchDate: '2026-10-26' }), '2026-10-22'), 'upcoming')
  assert.equal(statusOn(nfo({ launchDate: '2026-10-26' }), '2026-10-26'), 'offer')     // opened on a weekend: not stuck as upcoming
  assert.equal(statusOn(nfo({ launchDate: '2026-09-30' }), '2026-10-22'), 'offer')     // no closing date: never claimed closed
  assert.equal(statusOn(nfo({ closeDate: '2026-10-20' }), '2026-10-22'), 'closed')
  assert.equal(statusOn(nfo({ nav: { date: '2026-10-21', value: 9.9 } }), '2026-10-22'), 'trading')
})

test('todayIst uses India time', () => {
  assert.equal(todayIst(new Date('2026-10-21T19:00:00Z')), '2026-10-22')  // 00:30 IST
  assert.equal(todayIst(new Date('2026-10-21T18:00:00Z')), '2026-10-21')  // 23:30 IST
})

test('benchmark names normalise to one index', () => {
  for (const s of ['NIFTY 50 Total Return Index', 'Nifty 50 TRI', 'Nifty50 Index', 'NIFTY 50 (TRI)'])
    assert.equal(normalizeBenchmark(s), 'nifty 50', s)
  assert.equal(normalizeBenchmark('NIFTY Large Midcap 250 Total Return Index'), 'nifty largemidcap 250')
  assert.notEqual(normalizeBenchmark('Nifty Next 50 TRI'), normalizeBenchmark('Nifty 50 TRI'))
  assert.notEqual(normalizeBenchmark('Nifty 500 TRI'), normalizeBenchmark('Nifty 50 TRI'))
  assert.equal(normalizeBenchmark(null), '')
})

const peer = (code: number, name: string, extra: Partial<Fund> = {}): Fund => ({
  code, name, fullName: name, amc: 'Fixture', category: 'Index Funds', categoryDisplay: 'Index Funds',
  riskLevel: 'High', categorySize: 1, metrics: {}, benchmark: 'Nifty 50 TRI', ...extra,
})
const indexPeers = [
  peer(1, 'Alpha Nifty 50 Index Fund', { inceptionDate: '2020-01-01' }),
  peer(2, 'Beta Nifty 50 Index Fund', { inceptionDate: '2010-01-01' }),
  peer(3, 'Wrong Nifty 500 Index Fund'), peer(4, 'Wrong Nifty IT Index Fund'),
  peer(5, 'Active Nifty 50 Fund', { category: 'Large Cap' }),
]

test('index NFOs list exactly their compatible current peers, longest record first', () => {
  const n50 = nfo({ category: 'Index Funds', details: { benchmark: 'NIFTY 50 Total Return Index' } })
  for (const all of [funds, indexPeers, [], indexPeers.map(f => ({ ...f, benchmark: 'Nifty IT TRI' }))]) {
    const same = sameIndexFunds(n50, all)
    const expected = all.filter(f => f.code !== n50.code && f.category.startsWith('Index')
      && normalizeBenchmark(f.benchmark) === 'nifty 50' && nameAgreesWithBenchmark(f.name, f.benchmark))
    assert.deepEqual(same.map(f => f.code).sort((a, b) => a - b), expected.map(f => f.code).sort((a, b) => a - b))
    const starts = same.map(f => f.inceptionDate ?? '9999')
    assert.deepEqual(starts, [...starts].sort())
  }
  assert.deepEqual(sameIndexFunds(n50, indexPeers).map(f => f.code), [2, 1])
  assert.deepEqual(sameIndexFunds({ ...n50, code: 2 }, indexPeers).map(f => f.code), [1])
  assert.deepEqual(sameIndexFunds(nfo({ category: 'Index Funds' }), indexPeers), [])
  assert.deepEqual(sameIndexFunds(nfo({ details: n50.details }), indexPeers), [])
  assert.deepEqual(sameIndexFunds(nfo({ category: 'Index-Other', details: { benchmark: 'Nifty Imaginary 7 TRI' } }), indexPeers), [])
})

test('a fund whose name contradicts its stored benchmark is never listed as tracking it', () => {
  assert.equal(nameAgreesWithBenchmark('HDFC Nifty 50 Index Fund', 'NIFTY 50 Total Return Index'), true)
  assert.equal(nameAgreesWithBenchmark('HDFC Index Fund-BSE Sensex Plan', 'S&P BSE Sensex TRI'), true)
  assert.equal(nameAgreesWithBenchmark('Kotak Nifty Capital Markets Index Fund', 'Nifty Capital Market Index'), true)
  assert.equal(nameAgreesWithBenchmark('ICICI Prudential Nifty 500 Index Fund', 'NIFTY 50 Total Return Index'), false)
  assert.equal(nameAgreesWithBenchmark('SBI Nifty IT Index Fund', 'NIFTY 50 Total Return Index'), false)
  assert.equal(nameAgreesWithBenchmark('Motilal Oswal Nifty Microcap 250 Index Fund', 'NIFTY Smallcap 250 Total Return Index'), false)
  assert.equal(nameAgreesWithBenchmark('Any Fund', null), false)
  for (const n of nfoData.nfos) for (const f of sameIndexFunds(n, funds)) {
    assert.equal(normalizeBenchmark(f.benchmark), normalizeBenchmark(n.details?.benchmark))
    assert.equal(nameAgreesWithBenchmark(f.name, n.details?.benchmark), true)
  }
})

test('active NFOs get their current category size and available 3Y count; index NFOs never do', () => {
  const offer = nfo({ category: 'Small Cap' })
  const synthetic = [peer(1, 'Scored small cap', { category: 'Small Cap', categoryDisplay: 'Small Cap', metrics: { '3Y': { cagr: 10 } as never } }),
    peer(2, 'Young small cap', { category: 'Small Cap', categoryDisplay: 'Small Cap' })]
  for (const all of [funds, synthetic, synthetic.map(f => ({ ...f, metrics: {} })), []]) {
    const peers = all.filter(f => f.category === offer.category && f.code !== offer.code)
    const ctx = categoryContext(offer, all)
    if (!peers.length) { assert.equal(ctx, null); continue }
    assert.equal(ctx!.display, peers[0].categoryDisplay)
    assert.equal(ctx!.count, peers.length)
    assert.equal(ctx!.withThreeYears, peers.filter(f => f.metrics['3Y']?.cagr !== undefined).length)
    assert.ok(ctx!.withThreeYears >= 0 && ctx!.withThreeYears <= ctx!.count)
  }
  assert.equal(categoryContext(offer, synthetic)!.withThreeYears, 1)
  assert.equal(categoryContext(nfo({ category: 'Index-Other' }), funds), null)
  assert.equal(categoryContext(nfo({ category: 'No Such Category' }), synthetic), null)
})

test('yearsSince reads both date formats', () => {
  assert.ok(Math.abs((yearsSince('2013-01-02', '2026-01-02') ?? 0) - 13) < 0.01)
  assert.ok(Math.abs((yearsSince('01-Jan-2013', '2026-01-01') ?? 0) - 13) < 0.01)
  assert.equal(yearsSince(undefined, '2026-01-01'), null)
  assert.equal(yearsSince('garbage', '2026-01-01'), null)
  assert.equal(yearsSince('2027-01-01', '2026-01-01'), null)
})

test('grouping orders each section', () => {
  const g = groupNfos([
    nfo({ code: 1, launchDate: '2026-10-12' }), nfo({ code: 2, launchDate: '2026-10-20' }),
    nfo({ code: 3, launchDate: '2026-11-20' }), nfo({ code: 4, launchDate: '2026-10-26' }),
    nfo({ code: 5, launchDate: '2026-09-15', nav: { date: '2026-10-21', value: 10 } }),
  ], '2026-10-22')
  assert.deepEqual(g.offer.map((n) => n.code), [2, 1])
  assert.deepEqual(g.upcoming.map((n) => n.code), [4, 3])
  assert.deepEqual(g.trading.map((n) => n.code), [5])
})

test('committed nfo.json is well formed and in scope (real data)', () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(nfoData.generatedAt))
  const codes = new Set<number>()
  for (const n of nfoData.nfos) {
    assert.ok(Number.isSafeInteger(n.code) && !codes.has(n.code), `${n.code}`)
    codes.add(n.code)
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(n.launchDate), n.name)
    assert.ok(n.closeDate === null || n.closeDate > n.launchDate, n.name)
    assert.ok(['upcoming', 'offer', 'closed', 'trading'].includes(n.status), n.name)
    assert.ok(n.status !== 'trading' || n.nav, `${n.name} trading without a NAV`)
    assert.ok(!/regular|idcw/i.test(n.name), n.name)
    // A fund already in the universe keeps its own category.
    const f = getFund(n.code)
    if (f) assert.equal(f.category, n.category, n.name)
  }
})

test('closed and trading NFOs stay listed for 7 calendar days after closing', () => {
  const closed = nfo({ launchDate: '2026-10-01', closeDate: '2026-10-15' })
  assert.equal(visibleUntil(closed, 7), '2026-10-22')
  assert.equal(isListed(closed, '2026-10-22'), true)
  assert.equal(isListed(closed, '2026-10-23'), false)
  // Trading: counted from the close, else from the first NAV, else kept.
  const nav = { date: '2026-10-21', value: 10.1 }
  assert.equal(isListed(nfo({ nav, closeDate: '2026-10-12', firstNavDate: '2026-10-20' }), '2026-10-22'), false)
  assert.equal(isListed(nfo({ nav, firstNavDate: '2026-10-16' }), '2026-10-23'), true)
  assert.equal(isListed(nfo({ nav, firstNavDate: '2026-10-16' }), '2026-10-24'), false)
  assert.equal(isListed(nfo({ nav }), '2026-12-31'), true)
  // Offers and upcoming ones are never dropped by this rule.
  assert.equal(isListed(nfo({ launchDate: '2026-09-30' }), '2026-12-31'), true)
  const g = groupNfos([closed, nfo({ code: 2, launchDate: '2026-10-12', closeDate: '2026-10-26' })], '2026-10-23')
  assert.deepEqual([g.closed.length, g.offer.length], [0, 1])
})

test('availability: first NAV once trading, else a plausible expected date', () => {
  const nav = { date: '2026-10-21', value: 10.1 }
  assert.deepEqual(availableFrom(nfo({ nav, firstNavDate: '2026-10-16', details: { reopenDate: '2026-10-15' } })), { date: '2026-10-16', expected: false })
  assert.equal(availableFrom(nfo({ nav })), null)
  assert.deepEqual(availableFrom(nfo({ closeDate: '2026-10-26', details: { reopenDate: '2026-10-28' } })), { date: '2026-10-28', expected: true })
  assert.equal(availableFrom(nfo({ closeDate: '2026-10-26', details: { reopenDate: '2026-10-26' } })), null)  // not after the close
  assert.equal(availableFrom(nfo({ launchDate: '2026-10-12', details: { reopenDate: '2026-10-12' } })), null)  // the launch date itself
  assert.equal(availableFrom(nfo({})), null)
})

test('the built list never carries an NFO past its last listed day', () => {
  const day = nfoData.generatedAt
  for (const n of nfoData.nfos) assert.ok(isListed(n, day), `${n.code} ${n.name} should have left the list`)
  for (const n of nfoData.nfos) if (n.closeDate) assert.ok(n.closeDate > n.launchDate, `${n.code} closes before it opens`)
})
