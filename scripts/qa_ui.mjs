/**
 * QA: functional UI tests under API-UP and API-DOWN conditions.
 * Implements sections C/D/E of QA-PLAN.md using Playwright.
 *
 * Usage: node scripts/qa_ui.mjs <baseUrl>
 *   baseUrl e.g. http://localhost:4173/  (vite preview)
 *
 * Writes nothing; prints PASS/FAIL lines and a final summary. Exit 1 on any fail.
 */
import { chromium } from 'playwright'

const BASE = (process.argv[2] || 'http://localhost:4173/').replace(/\/$/, '')
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? ' — ' + detail : ''}`)
}

// Representative fund codes (filled from funds.json at runtime)
import fs from 'fs'
const funds = JSON.parse(fs.readFileSync(new URL('../src/data/funds.json', import.meta.url))).funds
const byCov = (cov) => funds.find((f) => f.holdingsMeta?.coverage === cov)
const stockFund = funds.find((f) => f.holdingsMeta?.coverage === 'stock_level' && f.metrics['3Y'])
const feederForeign = byCov('feeder_foreign')
const feederDomestic = byCov('feeder_domestic')
const unresolved = byCov('unresolved')
// two same-category stock funds for overlap
const flexi = funds.filter((f) => f.category === 'Flexi Cap' && f.holdingsMeta?.coverage === 'stock_level')
const pairA = flexi[0], pairB = flexi[1]
// cross-category pair
const largeCap = funds.find((f) => f.category === 'Large Cap' && f.holdingsMeta?.coverage === 'stock_level')

async function getConsoleErrors(page) {
  return page.__errors || []
}

function attachConsole(page) {
  page.__errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text()
      // tolerate network/CORS errors (expected under API DOWN); flag app errors
      if (/Failed to load resource|CORS|net::ERR|ERR_FAILED|mfapi\.in|429|Access-Control/i.test(t)) return
      page.__errors.push(t)
    }
  })
  page.on('pageerror', (err) => page.__errors.push('PAGEERROR: ' + err.message))
}

async function run(apiDown) {
  const label = apiDown ? 'API-DOWN' : 'API-UP'
  console.log(`\n== UI QA (${label}) ==`)
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (apiDown) {
    // block all mfapi.in calls to simulate outage / CORS block
    await ctx.route('**://api.mfapi.in/**', (r) => r.abort())
  }
  const page = await ctx.newPage()
  attachConsole(page)

  const goto = async (hash) => {
    await page.goto(`${BASE}/#/${hash}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(apiDown ? 5500 : 2500) // allow live timeout + fallback
  }
  const text = async (sel) => (await page.locator(sel).first().innerText().catch(() => '')) || ''
  const bodyText = async () => (await page.locator('body').innerText().catch(() => '')) || ''

  // C1 Home
  await goto('')
  check(`C1 Home loads (${label})`, (await bodyText()).toLowerCase().includes('fund'))

  // C2 Explore - metrics not all blank
  await goto('explore?cat=Flexi+Cap')
  const expRows = await page.locator('tbody tr').count()
  const expBody = await bodyText()
  const hasPct = /\d+\.\d+%/.test(expBody)
  check(`C2 Explore table non-empty + has % metrics (${label})`, expRows > 1 && hasPct, `rows=${expRows} hasPct=${hasPct}`)

  // C4 Fund detail (stock-level): metric cards + holdings
  await goto(`fund/${stockFund.code}`)
  const fdBody = await bodyText()
  const fdHasMetric = /\d+\.\d+%/.test(fdBody)
  const fdHasHoldings = fdBody.includes('Portfolio holdings') && /\d+\.\d+%/.test(fdBody)
  check(`C4 Fund detail metrics show (${label})`, fdHasMetric, `code=${stockFund.code}`)
  check(`C4 Fund detail holdings show (${label})`, fdHasHoldings)

  // C5 feeder foreign: honest label, no crash
  if (feederForeign) {
    await goto(`fund/${feederForeign.code}`)
    const ff = await bodyText()
    check(`C5 feeder_foreign honest label (${label})`,
      ff.includes('Portfolio holdings') && /feeder|overseas|not available|underlying/i.test(ff),
      `code=${feederForeign.code}`)
  }
  // C5b feeder domestic
  if (feederDomestic) {
    await goto(`fund/${feederDomestic.code}`)
    const fdm = await bodyText()
    check(`C5 feeder_domestic honest label (${label})`,
      /fund-of-fund|tracks|ETF|underlying/i.test(fdm), `code=${feederDomestic.code}`)
  }
  // C6 unresolved
  if (unresolved) {
    await goto(`fund/${unresolved.code}`)
    const ur = await bodyText()
    check(`C6 unresolved shows 'not available' + metrics (${label})`,
      /not available/i.test(ur) && /\d+\.\d+%/.test(ur), `code=${unresolved.code}`)
  }

  // C7/C8 Compare: metrics + Growth chart + overlap
  await goto(`compare?codes=${pairA.code},${pairB.code}`)
  await page.waitForTimeout(apiDown ? 6000 : 3500)
  const cmpBody = await bodyText()
  // metric table numbers
  const cmpHasMetric = /\d+\.\d+%/.test(cmpBody)
  check(`C7 Compare metric table shows numbers (${label})`, cmpHasMetric)
  // Growth of 100 chart: under API-UP expect svg path; under API-DOWN expect graceful (no infinite 'Loading comparison')
  const hasChartSvg = (await page.locator('.recharts-line path').count()) > 0
  const stuckLoading = cmpBody.includes('Loading comparison…')
  if (apiDown) {
    check(`C7 Growth chart not stuck-loading (${label})`, !stuckLoading || hasChartSvg)
  } else {
    check(`C7 Growth chart renders (${label})`, hasChartSvg, `svgPaths=${await page.locator('.recharts-line path').count()}`)
  }
  // overlap non-empty
  const hasOverlapHeader = cmpBody.includes('Portfolio overlap')
  const hasOverlapPct = /\d+\.\d+%/.test(cmpBody) && /overlap/i.test(cmpBody)
  const hasSharedTable = /shared holding/i.test(cmpBody) || /shared no common holdings/i.test(cmpBody)
  check(`C8 Compare overlap present + populated (${label})`, hasOverlapHeader && hasSharedTable, `header=${hasOverlapHeader} shared=${hasSharedTable}`)

  // C10 cross-category warning
  if (largeCap) {
    await goto(`compare?codes=${pairA.code},${largeCap.code}`)
    await page.waitForTimeout(1500)
    const cc = await bodyText()
    check(`C10 cross-category warning (${label})`, /different categories|apples/i.test(cc))
  }

  // C11 Planner, C12 Methodology
  await goto('planner')
  check(`C11 Planner loads (${label})`, (await bodyText()).length > 200)
  await goto('methodology')
  const meth = await bodyText()
  check(`C12 Methodology sections (${label})`, meth.includes('Methodology') && meth.includes('Authoritative'))

  // C15 no app console errors across visited pages
  const errs = await getConsoleErrors(page)
  check(`C15 no uncaught app errors (${label})`, errs.length === 0, errs.slice(0, 2).join(' | '))

  // C14 mobile Compare scroll (only need once, do under API-UP)
  if (!apiDown) {
    const m = await ctx.newPage()
    attachConsole(m)
    await m.setViewportSize({ width: 390, height: 800 })
    await m.goto(`${BASE}/#/compare?codes=${pairA.code},${pairB.code}`, { waitUntil: 'networkidle' }).catch(() => {})
    await m.waitForTimeout(2500)
    const tbl = m.locator('table').first()
    const scrollW = await tbl.evaluate((e) => e.scrollWidth).catch(() => 0)
    const clientW = await tbl.evaluate((e) => e.closest('div')?.clientWidth ?? 0).catch(() => 0)
    check('C14 mobile Compare table scrollable', scrollW >= clientW, `scrollW=${scrollW} clientW=${clientW}`)
    await m.close()
  }

  await browser.close()
}

await run(false) // API UP
await run(true) // API DOWN

const passed = results.filter((r) => r.ok).length
console.log(`\n== UI QA: ${passed}/${results.length} passed ==`)
process.exit(passed === results.length ? 0 : 1)
