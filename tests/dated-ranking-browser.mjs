import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const require = createRequire(import.meta.url)
const { syntheticFund, syntheticMetric, ensureCategory } = require('./fixtures/browser-timebomb-fixtures.cjs')
// Complete synthetic cohort: independent of which live funds are currently ranked, held or quarantined.
const data = JSON.parse(readFileSync(resolve(root, 'src/data/funds.json'), 'utf8'))
const mk = (code, name, category, extra = {}) => syntheticFund(code, name, category, { categorySize: 99, ...extra })
const metric = { ...syntheticMetric('3Y', '2023-11-09', '2026-11-09'), catRank: 2, catSize: 7 }
const previousMetric = { ...metric, catRank: 1 }
const current = mk(9000021, 'Synthetic Ranked Flexi Cap', 'Flexi Cap', { metrics: { '3Y': { ...metric, alpha: -20, sharpe: -1 } } })
const previous = mk(9000022, 'Synthetic Previously Ranked Flexi Cap', 'Flexi Cap', {
  metrics: {}, previousRankings: { '3Y': previousMetric }, navPoints: 2500,
  si: { since: previousMetric.windowStart, days: 3650, totalReturn: 120, cagr: 8 },
})
const held = mk(9000023, 'Synthetic Held Flexi Cap', 'Flexi Cap', {
  metrics: { '3Y': { ...metric, catRank: 1, alpha: 20, sharpe: 3 } }, previousRankings: { '3Y': previousMetric },
  dataQuality: { status: 'quarantined', issues: [] },
})
const eligible = [current, previous, held]
const debt = mk(9000024, 'Synthetic Liquid Fund', 'Liquid', {
  isDebt: true, riskLevel: 'Low to Moderate', sebiRisk: 'Low to Moderate',
  metrics: { '1Y': syntheticMetric('1Y', '2025-11-10', '2026-11-10'), '3Y': syntheticMetric('3Y', '2023-11-10', '2026-11-10') },
})
ensureCategory(data, 'Flexi Cap', 'Flexi Cap', 'Moderately High')
ensureCategory(data, 'Liquid', 'Liquid', 'Low to Moderate')
data.funds = [...eligible, debt]
data.totalFunds = data.funds.length
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${server.httpServer.address().port}`
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [320, 360, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/src/data/funds.json*', route => route.fulfill({ contentType: 'text/javascript', body: `export default ${JSON.stringify(data)}` }))
    await page.route('**/fund-data/*.json*', route => route.fulfill({ contentType: 'application/json', body: '{}' }))
    await page.route('**/nav/*.json*', route => route.abort())
    await page.route('https://api.mfapi.in/**', route => route.abort())
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px document overflow`)
    await page.goto(`${base}/#/explore?cat=Flexi%20Cap`)
    const rows = page.locator('tbody tr')
    await rows.first().waitFor()
    assert.match(await rows.first().innerText(), new RegExp(current.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const oldRow = rows.filter({ hasText: previous.name })
    assert.match(await oldRow.innerText(), /Previous ranking #1 of 7/)
    assert.equal(await oldRow.locator('[data-ranking="current"]').count(), 0)
    assert.match(await rows.filter({ hasText: held.name }).innerText(), /Ranking withheld/)
    const rank = rows.first().locator('[data-ranking="current"]')
    assert.match(await rank.innerText(), /Rank #2 of 7/)
    assert.equal(await rank.getAttribute('title'), `3Y ranking period: ${metric.windowStart} to ${metric.windowEnd}`)
    await noOverflow()
    await page.getByRole('columnheader').filter({ hasText: '#' }).click()
    assert.match(await rows.first().innerText(), /Rank #2 of 7/)
    await page.goto(`${base}/#/compare?codes=${eligible.map(f => f.code).join(',')}`)
    const rankRow = page.getByRole('row').filter({ hasText: 'Category Rank' })
    await rankRow.waitFor()
    assert.match(await rankRow.innerText(), /Rank #2 of 7/)
    assert.match(await rankRow.innerText(), /Previous ranking #1 of 7/)
    assert.match(await rankRow.innerText(), /Ranking withheld/)
    assert.equal(await rankRow.locator('[data-ranking="previous"]').evaluate(el => el.parentElement.className), '')
    const compositeRow = page.getByRole('row').filter({ hasText: 'Composite score' })
    assert.match(await compositeRow.innerText(), new RegExp(`3Y score basis: ${metric.windowStart} to ${metric.windowEnd}`))
    assert.equal(await compositeRow.locator('.bg-emerald-100').count(), 1, 'held high score and unranked neutral score cannot steal current equity highlight')
    assert.match(await compositeRow.locator('.bg-emerald-100').innerText(), /3Y score basis:/)
    await noOverflow()
    await page.goto(`${base}/#/compare?codes=${debt.code},${current.code}`)
    const mixedScores = page.getByRole('row').filter({ hasText: 'Composite score' })
    await mixedScores.waitFor()
    assert.ok((await mixedScores.innerText()).includes(`1Y score basis: ${debt.metrics['1Y'].windowStart} to ${debt.metrics['1Y'].windowEnd}`))
    assert.ok((await mixedScores.innerText()).includes(`3Y score basis: ${metric.windowStart} to ${metric.windowEnd}`))
    await noOverflow()
    await page.goto(`${base}/#/category/flexi-cap`)
    const standings = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Current standings (3Y)' }) })
    await standings.waitFor()
    assert.match(await standings.innerText(), /Rank #2 of 7/)
    assert.equal(await standings.locator('tbody tr').count(), 1)
    await noOverflow()
    await page.goto(`${base}/#/fund/${previous.code}`)
    await page.locator('#verdict').waitFor()
    assert.match(await page.locator('#verdict').innerText(), /Previous ranking #1 of 7/)
    assert.match(await page.locator('#verdict').innerText(), /Annualised over the available since-launch history/)
    assert.doesNotMatch(await page.locator('#verdict').innerText(), /Early, small-sample|limited NAV history/)
    await noOverflow()
    await page.goto(`${base}/#/fund/${held.code}`)
    await page.getByText('Ranking withheld', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-ranking]').count(), 1, 'only eligible peer rank remains visible on held detail')
    assert.equal(await page.locator('#verdict [data-ranking]').count(), 0)
    await noOverflow()
    await page.route('**/nav/*.json*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ d: [metric.windowStart, metric.windowEnd], v: [100, -1] }) }))
    await page.goto(`${base}/#/compare?codes=${current.code},${previous.code}`)
    const heldRanks = page.getByRole('row').filter({ hasText: 'Category Rank' })
    await heldRanks.getByText('Ranking withheld', { exact: true }).first().waitFor()
    assert.equal(await heldRanks.locator('[data-ranking]').count(), 0, 'runtime NAV hold hides stored and previous rank')
    await noOverflow()
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`PASS dated rank surfaces, exclusion, quarantine and responsive layout at ${width}px`)
  }
} finally {
  await browser.close()
  await server.close()
}
