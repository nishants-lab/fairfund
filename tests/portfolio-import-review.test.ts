import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { parseCAMSText } from '../src/lib/camsParser'
import { analyzePortfolio } from '../src/lib/portfolio'
import { correctPortfolioScheme, reviewPortfolioValues, reviewHoldingWarnings } from '../src/components/PortfolioImportReview'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
const directCode = 120828
const regularCode = 100177
const sourceName = 'Unknown Synthetic Scheme Direct Growth'
function block(name = sourceName) {
  return `${name} - ISIN : INF000000001
Opening Unit Balance: 0.000
28-Mar-2023 Purchase 10000.00 100.0000 100.000 100.000
NAV on 28-Mar-2024: INR 120.0000 Market Value on 28-Mar-2024: INR 12000.00
Closing Unit Balance: 100.000 Total Cost Value: 10000.00`
}
function fixture(text = block()) { return parseCAMSText(text) }

test('correction uses real universe identity and updates summaries, transactions and codes without mutating input', async () => {
  globalThis.fetch = (() => Promise.resolve({ ok: false })) as never
  const parsed = fixture()
  assert.equal(parsed.fundSummaries[0].fundCode, 0)
  const original = JSON.stringify(parsed)
  const before = await analyzePortfolio(parsed)
  const corrected = correctPortfolioScheme(parsed, sourceName, directCode)
  assert.equal(JSON.stringify(parsed), original)
  assert.equal(corrected.fundSummaries[0].fundCode, directCode)
  assert.equal(corrected.transactions[0].fundCode, directCode)
  assert.deepEqual(corrected.fundCodes, [directCode])
  assert.deepEqual({ ...corrected.fundSummaries[0], fundCode: 0 }, parsed.fundSummaries[0])
  const after = await analyzePortfolio(corrected)
  assert.equal(after.holdings[0].code, directCode)
  assert.equal(after.holdings[0].covered, true)
  assert.equal(after.totalValue, before.totalValue)
  assert.equal(after.holdings[0].valuationDate, '2024-03-28')
  assert.equal(after.holdings[0].personalCagr, before.holdings[0].personalCagr)
  assert.ok(after.holdings[0].personalCagr !== null)
})

test('arbitrary codes and unknown statement identities are rejected', () => {
  assert.throws(() => correctPortfolioScheme(fixture(), sourceName, -1), /local fund list/)
  assert.throws(() => correctPortfolioScheme(fixture(), sourceName, 999999999), /local fund list/)
  assert.throws(() => correctPortfolioScheme(fixture(), 'missing', directCode), /not found/)
})

test('correction of one unmatched name never steals another unmatched holding cashflows', () => {
  const parsed = fixture(`${block()}\n${block('Other Synthetic Scheme Growth')}`)
  const corrected = correctPortfolioScheme(parsed, sourceName, directCode)
  assert.equal(corrected.fundSummaries[1].fundCode, 0)
  assert.equal(corrected.transactions[1].fundCode, 0)
  assert.equal(corrected.transactions[1].fundName, 'Other Synthetic Scheme Growth')
})

test('all identical statement names change together and ambiguous unmatched history stays unavailable', async () => {
  globalThis.fetch = (() => Promise.resolve({ ok: false })) as never
  const parsed = fixture(`${block()}\n${block()}`)
  const corrected = correctPortfolioScheme(parsed, sourceName, directCode)
  assert.ok(corrected.fundSummaries.every(s => s.fundCode === directCode && s.historyUnusable))
  assert.ok(corrected.transactions.every(t => t.fundCode === directCode))
  const analysis = await analyzePortfolio(corrected)
  assert.equal(analysis.totalValue, 24000)
  assert.equal(analysis.holdings[0].personalCagr, null)
})

test('leave unmatched and repeated corrections keep fundCodes synchronized', () => {
  const matched = correctPortfolioScheme(fixture(), sourceName, directCode)
  const regular = correctPortfolioScheme(matched, sourceName, regularCode)
  assert.deepEqual(regular.fundCodes, [regularCode])
  assert.ok(reviewHoldingWarnings(regular.fundSummaries[0]).some(w => w.includes('Plan mismatch')))
  const unmatched = correctPortfolioScheme(regular, sourceName, 0)
  assert.deepEqual(unmatched.fundCodes, [])
  assert.equal(unmatched.transactions[0].fundCode, 0)
  assert.ok(reviewHoldingWarnings(unmatched.fundSummaries[0]).some(w => w.includes('Unmatched')))
})

test('review totals match production fallback values and exclude closed positions', async () => {
  globalThis.fetch = (() => Promise.resolve({ ok: false })) as never
  const parsed = fixture(`${block()}\n${block('Second Synthetic Scheme')}\n${block('Closed Synthetic Scheme')}`)
  parsed.fundSummaries[1].marketValue = 0
  parsed.fundSummaries[2].closingUnits = 0
  parsed.diagnostics!.statedTotalValue = 24000
  const review = reviewPortfolioValues(parsed)
  assert.equal(review.total, 24000)
  assert.equal(review.total, (await analyzePortfolio(parsed)).totalValue)
  assert.deepEqual(review.warnings, [])
})

test('material totals, dropped blocks, missing values and mixed dates produce visible warnings', () => {
  const parsed = fixture(`${block()}\n${block('Other Synthetic Scheme')}`)
  parsed.diagnostics!.statedTotalValue = 100000
  parsed.diagnostics!.isinCount = 3
  parsed.fundSummaries[1].marketValueDate = '2024-03-27'
  assert.match(reviewPortfolioValues(parsed).warnings.join(' '), /Material total mismatch/)
  assert.match(reviewPortfolioValues(parsed).warnings.join(' '), /could not be read/)
  assert.match(reviewPortfolioValues(parsed).warnings.join(' '), /different statement valuation dates/)
  const s = parsed.fundSummaries[0]
  s.latestNav = 0; s.marketValue = 0; s.navDate = null; s.openingUnits = null
  assert.match(reviewHoldingWarnings(s).join(' '), /Missing statement valuation/)
  assert.match(reviewHoldingWarnings(s).join(' '), /valuation date is missing/)
  assert.match(reviewHoldingWarnings(s).join(' '), /history is incomplete/)
})

test('same-date units x NAV mismatches and distribution-to-Growth corrections are flagged', () => {
  const parsed = fixture(block('Unknown Synthetic Direct IDCW'))
  const corrected = correctPortfolioScheme(parsed, parsed.fundSummaries[0].fundName, directCode)
  corrected.fundSummaries[0].latestNav = 200
  const warnings = reviewHoldingWarnings(corrected.fundSummaries[0]).join(' ')
  assert.match(warnings, /Material valuation mismatch/)
  assert.match(warnings, /Option mismatch/)
})

test('unknown summary total and transaction-free summaries still support honest review', () => {
  const parsed = fixture(block().replace('28-Mar-2023 Purchase 10000.00 100.0000 100.000 100.000', ''))
  assert.equal(parsed.transactions.length, 0)
  assert.equal(parsed.fundSummaries.length, 1)
  assert.equal(reviewPortfolioValues(parsed).total, 12000)
  assert.match(reviewPortfolioValues(parsed).warnings.join(' '), /Statement total was not read/)
})
