import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } })
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  const base = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  const outbound = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1' && url.protocol !== 'data:') {
      outbound.push({ url: url.href, method: route.request().method(), body: route.request().postData(), type: route.request().resourceType() })
      return route.abort()
    }
    if (url.pathname.includes('/nav/')) return route.fulfill({ status: 404, body: '' })
    return route.continue()
  })
  await page.goto(base)
  const original = await page.evaluate(async () => {
    const { parseCAMSText } = await import('/src/lib/camsParser.ts')
    const p = parseCAMSText(`Quant Small Cap Fund Direct Plan Growth - ISIN : INF000000001
Opening Unit Balance: 0.000
28-Mar-2023 Purchase 10000.00 100.0000 100.000 100.000
NAV on 28-Mar-2024: INR 120.0000 Market Value on 28-Mar-2024: INR 12000.00
Closing Unit Balance: 100.000 Total Cost Value: 10000.00`)
    const stored = JSON.stringify(p)
    localStorage.setItem('fairfund_portfolio', stored)
    return stored
  })
  await page.goto(`${base}/#/my/portfolio`)
  await page.getByRole('button', { name: 'Import new statement' }).waitFor()
  const sourceName = 'Unknown Synthetic Scheme Direct Growth'
  const statement = `${sourceName} - ISIN : INF000000001
Opening Unit Balance: 0.000
28-Mar-2023 Purchase 10000.00 100.0000 100.000 100.000
NAV on 28-Mar-2024: INR 120.0000 Market Value on 28-Mar-2024: INR 12000.00
Closing Unit Balance: 100.000 Total Cost Value: 10000.00
Total 10000.00 100000.00`
  const storage = () => page.evaluate(() => localStorage.getItem('fairfund_portfolio'))
  async function upload() {
    await page.getByRole('button', { name: 'Import new statement' }).click()
    await page.locator('input[accept=".pdf,.txt,.csv"]').setInputFiles({ name: 'synthetic-statement.txt', mimeType: 'text/plain', buffer: Buffer.from(statement) })
    const review = page.getByRole('region', { name: 'Review statement import' })
    await review.waitFor()
    return review
  }
  let review = await upload()
  assert.equal(await storage(), original, 'parse must not overwrite saved portfolio')
  assert.match(await review.innerText(), /Material total mismatch/)
  assert.match(await review.innerText(), /Unmatched/)
  assert.equal(await review.getByRole('button', { name: 'Confirm and replace saved portfolio' }).isDisabled(), true)
  await review.getByRole('button', { name: 'Cancel import' }).click()
  assert.equal(await storage(), original, 'cancel must preserve original saved portfolio')

  review = await upload()
  await review.getByText('Correct scheme match', { exact: true }).click()
  await review.getByRole('textbox', { name: `Search scheme for ${sourceName}` }).fill('100177')
  await review.getByRole('button', { name: /AMFI 100177/ }).click()
  assert.match(await review.innerText(), /Plan mismatch/)
  await review.getByRole('checkbox').check()
  await review.getByRole('textbox', { name: `Search scheme for ${sourceName}` }).fill('120828')
  await review.getByRole('button', { name: /AMFI 120828/ }).click()
  assert.equal(await review.getByRole('checkbox').isChecked(), false, 'correction must reset approval')
  assert.equal(await storage(), original, 'correction must remain an unsaved draft')
  if(process.env.FF_SCREENSHOT_DIR){mkdirSync(process.env.FF_SCREENSHOT_DIR,{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve(process.env.FF_SCREENSHOT_DIR,'portfolio-review-desktop.png'),fullPage:true,animations:'disabled'})}
  await review.getByRole('checkbox').check()
  await page.evaluate(() => {
    const originalSet = Storage.prototype.setItem
    window.restoreSetItem = () => { Storage.prototype.setItem = originalSet }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'fairfund_portfolio') throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
      originalSet.call(this, key, value)
    }
  })
  await review.getByRole('button', { name: 'Confirm and replace saved portfolio' }).click()
  await review.getByRole('alert').filter({ hasText: 'Could not save in this browser' }).waitFor()
  assert.equal(await storage(), original, 'failed storage must preserve original')
  await page.evaluate(() => window.restoreSetItem())
  await review.getByRole('button', { name: 'Confirm and replace saved portfolio' }).click()
  await review.waitFor({ state: 'detached' })
  const saved = JSON.parse(await storage())
  assert.equal(saved.fundSummaries[0].fundCode, 120828)
  assert.equal(saved.transactions[0].fundCode, 120828)
  assert.equal(saved.fundSummaries[0].marketValueDate, '2024-03-28')
  await page.getByRole('columnheader', { name: /XIRR/ }).waitFor()
  assert.equal(errors.length, 0, errors.join('\n'))
  const staticResources = outbound.filter(r => r.method === 'GET' && !r.body && (
    (new URL(r.url).origin === 'https://fonts.googleapis.com' && r.type === 'stylesheet') ||
    (r.url === 'https://gc.zgo.at/count.js' && r.type === 'script')
  ))
  assert.equal(outbound.length, staticResources.length, 'Only pre-existing public stylesheet/script loads may be attempted; no import request or telemetry')
  assert.ok(outbound.every(r => !decodeURIComponent(r.url).includes(sourceName) && !r.body), 'No statement contents in outbound requests')
  console.log('PASS portfolio import browser: review, local correction, plan mismatch, cancel, quota failure, confirm and recompute')
} finally {
  if (browser) await browser.close()
  await server.close()
}
