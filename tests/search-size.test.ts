import assert from 'node:assert/strict'
import test from 'node:test'
import { searchFunds } from '../src/lib/data'

const names = (q: string, n = 3) => searchFunds(q, n).map((f) => f.name)

test('an AMC abbreviation leads with the fund house\'s largest scheme', () => {
  assert.match(names('ppfas', 1)[0] ?? '', /^Parag Parikh Flexi Cap/)
})

test('size counts within the category, so liquid funds do not take over AMC searches', () => {
  for (const q of ['axis', 'tata', 'nippon', 'kotak', 'hdfc', 'sbi']) {
    const debt = names(q).filter((n) => /Liquid|Money Market|Overnight/i.test(n))
    assert.ok(debt.length <= 1, `${q}: ${names(q).join(' ; ')}`)
  }
})

test('exact name matches still beat size', () => {
  assert.match(names('hdfc midcap 150', 1)[0] ?? '', /Nifty Midcap 150 Index/)
  assert.match(names('sbi small cap', 1)[0] ?? '', /^SBI Small Cap Fund/)
  assert.match(names('motilal nasdaq', 1)[0] ?? '', /Nasdaq 100/)
})
