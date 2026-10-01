import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } })
const key = 'fairfund_fund_changes_v1'
const code = 111549
let browser
try {
  await server.listen()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(base)) return route.abort()
    return route.continue()
  })
  await page.addInitScript(code => {
    if (!localStorage.getItem('fairfund_wishlist')) localStorage.setItem('fairfund_wishlist', JSON.stringify([code]))
  }, code)
  await page.goto(`${base}/#/wishlist`)
  const panel = page.getByRole('region', { name: 'Since your last review' })
  const noChanges = panel.getByText('No comparable changes recorded.', { exact: false })
  await noChanges.waitFor()
  assert.equal(await panel.getByRole('button', { name: /Mark .* reviewed/ }).count(), 0)
  const cost = await page.evaluate(async ({ key, code }) => {
    const { getFund } = await import('/src/lib/data.ts')
    const cost = getFund(code).expenseRatio
    const stored = JSON.parse(localStorage.getItem(key))
    if (stored.funds[code].baseline.cost !== cost) throw new Error('Baseline TER must use the canonical index')
    return cost
  }, { key, code })
  assert.ok(Number.isFinite(cost), 'fixture requires disclosed canonical TER')
  console.log('PASS first visit records canonical index TER baseline without a change')

  await page.evaluate(({ key, code, cost }) => {
    const stored = JSON.parse(localStorage.getItem(key))
    stored.funds[code].baseline.cost = cost + 0.1
    stored.funds[code].latest.cost = cost + 0.1
    localStorage.setItem(key, JSON.stringify(stored))
  }, { key, code, cost })
  await page.reload()
  await panel.getByText('Expense ratio', { exact: true }).waitFor()
  await panel.getByText('Source date unavailable · Observed', { exact: false }).waitFor()
  const recorded = await page.evaluate(({ key, code }) => JSON.parse(localStorage.getItem(key)).funds[code], { key, code })
  assert.equal(recorded.changes.length, 1)
  assert.equal(recorded.changes[0].before, `${(cost + 0.1).toFixed(2)}%`)
  assert.equal(recorded.changes[0].after, `${cost.toFixed(2)}%`)
  assert.equal(recorded.changes[0].toDate, null)
  assert.equal(recorded.changes[0].fromDate, null)
  await page.reload()
  await panel.getByText('Expense ratio', { exact: true }).waitFor()
  assert.equal(await panel.getByText('Expense ratio', { exact: true }).count(), 1)
  assert.deepEqual(await page.evaluate(({ key, code }) => JSON.parse(localStorage.getItem(key)).funds[code], { key, code }), recorded)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile horizontal overflow')
  if(process.env.FF_SCREENSHOT_DIR){mkdirSync(process.env.FF_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.FF_SCREENSHOT_DIR,'saved-fund-changes-mobile.png'),fullPage:true,animations:'disabled'})}
  const review = panel.getByRole('button', { name: /Mark .* reviewed/ })
  assert.ok((await review.boundingBox()).height >= 44, 'review button touch target')
  await review.focus()
  await page.keyboard.press('Enter')
  await noChanges.waitFor()
  await page.reload()
  await noChanges.waitFor()
  assert.equal(await panel.getByText('Expense ratio', { exact: true }).count(), 0)
  const reviewed = await page.evaluate(({ key, code }) => JSON.parse(localStorage.getItem(key)).funds[code], { key, code })
  assert.equal(reviewed.baseline.cost, cost)
  assert.deepEqual(reviewed.changes, [])
  console.log('PASS seeded prior TER produces one persistent undated observation, mobile layout and keyboard Mark reviewed persist')

  await page.evaluate(key => localStorage.setItem(key, '{broken'), key)
  await page.reload()
  await panel.getByRole('alert').waitFor()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{broken')
  assert.deepEqual(errors, [])
  console.log('PASS malformed history is preserved with visible error and no browser page errors')
} finally {
  await browser?.close()
  await server.close()
}
