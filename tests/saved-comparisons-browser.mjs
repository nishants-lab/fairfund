import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../', import.meta.url))
const bundle = buildSync({
  absWorkingDir: root, bundle: true, write: false, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import SavedComparisons from './src/components/SavedComparisons'
    createRoot(document.getElementById('root')).render(<SavedComparisons
      fundCodes={[100, 200]} start="2020-01-01" end="2021-01-01"
      onLoad={record => { if (window.rejectLoad) return 'A saved fund is no longer available.'; window.loadedComparison = record }} />)
  ` },
}).outputFiles[0].text
const html = '<!doctype html><html><body><div id="root"></div><script type="module" src="/component.js"></script></body></html>'
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/component.js' ? 'text/javascript' : 'text/html')
  response.end(request.url === '/component.js' ? bundle : html)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const key = 'fairfund_saved_comparisons'
try {
  const page = await browser.newPage()
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request))
  await page.goto(base)
  await page.getByRole('heading', { name: 'Saved comparisons' }).waitFor()
  await page.getByLabel('Comparison name', { exact: true }).fill('Research set')
  await page.getByLabel('Private note (optional)', { exact: true }).fill('<script>privateNote()</script>')
  await page.getByRole('button', { name: 'Save comparison', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'saved in this browser' }).waitFor()
  assert.equal(await page.locator('li').count(), 1)
  await page.reload()
  await page.getByRole('button', { name: 'Load Research set', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.loadedComparison.fundCodes), [100, 200])
  assert.equal(await page.evaluate(() => window.loadedComparison.start), '2020-01-01')
  assert.equal(await page.getByLabel('Private note (optional)', { exact: true }).inputValue(), '<script>privateNote()</script>')
  await page.evaluate(() => { window.rejectLoad = true })
  await page.getByRole('button', { name: 'Load Research set', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'no longer available' }).waitFor()
  assert.equal(await page.getByRole('status').textContent(), '')
  await page.getByRole('button', { name: 'Delete Research set', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'deleted' }).waitFor()
  assert.equal(await page.locator('li').count(), 0)
  await page.evaluate(key => localStorage.setItem(key, '{malformed'), key)
  await page.reload()
  await page.getByRole('alert').filter({ hasText: 'could not be read' }).waitFor()
  await page.getByLabel('Comparison name', { exact: true }).fill('Cannot overwrite')
  await page.getByRole('button', { name: 'Save comparison', exact: true }).click()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), '{malformed')
  await page.evaluate(key => localStorage.removeItem(key), key)
  await page.getByRole('button', { name: 'Refresh list', exact: true }).click()
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') } })
  await page.getByRole('button', { name: 'Save comparison', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Changes were not saved' }).waitFor()
  assert.equal(await page.getByRole('status').textContent(), '')
  assert.equal(await page.locator('li').count(), 0)
  assert.deepEqual(errors, [])
  assert(requests.every(request => request.url().startsWith(base) && request.method() === 'GET' && !request.postData()))
  assert(requests.every(request => !/Research|privateNote|Cannot/.test(request.url())))
  console.log('PASS real React save/reload/load/delete, escaped private note, callback refusal, malformed/quota storage and no network payloads')
  await page.close()
  const denied = await browser.newPage()
  await denied.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError') } }))
  await denied.goto(base)
  await denied.getByRole('alert').filter({ hasText: 'storage is unavailable' }).waitFor()
  await denied.getByLabel('Comparison name', { exact: true }).fill('Blocked browser')
  await denied.getByRole('button', { name: 'Save comparison', exact: true }).click()
  assert.equal(await denied.getByRole('status').textContent(), '')
  assert.equal(await denied.locator('li').count(), 0)
  console.log('PASS storage accessor denied, no false saved confirmation')
  await denied.close()
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
