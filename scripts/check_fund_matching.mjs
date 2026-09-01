/**
 * Fund-matching acceptance test (CI + local).
 *
 * MUST MIRROR matchFundCode() in src/lib/camsParser.ts. If you change the
 * matching algorithm there, update the same logic here. The golden fixture
 * below is seeded from a real CAMS statement whose active funds each have a
 * same-named INDEX sibling in the universe - the exact case that used to
 * mis-resolve (active fund -> its index/large&mid sibling) and undervalue a
 * portfolio by ~25%.
 *
 * Run: node scripts/check_fund_matching.mjs   (exits non-zero on any miss)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const funds = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/funds.json'), 'utf8')).funds
const idx = funds.map(f => ({ code: f.code, searchable: (f.fullName ?? f.name).toLowerCase() }))

const FILLER = new Set(['fund','direct','regular','plan','growth','option','idcw','payout',
  'reinvestment','dividend','income','distribution','cum','withdrawal','the','and','india',
  'scheme','open','ended'])
const NON_EQ = /\b(gilt|liquid|overnight|money\s*market|ultra\s*short|low\s*duration|short\s*duration|medium\s*duration|long\s*duration|corporate\s*bond|credit\s*risk|dynamic\s*bond|banking\s*(&|and)\s*psu|floating\s*rate|floater|g-?sec|treasury|debt|bond|fixed\s*maturity|fmp|savings\s*fund|arbitrage|balanced\s*advantage|equity\s*savings|conservative\s*hybrid|multi\s*asset|asset\s*allocation|retirement|children)\b/i
const IDX_RE = /\b(index|nifty|sensex|bse)\b/

function normalizeForMatch(s) {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/flexicap/gi, 'flexi cap').replace(/multicap/gi, 'multi cap')
    .replace(/midcap/gi, 'mid cap').replace(/smallcap/gi, 'small cap')
    .replace(/largecap/gi, 'large cap').replace(/microcap/gi, 'micro cap')
    .replace(/[^a-z0-9]+/gi, ' ').replace(/\s{2,}/g, ' ').trim()
}

function matchFundCode(schemeName) {
  if (NON_EQ.test(schemeName)) return null
  const q = normalizeForMatch(
    schemeName.toLowerCase()
      .replace(/^[a-z0-9]{5,}\s*-\s*/i, '')
      .replace(/\s*-?\s*isin\s*:.*/i, '')
      .replace(/\s*-?\s*advisor\s*:.*/i, '')
      .replace(/\s*-?\s*registrar\s*:.*/i, ''))
  const qAmc = q.split(/\s+/)[0] ?? ''
  const qIsIndex = IDX_RE.test(q)
  let best = null, bestScore = 0
  for (const f of idx) {
    const hay = normalizeForMatch(f.searchable)
    if (hay.includes(q) || q.includes(hay)) {
      let score = Math.min(q.length, hay.length) / Math.max(q.length, hay.length)
      if (hay.startsWith(qAmc)) score += 0.1
      if (score > bestScore) { bestScore = score; best = f }
    }
  }
  if (best && bestScore > 0.5) return best.code
  const qTokens = new Set(q.split(/\s+/).filter(t => t.length > 2 && !FILLER.has(t)))
  best = null; bestScore = 0
  for (const f of idx) {
    const hay = normalizeForMatch(f.searchable)
    const fTokens = new Set(hay.split(/\s+/).filter(t => t.length > 0 && !FILLER.has(t)))
    let overlap = 0
    qTokens.forEach(t => { if (fTokens.has(t)) overlap++ })
    const union = new Set([...qTokens, ...fTokens]).size
    let score = overlap / Math.max(union, 1)
    if (hay.startsWith(qAmc)) score += 0.1
    if (IDX_RE.test(hay) !== qIsIndex) score -= 0.5
    if (score > bestScore) { bestScore = score; best = f }
  }
  return bestScore >= 0.45 ? (best?.code ?? null) : null
}

// Golden fixture: [statement scheme name, expected code | null]
const CASES = [
  ['Aditya Birla Sun Life International Equity Fund - Growth - Direct Plan', 119517],
  ['Axis Mid Cap Fund - Direct Growth', 120505],
  ['Axis NIFTY Next 50 Index Fund Direct Growth', 149466],
  ['Axis Small Cap Fund Direct Growth', 125354],
  ['Bandhan Small Cap Fund - Direct Plan - Growth', 147946],
  ['Canara Robeco Small Cap Fund - Direct Growth', 146130],
  ['Franklin Asian Equity Fund - Direct Plan - Growth', 118559],
  ['ICICI Prudential Technology Fund - Direct Plan - Growth', 120594],
  ['ICICI Prudential 10 year Constant Maturity Gilt Fund - Direct Plan - Growth', null],
  ['Kotak Mid Cap Fund Direct Growth', 119775],
  ['Mirae Asset Overnight Fund - Direct Plan ( Demat )', null],
  ['Mirae Asset ELSS Tax Saver Fund ( formerly Mirae Asset Tax Saver Fund ) - Direct Plan', 135781],
  ['Motilal Oswal Midcap Fund - Direct Plan Growth', 127042],
  ['RMFLQAGG - NIPPON INDIA MONEY MARKET FUND - DIRECT GROWTH PLAN GROWTH OPTION', null],
  ['PGIM India Midcap Fund - Direct Plan - Growth', 125307],
  ['Parag Parikh Flexi Cap Fund - Direct Plan Growth ( formerly Parag Parikh Long Term Value Fund )', 122639],
  ['quant Small Cap Fund - Direct Plan - Growth', 120828],
  ['quant Mid Cap Fund - Direct Plan - Growth', 120841],
  ['quant Quantamental Fund - Direct Plan - Growth', 148925],
  ['TDIFGZ - Tata Digital India Fund Direct Plan Growth', 135800],
]

let fails = 0
for (const [name, exp] of CASES) {
  const got = matchFundCode(name)
  if (got !== exp) {
    fails++
    console.log(`FAIL  ${name.slice(0, 55)}  expected ${exp} got ${got}`)
  }
}
// Regression guard: most funds must still resolve to their own code.
let self = 0, total = 0
for (const f of funds) {
  const nm = f.fullName ?? f.name
  if (NON_EQ.test(nm)) continue
  total++
  if (matchFundCode(nm) === f.code) self++
}
const selfPct = (self / total) * 100
console.log(`Portfolio fixture: ${CASES.length - fails}/${CASES.length} passed`)
console.log(`Self-match regression: ${self}/${total} (${selfPct.toFixed(1)}%)`)
if (fails > 0 || selfPct < 98) {
  console.error(`\nFund matching check FAILED (fixture fails=${fails}, self-match=${selfPct.toFixed(1)}%)`)
  process.exit(1)
}
console.log('\nFund matching check PASSED')
