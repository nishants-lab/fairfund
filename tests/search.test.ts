/**
 * Fund search: spelling variants, AMC abbreviations and old names.
 *
 * Run from the repo root:  node tests/run-regressions.mjs tests/search.test.ts
 *
 * Named ranking preferences ("axis bluechip", "hdfc midcap", "nifty 50", typos,
 * matchedOtherName) are pinned on a frozen synthetic universe in
 * search-synthetic-universe.test.ts. This file keeps the pure normalisers and
 * invariants that must hold for whatever funds.json currently contains.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { funds, searchFunds } from '../src/lib/data'
import { amcAliases, normalizeSearch, otherNames } from '../src/lib/searchText'

const top = (q: string, n = 1) => searchFunds(q, n).map((f) => f.code)

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

test('current-universe invariants: spelling variants and query shapes behave consistently', () => {
  // Pinned winners ("axis bluechip" -> a given code) live in
  // search-synthetic-universe.test.ts; here only relations that hold for ANY data.
  assert.deepEqual(top('smallcap', 10), top('small cap', 10))
  assert.deepEqual(searchFunds('a'), [])
  assert.deepEqual(searchFunds('  '), [])
  assert.deepEqual(searchFunds('&'), [])
  assert.ok(funds.length > 0, 'the fund universe must not be empty')
})

test('a current fund queried by its own name is returned, and a too-short query is not (real data)', () => {
  for (const f of funds.slice(0, 25)) {
    assert.ok(searchFunds(f.name, funds.length).some((x) => x.code === f.code), f.name)
    assert.deepEqual(searchFunds(f.name.slice(0, 1)), [], 'single letter must return nothing')
  }
})

test('every fund is found for its own name (real data)', () => {
  // No miss budget. Twins and prefix-related names (plan variants, "X Fund" vs
  // "X Fund of Funds") never count against a fund; exact ranking preferences are
  // pinned on the synthetic universe, not on whatever competitors exist today.
  const misses: string[] = []
  for (const f of funds) {
    // Exhaustive: any number of same-name twins may sit above, so the fund must be
    // a member of the full result list and have fewer than 8 UNRELATED funds above it.
    const res = searchFunds(f.name, funds.length)
    const pos = res.findIndex((x) => x.code === f.code)
    const n = normalizeSearch(f.name)
    const related = (x: { name: string }) => {
      const m = normalizeSearch(x.name)
      return m === n || m.startsWith(n) || n.startsWith(m)
    }
    if (pos < 0 || res.slice(0, pos).filter((x) => !related(x)).length >= 8) misses.push(`${f.code} ${f.name} (at ${pos}, above: ${res.slice(0, Math.max(pos, 0)).map((x) => x.name).join(' | ')})`)
  }
  assert.deepEqual(misses, [], misses.join('\n'))
})

test('every other name finds its fund in the top 5 (real data, coverage tied to the generated aliases)', () => {
  const formerJson = require('../src/data/former_names.json') as Record<string, string[]>
  const inUniverse = new Set(funds.map((f) => f.code))
  const expected = Object.entries(formerJson).filter(([c]) => inUniverse.has(Number(c))).reduce((n, [, v]) => n + v.length, 0)
  // Every alias of every current fund must be exercised: no floor constant, no silent skip.
  const owners = new Map<string, number[]>()
  for (const f of funds) for (const o of otherNames(f.code)) {
    const k = normalizeSearch(o)
    owners.set(k, [...(owners.get(k) ?? []), f.code])
  }
  let checked = 0
  const misses: string[] = []
  for (const f of funds) {
    for (const o of otherNames(f.code)) {
      checked++
      const res = searchFunds(o, funds.length).map((x) => x.code)
      const group = owners.get(normalizeSearch(o)) ?? [f.code]
      const at = res.findIndex((c) => group.includes(c))
      // An alias shared by several funds (an old name of a merged scheme) is
      // satisfied when any of its current owners is returned.
      const ok = at >= 0 && at < 5 + group.length
      if (!ok) misses.push(`${f.code} "${o}"`)
    }
  }
  assert.equal(checked, expected, 'alias coverage must equal the generated former_names for current funds')
  assert.deepEqual(misses, [], misses.join('\n'))
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
