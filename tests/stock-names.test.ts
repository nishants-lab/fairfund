import test from 'node:test'
import assert from 'node:assert/strict'
import { displayStockName, formerStockName, isRawStockName, stockSlug } from '../src/lib/stockNames'

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
