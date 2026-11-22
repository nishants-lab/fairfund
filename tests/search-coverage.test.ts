import assert from 'node:assert/strict'
import test from 'node:test'
import { funds, searchFunds } from '../src/lib/data'
import { applyCoverage } from '../src/lib/notCovered'
import { normalizeSearch } from '../src/lib/searchText'

const run = (q: string) => applyCoverage(q, searchFunds(q, 10), normalizeSearch)

test('an uncovered type says so instead of listing the fund house\'s other funds', () => {
  for (const [q, note] of [
    ['hdfc balanced advantage', /Hybrid funds are not part of FairFund/],
    ['Edelweiss Balanced Advantage', /Hybrid funds/],
    ['icici multi asset', /Hybrid funds/],
    ['silver etf', /Gold and silver funds/],
    ['sbi gilt', /Only liquid and money market funds/],
    ['hdfc corporate bond', /Only liquid and money market funds/],
  ] as const) {
    assert.ok(searchFunds(q, 10).length > 0, `${q}: the raw search used to list unrelated funds`)
    const r = run(q)
    assert.deepEqual(r.results.map((f) => f.name), [], q)
    assert.match(r.note ?? '', note, q)
  }
})

test('covered searches are untouched', () => {
  for (const q of ['hdfc flexi direct', 'parag parikh', 'motilal nasdaq fof', 'sbi small cap', 'liquid fund', 'nifty 50 index', 'tata digital', 'icici prudential bluechip']) {
    const r = run(q)
    assert.equal(r.note, null, q)
    assert.deepEqual(r.results, searchFunds(q, 10), q)
  }
})

test('a fund that carries the type in its name stays, with no contradicting line', () => {
  const nasdaq = run('invesco nasdaq etf')
  assert.equal(nasdaq.note, null)
  assert.match(nasdaq.results[0]?.name ?? '', /Nasdaq-100 ETF Fund of Fund/)
  const gold = run('dsp gold')
  assert.equal(gold.note, null)
  assert.match(gold.results[0]?.name ?? '', /World Gold Mining/)
})

test('an ETF query keeps its index-fund answers and says ETFs are not listed', () => {
  const r = run('nippon nifty bees etf')
  assert.match(r.note ?? '', /ETFs are not part of FairFund; index funds are/)
  assert.deepEqual(r.results, searchFunds('nippon nifty bees etf', 10))
})

test('every covered fund is still found by its own name', () => {
  const lost = funds.filter((f) => !run(f.name).results.some((x) => x.code === f.code))
  assert.deepEqual(lost.map((f) => f.name), [])
})
