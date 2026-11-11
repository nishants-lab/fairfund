/**
 * Fund-search ranking behaviour on a SYNTHETIC, frozen fund universe.
 *
 * Run: node tests/run-regressions.mjs tests/search-synthetic-universe.test.ts
 *
 * The preferences below ("axis bluechip" finds the renamed fund, the active fund
 * leads unless an index is asked for, "nifty 50" means the plain index, typos are
 * fixed) used to be pinned to live AMFI codes and names, so an ordinary data
 * refresh could break them. Here the universe and former names are replaced
 * in-place BEFORE the first search (the search index is built lazily), so the
 * ranking algorithm is tested against inputs that never change. Each test file
 * runs in its own process under `node --test`, so this cannot leak into the
 * real-data suite in search.test.ts.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import formerNames from '../src/data/former_names.json'
import { funds, matchedOtherName, searchFunds } from '../src/lib/data'
import { otherNames } from '../src/lib/searchText'

interface Syn { code: number; name: string; amc: string; category: string; former?: string[] }
const idx = 'Index Funds'
const SYN: Syn[] = [
  { code: 900001, name: 'Axis Large Cap Fund', amc: 'Axis', category: 'Large Cap', former: ['Axis Bluechip Fund'] },
  { code: 900002, name: 'Mirae Asset Large & Midcap Fund', amc: 'Mirae Asset', category: 'Large & Mid Cap', former: ['Mirae Asset Emerging Bluechip Fund'] },
  { code: 900003, name: 'Kotak Mid Cap Fund', amc: 'Kotak', category: 'Mid Cap', former: ['Kotak Emerging Equity Scheme'] },
  { code: 900004, name: 'HDFC Large Cap Fund', amc: 'HDFC', category: 'Large Cap', former: ['HDFC Top 100 Fund'] },
  { code: 900005, name: 'Aditya Birla Sun Life Large Cap Fund', amc: 'Aditya Birla Sun Life', category: 'Large Cap', former: ['Aditya Birla Sun Life Frontline Equity Fund'] },
  { code: 900006, name: 'Parag Parikh Flexi Cap Fund', amc: 'Parag Parikh', category: 'Flexi Cap', former: ['Parag Parikh Long Term Value Fund'] },
  { code: 900007, name: 'Kotak Flexi Cap Fund', amc: 'Kotak', category: 'Flexi Cap', former: ['Kotak Standard Multicap Fund'] },
  { code: 900008, name: 'Bandhan Value Fund', amc: 'Bandhan', category: 'Value', former: ['IDFC Sterling Value Fund'] },
  { code: 900009, name: 'HDFC Mid Cap Fund', amc: 'HDFC', category: 'Mid Cap' },
  { code: 900010, name: 'HDFC Nifty Midcap 150 Index Fund', amc: 'HDFC', category: 'Index-Mid Cap' },
  { code: 900011, name: 'HDFC Flexi Cap Fund', amc: 'HDFC', category: 'Flexi Cap' },
  { code: 900012, name: 'HDFC Nifty 50 Index Fund', amc: 'HDFC', category: 'Index-Large Cap' },
  { code: 900013, name: 'HDFC Small Cap Fund', amc: 'HDFC', category: 'Small Cap' },
  { code: 900014, name: 'HDFC Focused Fund', amc: 'HDFC', category: 'Focused' },
  { code: 900015, name: 'HDFC Value Fund', amc: 'HDFC', category: 'Value' },
  { code: 900016, name: 'HDFC Dividend Yield Fund', amc: 'HDFC', category: 'Dividend Yield' },
  { code: 900017, name: 'HDFC ELSS Tax Saver', amc: 'HDFC', category: 'ELSS' },
  { code: 900018, name: 'SBI Small Cap Fund', amc: 'SBI', category: 'Small Cap' },
  { code: 900019, name: 'SBI Nifty Smallcap 250 Index Fund', amc: 'SBI', category: 'Index-Small Cap' },
  { code: 900020, name: 'Nippon India Small Cap Fund', amc: 'Nippon India', category: 'Small Cap' },
  { code: 900021, name: 'Nippon India Nifty Smallcap 250 Index Fund', amc: 'Nippon India', category: 'Index-Small Cap' },
  { code: 900022, name: 'Motilal Oswal Midcap Fund', amc: 'Motilal Oswal', category: 'Mid Cap' },
  { code: 900023, name: 'Motilal Oswal Nifty Midcap 150 Index Fund', amc: 'Motilal Oswal', category: 'Index-Mid Cap' },
  { code: 900024, name: 'UTI Nifty 50 Index Fund', amc: 'UTI', category: 'Index-Large Cap' },
  { code: 900025, name: 'UTI Nifty 50 Equal Weight Index Fund', amc: 'UTI', category: 'Index-Large Cap' },
  { code: 900026, name: 'UTI Nifty Next 50 Index Fund', amc: 'UTI', category: 'Index-Large Cap' },
  { code: 900027, name: 'Invesco India Contra Fund', amc: 'Invesco India', category: 'Contra' },
  { code: 900028, name: 'Tata Digital India Fund', amc: 'Tata', category: 'Sectoral' },
  { code: 900029, name: 'JM Flexi Cap Fund', amc: 'JM', category: 'Flexi Cap' },
  { code: 900030, name: 'Quant Small Cap Fund', amc: 'Quant', category: 'Small Cap' },
  { code: 900031, name: 'Quantum Long Term Equity Value Fund', amc: 'Quantum', category: 'Value' },
  { code: 900032, name: 'Groww Small Cap Fund', amc: 'Groww', category: 'Small Cap' },
  { code: 900033, name: 'HSBC Mid Cap Fund', amc: 'HSBC', category: 'Mid Cap' },
  { code: 900034, name: 'Sundaram Mid Cap Fund', amc: 'Sundaram', category: 'Mid Cap' },
  { code: 900035, name: 'Navin Fluorine Fund', amc: 'Navin', category: 'Sectoral' },
]
funds.splice(0, funds.length, ...SYN.map((s) => ({
  code: s.code, name: s.name, fullName: s.name, amc: s.amc, category: s.category,
  categoryDisplay: s.category.startsWith('Index-') ? idx : s.category, metrics: {},
}) as never))
for (const k of Object.keys(formerNames)) delete (formerNames as Record<string, string[]>)[k]
for (const s of SYN) if (s.former) (formerNames as Record<string, string[]>)[String(s.code)] = s.former

// getFund() keeps a lookup built at module load, so resolve against the swapped array.
const byCode = (c: number) => funds.find((f) => f.code === c)
const top = (q: string, n = 1) => searchFunds(q, n).map((f) => f.code)
const first = (q: string) => searchFunds(q, 1)[0]

test('fixture is installed', () => {
  assert.equal(funds.length, SYN.length)
  assert.equal(byCode(900001)?.name, 'Axis Large Cap Fund')
  assert.deepEqual(otherNames(900001), ['Axis Bluechip Fund'])
})

test('old fund names find the renamed fund first', () => {
  assert.equal(top('axis bluechip')[0], 900001)
  assert.equal(top('mirae emerging bluechip')[0], 900002)
  assert.equal(top('kotak emerging')[0], 900003)
  assert.equal(top('hdfc top 100')[0], 900004)
  assert.equal(top('absl frontline')[0], 900005)
  assert.equal(top('aditya frontline')[0], 900005)
  assert.equal(top('parag parikh long term value')[0], 900006)
  assert.equal(top('kotak standard multicap')[0], 900007)
  assert.equal(top('idfc sterling value')[0], 900008)
})

test('AMC abbreviations and former AMC names', () => {
  assert.equal(top('ppfas flexi')[0], 900006)
  assert.deepEqual(searchFunds('ppfas', 5).map((f) => f.code), [900006])
  assert.ok(searchFunds('idfc', 5).every((f) => /^bandhan/i.test(f.name)))
  assert.ok(searchFunds('principal', 5).every((f) => /^sundaram/i.test(f.name)))
  assert.ok(searchFunds('indiabulls', 5).every((f) => /^groww/i.test(f.name)))
  assert.ok(searchFunds('l&t', 5).every((f) => /^hsbc/i.test(f.name)))
  for (const q of ['ppfas', 'idfc', 'principal', 'indiabulls', 'l&t']) assert.ok(searchFunds(q, 5).length > 0, `${q}: expected a result`)
})

test('an active fund leads unless the query asks for an index', () => {
  assert.equal(top('hdfc midcap')[0], 900009)
  assert.equal(top('hdfc mid')[0], 900009)
  assert.equal(first('sbi smallcap').code, 900018)
  assert.equal(first('nippon small').code, 900020)
  assert.equal(first('motilal midcap').code, 900022)
  assert.equal(first('hdfc midcap 150').code, 900010)
  assert.equal(first('sbi nifty smallcap 250').code, 900019)
})

test('"nifty 50" means the plain Nifty 50 index, not a variant of it', () => {
  for (const q of ['nifty 50', 'nifty50', 'nifty 50 index', 'uti nifty']) {
    const f = first(q)
    assert.ok(f, `${q}: no result`)
    assert.match(f.name, /nifty ?50 index/i, `${q} -> ${f.name}`)
    assert.doesNotMatch(f.name, /equal|next|midcap|smallcap|value|momentum/i, `${q} -> ${f.name}`)
  }
})

test('"smallcap" and "small cap" return the same funds', () => {
  assert.deepEqual(top('smallcap', 10), top('small cap', 10))
  assert.deepEqual(top('hdfc midcap', 5), top('hdfc mid cap', 5))
  assert.ok(searchFunds('smallcap', 3).every((f) => /small ?cap/i.test(f.name)))
})

test('prefixes, short and nonsense queries', () => {
  assert.equal(top('parag')[0], 900006)
  assert.equal(first('invesco contra').code, 900027)
  assert.equal(first('tata digital').code, 900028)
  assert.equal(first('kotak flexi').code, 900007)
  assert.equal(first('jm flexi').code, 900029)
  assert.deepEqual(searchFunds('a'), [])
  assert.deepEqual(searchFunds('  '), [])
  assert.deepEqual(searchFunds('&'), [])
  assert.deepEqual(searchFunds('qqqqzzzz'), [])
  assert.equal(searchFunds('hdfc', 8).length, 8)
  assert.ok(searchFunds('paragh').some((f) => f.code === 900006), 'typo tolerance kept')
})

test('misspelt words are fixed against words the funds use', () => {
  assert.equal(top('paragh')[0], 900006)
  assert.equal(top('kotk midcap')[0], 900003)
  assert.equal(top('hdfc midcp')[0], 900009)
  assert.equal(top('axsi bluechip')[0], 900001)
  assert.equal(top('mirae emergng')[0], 900002)
  assert.equal(top('parag parikh flexy')[0], 900006)
  // A correct spelling is never "fixed": "quant" stays Quant, not "quantum".
  assert.equal(top('quant')[0], 900030)
  assert.equal(top('kotak midcap')[0], 900003)
  assert.equal(top('kotak emerg')[0], 900003)
  assert.deepEqual(searchFunds('zzzzqqqq'), [])
  assert.deepEqual(searchFunds('unicorn rocket'), [])
})

test('matchedOtherName explains old-name matches only', () => {
  const axis = byCode(900001)!
  assert.equal(matchedOtherName(axis, 'axis bluechip'), 'Axis Bluechip Fund')
  assert.equal(matchedOtherName(axis, 'axis large'), null)
  assert.equal(matchedOtherName(axis, ''), null)
  assert.equal(matchedOtherName(byCode(900003)!, 'kotak emerging'), 'Kotak Emerging Equity Scheme')
})

test('every synthetic fund is found first by its own name and every former name finds its fund', () => {
  let aliases = 0
  for (const f of funds) {
    assert.equal(searchFunds(f.name, 3)[0].code, f.code, f.name)
    for (const o of otherNames(f.code)) {
      aliases++
      assert.ok(searchFunds(o, 3).some((x) => x.code === f.code), `${o} -> ${f.code}`)
    }
  }
  assert.equal(aliases, SYN.filter((s) => s.former).length)
})
