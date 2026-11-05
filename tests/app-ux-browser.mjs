import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const data = JSON.parse(readFileSync(resolve(root, 'src/data/funds.json'), 'utf8'))
// A fund whose SEBI riskometer differs from its category's house risk level. Prefer
// 149107 (the 320px overflow case); fall back to any such fund after a data refresh.
const differs = f => f.sebiRisk && f.riskLevel && f.riskLevel !== f.sebiRisk && !f.dataQuality && f.metrics?.['3Y']?.windowEnd
const fund = data.funds.find(f => f.code === 149107 && differs(f)) ?? data.funds.find(differs)
assert(fund, 'a fund whose SEBI risk differs from its category risk')
const nav = { d: [], v: [] }
for (let t = Date.parse('2021-11-01'), i = 0; t <= Date.parse('2026-11-05'); t += 86400000, i++) {
  nav.d.push(new Date(t).toISOString().slice(0, 10)); nav.v.push(100 + i * 0.02)
}
const server = await createServer({ root, server: { host: '127.0.0.1', port: Number(process.env.FF_UX_TEST_PORT || 4197), strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: width === 390 ? 'dark' : 'light', serviceWorkers: 'block' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.route('https://api.mfapi.in/**', r => r.abort())
    await page.route('**/nav/*.json*', r => r.fulfill({ json: nav }))
    await page.route('**/category-median/*.json*', r => r.fulfill({ json: nav }))
    await page.route('**/gc.zgo.at/**', r => r.abort())
    await page.route('**/goatcounter.com/**', r => r.abort())
    const noOverflow = async () => {
      const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('main *, header *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && el.getBoundingClientRect().width > 0).map(el => ({ tag: el.tagName, cls: el.className, text: el.textContent?.slice(0, 80), right: el.getBoundingClientRect().right })).slice(0, 25) }))
      assert(overflow.width <= width, `overflow at ${width}px: ${JSON.stringify(overflow)}`)
    }
    const targets = async locator => {
      for (const el of await locator.all()) {
        if (!await el.isVisible()) continue
        const box = await el.boundingBox()
        assert(box.height >= 40 && box.width >= 40, `${await el.innerText()} target ${box.width}x${box.height}`)
      }
    }
    await page.goto(`${base}/#/fund/${fund.code}`)
    const legend = page.getByLabel('Chart legend')
    await legend.waitFor()
    assert.equal(await legend.count(), 1)
    assert.equal(await page.locator('.recharts-legend-wrapper').count(), 0)
    assert.match(await legend.innerText(), /Top-ranked peer:/)
    assert.equal(await page.getByTitle(`SEBI riskometer: ${fund.sebiRisk}`).innerText(), `${fund.sebiRisk} risk`)
    assert.equal(await page.getByText(`${fund.riskLevel} risk`, { exact: true }).count(), 0)
    const headline = page.locator('.card').filter({ has: page.getByRole('button', { name: 'About 3Y CAGR', exact: true }) }).first()
    assert.match(await headline.innerText(), /to 5 Nov 2026/)
    assert.match(await page.locator('[data-ranking]').first().innerText(), new RegExp(`Through ${fund.metrics['3Y'].windowEnd}`))
    const checkColors = async color => {
      const swatch = legend.locator('span[style]').first()
      assert.equal(await swatch.evaluate(el => el.style.borderColor), color)
      const chart = legend.locator('..')
      const stroke = await chart.locator('.recharts-line-curve').last().getAttribute('stroke')
      assert.equal(stroke, color === 'rgb(37, 99, 235)' ? '#2563eb' : '#f43f5e')
      assert.equal(await legend.locator('span[style]').last().evaluate(el => el.style.borderColor), 'rgb(148, 163, 184)')
    }
    await checkColors('rgb(37, 99, 235)')
    await targets(page.locator('header button, header a[aria-label]'))
    await targets(page.getByRole('button', { name: /^(1Y|3Y|5Y)$/ }))
    await noOverflow()
    if (process.env.FF_SCREENSHOT_DIR && width === 390) await page.screenshot({ path: resolve(process.env.FF_SCREENSHOT_DIR, 'fund-390.png'), fullPage: true })
    await page.getByRole('button', { name: 'Drawdowns', exact: true }).click()
    await checkColors('rgb(244, 63, 94)')
    await noOverflow()
    const index = data.funds.find(f => f.categoryDisplay === 'Index Funds' && f.metrics['3Y'])
    await page.goto(`${base}/#/fund/${index.code}`)
    await page.getByRole('heading', { name: index.name, exact: true }).waitFor()
    assert.doesNotMatch(await page.getByRole('link', { name: /^See all / }).innerText(), /Funds funds/i)
    await page.getByRole('link', { name: /^See all / }).click()
    await page.getByRole('heading', { name: data.categories[index.category].display, exact: true }).waitFor()
    assert.doesNotMatch(await page.title(), /Funds funds/i)
    await page.goto(`${base}/#/explore?cat=Index-MidCap`)
    await page.getByText('Typical for category', { exact: true }).waitFor()
    await targets(page.locator('button[data-active]').locator('..').getByRole('button'))
    await noOverflow()
    await page.goto(`${base}/#/category/index-midcap`)
    await page.getByText(/Typical for category:/).waitFor()
    await noOverflow()
    await page.goto(`${base}/#/movers?view=cost&measure=terChange&categories=Index-MidCap&notCategories=Value%2FContra`)
    await page.getByTestId('movers-summary').waitFor()
    assert.match(await page.getByTestId('movers-chips').innerText(), /Index - Mid Cap/)
    assert.match(await page.getByTestId('movers-chips').innerText(), /Not Value \/ Contra/)
    await targets(page.getByTestId('movers-chips').getByRole('button'))
    await targets(page.getByRole('group').getByRole('button'))
    await noOverflow()
    assert.deepEqual(errors, [])
    console.log(`PASS app UX ${width}px: legend, SEBI risk, return/rank dates, category copy, tap targets, overflow`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}
