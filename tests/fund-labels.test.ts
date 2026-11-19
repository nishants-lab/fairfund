import assert from 'node:assert/strict'
import test from 'node:test'
import { oneWord, shortName } from '../src/lib/fundLabels.ts'
import type { Fund } from '../src/types.ts'

const f = (code: number, name: string) => ({ code, name }) as Fund

test('short names keep the words that tell funds apart', () => {
  assert.equal(shortName(f(1, 'Motilal Oswal Nifty 500 Index Fund')), 'Motilal Oswal Nifty 500')
  assert.equal(shortName(f(2, 'UTI Nifty 50 Index Fund')), 'UTI Nifty 50')
  assert.equal(shortName(f(3, 'HDFC Mid Cap Fund')), 'HDFC Mid Cap')
  assert.equal(shortName(f(4, 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth')), 'Parag Parikh Flexi Cap')
  assert.equal(shortName(f(5, 'Franklin India Index Fund- NSE Nifty 50 Index Fund')), 'Franklin India NSE Nifty 50')
  assert.equal(shortName(f(7, 'Motilal Oswal Nasdaq 100 Fund of Fund')), 'Motilal Oswal Nasdaq 100 FoF')
  assert.equal(shortName(f(6, 'Sundaram Nifty 100 Equal Weight Fund (Formerly Known as Principal Nifty 100 Equal Weight Fund)')), 'Sundaram Nifty 100 Equal Weight')
})

test('one-word labels fall back to the short name when two funds share the word', () => {
  const a = f(1, 'HDFC Mid Cap Fund'), b = f(2, 'HDFC Flexi Cap Fund'), c = f(3, 'UTI Nifty 50 Index Fund')
  assert.equal(oneWord(c, [a, b, c]), 'UTI')
  assert.equal(oneWord(a, [a, b, c]), 'HDFC Mid Cap')
  assert.equal(oneWord(b, [a, b, c]), 'HDFC Flexi Cap')
  assert.equal(oneWord(a), 'HDFC')
})
