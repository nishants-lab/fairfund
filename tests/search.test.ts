/**
 * Fund search: spelling variants, AMC abbreviations and old names.
 *
 * Run from the repo root:  node tests/run-regressions.mjs tests/search.test.ts
 *
 * Before this suite, "ppfas flexi" led with HDFC Flexi Cap, "axis bluechip" and
 * "kotak emerging" did not return the fund at all, "absl frontline" and "idfc
 * sterling" returned nothing, "hdfc midcap" put two index funds above HDFC Mid
 * Cap Fund, and "nifty 50" led with an equal-weight fund. The named cases pin
 * those fixes; the real-data cases re-check every fund on every run.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { funds, getFund, matchedOtherName, searchFunds } from '../src/lib/data'
import { amcAliases, normalizeSearch, otherNames } from '../src/lib/searchText'

const top = (q: string, n = 1) => searchFunds(q, n).map((f) => f.code)
const first = (q: string) => searchFunds(q, 1)[0]

test('normalizeSearch joins cap words, splits digits and reads L&T', () => {
  assert.equal(normalizeSearch('Small-Cap'), 'smallcap')
  assert.equal(normalizeSearch('small cap'), 'smallcap')
  assert.equal(normalizeSearch('SmallCap'), 'smallcap')
  assert.equal(normalizeSearch('HDFC NIFTY50 Equal weight'), 'hdfc nifty 50 equal weight')
  assert.equal(normalizeSearch('Large & Mid Cap'), 'large and midcap')
  assert.equal(normalizeSearch('L&T Emerging'), 'lnt emerging')
  assert.equal(normalizeSearch('l & t'), 'lnt')
  assert.equal(normalizeSearch('  DSP  India T.I.G.E.R.  '), 'dsp india t i g e r')
  assert.equal(normalizeSearch(''), '')
})

test('amcAliases match the start of the fund name only', () => {
  assert.equal(amcAliases('parag parikh flexicap fund'), 'ppfas')
  assert.equal(amcAliases('bandhan smallcap fund'), 'idfc')
  assert.equal(amcAliases('aditya birla sun life largecap fund'), 'absl birla')
  assert.equal(amcAliases('sundaram midcap fund'), 'principal')
  assert.equal(amcAliases('hdfc midcap fund'), '')
  // "navi" must not fire inside another word, "dsp" not mid-name.
  assert.equal(amcAliases('navin fluorine'), '')
  assert.equal(amcAliases('kotak dsp'), '')
})

test('old fund names find the renamed fund first', () => {
  assert.equal(top('axis bluechip')[0], 120465)            // Axis Large Cap Fund
  assert.equal(top('mirae emerging bluechip')[0], 118834)  // Mirae Asset Large & Midcap Fund
  assert.equal(top('kotak emerging')[0], 119775)           // Kotak Mid Cap Fund
  assert.equal(top('hdfc top 100')[0], 119018)             // HDFC Large Cap Fund
  assert.equal(top('absl frontline')[0], 119528)           // Aditya Birla Sun Life Large Cap Fund
  assert.equal(top('aditya frontline')[0], 119528)
  assert.equal(top('parag parikh long term value')[0], 122639)
  assert.equal(top('icici bluechip')[0], 120586)
})

test('AMC abbreviations and former AMC names', () => {
  assert.equal(top('ppfas flexi')[0], 122639)
  assert.ok(searchFunds('ppfas', 5).every((f) => f.name.startsWith('Parag Parikh')))
  assert.ok(searchFunds('idfc', 5).every((f) => /^bandhan/i.test(f.name)))
  assert.ok(searchFunds('principal', 5).every((f) => /^sundaram/i.test(f.name)))
  assert.ok(searchFunds('indiabulls', 5).every((f) => /^groww/i.test(f.name)))
  assert.ok(searchFunds('l&t', 5).every((f) => /^hsbc/i.test(f.name)))
})

test('an active fund leads unless the query asks for an index', () => {
  assert.equal(top('hdfc midcap')[0], 118989)  // HDFC Mid Cap Fund, not the Nifty Midcap 150 index fund
  assert.equal(top('hdfc mid')[0], 118989)
  assert.equal(first('sbi smallcap').name, 'SBI Small Cap Fund')
  assert.equal(first('nippon small').name, 'Nippon India Small Cap Fund')
  assert.equal(first('motilal midcap').name, 'Motilal Oswal Midcap Fund')
  // Asking for the index still gets it.
  assert.match(first('hdfc midcap 150').name, /Midcap 150 Index/i)
  assert.match(first('sbi nifty smallcap 250').name, /Smallcap 250 Index/i)
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
  assert.ok(searchFunds('smallcap', 5).every((f) => f.category === 'Small Cap'))
})

test('unchanged behaviour: prefixes, short and nonsense queries', () => {
  assert.equal(top('parag')[0], 122639)
  assert.equal(first('invesco contra').name, 'Invesco India Contra Fund')
  assert.equal(first('tata digital').name, 'Tata Digital India Fund')
  assert.equal(first('kotak flexi').name, 'Kotak Flexi Cap Fund')
  assert.equal(first('jm flexi').name, 'JM Flexi Cap Fund')
  assert.deepEqual(searchFunds('a'), [])
  assert.deepEqual(searchFunds('  '), [])
  assert.deepEqual(searchFunds('&'), [])
  assert.deepEqual(searchFunds('qqqqzzzz'), [])
  assert.ok(searchFunds('hdfc', 8).length === 8)
  assert.ok(searchFunds('paragh').some((f) => f.code === 122639), 'typo tolerance kept')
})

test('misspelt words are fixed against words the funds use', () => {
  assert.equal(top('paragh')[0], 122639)
  assert.equal(top('kotk midcap')[0], 119775)        // Kotak Mid Cap Fund
  assert.equal(top('hdfc midcp')[0], 118989)         // HDFC Mid Cap Fund
  assert.equal(top('axsi bluechip')[0], 120465)      // swapped letters, then an old name
  assert.equal(top('mirae emergng')[0], 118834)
  assert.equal(top('parag parikh flexy')[0], 122639)
  // A correct spelling is never "fixed": "quant" stays Quant, not "quantum".
  assert.ok(searchFunds('quant', 3).every((f) => /^quant /i.test(f.name)), searchFunds('quant', 3).map((f) => f.name).join())
  assert.equal(top('kotak midcap')[0], 119775)
  // A word still being typed is matched, not replaced.
  assert.equal(top('kotak emerg')[0], 119775)
  assert.deepEqual(searchFunds('zzzzqqqq'), [])
})

test('matchedOtherName explains old-name matches only', () => {
  const axis = getFund(120465)!
  assert.equal(matchedOtherName(axis, 'axis bluechip'), 'Axis Bluechip Fund')
  assert.equal(matchedOtherName(axis, 'axis large'), null)
  assert.equal(matchedOtherName(axis, ''), null)
  assert.equal(matchedOtherName(getFund(119775)!, 'kotak emerging'), 'Kotak Emerging Equity Scheme')
})

test('every fund is found first by its own name (real data)', () => {
  const misses: string[] = []
  for (const f of funds) {
    const res = searchFunds(f.name, 8)
    const pos = res.findIndex((x) => x.code === f.code)
    const n = normalizeSearch(f.name)
    // Funds with an identical name (plan variants) may tie ahead of it.
    const onlyTwinsAbove = pos >= 0 && res.slice(0, pos).every((x) => normalizeSearch(x.name) === n)
    if (!onlyTwinsAbove) misses.push(`${f.code} ${f.name} (at ${pos})`)
  }
  // Zero today. A fund renamed overnight should not block the daily data
  // refresh, so a few misses only warn; more than that is a ranking regression.
  if (misses.length) console.warn(`search: ${misses.length} funds not first for their own name:\n${misses.join('\n')}`)
  assert.ok(misses.length <= 3, misses.join('\n'))
})

test('every other name finds its fund in the top 5 (real data)', () => {
  let checked = 0
  const misses: string[] = []
  for (const f of funds) {
    for (const o of otherNames(f.code)) {
      checked++
      if (!searchFunds(o, 5).some((x) => x.code === f.code)) misses.push(`${f.code} "${o}"`)
    }
  }
  assert.ok(checked >= 50, `only ${checked} other names loaded`)
  if (misses.length) console.warn(`search: ${misses.length} other names miss their fund:\n${misses.join('\n')}`)
  assert.ok(misses.length <= 3, misses.join('\n'))
})

test('other names only reference funds in the universe and never another fund\'s name', () => {
  const codes = new Set(funds.map((f) => f.code))
  const current = new Map(funds.map((f) => [normalizeSearch(f.name), f.code]))
  for (const f of funds) {
    for (const o of otherNames(f.code)) {
      const owner = current.get(normalizeSearch(o))
      assert.ok(owner === undefined || owner === f.code, `"${o}" on ${f.code} is the current name of ${owner}`)
    }
  }
  for (const code of Object.keys(require('../src/data/former_names.json'))) {
    assert.ok(codes.has(Number(code)), `former_names.json has ${code}, which is not in the universe`)
  }
})
