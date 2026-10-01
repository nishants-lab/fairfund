/**
 * Fund-matching regression tests against the REAL production parser.
 *
 * These tests execute src/lib/camsParser.ts parseCAMSText() over synthetic CAMS
 * statement text and assert the fund codes it resolves. Nothing here
 * reimplements the matcher: an earlier standalone checker kept a copy of the
 * algorithm, which drifted from production and could pass while the shipped
 * parser was wrong.
 *
 * Expected codes are pinned to src/data/matcher_universe.json entries and
 * cross-checked by name + plan in "expected codes still exist in the universe",
 * so a universe rebuild that moves a code fails loudly instead of silently
 * re-pointing a fixture.
 *
 * Run: node tests/run-regressions.mjs tests/fund-matching.test.ts
 */
import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { MATCHER_VERSION, isNonEquityScheme, parseCAMSText } from '../src/lib/camsParser'
import { universeFunds } from '../src/lib/matcherUniverse'
import { analyzePortfolio } from '../src/lib/portfolio'

// ---- Statement fixtures -------------------------------------------------

const AS_OF = '30-Sep-2026'

interface BlockFixture {
  scheme: string
  isin?: string
  units?: number
  cost?: number
  nav?: number
  value?: number
  /** Raw transaction rows, written exactly as a statement prints them. */
  rows?: string[]
}

/**
 * Minimal but structurally faithful CAMS block: the header carries an ISIN (the
 * marker production relies on), followed by the balance / NAV / value lines.
 */
function block(f: BlockFixture): string {
  const units = f.units ?? 100
  const nav = f.nav ?? 50
  return [
    `${f.scheme} - ISIN : ${f.isin ?? 'INF000000000'}`,
    'Opening Unit Balance: 0.000',
    ...(f.rows ?? []),
    `NAV on ${AS_OF}: INR ${nav.toFixed(4)}   Market Value on ${AS_OF}: INR ${(f.value ?? units * nav).toFixed(2)}`,
    `Closing Unit Balance: ${units.toFixed(3)}   Total Cost Value: ${(f.cost ?? units * nav * 0.8).toFixed(2)}`,
  ].join('\n')
}

function statement(blocks: BlockFixture[]): string {
  return [
    'CONSOLIDATED ACCOUNT STATEMENT',
    'PAN : ABCDE1234F',
    'Folio No : 12345678 / 11   Test Investor',
    ...blocks.map(block),
  ].join('\n')
}

/** Resolve one statement scheme name through the production parser. */
function resolve(scheme: string): number | null {
  const parsed = parseCAMSText(statement([{ scheme }]))
  assert.equal(parsed.fundSummaries.length, 1, `expected exactly one block for: ${scheme}`)
  const code = parsed.fundSummaries[0].fundCode
  return code > 0 ? code : null
}

// ---- Expected-code fixtures --------------------------------------------
//
// name + plan are the universe identity of the expected code; `statement` is
// what a CAS actually prints for that holding.

interface Case {
  statement: string
  code: number | null
  /** Universe name the code must carry (omit for deliberately-unmatchable cases). */
  name?: string
  plan?: 'direct' | 'regular'
}

const DIRECT_REGULAR: Case[] = [
  { statement: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth', code: 122639, name: 'Parag Parikh Flexi Cap Fund', plan: 'direct' },
  { statement: 'Parag Parikh Flexi Cap Fund - Regular Plan - Growth', code: 122640, name: 'Parag Parikh Flexi Cap Fund', plan: 'regular' },
  { statement: 'HDFC Flexi Cap Fund - Direct Plan - Growth Option', code: 118955, name: 'HDFC Flexi Cap Fund', plan: 'direct' },
  // Pre-2013 folios print no plan word at all; absence of "Direct" means Regular.
  { statement: 'HDFC Flexi Cap Fund - Growth Option', code: 101762, name: 'HDFC Flexi Cap Fund', plan: 'regular' },
  { statement: 'Tata Digital India Fund - Direct Plan - Growth', code: 135800, name: 'Tata Digital India Fund', plan: 'direct' },
  { statement: 'Tata Digital India Fund - Regular Plan - Growth', code: 135797, name: 'Tata Digital India Fund', plan: 'regular' },
  { statement: 'BANDHAN Small Cap Fund - Direct Plan - Growth', code: 147946, name: 'BANDHAN Small Cap Fund', plan: 'direct' },
  { statement: 'BANDHAN Small Cap Fund - Regular Plan - Growth', code: 147944, name: 'BANDHAN Small Cap Fund', plan: 'regular' },
]

// The bug class this guards: an active fund resolving to its same-named index
// sibling (or the reverse), which silently repriced portfolios.
const ACTIVE_VS_INDEX: Case[] = [
  { statement: 'Nippon India Small Cap Fund - Direct Plan - Growth', code: 118778, name: 'Nippon India Small Cap Fund', plan: 'direct' },
  { statement: 'Nippon India Nifty Smallcap 250 Index Fund - Direct Plan - Growth', code: 148519, name: 'Nippon India Nifty Smallcap 250 Index Fund', plan: 'direct' },
  { statement: 'Nippon India Nifty Smallcap 250 Index Fund - Regular Plan - Growth', code: 148518, name: 'Nippon India Nifty Smallcap 250 Index Fund', plan: 'regular' },
  { statement: 'Motilal Oswal Midcap Fund - Direct Plan Growth', code: 127042, name: 'Motilal Oswal Midcap Fund-Direct Plan-Growth Option', plan: 'direct' },
  { statement: 'Motilal Oswal Nifty Midcap 150 Index Fund - Direct Plan - Growth', code: 147622, name: 'Motilal Oswal Nifty Midcap 150 Index Fund', plan: 'direct' },
  { statement: 'ICICI Prudential Technology Fund - Direct Plan - Growth', code: 120594, name: 'ICICI Prudential Technology Fund', plan: 'direct' },
  { statement: 'ICICI Prudential Nifty 50 Index Fund - Direct Plan - Growth', code: 120620, name: 'ICICI Prudential Nifty 50 Index Fund', plan: 'direct' },
  { statement: 'Axis NIFTY Next 50 Index Fund Direct Growth', code: 149466, name: 'Axis Nifty Next 50 Index Fund', plan: 'direct' },
  { statement: 'Axis NIFTY Next 50 Index Fund Regular Growth', code: 149467, name: 'Axis Nifty Next 50 Index Fund', plan: 'regular' },
]

// The matcher universe spans every asset class, so debt and hybrid holdings must
// now resolve to their own codes instead of being dropped as "not equity".
const DEBT_AND_HYBRID: Case[] = [
  { statement: 'ICICI Prudential 10 year Constant Maturity Gilt Fund - Direct Plan - Growth', code: 131061, name: 'ICICI Prudential 10 year Constant Maturity Gilt Fund', plan: 'direct' },
  { statement: 'ICICI Prudential 10 year Constant Maturity Gilt Fund - Growth', code: 131051, name: 'ICICI Prudential 10 year Constant Maturity Gilt Fund', plan: 'regular' },
  { statement: 'Mirae Asset Overnight Fund - Direct Plan ( Demat )', code: 147736, name: 'Mirae Asset Overnight Fund', plan: 'direct' },
  { statement: 'Mirae Asset Overnight Fund - Regular Plan', code: 147739, name: 'Mirae Asset Overnight Fund', plan: 'regular' },
  { statement: 'HDFC Balanced Advantage Fund - Direct Plan - Growth', code: 118968, name: 'HDFC Balanced Advantage Fund', plan: 'direct' },
  { statement: 'HDFC Balanced Advantage Fund - Growth', code: 100119, name: 'HDFC Balanced Advantage Fund', plan: 'regular' },
  { statement: 'Parag Parikh Conservative Hybrid Fund - Direct Plan - Growth', code: 148958, name: 'Parag Parikh Conservative Hybrid Fund', plan: 'direct' },
  { statement: 'Parag Parikh Arbitrage Fund - Direct Plan - Growth', code: 152109, name: 'Parag Parikh Arbitrage Fund', plan: 'direct' },
  { statement: 'Parag Parikh Liquid Fund - Direct Plan - Growth', code: 143269, name: 'Parag Parikh Liquid Fund', plan: 'direct' },
]

// CAS keeps the pre-rename name in a parenthetical; production drops
// parentheticals, so the current name must still win.
const HISTORICAL_ALIASES: Case[] = [
  { statement: 'Mirae Asset ELSS Tax Saver Fund ( formerly Mirae Asset Tax Saver Fund ) - Direct Plan', code: 135781, name: 'Mirae Asset ELSS Tax Saver Fund', plan: 'direct' },
  { statement: 'Mirae Asset ELSS Tax Saver Fund ( formerly Mirae Asset Tax Saver Fund ) - Regular Plan', code: 135784, name: 'Mirae Asset ELSS Tax Saver Fund', plan: 'regular' },
  { statement: 'Parag Parikh Flexi Cap Fund - Direct Plan Growth ( formerly Parag Parikh Long Term Value Fund )', code: 122639, name: 'Parag Parikh Flexi Cap Fund', plan: 'direct' },
  { statement: 'Bandhan Small Cap Fund (formerly IDFC Small Cap Fund) - Regular Plan - Growth', code: 147944, name: 'BANDHAN Small Cap Fund', plan: 'regular' },
  { statement: 'HDFC Flexi Cap Fund (formerly HDFC Equity Fund) - Direct Plan - Growth', code: 118955, name: 'HDFC Flexi Cap Fund', plan: 'direct' },
]

// RTA product codes prefix the scheme name on many statements and must be
// stripped before matching, including the "128 MCDGG" numeric AMC form.
const RTA_HEADERS: Case[] = [
  { statement: 'TDIFGZ - Tata Digital India Fund Direct Plan Growth', code: 135800, name: 'Tata Digital India Fund', plan: 'direct' },
  { statement: 'RMFLQAGG - NIPPON INDIA MONEY MARKET FUND - DIRECT GROWTH PLAN GROWTH OPTION', code: 118719, name: 'Nippon India Money Market Fund', plan: 'direct' },
  { statement: '128 MCDGG - Axis Midcap Fund - Direct Plan - Growth', code: 120505, name: 'Axis Midcap Fund', plan: 'direct' },
  { statement: 'K 123 D - Kotak Mid Cap Fund - Direct Plan - Growth', code: 119775, name: 'Kotak Mid Cap Fund', plan: 'direct' },
  { statement: 'P8070 - Parag Parikh Flexi Cap Fund - Direct Plan - Growth', code: 122639, name: 'Parag Parikh Flexi Cap Fund', plan: 'direct' },
]

// Scheme names whose own head carries a number. These must NOT be mistaken for an
// RTA product code and stripped: doing so left the block nameless, so the holding
// resolved to nothing (and, with no plan suffix, vanished from the portfolio).
const NUMBER_IN_NAME: Case[] = [
  { statement: 'BHARAT 22 ETF - Regular Plan - Growth', code: 141957, name: 'BHARAT 22 ETF', plan: 'regular' },
  { statement: 'ICICI Prudential Nifty 50 Index Fund - Direct Plan - Growth', code: 120620, name: 'ICICI Prudential Nifty 50 Index Fund', plan: 'direct' },
  { statement: 'Nippon India Nifty Smallcap 250 Index Fund - Regular Plan - Growth', code: 148518, name: 'Nippon India Nifty Smallcap 250 Index Fund', plan: 'regular' },
]

// Equity cases carried over from the previous standalone checker, now executed
// through the real parser.
const LEGACY_EQUITY: Case[] = [
  { statement: 'Aditya Birla Sun Life International Equity Fund - Growth - Direct Plan', code: 119517, name: 'Aditya Birla Sun Life International Equity Fund', plan: 'direct' },
  { statement: 'Axis Mid Cap Fund - Direct Growth', code: 120505, name: 'Axis Midcap Fund', plan: 'direct' },
  { statement: 'Axis Small Cap Fund Direct Growth', code: 125354, name: 'Axis Small Cap Fund', plan: 'direct' },
  { statement: 'Canara Robeco Small Cap Fund - Direct Growth', code: 146130, name: 'Canara Robeco Small Cap Fund', plan: 'direct' },
  { statement: 'Franklin Asian Equity Fund - Direct Plan - Growth', code: 118559, name: 'Franklin Asian Equity Fund', plan: 'direct' },
  { statement: 'Kotak Mid Cap Fund Direct Growth', code: 119775, name: 'Kotak Mid Cap Fund', plan: 'direct' },
  { statement: 'PGIM India Midcap Fund - Direct Plan - Growth', code: 125307, name: 'PGIM India Midcap Fund', plan: 'direct' },
  { statement: 'quant Small Cap Fund - Direct Plan - Growth', code: 120828, name: 'Quant Small Cap Fund', plan: 'direct' },
  { statement: 'quant Mid Cap Fund - Direct Plan - Growth', code: 120841, name: 'Quant Mid Cap Fund', plan: 'direct' },
  { statement: 'quant Quantamental Fund - Direct Plan - Growth', code: 148925, name: 'quant Quantamental Fund', plan: 'direct' },
]

// Holdings the universe genuinely cannot name. A wrong code here is worse than
// none: it reprices someone's portfolio with an unrelated NAV series.
const UNMATCHABLE: Case[] = [
  // Closed-ended FMP: never in an open-ended universe.
  { statement: 'HDFC FMP 1846D March 2017 (1) - Direct Plan - Growth Option', code: null },
  // No such AMC or scheme.
  { statement: 'Zzyzx Opportunities Fund - Direct Plan - Growth', code: null },
  // Header text too short to be a scheme name (production gate: > 8 chars).
  { statement: 'Cash A/c', code: null },
]

const GROUPS: [string, Case[]][] = [
  ['direct and regular plans stay separate', DIRECT_REGULAR],
  ['active funds never resolve to index siblings', ACTIVE_VS_INDEX],
  ['debt and hybrid holdings resolve to their own codes', DEBT_AND_HYBRID],
  ['renamed schemes resolve through their historical alias', HISTORICAL_ALIASES],
  ['RTA product-code prefixes are stripped', RTA_HEADERS],
  ['a number inside the scheme name is not an RTA code', NUMBER_IN_NAME],
  ['legacy equity fixture still resolves', LEGACY_EQUITY],
  ['unmatchable holdings return no code', UNMATCHABLE],
]

const ALL_CASES = GROUPS.flatMap(([, cases]) => cases)

/** Case- and whitespace-insensitive form, for tolerating cosmetic AMC renames. */
function loosenName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

// ---- Tests -------------------------------------------------------------

test('expected codes still exist in the universe under the expected name and plan', () => {
  const byCode = new Map(universeFunds.map(f => [f.code, f]))
  for (const c of ALL_CASES) {
    if (c.code === null) continue
    const fund = byCode.get(c.code)
    assert.ok(fund, `fixture code ${c.code} is no longer in matcher_universe.json (${c.statement})`)
    // Identity is the code + plan: those must match exactly. The name is
    // compared case- and whitespace-insensitively so a benign AMC re-spelling
    // ("BANDHAN" -> "Bandhan  Small Cap  Fund") does not fail the build, while
    // a code pointing at a different scheme still does.
    assert.equal(
      loosenName(fund.name), loosenName(c.name ?? ''),
      `code ${c.code} now names a different scheme: ${fund.name} (fixture expected ${c.name})`,
    )
    assert.equal(fund.planType, c.plan, `code ${c.code} plan drifted`)
  }
})

for (const [title, cases] of GROUPS) {
  test(title, () => {
    const misses: string[] = []
    for (const c of cases) {
      const got = resolve(c.statement)
      if (got !== c.code) {
        const byCode = new Map(universeFunds.map(f => [f.code, f]))
        const gotName = got === null ? '(none)' : byCode.get(got)?.name ?? `unknown code ${got}`
        const gotPlan = got === null ? '' : ` [${byCode.get(got)?.planType ?? '?'}]`
        misses.push(
          `  ${c.statement}\n` +
          `    expected ${c.code ?? 'null'} ${c.name ?? '(no match)'}\n` +
          `    got      ${got ?? 'null'} ${gotName}${gotPlan}`
        )
      }
    }
    assert.equal(misses.length, 0, `${misses.length}/${cases.length} mismatched:\n${misses.join('\n')}`)
  })
}

test('plan words never cross-match: every direct fixture stays direct', () => {
  const byCode = new Map(universeFunds.map(f => [f.code, f]))
  for (const c of ALL_CASES) {
    if (c.code === null) continue
    const got = resolve(c.statement)
    if (got === null) continue
    const wantPlan = /\bdirect\b/i.test(c.statement) ? 'direct' : 'regular'
    assert.equal(byCode.get(got)?.planType, wantPlan, `${c.statement} resolved to a ${wantPlan === 'direct' ? 'regular' : 'direct'}-plan code ${got}`)
  }
})

test('parses a multi-fund statement end to end', () => {
  const text = statement([
    { scheme: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth', isin: 'INF879O01019', units: 1234.567, nav: 85.1234, value: 105091.2, cost: 80000 },
    { scheme: 'ICICI Prudential 10 year Constant Maturity Gilt Fund - Direct Plan - Growth', isin: 'INF109K01Z48', units: 500, nav: 24.5, value: 12250, cost: 11000 },
    { scheme: 'Zzyzx Opportunities Fund - Direct Plan - Growth', isin: 'INF000X01011', units: 10, nav: 10, value: 100, cost: 100 },
  ])
  const parsed = parseCAMSText(text)

  assert.equal(parsed.matcherVersion, MATCHER_VERSION)
  assert.equal(parsed.pan, 'XXXX234F')
  assert.equal(parsed.fundSummaries.length, 3)
  const diagnostics = parsed.diagnostics
  assert.ok(diagnostics, 'parser must report diagnostics')
  assert.equal(diagnostics.isinCount, 3)
  assert.equal(diagnostics.schemesParsed, 3)
  assert.equal(diagnostics.activeHoldings, 3)
  assert.equal(diagnostics.closedPositions, 0)
  assert.deepEqual(diagnostics.missingValueFunds, [])

  const equity = parsed.fundSummaries[0]
  assert.equal(equity.fundCode, 122639)
  assert.equal(equity.closingUnits, 1234.567)
  assert.equal(equity.totalCost, 80000)
  assert.equal(equity.latestNav, 85.1234)
  assert.equal(equity.marketValue, 105091.2)

  assert.equal(parsed.fundSummaries[1].fundCode, 131061)
  assert.equal(parsed.fundSummaries[2].fundCode, 0, 'unknown scheme must not borrow another fund code')
  assert.deepEqual(parsed.fundCodes, [122639, 131061])
})

test('a fully redeemed holding is kept as a zero-unit block, not dropped', () => {
  const text = statement([
    { scheme: 'Axis Small Cap Fund - Direct Plan - Growth', units: 0, nav: 0, value: 0, cost: 0 },
  ])
  const parsed = parseCAMSText(text)
  const diagnostics = parsed.diagnostics
  assert.ok(diagnostics, 'parser must report diagnostics')
  assert.equal(diagnostics.schemesParsed, 1)
  assert.equal(diagnostics.activeHoldings, 0)
  assert.equal(diagnostics.closedPositions, 1)
  assert.equal(parsed.fundSummaries[0].fundCode, 125354)
})

test('a scheme header with no plan words keeps its name and its code', () => {
  // The header reduces to "<name> - ISIN : ..."; stripping the name as an RTA code
  // left an empty scheme, and an empty scheme is silently dropped on flush.
  // No "Direct" anywhere on the header means a Regular-plan holding, so these are
  // the regular codes of each scheme.
  for (const [scheme, code] of [
    ['BHARAT 22 ETF', 141957],
    ['Axis Small Cap Fund', 125350],
  ] as [string, number][]) {
    const parsed = parseCAMSText(statement([{ scheme }]))
    const diagnostics = parsed.diagnostics
    assert.ok(diagnostics, 'parser must report diagnostics')
    assert.equal(diagnostics.isinCount, 1, scheme)
    assert.equal(diagnostics.schemesParsed, 1, `${scheme} was dropped instead of parsed`)
    assert.equal(parsed.fundSummaries.length, 1, scheme)
    assert.equal(parsed.fundSummaries[0].fundName, scheme, `${scheme} lost its name`)
    assert.equal(parsed.fundSummaries[0].fundCode, code, scheme)
  }
})

// ---- History-usability flag --------------------------------------------
//
// These assert only the flag the parser sets on the block. The return itself is
// computed elsewhere; the point here is that an unpriceable row is declared as
// such at parse time instead of reaching the maths as if it were cash.

const PURCHASE_ROW = '01-Apr-2024 Purchase 100000.00 100.0000 1000.000 1000.000'

function parseRows(rows: string[]): boolean | undefined {
  const parsed = parseCAMSText(statement([{
    scheme: 'quant Small Cap Fund - Direct Plan - Growth',
    units: 1400, nav: 200, value: 280000, cost: 100000, rows,
  }]))
  assert.equal(parsed.fundSummaries.length, 1)
  return parsed.fundSummaries[0].historyUnusable
}

test('an IDCW reinvestment row makes the block history unusable', () => {
  // Reinvested IDCW is not money received: its units are already inside the
  // closing balance, so pricing the row as an inflow double-counts it.
  assert.equal(parseRows([
    PURCHASE_ROW,
    '15-Jun-2025 IDCW Reinvestment 50000.00 125.0000 400.000 1400.000',
  ]), true)
  for (const desc of ['Dividend Reinvest', 'IDCW Re-investment', 'IDCW Re Invest', 'REINVESTMENT']) {
    assert.equal(parseRows([PURCHASE_ROW, `15-Jun-2025 ${desc} 5000.00 125.0000 40.000 1040.000`]), true, desc)
  }
})

test('a reversal row makes the block history unusable', () => {
  // The row it cancels stays in the list, so the pair cannot be netted here.
  assert.equal(parseRows([
    PURCHASE_ROW,
    '20-Jun-2025 Purchase - Reversal 10000.00 125.0000 80.000 920.000',
  ]), true)
  assert.equal(parseRows([PURCHASE_ROW, '20-Jun-2025 Reversed Transaction 10000.00 125.0000 80.000 920.000']), true)
})

test('ordinary transaction rows leave the history usable', () => {
  for (const row of [
    '10-May-2024 Systematic Investment 5000.00 110.0000 45.455 1045.455',
    '10-Jun-2024 Purchase 5000.00 115.0000 43.478 1088.933',
    '10-Jul-2024 Redemption 5000.00 120.0000 41.667 1047.266',
    '10-Aug-2024 IDCW Payout 2000.00 120.0000 0.000 1047.266',
    '10-Sep-2024 Switch In 5000.00 125.0000 40.000 1087.266',
    // The spelling guard keys on a word boundary, so an ordinary description that
    // merely ends in "re" before "invest" must not trip it.
    '10-Oct-2024 Share Investment 5000.00 125.0000 40.000 1127.266',
  ]) {
    assert.notEqual(parseRows([PURCHASE_ROW, row]), true, row)
  }
})

test('a wrapped row flags the block even though its numbers are on the next line', () => {
  // PDF extraction can split a row: description on one line, amounts on the next.
  // The amount-less line is dropped by the numeric gate, so the keyword has to be
  // read before that gate or the block looks cleanly priceable.
  assert.equal(parseRows([
    PURCHASE_ROW,
    '15-Jun-2025 IDCW Reinvestment',
    '50000.00 125.0000 400.000 1400.000',
  ]), true)
  assert.equal(parseRows([
    PURCHASE_ROW,
    '20-Jun-2025 Purchase - Reversal',
    '10000.00 125.0000 80.000 920.000',
  ]), true)
})

test('a bracketed or signed amount on a money-in row flags the block', () => {
  // Brackets are the only sign the statement carries, and the numeric scan reads
  // digits only - so a taken-back credit would otherwise read as new money.
  for (const row of [
    '10-Apr-2024 Purchase (50000.00) 100.0000 500.000 500.000',
    '10-Apr-2024 Systematic Investment (5000.00) 100.0000 50.000 950.000',
    '10-Apr-2024 Switch In (5000.00) 100.0000 50.000 900.000',
    '10-Apr-2024 Purchase -50000.00 100.0000 500.000 500.000',
  ]) {
    assert.equal(parseRows([PURCHASE_ROW, row]), true, row)
  }
})

test('normal money-out signs and dash separators are left alone', () => {
  for (const row of [
    // Redemptions and switch-outs are printed negative as a matter of course.
    '10-Apr-2024 Redemption (50000.00) 100.0000 500.000 500.000',
    '10-Apr-2024 Switch Out (50000.00) 100.0000 500.000 500.000',
    '10-Apr-2024 Redemption -50000.00 100.0000 500.000 500.000',
    // " - " before the amount is a separator, not a minus sign.
    '10-Apr-2024 Purchase - 50000.00 100.0000 500.000 1500.000',
  ]) {
    assert.notEqual(parseRows([PURCHASE_ROW, row]), true, row)
  }
})

test('the reinvestment flag is per block, not per statement', () => {
  const parsed = parseCAMSText(statement([
    { scheme: 'quant Small Cap Fund - Direct Plan - Growth', rows: [PURCHASE_ROW] },
    {
      scheme: 'Axis Small Cap Fund - Direct Plan - Growth',
      rows: [PURCHASE_ROW, '15-Jun-2025 IDCW Reinvestment 50000.00 125.0000 400.000 1400.000'],
    },
  ]))
  assert.equal(parsed.fundSummaries.length, 2)
  assert.notEqual(parsed.fundSummaries[0].historyUnusable, true, 'a clean block must not inherit the flag')
  assert.equal(parsed.fundSummaries[1].historyUnusable, true)
})

test('isNonEquityScheme flags debt and hybrid statement names', () => {
  for (const name of [
    'ICICI Prudential 10 year Constant Maturity Gilt Fund - Direct Plan - Growth',
    'Mirae Asset Overnight Fund - Direct Plan',
    'NIPPON INDIA MONEY MARKET FUND - DIRECT GROWTH',
    'HDFC Balanced Advantage Fund - Growth',
    'Parag Parikh Arbitrage Fund - Direct Plan - Growth',
  ]) {
    assert.equal(isNonEquityScheme(name), true, name)
  }
  for (const name of [
    'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
    'Axis Small Cap Fund - Direct Plan - Growth',
    'Nippon India Nifty Smallcap 250 Index Fund - Direct Plan - Growth',
  ]) {
    assert.equal(isNonEquityScheme(name), false, name)
  }
})

// ---- Universe-wide self-match report -----------------------------------
//
// Every universe fund, rendered the way a statement prints it, must resolve back
// to its OWN code. Two tolerances exist, both pinned to explicit baselines below:
// KNOWN_MISSES (funds production cannot resolve at all) and AMBIGUOUS_GROUPS
// (codes that are indistinguishable from the statement name alone). Exact hits
// and ambiguous-sibling hits are counted and reported separately - a sibling code
// can carry a different NAV series, so it is a limitation, not a pass.

function normalizeName(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/flexicap/gi, 'flexi cap').replace(/multicap/gi, 'multi cap')
    .replace(/midcap/gi, 'mid cap').replace(/smallcap/gi, 'small cap')
    .replace(/largecap/gi, 'large cap').replace(/microcap/gi, 'micro cap')
    .replace(/[^a-z0-9]+/gi, ' ').replace(/\s{2,}/g, ' ').trim()
    .toLowerCase()
}

function assetClass(amfiCategory: string): string {
  const c = amfiCategory.toLowerCase()
  if (c.includes('index') || c.includes('etf')) return 'index/etf'
  if (c.includes('equity')) return 'equity'
  if (c.includes('hybrid') || c.includes('asset allocation') || c.includes('arbitrage')) return 'hybrid'
  if (c.includes('debt') || c.includes('income')) return 'debt'
  if (c.includes('fof') || c.includes('fund of funds') || c.includes('overseas')) return 'fof'
  if (c.includes('solution') || c.includes('retirement') || c.includes('children')) return 'solution'
  return 'other'
}

/** Render a universe fund the way a CAS prints that holding. */
function asStatementName(name: string, plan: 'direct' | 'regular'): string {
  const planWords = plan === 'direct' ? 'Direct Plan - Growth' : 'Regular Plan - Growth'
  return /\b(direct|regular)\b/i.test(name) ? name : `${name} - ${planWords}`
}

/**
 * Self-match misses production is known to have, each pinned to the result it
 * must produce. Baseline, not permission: a listed fund has to return null (no
 * code), because a WRONG code reprices a real portfolio, and any fund NOT listed
 * here must self-match.
 *
 * Currently empty. 141957 BHARAT 22 ETF (regular) lived here until
 * stripSchemeCode() stopped treating a number inside the scheme name as an RTA
 * product code; it is now covered by the NUMBER_IN_NAME fixtures instead of being
 * tolerated here.
 */
const KNOWN_MISSES = new Map<number, null>([])

/**
 * Code groups the universe cannot tell apart from the statement name alone:
 * same normalized name, same plan, different AMFI codes (usually an AMC's merged
 * or re-registered scheme, e.g. three "SBI GILT FUND" regular codes).
 *
 * Pinned EXPLICITLY, as a baseline of today's ambiguity. Resolving to a sibling
 * inside a pinned group is tolerated and counted separately from an exact hit;
 * two codes that merely happen to share a name in some future universe build are
 * NOT interchangeable, because their NAV series can differ. A new same-name
 * collision therefore fails the test until someone decides it is benign.
 *
 * Generated from src/data/matcher_universe.json (generated 2026-09-01).
 */
const AMBIGUOUS_GROUPS: { name: string; plan: 'direct' | 'regular'; codes: number[] }[] = [
  { name: "360 one dynamic term fund", plan: 'regular', codes: [122612, 122711] },
  { name: "axis children s fund", plan: 'direct', codes: [135762, 135764] },
  { name: "axis children s fund", plan: 'regular', codes: [135759, 135766] },
  { name: "axis short term fund", plan: 'regular', codes: [112354, 112721] },
  { name: "axis ultra short to short term fund", plan: 'regular', codes: [112214, 112717] },
  { name: "bandhan medium to long term fund", plan: 'regular', codes: [108765, 108768] },
  { name: "baroda bnp paribas short term fund", plan: 'direct', codes: [119400, 154673] },
  { name: "baroda bnp paribas short term fund", plan: 'regular', codes: [113036, 154675, 154689] },
  { name: "canara robeco liquid fund", plan: 'direct', codes: [118305, 139235] },
  { name: "franklin india conservative hybrid fund", plan: 'direct', codes: [118574, 148298, 148301, 148302] },
  { name: "franklin india credit risk fund", plan: 'direct', codes: [118552, 118553, 147955, 147956, 147958, 147960, 148304] },
  { name: "franklin india dynamic accrual fund", plan: 'direct', codes: [118495, 118496, 147982, 147984, 147986, 147988, 148308] },
  { name: "franklin india liquid fund", plan: 'regular', codes: [100538, 100546, 139889, 139890, 139891, 139892] },
  { name: "franklin india low duration fund", plan: 'direct', codes: [118528, 118529, 118530, 147989, 147991, 147993, 147996, 147998] },
  { name: "franklin india low duration fund", plan: 'regular', codes: [147995, 147997] },
  { name: "franklin india money market fund", plan: 'regular', codes: [101357, 101358] },
  { name: "franklin india short term income plan", plan: 'direct', codes: [118565, 118566, 118567, 118568, 148015, 148016, 148017, 148018, 148313] },
  { name: "franklin india short term income plan", plan: 'regular', codes: [148314, 148318] },
  { name: "franklin india ultra short bond fund", plan: 'direct', codes: [118560, 118561, 118562] },
  { name: "hdfc gilt fund", plan: 'regular', codes: [101083, 101084] },
  { name: "hsbc liquid fund", plan: 'regular', codes: [118902, 118907] },
  { name: "hsbc multi cap fund", plan: 'regular', codes: [151289, 151292] },
  { name: "invesco india liquid fund", plan: 'direct', codes: [120537, 139387, 139388, 139389, 139390] },
  { name: "invesco india liquid fund", plan: 'regular', codes: [104486, 104488] },
  { name: "invesco india money market fund", plan: 'regular', codes: [112120, 112123] },
  { name: "invesco india short term fund", plan: 'regular', codes: [105185, 105189] },
  { name: "invesco india ultra short to short term fund", plan: 'regular', codes: [104726, 104728] },
  { name: "jm liquid fund", plan: 'direct', codes: [120406, 148413, 148414] },
  { name: "jm liquid fund", plan: 'regular', codes: [100234, 100247] },
  { name: "jm overnight fund", plan: 'direct', codes: [147837, 149826, 149827, 149828, 149829] },
  { name: "kotak aggressive hybrid fund", plan: 'direct', codes: [119767, 133035] },
  { name: "kotak gilt fund", plan: 'direct', codes: [119757, 119759] },
  { name: "kotak gilt fund", plan: 'regular', codes: [100265, 100281] },
  { name: "motilal oswal digital india fund", plan: 'direct', codes: [152964, 152965] },
  { name: "motilal oswal digital india fund", plan: 'regular', codes: [152966, 152967] },
  { name: "nippon india aggressive hybrid fund", plan: 'direct', codes: [118794, 147689, 148265] },
  { name: "nippon india aggressive hybrid fund", plan: 'regular', codes: [112936, 147685, 148271] },
  { name: "nippon india conservative hybrid fund", plan: 'direct', codes: [118726, 148143, 148296] },
  { name: "nippon india conservative hybrid fund", plan: 'regular', codes: [102172, 148141, 148293] },
  { name: "nippon india credit risk fund", plan: 'direct', codes: [118780, 148101, 148261] },
  { name: "nippon india credit risk fund", plan: 'regular', codes: [112938, 112939, 148094, 148100, 148258, 148259] },
  { name: "nippon india equity savings fund", plan: 'direct', codes: [134594, 147697, 148274] },
  { name: "nippon india equity savings fund", plan: 'regular', codes: [134593, 147700, 148280] },
  { name: "nippon india gilt fund", plan: 'regular', codes: [109717, 109720] },
  { name: "nippon india liquid fund", plan: 'regular', codes: [100837, 100845, 100851] },
  { name: "nippon india medium term fund", plan: 'direct', codes: [130050, 148080, 148285] },
  { name: "nippon india medium term fund", plan: 'regular', codes: [130037, 148083, 148286] },
  { name: "nippon india multi cap fund", plan: 'regular', codes: [101161, 106253] },
  { name: "nippon india ultra short term fund", plan: 'direct', codes: [143494, 147675] },
  { name: "nippon india ultra short term fund", plan: 'regular', codes: [143493, 147674] },
  { name: "nippon india ultra short to short term fund", plan: 'regular', codes: [111748, 111753] },
  { name: "pgim india money market fund", plan: 'direct', codes: [148161, 152114] },
  { name: "pgim india money market fund", plan: 'regular', codes: [148159, 152122] },
  { name: "quant liquid fund", plan: 'direct', codes: [120837, 148510, 148512, 148513] },
  { name: "sbi gilt fund", plan: 'regular', codes: [101001, 101932, 101934] },
  { name: "sbi liquid fund", plan: 'regular', codes: [105274, 105280] },
  { name: "sbi short term fund", plan: 'regular', codes: [106227, 106231] },
  { name: "sbi ultra short to short term fund", plan: 'regular', codes: [106212, 106217] },
  { name: "shriram liquid fund", plan: 'direct', codes: [153035, 153280, 153281, 153282, 153283] },
  { name: "sundaram banking and psu debt fund", plan: 'direct', codes: [119625, 134363] },
  { name: "sundaram banking and psu debt fund", plan: 'regular', codes: [100784, 134356] },
  { name: "sundaram small cap fund", plan: 'direct', codes: [119588, 119589] },
  { name: "trustmf overnight fund", plan: 'direct', codes: [149797, 153520] },
  { name: "uti gilt fund", plan: 'regular', codes: [102510, 102512] },
  { name: "uti liquid fund", plan: 'regular', codes: [102009, 102012] },
  { name: "uti money market fund", plan: 'regular', codes: [100723, 112077] },
  { name: "uti regular saving fund", plan: 'regular', codes: [148104, 148105, 148106, 148108, 148109, 148111, 148112, 148115] },
  { name: "uti short term fund", plan: 'regular', codes: [106384, 106624] },
  { name: "uti ultra short term fund", plan: 'regular', codes: [102532, 112083] },
  { name: "uti ultra short to short term fund", plan: 'regular', codes: [102540, 102544] },
]

/**
 * Funds that currently resolve to a pinned same-name sibling rather than their own
 * code, measured on the 2026-09-01 universe. Locked so the ambiguity cannot grow
 * unnoticed: the pinned groups say which collisions are known, this says how many
 * of them production actually trips on.
 */
const AMBIGUOUS_BASELINE = 134

function ambiguityIndex(): Map<number, Set<number>> {
  const byCode = new Map<number, Set<number>>()
  for (const g of AMBIGUOUS_GROUPS) {
    const set = new Set(g.codes)
    for (const code of g.codes) byCode.set(code, set)
  }
  return byCode
}

test('pinned ambiguous groups still describe the universe', () => {
  const byCode = new Map(universeFunds.map(f => [f.code, f]))
  const problems: string[] = []
  for (const g of AMBIGUOUS_GROUPS) {
    for (const code of g.codes) {
      const f = byCode.get(code)
      if (!f) { problems.push(`  ${code} (${g.name}) left the universe`); continue }
      if (f.planType !== g.plan) problems.push(`  ${code} is ${f.planType}, pinned as ${g.plan}`)
      if (normalizeName(f.name) !== g.name) problems.push(`  ${code} normalizes to "${normalizeName(f.name)}", pinned as "${g.name}"`)
    }
  }
  assert.deepEqual(problems, [], `AMBIGUOUS_GROUPS is stale:\n${problems.join('\n')}`)
})

test('every universe fund self-matches except the documented known misses', () => {
  const siblings = ambiguityIndex()
  const totals = new Map<string, { exact: number; ambiguous: number; total: number }>()
  const wrongCode: string[] = []
  const unexpectedNull: string[] = []
  const staleAllowlist: string[] = []
  const ambiguousHits: string[] = []
  let total = 0
  let exact = 0

  for (const f of universeFunds) {
    const got = resolve(asStatementName(f.name, f.planType))
    const isExact = got === f.code
    const isSibling = got !== null && !isExact && (siblings.get(f.code)?.has(got) ?? false)
    const label = `  ${f.code} ${f.planType} ${f.name}`
    total++
    if (isExact) exact++
    else if (isSibling) ambiguousHits.push(`${label} -> ${got}`)

    if (KNOWN_MISSES.has(f.code)) {
      // The baseline is exact: a known miss must stay a null, and must not
      // quietly linger in the allowlist once production resolves it.
      if (got !== KNOWN_MISSES.get(f.code)) {
        staleAllowlist.push(`${label} -> ${got ?? 'null'} (allowlist expects null)`)
      }
    } else if (got === null) {
      unexpectedNull.push(`${label} -> null`)
    } else if (!isExact && !isSibling) {
      const other = universeFunds.find(u => u.code === got)
      wrongCode.push(`${label} -> ${got} ${other?.planType ?? '?'} ${other?.name ?? 'unknown code'}`)
    }

    const bucket = assetClass(f.amfiCategory)
    const agg = totals.get(bucket) ?? { exact: 0, ambiguous: 0, total: 0 }
    agg.total++
    if (isExact) agg.exact++
    if (isSibling) agg.ambiguous++
    totals.set(bucket, agg)
  }

  const exactPct = ((exact / total) * 100).toFixed(2)
  const lines = [
    `Universe self-match: exact ${exact}/${total} (${exactPct}pct), ambiguous-sibling ${ambiguousHits.length}, known misses ${KNOWN_MISSES.size}`,
    `  asset class  exact / ambiguous / total`,
  ]
  for (const [bucket, agg] of [...totals].sort((a, b) => b[1].total - a[1].total)) {
    lines.push(`  ${bucket.padEnd(11)} ${agg.exact} / ${agg.ambiguous} / ${agg.total}`)
  }
  if (ambiguousHits.length) lines.push('Resolved to a pinned same-name sibling:', ...ambiguousHits)
  console.log(lines.join('\n'))

  assert.deepEqual(wrongCode, [], `funds resolved to the WRONG code (repriced holdings):\n${wrongCode.join('\n')}`)
  assert.deepEqual(unexpectedNull, [], `funds no longer resolve at all (not in KNOWN_MISSES):\n${unexpectedNull.join('\n')}`)
  assert.deepEqual(staleAllowlist, [], `KNOWN_MISSES is out of date - update it with the new result:\n${staleAllowlist.join('\n')}`)
  assert.equal(ambiguousHits.length, AMBIGUOUS_BASELINE,
    `same-name ambiguity changed (baseline ${AMBIGUOUS_BASELINE}, now ${ambiguousHits.length}).` +
    ` Review the list above before re-baselining: a different code can price differently.`)
  assert.equal(exact + ambiguousHits.length + KNOWN_MISSES.size, total,
    `unaccounted results: exact ${exact} + ambiguous ${ambiguousHits.length} + known misses ${KNOWN_MISSES.size} != ${total}`)
})

test('curated self-match: marquee funds resolve to themselves exactly', () => {
  const marquee = [
    122639, 122640, 118955, 101762, 125354, 118778, 148519, 127042, 147622,
    120594, 120620, 149466, 149467, 135800, 135797, 147946, 147944, 120505,
    119775, 125307, 120828, 120841, 135781, 135784, 131061, 131051, 147736,
    118719, 118968, 100119, 148958, 152109, 143269, 119517, 118559, 146130,
    148925,
  ]
  const byCode = new Map(universeFunds.map(f => [f.code, f]))
  const misses: string[] = []
  for (const code of marquee) {
    const f = byCode.get(code)
    assert.ok(f, `curated code ${code} missing from universe`)
    const got = resolve(asStatementName(f.name, f.planType))
    if (got !== code) misses.push(`  ${code} ${f.planType} ${f.name} -> ${got ?? 'null'}`)
  }
  assert.equal(misses.length, 0, `${misses.length} curated funds did not self-match:\n${misses.join('\n')}`)
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
    scheme: 'quant Small Cap Fund - Direct Plan - Growth',
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
