/**
 * Regression tests for statement-dated portfolio valuation and XIRR.
 *
 * Guards the bug class where the XIRR terminal inflow was dated from the clock
 * (`Date.now()`) while its amount came from the statement's Market Value on
 * line. One unchanged statement then reported a different annualized return
 * every day it was reopened, and a statement with no readable date reported a
 * confident number anyway.
 *
 * These run the production code: parseCAMSText from src/lib/camsParser.ts and
 * analyzePortfolio from src/lib/portfolio.ts. `fetch` is a browser global, so it
 * is stubbed per test and always restored; the stub returns no NAV history,
 * which keeps the day-change path out of these assertions.
 *
 * Run: node tests/run-regressions.mjs tests/portfolio-valuation.test.ts
 */
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { parseCAMSText } from '../src/lib/camsParser'
import { analyzePortfolio, type ParsedPortfolio, type PortfolioAnalysis, type FundSummary, type Transaction } from '../src/lib/portfolio'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/** No NAV file for any fund: day-change stays zero and XIRR is the only variable. */
function stubNoNavHistory(): void {
  globalThis.fetch = (() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as never
}

const ISIN = 'ISIN : INF000000001'

/**
 * A minimal CAMS block in the shape the parser reads lines in. `valueDate` is
 * the date on both the NAV on and Market Value on lines unless `navDate`
 * overrides it, which is how real statements that value units and money on
 * different days are reproduced.
 */
function statementBlock(opts: {
  scheme: string
  valueDate: string
  navDate?: string
  nav: number
  marketValue: number
  units: number
  cost: number
  openingUnits?: number
  rows?: { date: string; desc: string; amount: number; nav: number; units: number }[]
}): string {
  const rows = (opts.rows ?? []).map(
    r => `${r.date} ${r.desc} ${r.amount.toFixed(2)} ${r.nav.toFixed(4)} ${r.units.toFixed(3)} ${r.units.toFixed(3)}`
  )
  return [
    `${opts.scheme} - ${ISIN}`,
    `Opening Unit Balance: ${(opts.openingUnits ?? 0).toFixed(3)}`,
    ...rows,
    `NAV on ${opts.navDate ?? opts.valueDate}: INR ${opts.nav.toFixed(4)}   Market Value on ${opts.valueDate}: INR ${opts.marketValue.toFixed(2)}`,
    `Closing Unit Balance: ${opts.units.toFixed(3)}   Total Cost Value: ${opts.cost.toFixed(2)}`,
  ].join('\n')
}

/** A portfolio assembled directly, for cases a statement cannot express. */
function portfolioOf(summaries: Partial<FundSummary>[], transactions: Partial<Transaction>[]): ParsedPortfolio {
  return {
    id: 'test',
    uploadedAt: '2026-09-30T00:00:00.000Z',
    investorName: 'Test',
    pan: 'XXXX1234',
    transactions: transactions.map(t => ({
      fundCode: 0,
      fundName: 'Scheme',
      date: '2024-01-15',
      type: 'purchase',
      units: 10,
      amount: 10000,
      nav: 1000,
      ...t,
    })) as Transaction[],
    fundSummaries: summaries.map(s => ({
      fundCode: 0,
      fundName: 'Scheme',
      closingUnits: 100,
      totalCost: 100000,
      latestNav: 1500,
      marketValue: 150000,
      openingUnits: 0,
      ...s,
    })) as FundSummary[],
    fundCodes: [],
  }
}

/** The single holding of a one-fund fixture. */
const only = (a: PortfolioAnalysis) => a.holdings[0]

// ---- The core contract: the terminal flow is dated by the statement ----

test('XIRR is unchanged when the clock advances: the terminal flow is the statement date', async () => {
  stubNoNavHistory()
  const text = statementBlock({
    scheme: 'Quant Small Cap Fund Direct Plan Growth',
    valueDate: '31-Mar-2026',
    nav: 200,
    marketValue: 200000,
    units: 1000,
    cost: 100000,
    rows: [{ date: '01-Apr-2024', desc: 'Purchase', amount: 100000, nav: 100, units: 1000 }],
  })
  const parsed = parseCAMSText(text)
  assert.equal(parsed.fundSummaries[0].marketValueDate, '2026-03-31')

  const first = only(await analyzePortfolio(parsed))
  assert.equal(first.valuationDate, '2026-03-31')
  assert.ok(first.personalCagr !== null, 'a dated statement must produce an XIRR')

  // Re-analyze with the process clock moved a year on. Nothing about the
  // statement changed, so the reported return must not change either.
  const realNow = Date.now
  try {
    const shifted = realNow() + 365 * 24 * 3600 * 1000
    Date.now = () => shifted
    const second = only(await analyzePortfolio(parseCAMSText(text)))
    assert.equal(second.valuationDate, first.valuationDate)
    assert.equal(second.personalCagr, first.personalCagr)
  } finally {
    Date.now = realNow
  }

  // A 1000 -> 2000 unit NAV over two years is ~41.4% a year; the point is that
  // the number comes from the statement window, not from today.
  assert.ok(Math.abs(first.personalCagr! - 41.42) < 0.5, `got ${first.personalCagr}`)
})

test('the upload time is never a substitute for a missing valuation date', async () => {
  stubNoNavHistory()
  // Legacy shape: parsed before the statement dates were captured at all.
  const legacy = portfolioOf(
    [{ fundCode: 0, marketValue: 150000, openingUnits: 0 }],
    [{ fundCode: 0, date: '2024-01-15', amount: 100000 }]
  )
  delete (legacy.fundSummaries[0] as Partial<FundSummary>).marketValueDate
  const h = only(await analyzePortfolio(legacy))
  assert.equal(h.valuationDate, null)
  assert.equal(h.personalCagr, null)
  // The value itself still shows: only the dated return is withheld.
  assert.equal(h.currentValue, 150000)
})

test('an explicitly null statement date yields no XIRR', async () => {
  stubNoNavHistory()
  const h = only(await analyzePortfolio(portfolioOf(
    [{ marketValueDate: null, navDate: null }],
    [{ date: '2024-01-15' }]
  )))
  assert.equal(h.valuationDate, null)
  assert.equal(h.personalCagr, null)
})

// ---- Date validation ----

test('an impossible calendar date is rejected, not rolled forward', async () => {
  stubNoNavHistory()
  // 31-Feb-2026 and 30/02/2026 both roll forward into March under new Date().
  for (const bad of ['31-Feb-2026', '30/02/2026', '32-Jan-2026']) {
    const parsed = parseCAMSText(statementBlock({
      scheme: 'Quant Small Cap Fund Direct Plan Growth',
      valueDate: bad,
      nav: 200,
      marketValue: 200000,
      units: 1000,
      cost: 100000,
      rows: [{ date: '01-Apr-2024', desc: 'Purchase', amount: 100000, nav: 100, units: 1000 }],
    }))
    assert.equal(parsed.fundSummaries[0].marketValueDate, null, bad)
    const h = only(await analyzePortfolio(parsed))
    assert.equal(h.valuationDate, null, bad)
    assert.equal(h.personalCagr, null, bad)
  }
})

test('a real leap day is accepted on both the value line and a transaction row', async () => {
  stubNoNavHistory()
  const parsed = parseCAMSText(statementBlock({
    scheme: 'Quant Small Cap Fund Direct Plan Growth',
    valueDate: '29-Feb-2024',
    nav: 120,
    marketValue: 120000,
    units: 1000,
    cost: 100000,
    rows: [{ date: '29-Feb-2020', desc: 'Purchase', amount: 100000, nav: 100, units: 1000 }],
  }))
  assert.equal(parsed.fundSummaries[0].marketValueDate, '2024-02-29')
  assert.equal(parsed.transactions[0].date, '2020-02-29')
  const h = only(await analyzePortfolio(parsed))
  assert.equal(h.valuationDate, '2024-02-29')
  assert.ok(h.personalCagr !== null)
})

// ---- NAV date vs market-value date ----

test('the market-value date wins when the market value is the terminal amount', async () => {
  stubNoNavHistory()
  const parsed = parseCAMSText(statementBlock({
    scheme: 'Quant Small Cap Fund Direct Plan Growth',
    valueDate: '31-Mar-2026',
    navDate: '27-Mar-2026',
    nav: 199,
    marketValue: 200000,
    units: 1000,
    cost: 100000,
    rows: [{ date: '01-Apr-2024', desc: 'Purchase', amount: 100000, nav: 100, units: 1000 }],
  }))
  assert.equal(parsed.fundSummaries[0].navDate, '2026-03-27')
  assert.equal(parsed.fundSummaries[0].marketValueDate, '2026-03-31')
  assert.equal(only(await analyzePortfolio(parsed)).valuationDate, '2026-03-31')
})

test('the NAV date is used when the value falls back to units x NAV', async () => {
  stubNoNavHistory()
  const h = only(await analyzePortfolio(portfolioOf(
    [{ marketValue: 0, marketValueDate: null, latestNav: 1500, navDate: '2026-03-27', closingUnits: 100 }],
    [{ date: '2024-01-15', amount: 100000 }]
  )))
  assert.equal(h.currentValue, 150000)
  assert.equal(h.valuationDate, '2026-03-27')
  assert.ok(h.personalCagr !== null)
})

test('a units x NAV fallback with no NAV date yields no XIRR', async () => {
  stubNoNavHistory()
  const h = only(await analyzePortfolio(portfolioOf(
    [{ marketValue: 0, marketValueDate: '2026-03-31', latestNav: 1500, navDate: null, closingUnits: 100 }],
    [{ date: '2024-01-15', amount: 100000 }]
  )))
  assert.equal(h.currentValue, 150000)
  assert.equal(h.valuationDate, null, 'the market-value date does not date a NAV-derived amount')
  assert.equal(h.personalCagr, null)
})

// ---- Multiple folios of one fund ----

test('folios valued on the same date merge and keep that date', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 100000, marketValueDate: '2026-03-31', closingUnits: 50, totalCost: 60000 },
      { fundCode: 500001, marketValue: 50000, marketValueDate: '2026-03-31', closingUnits: 25, totalCost: 30000 },
    ],
    [{ fundCode: 500001, date: '2024-01-15', amount: 90000 }]
  ))
  assert.equal(a.holdings.length, 1)
  assert.equal(a.holdings[0].currentValue, 150000)
  assert.equal(a.holdings[0].valuationDate, '2026-03-31')
  assert.ok(a.holdings[0].personalCagr !== null)
})

test('folios valued on different dates leave the holding undated and XIRR unavailable', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 100000, marketValueDate: '2026-03-31', closingUnits: 50, totalCost: 60000 },
      { fundCode: 500001, marketValue: 50000, marketValueDate: '2025-12-31', closingUnits: 25, totalCost: 30000 },
    ],
    [{ fundCode: 500001, date: '2024-01-15', amount: 90000 }]
  ))
  assert.equal(a.holdings.length, 1)
  assert.equal(a.holdings[0].valuationDate, null, 'the later date must not be adopted for the earlier folio')
  assert.equal(a.holdings[0].personalCagr, null)
  // Amounts still aggregate, so the portfolio total and weights are unaffected.
  assert.equal(a.holdings[0].currentValue, 150000)
  assert.equal(a.holdings[0].invested, 90000)
})

test('one folio with no date makes the merged holding undated', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 100000, marketValueDate: '2026-03-31', closingUnits: 50, totalCost: 60000 },
      { fundCode: 500001, marketValue: 50000, marketValueDate: null, closingUnits: 25, totalCost: 30000 },
    ],
    [{ fundCode: 500001, date: '2024-01-15', amount: 90000 }]
  ))
  assert.equal(a.holdings[0].valuationDate, null)
  assert.equal(a.holdings[0].personalCagr, null)
})

// ---- Fully-redeemed sibling folios ----
//
// A closed folio is never displayed, but its purchases and its redemption inflow
// land in the same transaction group as the surviving folio's. The gate therefore
// has to consider every folio of the fund, including the ones the merge drops.

test('a closed sibling folio that opened with units withholds the surviving holding return', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31', closingUnits: 100, totalCost: 100000, openingUnits: 0 },
      // Fully redeemed folio of the same fund. Its units predate the window, so
      // the purchases behind its 300k redemption are not in the rows.
      { fundCode: 500001, marketValue: 0, marketValueDate: '2026-03-31', closingUnits: 0, totalCost: 0, openingUnits: 1000 },
    ],
    [
      { fundCode: 500001, date: '2024-01-15', amount: 100000, type: 'purchase' },
      { fundCode: 500001, date: '2025-06-30', amount: 300000, type: 'redeem' },
    ]
  ))
  assert.equal(a.holdings.length, 1, 'the closed folio is still not displayed')
  assert.equal(a.holdings[0].valuationDate, '2026-03-31')
  assert.equal(a.holdings[0].personalCagr, null, 'a redemption without its purchases must not inflate the return')
})

test('a closed sibling folio marked historyUnusable withholds the surviving holding return', async () => {
  stubNoNavHistory()
  const h = only(await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31', closingUnits: 100, totalCost: 100000, openingUnits: 0 },
      { fundCode: 500001, marketValue: 0, marketValueDate: '2026-03-31', closingUnits: 0, totalCost: 0, openingUnits: 0, historyUnusable: true },
    ],
    [
      { fundCode: 500001, date: '2024-01-15', amount: 100000, type: 'purchase' },
      { fundCode: 500001, date: '2025-06-30', amount: 300000, type: 'redeem' },
    ]
  )))
  assert.equal(h.personalCagr, null, 'an undatable row in any folio of the fund must withhold the return')
})

test('a closed sibling folio with an unread opening balance withholds the return', async () => {
  stubNoNavHistory()
  const p = portfolioOf(
    [
      { fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31', closingUnits: 100, totalCost: 100000, openingUnits: 0 },
      { fundCode: 500001, marketValue: 0, closingUnits: 0, totalCost: 0 },
    ],
    [
      { fundCode: 500001, date: '2024-01-15', amount: 100000, type: 'purchase' },
      { fundCode: 500001, date: '2025-06-30', amount: 300000, type: 'redeem' },
    ]
  )
  // portfolioOf states openingUnits: 0 by default, so the unread case has to be
  // made on the built summary.
  delete (p.fundSummaries[1] as Partial<FundSummary>).openingUnits
  assert.equal(p.fundSummaries[1].openingUnits, undefined)
  const h = only(await analyzePortfolio(p))
  assert.equal(h.personalCagr, null)
})

test('a closed sibling folio with a read zero opening balance does not withhold the return', async () => {
  stubNoNavHistory()
  // 100k out in Mar 2024 and 100k out in Mar 2025, 100k back in Mar 2025 from
  // the folio that closed, and 150k still held at the Mar 2026 valuation. No
  // folio of the fund is known to be missing rows, so a return is derived. That
  // is the gate passing, not proof that every row was parsed.
  const h = only(await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31', closingUnits: 100, totalCost: 100000, openingUnits: 0 },
      { fundCode: 500001, marketValue: 0, closingUnits: 0, totalCost: 0, openingUnits: 0 },
    ],
    [
      { fundCode: 500001, date: '2024-03-31', amount: 100000, type: 'purchase' },
      { fundCode: 500001, date: '2025-03-31', amount: 100000, type: 'purchase' },
      { fundCode: 500001, date: '2025-03-31', amount: 100000, type: 'redeem' },
    ]
  )))
  assert.ok(h.personalCagr !== null, 'a group with no known gap must still produce a return')
})

test('an unmatched closed folio sharing a name with an active one withholds the return', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 0, fundName: 'Alpha Unknown Fund', marketValue: 110000, marketValueDate: '2026-03-31', closingUnits: 100, totalCost: 100000, openingUnits: 0 },
      { fundCode: 0, fundName: 'Alpha Unknown Fund', marketValue: 0, closingUnits: 0, totalCost: 0, openingUnits: 500 },
    ],
    [{ fundCode: 0, fundName: 'Alpha Unknown Fund', date: '2025-03-31', amount: 100000 }]
  ))
  assert.equal(a.holdings.length, 1)
  assert.equal(a.holdings[0].personalCagr, null)
})

// ---- Unmatched and zero codes ----

test('two unmatched schemes do not pool each other cashflows', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 0, fundName: 'Alpha Unknown Fund', marketValue: 110000, marketValueDate: '2026-03-31', closingUnits: 100, totalCost: 100000 },
      { fundCode: 0, fundName: 'Beta Unknown Fund', marketValue: 400000, marketValueDate: '2026-03-31', closingUnits: 200, totalCost: 100000 },
    ],
    [
      { fundCode: 0, fundName: 'Alpha Unknown Fund', date: '2025-03-31', amount: 100000 },
      { fundCode: 0, fundName: 'Beta Unknown Fund', date: '2025-03-31', amount: 100000 },
    ]
  ))
  assert.equal(a.holdings.length, 2)
  const alpha = a.holdings.find(h => h.name === 'Alpha Unknown Fund')!
  const beta = a.holdings.find(h => h.name === 'Beta Unknown Fund')!
  // 100k -> 110k over a year is ~10%; 100k -> 400k is ~300%. Pooling the two
  // code-0 streams would have given both holdings the same blended figure.
  assert.ok(Math.abs(alpha.personalCagr! - 10) < 0.5, `alpha ${alpha.personalCagr}`)
  assert.ok(Math.abs(beta.personalCagr! - 300) < 2, `beta ${beta.personalCagr}`)
})

test('two unmatched folios sharing one scheme name are ambiguous, so XIRR is withheld', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 0, fundName: 'Alpha Unknown Fund', marketValue: 110000, marketValueDate: '2026-03-31', closingUnits: 100, totalCost: 100000 },
      { fundCode: 0, fundName: 'Alpha Unknown Fund', marketValue: 220000, marketValueDate: '2026-03-31', closingUnits: 200, totalCost: 200000 },
    ],
    [{ fundCode: 0, fundName: 'Alpha Unknown Fund', date: '2025-03-31', amount: 300000 }]
  ))
  assert.equal(a.holdings.length, 2, 'unmatched folios stay separate holdings')
  for (const h of a.holdings) {
    assert.equal(h.valuationDate, '2026-03-31')
    assert.equal(h.personalCagr, null, 'one transaction stream cannot be split across two folios')
  }
})

test('a code-0 holding does not borrow a matched fund transaction history', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [{ fundCode: 0, fundName: 'Alpha Unknown Fund', marketValue: 110000, marketValueDate: '2026-03-31', closingUnits: 100, totalCost: 100000 }],
    [{ fundCode: 500001, fundName: 'Some Matched Fund', date: '2025-03-31', amount: 100000 }]
  ))
  assert.equal(a.holdings.length, 1)
  assert.equal(a.holdings[0].personalCagr, null, 'no cashflows of its own means no return')
})

// ---- Cashflows that fall outside the valuation window ----

test('a transaction dated after the valuation date withholds XIRR instead of computing one', async () => {
  stubNoNavHistory()
  const h = only(await analyzePortfolio(portfolioOf(
    [{ fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31' }],
    [
      { fundCode: 500001, date: '2024-01-15', amount: 100000 },
      { fundCode: 500001, date: '2026-04-15', amount: 20000 },
    ]
  )))
  assert.equal(h.valuationDate, '2026-03-31')
  assert.equal(h.personalCagr, null)
})

test('a transaction on the valuation date itself is kept', async () => {
  stubNoNavHistory()
  const h = only(await analyzePortfolio(portfolioOf(
    [{ fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31' }],
    [
      { fundCode: 500001, date: '2024-01-15', amount: 100000 },
      { fundCode: 500001, date: '2026-03-31', amount: 20000 },
    ]
  )))
  assert.ok(h.personalCagr !== null)
})

test('a malformed stored transaction date withholds XIRR for the whole holding', async () => {
  stubNoNavHistory()
  for (const bad of ['', '2026-13-01', '2026-02-30', '31-Mar-2026', 'unknown']) {
    const h = only(await analyzePortfolio(portfolioOf(
      [{ fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31' }],
      [
        { fundCode: 500001, date: '2024-01-15', amount: 100000 },
        { fundCode: 500001, date: bad, amount: 20000 },
      ]
    )))
    assert.equal(h.personalCagr, null, `date ${JSON.stringify(bad)} must not be silently dropped`)
  }
})

test('no cashflow is ever dated beyond the statement valuation date', async () => {
  stubNoNavHistory()
  // Valued well in the past; "today" is far later. A clock-dated terminal flow
  // would stretch the window by years and depress the return.
  const h = only(await analyzePortfolio(portfolioOf(
    [{ fundCode: 500001, marketValue: 200000, marketValueDate: '2020-03-31' }],
    [{ fundCode: 500001, date: '2019-03-31', amount: 100000 }]
  )))
  assert.equal(h.valuationDate, '2020-03-31')
  // 100k doubling over the single year to the valuation date.
  assert.ok(Math.abs(h.personalCagr! - 100) < 1, `got ${h.personalCagr}`)
})

// ---- Incomplete history ----

test('a folio that opened with units has a partial history, so XIRR is withheld', async () => {
  stubNoNavHistory()
  const parsed = parseCAMSText(statementBlock({
    scheme: 'Quant Small Cap Fund Direct Plan Growth',
    valueDate: '31-Mar-2026',
    nav: 200,
    marketValue: 400000,
    units: 2000,
    cost: 150000,
    openingUnits: 1000,
    rows: [{ date: '01-Apr-2024', desc: 'Purchase', amount: 100000, nav: 100, units: 1000 }],
  }))
  assert.equal(parsed.fundSummaries[0].openingUnits, 1000)
  const h = only(await analyzePortfolio(parsed))
  assert.equal(h.valuationDate, '2026-03-31', 'the value is still dated')
  assert.equal(h.personalCagr, null, 'the rows do not account for the opening units')
})

// A read zero opening balance means no units predate the statement window. It
// does not prove every row inside that window parsed, so this permits the
// calculation rather than certifying the history.
test('a zero opening balance permits an XIRR calculation', async () => {
  stubNoNavHistory()
  const parsed = parseCAMSText(statementBlock({
    scheme: 'Quant Small Cap Fund Direct Plan Growth',
    valueDate: '31-Mar-2026',
    nav: 200,
    marketValue: 200000,
    units: 1000,
    cost: 100000,
    openingUnits: 0,
    rows: [{ date: '01-Apr-2024', desc: 'Purchase', amount: 100000, nav: 100, units: 1000 }],
  }))
  assert.equal(parsed.fundSummaries[0].openingUnits, 0)
  assert.ok(only(await analyzePortfolio(parsed)).personalCagr !== null)
})

test('an unread opening balance withholds XIRR: it is unknown, not an assumed zero', async () => {
  stubNoNavHistory()
  // A dated statement is not enough on its own. Without a read opening balance
  // the rows cannot be shown to account for the whole folio, so the return is
  // withheld rather than computed from a possibly partial history.
  for (const opening of [undefined, null]) {
    const p = portfolioOf(
      [{ fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31', openingUnits: opening }],
      [{ fundCode: 500001, date: '2024-01-15', amount: 100000 }]
    )
    if (opening === undefined) delete (p.fundSummaries[0] as Partial<FundSummary>).openingUnits
    const h = only(await analyzePortfolio(p))
    assert.equal(h.valuationDate, '2026-03-31', 'the value is still dated')
    assert.equal(h.personalCagr, null, `openingUnits ${String(opening)} must not be treated as zero`)
  }
})

test('a misread opening balance withholds XIRR: negative and NaN prove nothing', async () => {
  stubNoNavHistory()
  for (const opening of [-5, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const h = only(await analyzePortfolio(portfolioOf(
      [{ fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31', openingUnits: opening }],
      [{ fundCode: 500001, date: '2024-01-15', amount: 100000 }]
    )))
    assert.equal(h.personalCagr, null, `openingUnits ${String(opening)} must withhold the return`)
  }
})

test('the opening-balance tolerance matches the closing-balance one', async () => {
  stubNoNavHistory()
  const withOpening = async (openingUnits: number) => only(await analyzePortfolio(portfolioOf(
    [{ fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31', openingUnits }],
    [{ fundCode: 500001, date: '2024-01-15', amount: 100000 }]
  ))).personalCagr
  // Rounding dust at or below 0.001 unit is still an empty folio.
  assert.ok(await withOpening(0) !== null)
  assert.ok(await withOpening(0.001) !== null)
  assert.ok(await withOpening(-0.001) !== null)
  // Anything above it is real units that predate the rows.
  assert.equal(await withOpening(0.002), null)
})

test('one folio with a partial history withholds XIRR for the merged holding', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 100000, marketValueDate: '2026-03-31', closingUnits: 50, totalCost: 60000, openingUnits: 0 },
      { fundCode: 500001, marketValue: 50000, marketValueDate: '2026-03-31', closingUnits: 25, totalCost: 30000, openingUnits: 12 },
    ],
    [{ fundCode: 500001, date: '2024-01-15', amount: 90000 }]
  ))
  assert.equal(a.holdings.length, 1)
  assert.equal(a.holdings[0].valuationDate, '2026-03-31')
  assert.equal(a.holdings[0].personalCagr, null)
  assert.equal(a.holdings[0].currentValue, 150000)
})

test('a statement block with no Opening Unit Balance line parses it as unknown, not zero', () => {
  const text = [
    `Quant Small Cap Fund Direct Plan Growth - ${ISIN}`,
    '01-Apr-2024 Purchase 100000.00 100.0000 1000.000 1000.000',
    'NAV on 31-Mar-2026: INR 200.0000   Market Value on 31-Mar-2026: INR 200000.00',
    'Closing Unit Balance: 1000.000   Total Cost Value: 100000.00',
  ].join('\n')
  assert.equal(parseCAMSText(text).fundSummaries[0].openingUnits, null)
})

// ---- Rows the parser could not date ----

test('an undatable transaction row disables the return instead of shortening the history', async () => {
  stubNoNavHistory()
  const text = [
    `Quant Small Cap Fund Direct Plan Growth - ${ISIN}`,
    'Opening Unit Balance: 0.000',
    '01-Apr-2024 Purchase 100000.00 100.0000 1000.000 1000.000',
    '31-Feb-2025 Purchase 50000.00 125.0000 400.000 1400.000',
    'NAV on 31-Mar-2026: INR 200.0000   Market Value on 31-Mar-2026: INR 280000.00',
    'Closing Unit Balance: 1400.000   Total Cost Value: 150000.00',
  ].join('\n')
  const parsed = parseCAMSText(text)
  assert.equal(parsed.transactions.length, 1, 'the undatable row is not retained')
  assert.equal(parsed.fundSummaries[0].historyUnusable, true)
  const h = only(await analyzePortfolio(parsed))
  assert.equal(h.valuationDate, '2026-03-31', 'the value is still dated')
  assert.equal(h.personalCagr, null, 'a return from the surviving row alone would be wrong')
})

test('a clean statement is not marked unusable', () => {
  const parsed = parseCAMSText(statementBlock({
    scheme: 'Quant Small Cap Fund Direct Plan Growth',
    valueDate: '31-Mar-2026',
    nav: 200,
    marketValue: 200000,
    units: 1000,
    cost: 100000,
    rows: [{ date: '01-Apr-2024', desc: 'Purchase', amount: 100000, nav: 100, units: 1000 }],
  }))
  assert.equal(parsed.fundSummaries[0].historyUnusable, false)
})

// ---- Degenerate solver inputs ----

test('cashflows that all fall on the valuation date yield no return, not an arbitrary one', async () => {
  stubNoNavHistory()
  const h = only(await analyzePortfolio(portfolioOf(
    [{ fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31' }],
    [
      { fundCode: 500001, date: '2026-03-31', amount: 100000 },
      { fundCode: 500001, date: '2026-03-31', amount: 50000 },
    ]
  )))
  assert.equal(h.valuationDate, '2026-03-31')
  assert.equal(h.personalCagr, null, 'no elapsed period means nothing to annualize')
})

test('a non-finite stored amount or value never reaches the solver', async () => {
  stubNoNavHistory()
  const badAmount = only(await analyzePortfolio(portfolioOf(
    [{ fundCode: 500001, marketValue: 150000, marketValueDate: '2026-03-31' }],
    [
      { fundCode: 500001, date: '2024-01-15', amount: 100000 },
      { fundCode: 500001, date: '2025-01-15', amount: Number.NaN },
    ]
  )))
  assert.equal(badAmount.personalCagr, null)

  const badValue = only(await analyzePortfolio(portfolioOf(
    [{ fundCode: 500001, marketValue: Number.POSITIVE_INFINITY, marketValueDate: '2026-03-31' }],
    [{ fundCode: 500001, date: '2024-01-15', amount: 100000 }]
  )))
  assert.equal(badValue.personalCagr, null)
})

// ---- Value normalization across folios ----

test('a folio valued only by units x NAV still contributes its value to the merged holding', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 100000, marketValueDate: '2026-03-31', navDate: '2026-03-31', closingUnits: 50, latestNav: 2000, totalCost: 60000 },
      { fundCode: 500001, marketValue: 0, marketValueDate: null, navDate: '2026-03-31', closingUnits: 25, latestNav: 2000, totalCost: 30000 },
    ],
    [{ fundCode: 500001, date: '2024-01-15', amount: 90000 }]
  ))
  assert.equal(a.holdings.length, 1)
  // 100000 from the first folio plus 25 x 2000 from the second. Summing raw
  // market values would have reported 100000 and lost the second folio outright.
  assert.equal(a.holdings[0].currentValue, 150000)
  assert.equal(a.holdings[0].valuationDate, '2026-03-31', 'both folios are dated 31 Mar, by different lines')
  assert.ok(a.holdings[0].personalCagr !== null)
  assert.equal(a.totalValue, 150000)
})

test('a NAV-valued sibling dated differently still contributes value but withholds XIRR', async () => {
  stubNoNavHistory()
  const a = await analyzePortfolio(portfolioOf(
    [
      { fundCode: 500001, marketValue: 100000, marketValueDate: '2026-03-31', closingUnits: 50, latestNav: 2000, totalCost: 60000 },
      { fundCode: 500001, marketValue: 0, marketValueDate: null, navDate: '2025-12-31', closingUnits: 25, latestNav: 2000, totalCost: 30000 },
    ],
    [{ fundCode: 500001, date: '2024-01-15', amount: 90000 }]
  ))
  assert.equal(a.holdings[0].currentValue, 150000)
  assert.equal(a.holdings[0].valuationDate, null)
  assert.equal(a.holdings[0].personalCagr, null)
})

// ---- Date formats on the value lines ----

test('a dd/mm/yyyy value-line date is read, and an impossible one is not', async () => {
  stubNoNavHistory()
  const good = parseCAMSText(statementBlock({
    scheme: 'Quant Small Cap Fund Direct Plan Growth',
    valueDate: '31/03/2026',
    nav: 200,
    marketValue: 200000,
    units: 1000,
    cost: 100000,
    rows: [{ date: '01-Apr-2024', desc: 'Purchase', amount: 100000, nav: 100, units: 1000 }],
  }))
  assert.equal(good.fundSummaries[0].marketValueDate, '2026-03-31')
  assert.equal(good.fundSummaries[0].navDate, '2026-03-31')
  assert.ok(only(await analyzePortfolio(good)).personalCagr !== null)
})

// ---- The transaction-netting fallback has no statement valuation at all ----

test('a portfolio with no fund summaries is undated and reports no XIRR', async () => {
  stubNoNavHistory()
  const p = portfolioOf([], [{ fundCode: 500001, date: '2024-01-15', amount: 100000, units: 10 }])
  p.fundSummaries = []
  const a = await analyzePortfolio(p)
  assert.equal(a.holdings.length, 1)
  assert.equal(a.holdings[0].valuationDate, null)
  assert.equal(a.holdings[0].personalCagr, null)
})
