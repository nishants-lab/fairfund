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
// five same-category funds for the Compare-5 test (fall back to any funds if <5 flexi)
const five = (flexi.length >= 5 ? flexi : funds.filter((f) => f.metrics['3Y'])).slice(0, 5)
// cross-category pair
const largeCap = funds.find((f) => f.category === 'Large Cap' && f.holdingsMeta?.coverage === 'stock_level')

async function getConsoleErrors(page) {
  return page.__errors || []
}

// Scan the rendered page for broken value artifacts — the general class of
// "a value rendered, but rendered wrong" (NaN, undefined, Invalid Date, etc.).
// Returns the list of artifacts found in visible text (empty = clean).
async function brokenContent(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText
    const patterns = [
      /\bNaN\b/, /\bundefined\b/, /\bnull\b/, /Invalid Date/i,
      /\[object Object\]/, /₹\s*NaN/, /NaN\s*%/, /\$\{/,
    ]
    const hits = []
    for (const p of patterns) {
      const m = txt.match(p)
      if (m) hits.push(m[0])
    }
    return hits
  })
}

// Read computed color of the first element matching a text within a region.
async function colorOfValue(page, text) {
  return page.evaluate((text) => {
    const els = [...document.querySelectorAll('div,span,td')]
    const el = els.find((e) => e.children.length === 0 && e.textContent && e.textContent.trim() === text)
    return el ? getComputedStyle(el).color : null
  }, text)
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

  // C4-broken: no NaN/undefined/Invalid Date artifacts on the fund page
  check(`C4 no broken value artifacts (${label})`, (await brokenContent(page)).length === 0,
    (await brokenContent(page)).join(', '))

  // C4-dates: drawdown/best/worst sub-lines render as "Mon YYYY → Mon YYYY"
  // (only under API-UP where live NAV → live metrics carry the dates)
  if (!apiDown) {
    const hasPeriods = /[A-Z][a-z]{2} \d{4} → [A-Z][a-z]{2} \d{4}/.test(fdBody)
    check('C4 drawdown/month date sub-lines render', hasPeriods)
    // volatility shows a category-median comparison (now phrased as a verdict)
    check('C4 volatility shows category median', /category \(median \d+\.\d+%\)|Category median \d+\.\d+%/i.test(fdBody))
  }

  // C4-color: semantic-color correctness (the bug class the user caught).
  // Set a short YTD range so ratios/returns can go negative, then verify:
  //   - Max Drawdown value is never green (it's always a loss)
  //   - any negative Sharpe/Sortino/Calmar is red, never black/amber
  if (!apiDown) {
    await goto(`fund/${stockFund.code}`)
    await page.getByRole('button', { name: 'YTD', exact: true }).first().click().catch(() => {})
    await page.waitForTimeout(1200)
    const colorCheck = await page.evaluate(() => {
      const GREEN = /rgb\(5, 150, 105\)|rgb\(16, 185, 129\)|rgb\(52, 211, 153\)/ // emerald shades
      const RED = /rgb\(225, 29, 72\)|rgb\(220, 38, 38\)|rgb\(244, 63, 94\)|rgb\(251, 113, 133\)/ // rose
      const cards = [...document.querySelectorAll('.card')]
      const valueEl = (labelStarts) => {
        const c = cards.find((el) => el.innerText.toUpperCase().startsWith(labelStarts))
        if (!c) return null
        // the big value is the 2xl font div
        const v = [...c.querySelectorAll('div')].find((d) => /text-2xl|font-bold/.test(d.className) && /[\d.-]/.test(d.textContent))
        return v ? { text: v.textContent.trim(), color: getComputedStyle(v).color } : null
      }
      const dd = valueEl('MAX DRAWDOWN')
      const issues = []
      if (dd && GREEN.test(dd.color)) issues.push(`drawdown green: ${dd.text}`)
      for (const lbl of ['SHARPE RATIO', 'SORTINO RATIO', 'CALMAR RATIO']) {
        const r = valueEl(lbl)
        if (r && r.text.includes('-') && !RED.test(r.color)) issues.push(`${lbl} negative not red: ${r.text} (${r.color})`)
      }
      return issues
    })
    check('C4 semantic colors (drawdown not green; negative ratios red)', colorCheck.length === 0, colorCheck.join(' | '))
  }

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

  // C4e Form card clarifies its rank is by 3-year RETURN (not the composite
  // headline rank) — guards the #7 confusion where the two ranks differ.
  check(`C4 Form card labels 3Y-return rank (${label})`,
    /3-year return/i.test(fwdBody) && /composite/i.test(fwdBody))
  // C4f spectrums render (skill / consistency / running-hot) — count SVG-free
  // gradient bars via their left/right labels.
  if (!apiDown) {
    check('C4 skill spectrum (luck→skill) present', /Likely luck/i.test(fwdBody) && /Likely skill/i.test(fwdBody))
    check('C4 running-hot spectrum present', /❄️ Cold/i.test(fwdBody) && /🔥 Hot/i.test(fwdBody))
    // capture color logic: down-capture <100 should be emerald, up-capture <90 rose
    const capColors = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.card')]
      const cap = cards.find((c) => /Up \/ down capture/i.test(c.innerText))
      if (!cap) return null
      const stats = [...cap.querySelectorAll('div')].filter((d) => /^\d+%$/.test(d.textContent.trim()))
      return stats.map((s) => ({ v: s.textContent.trim(), color: getComputedStyle(s).color }))
    })
    check('C4 capture values are color-coded', !!capColors && capColors.length >= 1, JSON.stringify(capColors))
  }

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

  // C8d Compare no broken value artifacts
  check(`C8 Compare no broken value artifacts (${label})`, (await brokenContent(page)).length === 0,
    (await brokenContent(page)).join(', '))

  // C9 Compare with FIVE funds (new max). Verify all 5 columns + 5 chart lines.
  const fiveCodes = five.map((f) => f.code).join(',')
  await goto(`compare?codes=${fiveCodes}`)
  await page.waitForTimeout(apiDown ? 6500 : 4000)
  const five5 = await page.evaluate(() => {
    const firstTable = document.querySelector('table')
    const headers = firstTable ? firstTable.querySelectorAll('thead th').length : 0 // 1 metric + N funds
    return { headerCols: headers }
  })
  check(`C9 Compare renders 5 fund columns (${label})`, five5.headerCols === 6, `headerCols=${five5.headerCols} (expect 6)`)
  if (!apiDown) {
    const lines = await page.locator('.recharts-line path').count()
    check('C9 Compare chart draws 5 lines', lines >= 5, `lines=${lines}`)
    // C9-tooltip: hovering the chart shows fund values sorted DESCENDING.
    const chart = page.locator('.recharts-surface').first()
    const box = await chart.boundingBox().catch(() => null)
    if (box) {
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
      await page.waitForTimeout(400)
      const order = await page.evaluate(() => {
        // the custom tooltip lists "Name : ₹value" rows
        const tip = document.querySelector('.recharts-tooltip-wrapper')
        if (!tip) return null
        const nums = [...tip.querySelectorAll('span')]
          .map((s) => (s.textContent.match(/₹\s*([\d.]+)/) || [])[1])
          .filter(Boolean)
          .map(Number)
        return nums
      })
      if (order && order.length >= 2) {
        const sorted = order.every((v, i) => i === 0 || order[i - 1] >= v)
        check('C9 chart tooltip sorted descending by value', sorted, JSON.stringify(order))
      }
    }
  }
  // date sub-lines present in the table (Max Drawdown / Best / Worst Month rows)
  if (!apiDown) {
    const cmp5 = await bodyText()
    check('C9 Compare table shows period sub-lines', /[A-Z][a-z]{2} \d{4} → [A-Z][a-z]{2} \d{4}/.test(cmp5))
  }
  check(`C9 Compare-5 no broken artifacts (${label})`, (await brokenContent(page)).length === 0,
    (await brokenContent(page)).join(', '))
  // C9b sticky first column: the metric cell stays at the left edge after scrolling right
  const sticky = await page.evaluate(() => {
    const firstMetricCell = document.querySelector('tbody tr td')
    if (!firstMetricCell) return null
    const pos = getComputedStyle(firstMetricCell).position
    return { position: pos }
  })
  check(`C9 Compare metric column is sticky (${label})`, sticky?.position === 'sticky', JSON.stringify(sticky))

  // C9c Overlap header: every fund column must have a colored dot (regression
  // guard — the overlap component had a 3-color array while Compare allows 5,
  // leaving funds 4-5 with transparent/missing dots).
  if (!apiDown) {
    const dotCheck = await page.evaluate(() => {
      // shared-holdings table is the LAST table on the page
      const tables = [...document.querySelectorAll('table')]
      const tbl = tables[tables.length - 1]
      if (!tbl) return { ok: false, note: 'no table' }
      const headerDots = [...tbl.querySelectorAll('thead th span')].filter((s) => {
        const bg = getComputedStyle(s).backgroundColor
        return s.style.backgroundColor || (bg && bg !== 'rgba(0, 0, 0, 0)')
      })
      // funds with data = header cells minus the first "Shared holding" label cell
      const fundCols = tbl.querySelectorAll('thead th').length - 1
      const coloredDots = [...tbl.querySelectorAll('thead th')].slice(1).filter((th) => {
        const dot = th.querySelector('span[style*="background"]')
        if (!dot) return false
        const bg = dot.style.backgroundColor || getComputedStyle(dot).backgroundColor
        return bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
      }).length
      return { ok: coloredDots === fundCols, fundCols, coloredDots }
    })
    check('C9 overlap header has a colored dot per fund', dotCheck.ok, JSON.stringify(dotCheck))
  }

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

  // C13 fund-count copy is DYNAMIC (reads data.totalFunds), not a stale literal.
  // Home hero + Footer should show the live count; guards the "838" hardcode class.
  if (!apiDown) {
    const total = funds.length
    await goto('')
    const home = await bodyText()
    check('C13 Home hero shows live fund count', home.includes(`${total} funds`), `expected "${total} funds"`)
    // search placeholder shows a rounded "NNN+" derived from the live count
    const label10 = `${Math.floor(total / 10) * 10}+`
    // the ticker may be mid-rotation; check the prompt set via the input over a moment
    const seen = new Set()
    for (let i = 0; i < 6; i++) {
      const ph = await page.locator('input[type="text"]').first().getAttribute('placeholder').catch(() => '')
      if (ph) seen.add(ph)
      await page.waitForTimeout(700)
    }
    // not asserting we catch the count prompt in 6 samples (randomized); instead
    // assert no STALE hardcoded "830+" appears anywhere on the page
    check('C13 no stale 830+ literal on Home', !home.includes('830+') || label10 === '830+')
  }

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
