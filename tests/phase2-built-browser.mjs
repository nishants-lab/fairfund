import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preview } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
assert.ok(existsSync(join(dist, 'index.html')), 'Run the approved full build before this built-artifact test.')
const codes = [111549, 120503]
const now = new Date()
const today = now.toISOString().slice(0, 10)
const navDates = codes.map(code => JSON.parse(readFileSync(join(dist, 'nav', `${code}.json`), 'utf8')).d.filter(date => date <= today))
const commonStart = navDates.map(dates => dates[0]).sort().at(-1)
const end = navDates.map(dates => dates.at(-1)).sort()[0]
const start = new Date(Math.max(Date.parse(commonStart), Date.parse(end) - 400 * 86400000)).toISOString().slice(0, 10)
assert.ok(start < end && end <= today, 'The built comparison fixtures need a valid overlapping NAV window.')
const transactionDate = new Date(Date.parse(end) - 370 * 86400000).toISOString().slice(0, 10)
function camsDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`)
  return `${date.getUTCDate()}-${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}-${date.getUTCFullYear()}`
}
const statement = [
  'PAN : ABCDE1234F',
  'Folio No : 12345678 Test Investor',
  'Parag Parikh Flexi Cap Fund - Direct Plan - Growth - ISIN : INF000000001',
  'Opening Unit Balance: 0.000',
  `${camsDate(transactionDate)} Purchase 10000.00 100.0000 100.000 100.000`,
  `NAV on ${camsDate(end)}: INR 120.0000 Market Value on ${camsDate(end)}: INR 12000.00`,
  'Closing Unit Balance: 100.000 Total Cost Value: 10000.00',
  'Total 10000.00 12000.00',
].join('\n')
const password = 'Synthetic browser backup passphrase 42'

const server = await preview({ root, configFile: false, build: { outDir: dist }, preview: { host: '127.0.0.1', port: 0, strictPort: true, open: false } })
const address = server.httpServer.address()
assert.ok(address && typeof address !== 'string')
const origin = `http://127.0.0.1:${address.port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  for (const viewport of [{ width: 1280, height: 900 }, { width: 360, height: 800 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce', acceptDownloads: true })
    const errors = []
    const unsafeRequests = []
    const externalBlocked = []
    await context.route('**/*', route => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.origin !== origin) {
        externalBlocked.push(url.hostname)
        return route.abort()
      }
      if (request.method() !== 'GET' || url.pathname.startsWith('/src/')) {
        unsafeRequests.push(`${request.method()} ${url.pathname}`)
        return route.abort()
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => errors.push(error.message))
    async function layout(label) {
      const measurements = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
      assert.ok(measurements.content <= measurements.viewport + 1, `${label} overflows ${measurements.content}px at ${measurements.viewport}px viewport`)
      assert.deepEqual(errors, [], `${label}: browser page errors`)
    }
    async function navigate(path) {
      await page.goto(`${origin}/#${path}`, { waitUntil: 'domcontentloaded' })
      await page.locator('main h1').waitFor()
    }
    async function stored(key) {
      return page.evaluate(key => {
        const value = localStorage.getItem(key)
        return value === null ? null : JSON.parse(value)
      }, key)
    }

    try {
      await navigate(`/compare?codes=${codes.join(',')}`)
      const saved = page.getByRole('region', { name: 'Saved comparisons', exact: true })
      await page.getByText('Save or load a comparison', { exact: true }).click()
      await saved.waitFor()
      const dates = page.locator('input[type="date"]')
      await dates.nth(0).waitFor()
      await page.waitForFunction(() => [...document.querySelectorAll('input[type="date"]')].length === 2 && [...document.querySelectorAll('input[type="date"]')].every(input => input.value))
      await dates.nth(0).fill(start)
      await dates.nth(1).fill(end)
      const comparisonName = `Built comparison ${viewport.width}`
      const note = 'Synthetic private note retained only in this browser.'
      await saved.getByLabel('Comparison name').fill(comparisonName)
      await saved.getByLabel('Private note (optional)').fill(note)
      await saved.getByRole('button', { name: 'Save comparison', exact: true }).click()
      await saved.getByRole('status').filter({ hasText: 'Comparison saved' }).waitFor()
      const comparison = await stored('fairfund_saved_comparisons')
      assert.equal(comparison.records.length, 1)
      assert.equal(comparison.records[0].start, start)
      assert.equal(comparison.records[0].end, end)
      assert.deepEqual(comparison.records[0].fundCodes, codes)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByText('Save or load a comparison', { exact: true }).click()
      await saved.getByRole('button', { name: `Load ${comparisonName}`, exact: true }).click()
      await saved.getByRole('status').filter({ hasText: 'Saved funds and dates loaded' }).waitFor()
      assert.equal(await dates.nth(0).inputValue(), start)
      assert.equal(await dates.nth(1).inputValue(), end)
      assert.equal(await saved.getByLabel('Private note (optional)').inputValue(), note)
      assert.deepEqual(await stored('fairfund_saved_comparisons'), comparison)
      await layout('Saved comparison after reload and load')

      await page.evaluate(codes => { localStorage.setItem('fairfund_wishlist', JSON.stringify(codes)); window.dispatchEvent(new CustomEvent('wishlist-change')) }, codes)
      await navigate('/wishlist')
      const changes = page.getByRole('region', { name: 'Since your last review', exact: true })
      await changes.waitFor()
      await page.waitForFunction(codes => {
        const state = JSON.parse(localStorage.getItem('fairfund_fund_changes_v1') || 'null')
        return codes.every(code => state?.funds?.[code])
      }, codes)
      const baseline = await stored('fairfund_fund_changes_v1')
      for (const code of codes) {
        assert.match(baseline.funds[code].reviewedOn, /^\d{4}-\d{2}-\d{2}$/)
        assert.deepEqual(baseline.funds[code].changes, [])
        assert.deepEqual(baseline.funds[code].baseline, baseline.funds[code].latest)
      }
      await changes.getByText('No comparable changes recorded.', { exact: false }).first().waitFor()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await changes.getByText('No comparable changes recorded.', { exact: false }).first().waitFor()
      assert.deepEqual(await stored('fairfund_fund_changes_v1'), baseline)
      await layout('Wishlist baseline persisted without manufactured changes')

      await navigate('/my/portfolio')
      assert.equal(await stored('fairfund_portfolio'), null)
      await page.locator('input[type="file"][accept=".pdf,.txt,.csv"]').setInputFiles({ name: 'synthetic-statement.txt', mimeType: 'text/plain', buffer: Buffer.from(statement) })
      const review = page.getByRole('region', { name: 'Review statement import', exact: true })
      await review.waitFor()
      assert.equal(await stored('fairfund_portfolio'), null, 'Parsing must not persist before approval')
      const confirm = review.getByRole('button', { name: 'Confirm and save portfolio', exact: true })
      assert.equal(await confirm.isDisabled(), true)
      await layout('Statement import review')
      await review.getByRole('checkbox').check()
      await confirm.click()
      await page.waitForFunction(() => localStorage.getItem('fairfund_portfolio') !== null)
      const original = await stored('fairfund_portfolio')
      assert.equal(original.transactions.length, 1)
      assert.equal(original.fundSummaries.length, 1)
      assert.equal(original.fundSummaries[0].marketValue, 12000)
      assert.equal(original.fundSummaries[0].marketValueDate, end)

      const backup = page.getByRole('region', { name: 'Encrypted portfolio backup', exact: true })
      const passwordInput = backup.getByLabel('Backup password', { exact: true })
      await passwordInput.fill(password)
      await backup.getByLabel('Confirm password for download').fill(password)
      const downloadEvent = page.waitForEvent('download')
      await backup.getByRole('button', { name: 'Download encrypted backup', exact: true }).click()
      const download = await downloadEvent
      const encrypted = readFileSync(await download.path(), 'utf8')
      const envelope = JSON.parse(encrypted)
      assert.equal(envelope.version, 1)
      assert.equal(envelope.cipher, 'AES-256-GCM')
      assert.equal(envelope.iterations, 600000)
      for (const secret of [original.investorName, original.pan, original.fundSummaries[0].fundName, password]) {
        if (secret) assert.equal(encrypted.includes(secret), false, 'Encrypted file exposed synthetic plaintext')
      }
      assert.equal(await passwordInput.inputValue(), '')
      await page.getByRole('button', { name: 'Clear data', exact: true }).click()
      assert.equal(await stored('fairfund_portfolio'), null)
      await backup.getByLabel('Restore a backup file').setInputFiles({ name: 'synthetic.ffbackup', mimeType: 'application/json', buffer: Buffer.from(encrypted) })
      await passwordInput.fill('Wrong synthetic password 42')
      await backup.getByRole('button', { name: 'Unlock and preview backup', exact: true }).click()
      await backup.getByRole('alert').filter({ hasText: 'password is incorrect' }).waitFor()
      assert.equal(await stored('fairfund_portfolio'), null)
      await passwordInput.fill(password)
      await backup.getByRole('button', { name: 'Unlock and preview backup', exact: true }).click()
      await backup.getByRole('heading', { name: 'Review before restoring', exact: true }).waitFor()
      assert.equal(await stored('fairfund_portfolio'), null, 'Unlocked preview must not restore without consent')
      const replace = backup.getByRole('button', { name: 'Replace saved portfolio', exact: true })
      assert.equal(await replace.isDisabled(), true)
      await layout('Encrypted backup restore preview')
      await backup.getByRole('checkbox').check()
      await replace.click()
      await backup.getByRole('status').filter({ hasText: 'Portfolio restored in this browser' }).waitFor()
      assert.deepEqual(await stored('fairfund_portfolio'), original)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await backup.waitFor()
      assert.deepEqual(await stored('fairfund_portfolio'), original)
      await layout('Restored portfolio after reload')
      assert.deepEqual(unsafeRequests, [], 'Only static built-file GET requests are allowed')
      assert.deepEqual(errors, [])
      console.log(`PASS built phase 2 ${viewport.width}px: comparison dates, wishlist baseline, reviewed import, encrypted restore; ${externalBlocked.length} external requests blocked`)
    } catch (error) {
      console.error(JSON.stringify({ viewport: viewport.width, pageErrors: errors, unsafeRequests, externalBlocked, pageText: (await page.locator('body').innerText()).slice(0, 16000) }, null, 2))
      throw error
    } finally {
      await context.close()
    }
  }
  console.log('ALL BUILT PHASE 2 JOURNEYS PASSED')
} finally {
  if (browser) await browser.close()
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
