import test from 'node:test'
import assert from 'node:assert/strict'
import { displayStockName, formerStockName, isRawStockName, stockSlug } from '../src/lib/stockNames'
import { funds } from '../src/lib/data'
import { buildContext, type MoversData } from '../src/lib/moversData'
import { parseQuery } from '../src/lib/moversQuery'
import movers from '../src/data/movers.json'

test('holding keys resolve renames and curated spellings', () => {
  assert.equal(displayStockName('zomato-ltd', 'Zomato Ltd'), 'Eternal Ltd')
  assert.equal(formerStockName('zomato-ltd'), 'Zomato Ltd')
  assert.equal(displayStockName('dewan-housing-finance-corporation-ltd', 'DEWAN HOUSING FINANCE CORP. LTD. EQ'), 'Piramal Finance Ltd')
  assert.equal(displayStockName('hexaware-technologies-limited', 'HEXAWARE TECHNOLOGIES LIMITED EQ NEW FV RS.2/-'), 'Hexaware Technologies Ltd')
  assert.equal(displayStockName('infosys-ltd', 'Infosys Ltd.'), 'Infosys Ltd.')
  assert.equal(displayStockName(null, 'ITC Ltd'), 'ITC Ltd')
})

test('name-only portfolio moves resolve through the suffix-free slug and aliases', () => {
  assert.equal(displayStockName(undefined, 'Zomato Ltd'), 'Eternal Ltd')
  assert.equal(displayStockName(undefined, 'Shriram Transport Finance Company Ltd'), 'Shriram Finance Ltd')
  assert.equal(displayStockName(undefined, 'HDB FINANCIAL SERVICES LIMITED EQ'), 'HDB Financial Services Ltd')
  assert.equal(displayStockName(undefined, 'DEWAN HOUSING FINANCE CORP. LTD. EQ'), 'Piramal Finance Ltd')
  assert.equal(displayStockName(undefined, 'DHFL VYSYA HOUSING FINANCE LIMITED EQ'), 'Aadhar Housing Finance Ltd')
  assert.equal(displayStockName(undefined, 'HERO MOTORS LIMITED EQ NEW FV RS.10/-'), 'Hero Motors Ltd')
  assert.equal(displayStockName(undefined, 'Kanohar Electricals Ltd Equity'), 'Kanohar Electricals Ltd')
  assert.equal(displayStockName(undefined, 'National Stock Exchange Of India Ltd Equity'), 'National Stock Exchange of India Ltd')
})

test('raw-name detection and slugs match the static pages', () => {
  assert.deepEqual(['TATA CAPITAL LIMITED EQ', 'Infosys Ltd', 'ITC Ltd', 'DOMS Industries Ltd.'].map(isRawStockName), [true, false, false, false])
  assert.equal(stockSlug('Aadhar Housing Finance Ltd'), 'aadhar-housing-finance-ltd')
})

test('the movers question box finds a stock by its shown name and by its old name', () => {
  const ctx = buildContext(funds, movers as unknown as MoversData)
  const stockOf = (q: string) => parseQuery(q, ctx).state.stock
  const keyOf = (name: string) => ctx.stocks.find(s => s.name === name)?.key
  let checked = 0
  for (const [q, name] of [
    ['who bought piramal finance', 'Piramal Finance Ltd'],
    ['who bought dewan housing finance', 'Piramal Finance Ltd'],
    ['who bought aadhar housing finance', 'Aadhar Housing Finance Ltd'],
    ['who bought shriram finance', 'Shriram Finance Ltd'],
    ['who bought eternal', 'Eternal Ltd'],
    ['who bought zomato', 'Eternal Ltd'],
  ] as const) {
    const key = keyOf(name)
    if (!key) continue // not in this month's stock list
    assert.equal(stockOf(q), key, q)
    checked++
  }
  assert.ok(checked >= 4, `only ${checked} renamed stocks in the movers list`)
  const pharma = ctx.stocks.find(s => /piramal pharma/i.test(s.name))?.key
  if (pharma && keyOf('Piramal Finance Ltd')) assert.notEqual(stockOf('who bought piramal finance'), pharma)
})
