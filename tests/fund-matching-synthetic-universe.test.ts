/**
 * Fund-matching behaviour of the REAL production parser over a SYNTHETIC,
 * frozen matcher universe.
 *
 * Run: node tests/run-regressions.mjs tests/fund-matching-synthetic-universe.test.ts
 *
 * The expected codes here used to be pinned to live AMFI scheme identities and
 * a live ambiguity count, so a daily universe rebuild (rename, delisting, new
 * same-name scheme) could fail the gate with no parser defect. The universe is
 * replaced in place before the first parse (the parser builds its index lazily),
 * so every assertion below is deterministic. Each test file runs in its own
 * process, so this cannot leak into fund-matching.test.ts, which checks the
 * parser against whatever the CURRENT universe contains.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { MATCHER_VERSION, parseCAMSText } from '../src/lib/camsParser'
import { universeFunds } from '../src/lib/matcherUniverse'
import { resolve, statement } from './fund-matching-fixture-helpers'

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

// ---- Synthetic universe ------------------------------------------------

type Plan = 'direct' | 'regular'
const catFor = (name: string) =>
  /index|etf/i.test(name) ? 'Other Scheme - Index Funds'
    : /gilt|overnight|money market|liquid|debt/i.test(name) ? 'Open Ended Schemes(Income/Debt Oriented Schemes - Gilt Fund)'
    : /hybrid|balanced|arbitrage/i.test(name) ? 'Open Ended Schemes(Hybrid Scheme - Balanced Hybrid Fund)'
    : 'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)'
const synthetic = new Map<number, { code: number; name: string; plan: Plan }>()
function addScheme(code: number, name: string, plan: Plan): void {
  if (!synthetic.has(code)) synthetic.set(code, { code, name, plan })
}
for (const c of ALL_CASES) if (c.code !== null) addScheme(c.code, c.name!, c.plan!)
// Distractors: siblings that must not steal a match.
addScheme(125350, 'Axis Small Cap Fund', 'regular')
addScheme(120506, 'Axis Midcap Fund', 'regular')
addScheme(118779, 'Nippon India Small Cap Fund', 'regular')
addScheme(119776, 'Kotak Mid Cap Fund', 'regular')
addScheme(120829, 'Quant Small Cap Fund', 'regular')
for (const g of [
  { name: 'SBI Gilt Fund', plan: 'regular' as Plan, codes: [101001, 101932, 101934] },
  { name: 'Sundaram Small Cap Fund', plan: 'direct' as Plan, codes: [119588, 119589] },
]) for (const code of g.codes) addScheme(code, g.name, g.plan)
universeFunds.splice(0, universeFunds.length, ...[...synthetic.values()].map(s => ({
  code: s.code, name: s.name, amc: s.name.split(' ')[0], amfiCategory: catFor(s.name), planType: s.plan, optionType: 'growth',
})))

// ---- Tests -------------------------------------------------------------

test('synthetic universe is installed and every expected code is in it with its plan', () => {
  const byCode = new Map(universeFunds.map(f => [f.code, f]))
  let checked = 0
  for (const c of ALL_CASES) {
    if (c.code === null) continue
    checked++
    assert.equal(byCode.get(c.code)?.planType, c.plan, `fixture ${c.code}`)
  }
  assert.ok(checked > 40)
  assert.equal(universeFunds.length, synthetic.size)
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
 * Synthetic same-name groups (same normalized name + plan, several codes), as
 * AMCs produce when they merge or re-register a scheme. Resolving to a sibling
 * inside the group is tolerated and counted; resolving anywhere else is not.
 */
const AMBIGUOUS_GROUPS: { name: string; plan: 'direct' | 'regular'; codes: number[] }[] = [
  { name: 'sbi gilt fund', plan: 'regular', codes: [101001, 101932, 101934] },
  { name: 'sundaram small cap fund', plan: 'direct', codes: [119588, 119589] },
]

/** Sibling resolutions the fixture produces: every member of a group but the one the matcher prefers. */
const AMBIGUOUS_BASELINE = AMBIGUOUS_GROUPS.reduce((n, g) => n + g.codes.length - 1, 0)

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

test('curated self-match: every unambiguous fixture code resolves to itself exactly', () => {
  const grouped = new Set(AMBIGUOUS_GROUPS.flatMap(g => g.codes))
  const byCode = new Map(universeFunds.map(f => [f.code, f]))
  const misses: string[] = []
  let checked = 0
  for (const c of ALL_CASES) {
    if (c.code === null || grouped.has(c.code)) continue
    const f = byCode.get(c.code)
    assert.ok(f, `fixture code ${c.code} missing from the synthetic universe`)
    checked++
    const got = resolve(asStatementName(f.name, f.planType))
    if (got !== c.code) misses.push(`  ${c.code} ${f.planType} ${f.name} -> ${got ?? 'null'}`)
  }
  assert.ok(checked > 40, `only ${checked} fixture codes checked`)
  assert.equal(misses.length, 0, `${misses.length} fixture funds did not self-match:\n${misses.join('\n')}`)
})
