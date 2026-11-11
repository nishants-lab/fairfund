/**
 * Fund-matching tests against the REAL production parser and the CURRENT
 * shipped universe (src/data/matcher_universe.json + funds.json).
 *
 * Nothing here pins a live scheme code, name or ambiguity count: a daily AMFI
 * rebuild may rename, add or retire schemes without failing this file. What is
 * asserted are invariants that must hold for whatever the universe contains:
 *   - every universe scheme, printed as a CAS prints it, resolves to its own
 *     code, or to a member of its CURRENT same-name/same-plan group - never to
 *     a different scheme, another plan, or nothing;
 *   - every analytics-index (funds.json) scheme with a unique identity
 *     resolves EXACTLY to itself.
 * Specific behaviours (Direct vs Regular, active vs index siblings, renamed
 * schemes, RTA prefixes, unmatchable names, deliberate same-name groups) are
 * pinned on a frozen synthetic universe in
 * fund-matching-synthetic-universe.test.ts.
 *
 * Run: node tests/run-regressions.mjs tests/fund-matching.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { isNonEquityScheme, parseCAMSText } from '../src/lib/camsParser'
import { universeFunds } from '../src/lib/matcherUniverse'
import { funds } from '../src/lib/data'
import { resolve, statement } from './fund-matching-fixture-helpers'

function normalizeName(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/flexicap/gi, 'flexi cap').replace(/multicap/gi, 'multi cap')
    .replace(/midcap/gi, 'mid cap').replace(/smallcap/gi, 'small cap')
    .replace(/largecap/gi, 'large cap').replace(/microcap/gi, 'micro cap')
    .replace(/[^a-z0-9]+/gi, ' ').replace(/\s{2,}/g, ' ').trim()
    .toLowerCase()
}

/** Render a universe fund the way a CAS prints that holding. */
function asStatementName(name: string, plan: 'direct' | 'regular'): string {
  const planWords = plan === 'direct' ? 'Direct Plan - Growth' : 'Regular Plan - Growth'
  return /\b(direct|regular)\b/i.test(name) ? name : `${name} - ${planWords}`
}

/** Current same-name, same-plan groups: the schemes a statement name cannot tell apart. */
const groupKey = (f: { name: string; planType: string }) => `${f.planType}|${normalizeName(f.name)}`
const groups = new Map<string, number[]>()
for (const f of universeFunds) groups.set(groupKey(f), [...(groups.get(groupKey(f)) ?? []), f.code])
const byCode = new Map(universeFunds.map(f => [f.code, f]))

test('every analytics-index scheme is in the matcher universe and resolves exactly to itself unless it shares a name', () => {
  assert.ok(funds.length > 0, 'funds.json must not be empty')
  const problems: string[] = []
  let exactChecked = 0
  let grouped = 0
  for (const x of funds) {
    const u = byCode.get(x.code)
    if (!u) { problems.push(`  ${x.code} ${x.name} is indexed but missing from the matcher universe`); continue }
    const siblings = groups.get(groupKey(u))!
    const got = resolve(asStatementName(u.name, u.planType))
    if (siblings.length === 1) {
      exactChecked++
      if (got !== x.code) problems.push(`  ${x.code} ${u.name} -> ${got ?? 'null'}`)
    } else {
      grouped++
      if (got === null || !siblings.includes(got)) problems.push(`  ${x.code} ${u.name} -> ${got ?? 'null'} (outside its same-name group)`)
    }
  }
  console.log(`indexed schemes: ${funds.length}; exact-checked ${exactChecked}; same-name-group ${grouped} (reported, no floor)`)
  assert.equal(exactChecked + grouped + problems.filter(p => p.includes('missing')).length, funds.length, 'every indexed scheme must be accounted for')
  assert.deepEqual(problems, [], `indexed schemes resolved wrongly:\n${problems.join('\n')}`)
})

test('every universe fund resolves to itself or its current same-name sibling, on its own plan', () => {
  const wrong: string[] = []
  const unresolved: string[] = []
  const wrongPlan: string[] = []
  let exact = 0
  let sibling = 0
  for (const f of universeFunds) {
    const got = resolve(asStatementName(f.name, f.planType))
    const label = `  ${f.code} ${f.planType} ${f.name}`
    if (got === null) { unresolved.push(`${label} -> null`); continue }
    if (got === f.code) { exact++; continue }
    const g = byCode.get(got)
    if (g && groupKey(g) === groupKey(f)) { sibling++; continue }
    wrong.push(`${label} -> ${got} ${g?.planType ?? '?'} ${g?.name ?? 'unknown code'}`)
    if (g && g.planType !== f.planType) wrongPlan.push(label)
  }
  console.log(`Universe self-match: exact ${exact}/${universeFunds.length}, same-name sibling ${sibling} (reported, not budgeted)`)
  assert.ok(universeFunds.length > 0, 'matcher universe must not be empty')
  assert.deepEqual(wrongPlan, [], `plan words crossed:\n${wrongPlan.join('\n')}`)
  assert.deepEqual(wrong, [], `funds resolved to a DIFFERENT scheme (repriced holdings):\n${wrong.join('\n')}`)
  assert.deepEqual(unresolved, [], `funds no longer resolve at all:\n${unresolved.join('\n')}`)
  assert.equal(exact + sibling, universeFunds.length)
})

// ---- History-usability flag --------------------------------------------
//
// These assert only the flag the parser sets on the block. The return itself is
// computed elsewhere; the point here is that an unpriceable row is declared as
// such at parse time instead of reaching the maths as if it were cash.

const PURCHASE_ROW = '01-Apr-2024 Purchase 100000.00 100.0000 1000.000 1000.000'

function parseRows(rows: string[]): boolean | undefined {
  const parsed = parseCAMSText(statement([{
    scheme: 'Fixture Alpha Flexi Cap Fund - Direct Plan - Growth',
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
    { scheme: 'Fixture Alpha Flexi Cap Fund - Direct Plan - Growth', rows: [PURCHASE_ROW] },
    {
      scheme: 'Fixture Beta Flexi Cap Fund - Direct Plan - Growth',
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
    'Fixture Beta Flexi Cap Fund - Direct Plan - Growth',
    'Nippon India Nifty Smallcap 250 Index Fund - Direct Plan - Growth',
  ]) {
    assert.equal(isNonEquityScheme(name), false, name)
  }
})
