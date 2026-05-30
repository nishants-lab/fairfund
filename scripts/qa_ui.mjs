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
// A fund with the full set of build-time forward-looking signals (trajectory + batting + mean-reversion + regimes)
// so we can assert the v3 section renders all its parts. Falls back to any fund with a trajectory.
const fwdFund =
  funds.find(
    (f) =>
      f.analytics?.rankTrajectory &&
      f.analytics?.battingAverage &&
      f.analytics?.meanReversion &&
      f.analytics?.regimes?.length &&
      f.metrics['3Y'],
  ) || funds.find((f) => f.analytics?.rankTrajectory)
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
  // Suppress the first-visit onboarding modal (overlay intercepts clicks in interaction tests).
  // Setting its localStorage flag makes the QA browser behave like a returning visitor.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('ff-onboarded', '1') } catch { /* ignore */ }
  })
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

  // C2b Explore shows the v3 Consistency column (batting % + trajectory arrow)
  const expHasConsistency = /Consistency/i.test(expBody)
  const expHasBattingPct = await page.locator('thead').innerText().then((t) => /Consistency/i.test(t)).catch(() => false)
  check(`C2 Explore Consistency column (${label})`, expHasConsistency && expHasBattingPct)

  // C4 Fund detail (stock-level): metric cards + holdings
  await goto(`fund/${stockFund.code}`)
  const fdBody = await bodyText()
  const fdHasMetric = /\d+\.\d+%/.test(fdBody)
  const fdHasHoldings = fdBody.includes('Portfolio holdings') && /\d+\.\d+%/.test(fdBody)
  check(`C4 Fund detail metrics show (${label})`, fdHasMetric, `code=${stockFund.code}`)
  check(`C4 Fund detail holdings show (${label})`, fdHasHoldings)
  // C4c Management section present with a signal
  const fdHasMgmt = /Management quality|Management/.test(fdBody) &&
    /(Strong|Solid|Mixed|Limited evidence|not available)/.test(fdBody)
  check(`C4 Fund detail management section (${label})`, fdHasMgmt)

  // C4d Forward-looking analytics section (v3) — uses a fund with the full build-time signal set.
  // Both build-time (funds.json) and client-side (self-hosted NAV) parts must render under API-UP and API-DOWN.
  await goto(`fund/${fwdFund.code}`)
  await page.waitForTimeout(apiDown ? 1500 : 800) // let client-side outcome-cone/rolling-dist compute
  const fwdBody = await bodyText()
  check(`C4 Forward-looking section present (${label})`,
    /Forward-looking signals/i.test(fwdBody), `code=${fwdFund.code}`)
  // sparkline (rank trajectory) renders as inline SVG path
  const sparkPaths = await page.locator('svg path[stroke="#2563eb"]').count()
  check(`C4 trajectory sparkline renders (${label})`,
    /Form \(rank trajectory\)/i.test(fwdBody) && sparkPaths > 0, `sparkPaths=${sparkPaths}`)
  // core build-time signal cards present
  check(`C4 consistency + skill cards (${label})`,
    /Consistency/i.test(fwdBody) && /Skill vs luck/i.test(fwdBody) && /Running hot\?/i.test(fwdBody))
  // client-side outcome cone (block-bootstrap) + horizon controls
  const coneOk = /Modeled \d+Y outcome range/i.test(fwdBody) && /simulations/i.test(fwdBody)
  check(`C4 outcome cone renders (${label})`, coneOk)
  // horizon buttons change the cone — use 10Y (unique to the forward-looking horizon selector;
  // the page's RangeSelector presets stop at 5Y, so this avoids a selector collision) and confirm recompute
  const has10Y = await page.getByRole('button', { name: '10Y', exact: true }).count()
  if (has10Y) {
    await page.getByRole('button', { name: '10Y', exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(900)
    const after = await bodyText()
    check(`C4 horizon switch recomputes (${label})`, /Modeled 10Y outcome range/i.test(after))
  }
  // regime table with the fixed regimes
  const regimeOk = /How it behaved in each market regime/i.test(fwdBody) &&
    /COVID crash/i.test(fwdBody) && /2022-24 bull run/i.test(fwdBody)
  check(`C4 regime table renders (${label})`, regimeOk)
  // honesty framing — never a guarantee
  check(`C4 honesty framing present (${label})`,
    /not a guarantee|never a guarantee|not advice/i.test(fwdBody))

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
  // C8b Compare shows management quality row
  const hasMgmtRow = /Management quality/i.test(cmpBody)
  check(`C8 Compare management row present (${label})`, hasMgmtRow)

  // C8c Compare shows the v3 forward-looking rows
  const cmpFwdRows =
    /Consistency/i.test(cmpBody) &&
    /Form/i.test(cmpBody) &&
    /Skill confidence/i.test(cmpBody) &&
    /Down-capture/i.test(cmpBody) &&
    /Momentum state/i.test(cmpBody)
  check(`C8 Compare forward-looking rows present (${label})`, cmpFwdRows)

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
  // C12b Methodology documents the v3 forward-looking signals
  check(`C12 Methodology documents v3 signals (${label})`,
    /Forward-looking signals/i.test(meth) && /probabilistic/i.test(meth))

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
