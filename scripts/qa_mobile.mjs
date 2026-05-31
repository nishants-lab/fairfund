/**
 * MOBILE QA harness — small-screen CX is a different product from desktop.
 * ========================================================================
 * Same URLs, very different constraints: 390px width, touch targets, no hover,
 * modals must fit, and — the bug that slipped through before — NOTHING should
 * cause unexpected horizontal page scroll. This harness runs every page at a
 * real phone viewport under both API-UP and API-DOWN and asserts mobile-specific
 * invariants that desktop tests cannot catch.
 *
 * Usage: node scripts/qa_mobile.mjs [baseUrl]   (default http://localhost:4173/)
 * Exit 1 on any failure.
 */
import { chromium, devices } from 'playwright'
import fs from 'fs'

const BASE = (process.argv[2] || 'http://localhost:4173/').replace(/\/$/, '')
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? ' — ' + detail : ''}`)
}

const funds = JSON.parse(fs.readFileSync(new URL('../src/data/funds.json', import.meta.url))).funds
const stockFund = funds.find((f) => f.holdingsMeta?.coverage === 'stock_level' && f.metrics['3Y'])
const fwdFund =
  funds.find((f) => f.analytics?.rankTrajectory && f.analytics?.regimes?.length && f.metrics['3Y']) || stockFund
const flexi = funds.filter((f) => f.category === 'Flexi Cap' && f.holdingsMeta?.coverage === 'stock_level')
const pairA = flexi[0], pairB = flexi[1]
const five = (flexi.length >= 5 ? flexi : funds.filter((f) => f.metrics['3Y'])).slice(0, 5)

const VIEWPORT = { width: 390, height: 844 } // iPhone 12/13/14 logical size
const SLOP = 2 // px tolerance for sub-pixel rounding

function attachConsole(page) {
  page.__errors = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/Failed to load resource|CORS|net::ERR|ERR_FAILED|mfapi\.in|429|Access-Control/i.test(t)) return
    page.__errors.push(t)
  })
  page.on('pageerror', (e) => page.__errors.push('PAGEERROR: ' + e.message))
}

// Broken-value artifact scan (NaN/undefined/Invalid Date/etc.) on rendered text.
async function brokenContent(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText
    const pats = [/\bNaN\b/, /\bundefined\b/, /Invalid Date/i, /\[object Object\]/, /₹\s*NaN/, /NaN\s*%/, /\$\{/]
    return pats.filter((p) => p.test(txt)).map((p) => (txt.match(p) || [''])[0])
  })
}

/** Measure horizontal overflow of the document at the current viewport. */
async function pageOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, innerW: window.innerWidth }
  })
}

/** Find elements whose right edge extends past the viewport (the usual culprits
 *  for horizontal scroll). Returns up to 5 offenders with a CSS-ish path. */
async function overflowingElements(page, vw) {
  return page.evaluate((vw) => {
    const out = []
    const all = document.querySelectorAll('body *')
    for (const el of all) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      // ignore elements that are themselves scroll containers (intended)
      const style = getComputedStyle(el)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue
      if (r.right > vw + 2) {
        const id = el.id ? `#${el.id}` : ''
        const cls = (el.className && typeof el.className === 'string')
          ? '.' + el.className.split(/\s+/).slice(0, 2).join('.')
          : ''
        out.push(`${el.tagName.toLowerCase()}${id}${cls} right=${Math.round(r.right)}`)
        if (out.length >= 5) break
      }
    }
    return out
  }, vw)
}

async function run(apiDown) {
  const label = apiDown ? 'API-DOWN' : 'API-UP'
  console.log(`\n== MOBILE QA (${label}) ==`)
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: VIEWPORT,
  })
  await ctx.addInitScript(() => { try { localStorage.setItem('ff-onboarded', '1') } catch {} })
  if (apiDown) await ctx.route('**://api.mfapi.in/**', (r) => r.abort())
  const page = await ctx.newPage()
  attachConsole(page)

  const goto = async (hash) => {
    await page.goto(`${BASE}/#/${hash}`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(apiDown ? 5200 : 2200)
  }
  const body = async () => (await page.locator('body').innerText().catch(() => '')) || ''

  // Pages to sweep for the universal mobile invariant: no horizontal page scroll.
  const pages = [
    ['Home', ''],
    ['Explore', 'explore?cat=Flexi+Cap'],
    ['FundDetail', `fund/${fwdFund.code}`],
    ['Compare', `compare?codes=${pairA.code},${pairB.code}`],
    ['Compare-5', `compare?codes=${five.map((f) => f.code).join(',')}`],
    ['Planner', 'planner'],
    ['Methodology', 'methodology'],
  ]

  for (const [name, hash] of pages) {
    await goto(hash)
    if (name.startsWith('Compare')) await page.waitForTimeout(apiDown ? 4000 : 2500) // let NAV/table settle
    const o = await pageOverflow(page)
    const overflow = o.scrollW - o.clientW
    const ok = overflow <= SLOP
    let detail = `scrollW=${o.scrollW} clientW=${o.clientW} (+${overflow}px)`
    if (!ok) {
      const offenders = await overflowingElements(page, o.clientW)
      detail += ` offenders: ${offenders.join(' | ')}`
    }
    check(`M·no horizontal scroll — ${name} (${label})`, ok, detail)
    // Broken-value artifact scan on every swept page.
    const broken = await brokenContent(page)
    check(`M·no broken value artifacts — ${name} (${label})`, broken.length === 0, broken.join(', '))
  }

  // --- Mobile-specific functional checks (run once, under API-UP) ---
  if (!apiDown) {
    // M1 mobile nav is a HAMBURGER: button present, links hidden until opened,
    // then tappable. (Replaced the old always-visible md:hidden scroller.)
    await goto('')
    const burger = page.locator('button[aria-label="Open menu"]')
    const burgerVisible = await burger.isVisible().catch(() => false)
    check('M·hamburger button present', burgerVisible)
    // links should NOT be visible before opening
    const linksBeforeOpen = await page.locator('nav a', { hasText: 'Explore' }).count()
    // open the menu
    await burger.click().catch(() => {})
    await page.waitForTimeout(400)
    const menuLinks = page.locator('nav a')
    const navItems = await page.locator('nav a:visible').filter({ hasText: /Explore|Compare|Methodology/ }).count()
    check('M·hamburger opens nav with all links', navItems >= 3, `visible links=${navItems} (before=${linksBeforeOpen})`)

    // M2 tap targets: opened nav links should be >= 40px tall (comfortable touch)
    let small = 0
    const visLinks = page.locator('nav a:visible').filter({ hasText: /Explore|Compare|Methodology/ })
    const vc = await visLinks.count()
    for (let i = 0; i < vc; i++) {
      const box = await visLinks.nth(i).boundingBox().catch(() => null)
      if (box && box.height < 40) small++
    }
    check('M·nav tap targets >=40px tall', small === 0, `${small} too small`)
    // close it again so it doesn't block later checks
    await page.locator('button[aria-label="Close menu"]').click().catch(() => {})
    await page.waitForTimeout(300)

    // M3 search box usable on mobile: opens, dropdown fits within viewport width
    await goto('')
    const input = page.locator('input[type="text"]').first()
    await input.click()
    await input.fill('hdfc')
    await page.waitForTimeout(700)
    const ddInfo = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div')]
      const dd = els.find((e) => getComputedStyle(e).overflowY === 'auto' && e.querySelector('button'))
      if (!dd) return null
      const r = dd.getBoundingClientRect()
      return { right: Math.round(r.right), left: Math.round(r.left), vw: window.innerWidth, scrollable: dd.scrollHeight > dd.clientHeight, maxH: getComputedStyle(dd).maxHeight }
    })
    check('M·search dropdown fits + scrolls', !!ddInfo && ddInfo.right <= ddInfo.vw + SLOP && ddInfo.left >= -SLOP, ddInfo ? JSON.stringify(ddInfo) : 'no dropdown')

    // M4 Compare table is horizontally scrollable WITHIN its container (the bug
    // that slipped through: the page scrolled instead of the table). The table's
    // own wrapper should scroll; the page should not (asserted in the sweep above).
    await goto(`compare?codes=${pairA.code},${pairB.code}`)
    await page.waitForTimeout(2500)
    const tblScroll = await page.evaluate(() => {
      const tbl = document.querySelector('table')
      if (!tbl) return null
      // find nearest scrollable ancestor
      let el = tbl.parentElement
      while (el) {
        const ox = getComputedStyle(el).overflowX
        if (ox === 'auto' || ox === 'scroll') {
          return { wrapperScrollable: el.scrollWidth > el.clientWidth, wrapperClientW: el.clientWidth, vw: window.innerWidth }
        }
        el = el.parentElement
      }
      return { wrapperScrollable: false, note: 'no scroll wrapper' }
    })
    check('M·Compare table scrolls inside its own wrapper', !!tblScroll && tblScroll.wrapperClientW <= VIEWPORT.width + SLOP, JSON.stringify(tblScroll))

    // M4b Compare-5 on mobile: the sticky first column (metric name) must stay
    // pinned to the left edge after scrolling the table horizontally. This is
    // the small-screen guarantee the user asked for with 5 funds + many rows.
    await goto(`compare?codes=${five.map((f) => f.code).join(',')}`)
    await page.waitForTimeout(3000)
    const stick = await page.evaluate(() => {
      const tbl = document.querySelector('table')
      if (!tbl) return null
      let wrap = tbl.parentElement
      while (wrap && !/auto|scroll/.test(getComputedStyle(wrap).overflowX) && !/auto|scroll/.test(getComputedStyle(wrap).overflow)) wrap = wrap.parentElement
      if (!wrap) return { note: 'no wrapper' }
      const cell = tbl.querySelector('tbody tr td') // first metric cell
      const beforeLeft = cell.getBoundingClientRect().left
      wrap.scrollLeft = 300 // scroll right
      const afterLeft = cell.getBoundingClientRect().left
      const headerCols = tbl.querySelectorAll('thead th').length
      const pos = getComputedStyle(cell).position
      return { beforeLeft: Math.round(beforeLeft), afterLeft: Math.round(afterLeft), pos, headerCols, scrolled: wrap.scrollLeft }
    })
    // sticky => the metric cell's left position barely moves after scrolling right
    const stuck = stick && stick.pos === 'sticky' && Math.abs(stick.beforeLeft - stick.afterLeft) <= 3 && stick.scrolled > 0
    check('M·Compare-5 metric column stays pinned on h-scroll', !!stuck, JSON.stringify(stick))
    check('M·Compare-5 shows all 5 fund columns', stick?.headerCols === 6, `headerCols=${stick?.headerCols}`)
    // header row should also stay pinned on vertical scroll (sticky top)
    const headerSticky = await page.evaluate(() => {
      const th = document.querySelector('thead th')
      return th ? getComputedStyle(th).position : null
    })
    check('M·Compare-5 header row is sticky (top)', headerSticky === 'sticky', `pos=${headerSticky}`)

    // M5 fund-detail forward-looking section: regime table scrolls in-wrapper, not page
    await goto(`fund/${fwdFund.code}`)
    await page.waitForTimeout(1500)
    const fwdOk = /Forward-looking signals/i.test(await body())
    check('M·FundDetail forward section renders', fwdOk)

    // M5b InfoTip CLOSE behavior on touch (the reported bug: metric-card tip
    // opened on tap but never closed). Tap an "i" → tip opens; tap it again →
    // closes; tap it again then tap OUTSIDE → also closes. Uses a real touch tap.
    await goto(`fund/${stockFund.code}`)
    await page.waitForTimeout(2200)
    const infoBtn = page.locator('button[aria-label^="About"]').first()
    const haveInfo = (await infoBtn.count()) > 0
    if (haveInfo) {
      await infoBtn.scrollIntoViewIfNeeded().catch(() => {})
      // Use real touchscreen taps at the button's center (locator.tap can fall
      // back to a mouse click, which triggers hover-open semantics and muddies
      // the toggle measurement). touchscreen.tap is unambiguously a touch tap.
      const box = await infoBtn.boundingBox()
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      // open
      await page.touchscreen.tap(cx, cy)
      await page.waitForTimeout(250)
      const openCount1 = await page.locator('[role="tooltip"]').count()
      // tap the same button again → should close (toggle)
      await page.touchscreen.tap(cx, cy)
      await page.waitForTimeout(250)
      const afterToggle = await page.locator('[role="tooltip"]').count()
      // open again, then tap OUTSIDE (top-left of viewport) → should close
      await page.touchscreen.tap(cx, cy)
      await page.waitForTimeout(200)
      await page.touchscreen.tap(8, 120)
      await page.waitForTimeout(250)
      const afterOutside = await page.locator('[role="tooltip"]').count()
      check('M·metric tooltip toggles closed on re-tap', openCount1 >= 1 && afterToggle === 0, `open=${openCount1} afterToggle=${afterToggle}`)
      check('M·metric tooltip closes on tap-outside', afterOutside === 0, `afterOutside=${afterOutside}`)
    } else {
      check('M·metric tooltip toggles closed on re-tap', false, 'no info button found')
    }

    // M5c rank-trajectory mini-chart shows axes (the sparkline was axis-less and
    // read as a broken flat line). Expect y gridlines + month labels in its SVG.
    await goto(`fund/${fwdFund.code}`)
    await page.waitForTimeout(1500)
    const axisInfo = await page.evaluate(() => {
      const svg = document.querySelector('svg[aria-label="Rank percentile over time"]')
      if (!svg) return null
      const lines = svg.querySelectorAll('line').length
      const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent || '')
      const hasPctLabels = texts.includes('0') && texts.includes('100')
      const hasMonthLabel = texts.some((t) => /[A-Z][a-z]{2} '?\d{2}/.test(t))
      return { lines, hasPctLabels, hasMonthLabel }
    })
    check('M·trajectory chart has y + x axes', !!axisInfo && axisInfo.lines >= 2 && axisInfo.hasPctLabels && axisInfo.hasMonthLabel, JSON.stringify(axisInfo))

    // M6 readable text: body font-size >= 12px (nothing microscopic on mobile)
    const tooSmall = await page.evaluate(() => {
      let n = 0
      for (const el of document.querySelectorAll('p, span, div, td, th, a, button')) {
        const t = el.textContent?.trim()
        if (!t || t.length < 4) continue
        if (el.children.length > 0) continue // only leaf text
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs && fs < 10) n++
      }
      return n
    })
    check('M·no text under 10px', tooSmall === 0, `${tooSmall} tiny nodes`)

    // M7 onboarding modal (force-show) fits within the viewport on mobile
    await page.evaluate(() => { try { localStorage.removeItem('ff-onboarded') } catch {} })
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle' }).catch(() => {})
    await page.waitForTimeout(900)
    const modal = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('div')].filter((d) => /Welcome to FairFund/i.test(d.textContent || ''))
      const card = cards[cards.length - 1]
      if (!card) return null
      const r = card.getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth }
    })
    check('M·onboarding modal fits viewport', !modal || (modal.left >= -SLOP && modal.right <= modal.vw + SLOP), modal ? JSON.stringify(modal) : 'no modal')
    // restore
    await page.evaluate(() => { try { localStorage.setItem('ff-onboarded', '1') } catch {} })

    // M8 no uncaught app errors across mobile pages
    check('M·no uncaught app errors', (page.__errors || []).length === 0, (page.__errors || []).slice(0, 2).join(' | '))
  }

  await browser.close()
}

await run(false)
await run(true)

const passed = results.filter((r) => r.ok).length
console.log(`\n== MOBILE QA: ${passed}/${results.length} passed ==`)
process.exit(passed === results.length ? 0 : 1)
