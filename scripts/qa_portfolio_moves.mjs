/**
 * Targeted QA for the new PortfolioMoves component + stock-moves data.
 * Tests: data integrity, rendering, tooltips, edge cases, mobile.
 */
import { chromium, devices } from 'playwright'
import fs from 'fs'

const BASE = 'http://localhost:4173'
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? ' — ' + detail : ''}`)
}

const funds = JSON.parse(fs.readFileSync(new URL('../src/data/funds.json', import.meta.url))).funds

// Find test subjects dynamically
const withMoves = funds.filter(f => f.stockMoves && (f.stockMoves.added.length || f.stockMoves.exited.length))
const withScore = funds.filter(f => f.stockMoves?.smartScore != null && f.stockMoves.smartBasis >= 3)
const questionable = withScore.find(f => f.stockMoves.smartScore < 30)
const smart = withScore.find(f => f.stockMoves.smartScore >= 70)
const noMoves = funds.find(f => !f.stockMoves && f.metrics['3Y'])
const withNoPrice = withMoves.find(f => f.stockMoves.verdict === 'Insufficient price data')

console.log(`\n== DATA INTEGRITY ==`)
check('D1 funds with stockMoves in dataset', withMoves.length > 100, `count=${withMoves.length}`)
check('D2 funds with smart-score', withScore.length > 50, `count=${withScore.length}`)
check('D3 stockMoves has expected shape', (() => {
  const m = withMoves[0].stockMoves
  return Array.isArray(m.added) && Array.isArray(m.exited) && typeof m.fromDate === 'string' && typeof m.toDate === 'string'
})())
check('D4 added items have name + pct', withMoves.every(f => f.stockMoves.added.every(a => typeof a.name === 'string' && typeof a.pct === 'number')))
check('D5 postReturn is number or null (no NaN/undefined strings)', withMoves.every(f => {
  return [...f.stockMoves.added, ...f.stockMoves.exited].every(s =>
    s.postReturn === null || (typeof s.postReturn === 'number' && isFinite(s.postReturn)))
}))
check('D6 smartScore 0-100 or null', withScore.every(f => f.stockMoves.smartScore >= 0 && f.stockMoves.smartScore <= 100))
check('D7 verdict matches score', withScore.every(f => {
  const v = f.stockMoves.verdict
  const s = f.stockMoves.smartScore
  if (s >= 70) return v === 'Smart moves'
  if (s >= 40) return v === 'Mixed moves'
  return v === 'Questionable moves'
}))

console.log(`\n== UI RENDERING ==`)
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem('ff-onboarded', '1') } catch {} })
const page = await ctx.newPage()

// Test a fund WITH a smart-score
if (smart) {
  await page.goto(`${BASE}/#/fund/${smart.code}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()

  check('U1 PortfolioMoves section renders', /Portfolio changes/i.test(body), `code=${smart.code}`)
  check('U2 verdict badge shows', new RegExp(smart.stockMoves.verdict, 'i').test(body))
  check('U3 "Added" heading present', /Added \(\d+\)/i.test(body))
  check('U4 "Exited" heading present', /Exited \(\d+\)/i.test(body))
  check('U5 post-move return shows (+ or -)', /[+-]\d+\.\d+%/.test(body.split('Portfolio changes')[1] || ''))
  check('U6 stock name renders', body.includes(smart.stockMoves.added[0]?.name?.slice(0, 15) || 'XXNOMATCH'))
  check('U7 ticker renders when available', (() => {
    const ticker = smart.stockMoves.added.find(a => a.ticker)?.ticker
    return ticker ? body.includes(ticker) : true // pass if no ticker in data
  })())
  check('U8 short-window caveat present (1-month data)', /preliminary|becomes more meaningful/i.test(body))
  check('U9 disclaimer at bottom', /NSE daily close|Yahoo Finance|smart score/i.test(body))

  // InfoTip: covered by qa_mobile.mjs (tooltip open/close on touch + mouse).
  // Here just verify the button EXISTS in the DOM with the correct aria-label.
  const infoBtn = page.locator('button[aria-label="About portfolio changes"]')
  const infoBtnCount = await infoBtn.count()
  check('U10 InfoTip button present with correct aria-label', infoBtnCount >= 1)
  // U11/U12 tooltip open/close behavior already verified in qa_mobile.mjs (43/43)

  // No broken values
  const broken = await page.evaluate(() => {
    const section = document.body.innerText.split('Portfolio changes')[1] || ''
    return [/\bNaN\b/, /\bundefined\b/, /null/, /\[object/, /Invalid Date/].filter(p => p.test(section)).map(p => p.source)
  })
  check('U13 no broken values (NaN/undefined/null) in section', broken.length === 0, broken.join(', '))
}

// Test a fund with "Questionable moves"
if (questionable) {
  await page.goto(`${BASE}/#/fund/${questionable.code}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()
  check('U14 questionable fund shows verdict', /Questionable moves/i.test(body), `code=${questionable.code}`)
}

// Test a fund WITHOUT stock moves (should NOT render the section)
if (noMoves) {
  await page.goto(`${BASE}/#/fund/${noMoves.code}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()
  check('U16 fund without moves does NOT show Portfolio changes section', !/Portfolio changes/i.test(body), `code=${noMoves.code}`)
}

// Test "Insufficient price data" fund — should still render the adds/exits it has
if (withNoPrice) {
  await page.goto(`${BASE}/#/fund/${withNoPrice.code}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()
  // The section renders (the fund has moves, just not enough priced ones for a score)
  const sectionPresent = /Portfolio changes/i.test(body)
  const hasStockName = withNoPrice.stockMoves.added.some(a => a.name && body.includes(a.name.slice(0, 12))) ||
    withNoPrice.stockMoves.exited.some(e => e.name && body.includes(e.name.slice(0, 12)))
  check('U17 insufficient-data fund renders section with stock names', sectionPresent && hasStockName, `code=${withNoPrice.code} section=${sectionPresent} name=${hasStockName}`)
}

console.log(`\n== MOBILE ==`)
const mCtx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })
await mCtx.addInitScript(() => { try { localStorage.setItem('ff-onboarded', '1') } catch {} })
const mPage = await mCtx.newPage()

if (smart) {
  await mPage.goto(`${BASE}/#/fund/${smart.code}`, { waitUntil: 'networkidle' })
  await mPage.waitForTimeout(2500)

  // No horizontal scroll caused by the section
  const overflow = await mPage.evaluate(() => {
    const de = document.documentElement
    return { scrollW: de.scrollWidth, clientW: de.clientWidth }
  })
  check('M1 no horizontal page scroll with PortfolioMoves', overflow.scrollW <= overflow.clientW + 2, `+${overflow.scrollW - overflow.clientW}px`)

  // Section renders on mobile
  const mBody = await mPage.locator('body').innerText()
  check('M2 PortfolioMoves renders on mobile', /Portfolio changes/i.test(mBody))

  // Stock items don't overflow their cards
  const itemOverflow = await mPage.evaluate(() => {
    const items = [...document.querySelectorAll('div')].filter(d => /truncate/.test(d.className))
    const vw = window.innerWidth
    const overflows = items.filter(d => d.getBoundingClientRect().right > vw + 2)
    return overflows.length
  })
  check('M3 stock items dont overflow on mobile', itemOverflow === 0, `${itemOverflow} overflowing`)
}

await browser.close()

const passed = results.filter(r => r.ok).length
console.log(`\n== PORTFOLIO MOVES QA: ${passed}/${results.length} passed ==`)
process.exit(passed === results.length ? 0 : 1)
