import test from 'node:test'
import assert from 'node:assert/strict'
import { displayStockName, formerStockName, isRawStockName, stockSlug } from '../src/lib/stockNames'
import { funds } from '../src/lib/data'
import { buildContext, type MoversData } from '../src/lib/moversData'
import { parseQuery } from '../src/lib/moversQuery'
import movers from '../src/data/movers.json'
import stockNames from '../src/data/stock_names.json'

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

test('the movers question box finds current and former names even when monthly stocks rotate out', () => {
  const synthetic: MoversData = {
    generatedAt: '2026-10-01', refMonth: '2026-09', windows: [1], stockWindows: [1], funds: {}, mgrLog: [],
    stocks: [...Object.entries(stockNames.renames).map(([key, value]): [string, string, string] => [key, value.formerly, 'Financial']),
      ['piramal-pharma-ltd', 'Piramal Pharma Ltd', 'Healthcare']],
  }
  for (const data of [movers as unknown as MoversData, synthetic, { ...synthetic, stocks: [] }]) {
    const ctx = buildContext(funds, data)
    let checked = 0
    for (const stock of ctx.stocks) {
      const former = formerStockName(stock.key, stock.name)
      if (!former) continue
      for (const name of [stock.name, former]) {
        assert.equal(parseQuery(`who bought ${name}`, ctx).state.stock, stock.key, name)
      }
      checked++
    }
    if (data === synthetic) {
      assert.equal(checked, Object.keys(stockNames.renames).length)
      for (const name of ['piramal finance', 'dewan housing finance']) {
        assert.equal(parseQuery(`who bought ${name}`, ctx).state.stock, 'dewan-housing-finance-corporation-ltd')
      }
    }
    console.log(`Renamed stock lookup: ${checked}/${ctx.stocks.length}`)
  }
})
