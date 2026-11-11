/**
 * End-to-end: parse then analyze, on the synthetic Direct scheme that
 * portfolio-import-synthetic-install merges into the in-memory universe and
 * fund index (so the matched, priceable control never depends on a live scheme).
 * Must be imported first: it runs before src/lib/data.ts reads the JSON.
 */
import './portfolio-import-synthetic-install'
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { parseCAMSText } from '../src/lib/camsParser'
import { analyzePortfolio } from '../src/lib/portfolio'
import { SYNTHETIC_DIRECT } from './portfolio-import-synthetic-data.mjs'
import { statement } from './fund-matching-fixture-helpers'

test('the synthetic scheme is matched by the parser', () => {
  const parsed = parseCAMSText(statement([{ scheme: SYNTHETIC_DIRECT.name }]))
  assert.equal(parsed.fundSummaries[0].fundCode, SYNTHETIC_DIRECT.code)
})

// ---- End-to-end: parse then analyze ------------------------------------
//
// Proves the flag actually withholds the published return rather than merely
// being set. NAV history is stubbed unreachable so the analysis falls back to the
// statement's own values; the real fetch is restored after every test.

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function stubNoNavHistory(): void {
  globalThis.fetch = (() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as never
}

const E2E_PURCHASE = '01-Apr-2024 Purchase 100000.00 100.0000 1000.000 1000.000'
const E2E_REINVEST = '15-Jun-2025 IDCW Reinvestment 50000.00 125.0000 400.000 1400.000'

function e2eStatement(rows: string[]): string {
  return statement([{
    scheme: SYNTHETIC_DIRECT.name,
    isin: 'INF966L01945', units: 1400, nav: 200, value: 280000, cost: 100000, rows,
  }])
}

test('end to end: a reinvestment row withholds the published return', async () => {
  stubNoNavHistory()

  // Control: the same holding without the reinvestment row still publishes a
  // number, so the assertion below is about the flag and not about a statement
  // the analysis could never price.
  const clean = await analyzePortfolio(parseCAMSText(e2eStatement([E2E_PURCHASE])))
  assert.equal(clean.holdings.length, 1)
  assert.equal(typeof clean.holdings[0].personalCagr, 'number',
    'control statement must be priceable, otherwise this test proves nothing')

  const withReinvestment = await analyzePortfolio(parseCAMSText(e2eStatement([E2E_PURCHASE, E2E_REINVEST])))
  assert.equal(withReinvestment.holdings.length, 1)
  assert.equal(withReinvestment.holdings[0].personalCagr, null,
    'a reinvested IDCW row must withhold the return, not price it as cash received')
})

test('end to end: a bracketed purchase amount withholds the published return', async () => {
  stubNoNavHistory()
  const analysis = await analyzePortfolio(parseCAMSText(e2eStatement([
    E2E_PURCHASE,
    '10-Apr-2024 Purchase (50000.00) 100.0000 500.000 500.000',
  ])))
  assert.equal(analysis.holdings.length, 1)
  assert.equal(analysis.holdings[0].personalCagr, null,
    'a bracketed amount on a money-in row is a credit taken back, not new money')
})

test('end to end: a wrapped reinvestment row withholds the published return', async () => {
  stubNoNavHistory()
  const analysis = await analyzePortfolio(parseCAMSText(e2eStatement([
    E2E_PURCHASE,
    '15-Jun-2025 IDCW Reinvestment',
    '50000.00 125.0000 400.000 1400.000',
  ])))
  assert.equal(analysis.holdings.length, 1)
  assert.equal(analysis.holdings[0].personalCagr, null)
})

test('end to end: a reversal row withholds the published return', async () => {
  stubNoNavHistory()
  const analysis = await analyzePortfolio(parseCAMSText(e2eStatement([
    E2E_PURCHASE,
    '20-Jun-2025 Purchase - Reversal 10000.00 125.0000 80.000 920.000',
  ])))
  assert.equal(analysis.holdings.length, 1)
  assert.equal(analysis.holdings[0].personalCagr, null)
})
