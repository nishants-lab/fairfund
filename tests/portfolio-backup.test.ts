import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decryptPortfolioBackup, encryptPortfolioBackup, MAX_BACKUP_BYTES, PortfolioBackupError, readPortfolioBackupFile, validateBackupPortfolio } from '../src/lib/portfolioBackup'
import type { ParsedPortfolio } from '../src/lib/portfolio'

const password = 'a unique test passphrase 🔐'
const portfolio: ParsedPortfolio = {
  id: 'test-portfolio', uploadedAt: new Date().toISOString(), matcherVersion: 5,
  investorName: 'Test Investor', pan: 'XXXX123A', fundCodes: [123456],
  transactions: [{ fundCode: 123456, fundName: 'Test Direct Growth', date: new Date().toISOString().slice(0, 10), type: 'purchase', units: 10, amount: 100, nav: 10 }],
  fundSummaries: [
    { fundCode: 123456, fundName: 'Test Direct Growth', closingUnits: 10, totalCost: 100, latestNav: 12, marketValue: 120, navDate: null, marketValueDate: null, openingUnits: 0, historyUnusable: false },
    { fundCode: 0, fundName: 'Unmatched Fund', closingUnits: 2, totalCost: 20, latestNav: 0, marketValue: 0 },
  ],
  diagnostics: { isinCount: 2, schemesParsed: 2, activeHoldings: 2, closedPositions: 0, missingValueFunds: ['Unmatched Fund'], statedTotalValue: null },
}
let encrypted: string
before(async () => { encrypted = await encryptPortfolioBackup(portfolio, password) })

function errorCode(code: PortfolioBackupError['code']) {
  return (error: unknown) => error instanceof PortfolioBackupError && error.code === code
}
function changed(fields: Record<string, unknown>): string { return JSON.stringify({ ...JSON.parse(encrypted), ...fields }) }
function changedBase64(field: string): string {
  const bytes = Buffer.from(JSON.parse(encrypted)[field], 'base64')
  bytes[0] ^= 1
  return changed({ [field]: bytes.toString('base64') })
}

async function authenticatedPayload(value: unknown): Promise<string> {
  const envelope = JSON.parse(encrypted)
  const { ciphertext: _, ...header } = envelope
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(header.salt, 'base64'), hash: 'SHA-256', iterations: header.iterations }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: Buffer.from(header.iv, 'base64'), additionalData: new TextEncoder().encode(JSON.stringify(header)), tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify(value)))
  return JSON.stringify({ ...header, ciphertext: Buffer.from(ciphertext).toString('base64') })
}

test('round trip preserves exact local shape, unknown funds and absent/null optional fields', async () => {
  assert.deepEqual(await decryptPortfolioBackup(encrypted, password), portfolio)
  const legacy = structuredClone(portfolio)
  delete legacy.matcherVersion
  delete legacy.diagnostics
  legacy.fundSummaries[0].openingUnits = null
  assert.deepEqual(await decryptPortfolioBackup(await encryptPortfolioBackup(legacy, password), password), legacy)
})

test('random salt and nonce produce different ciphertext and no plaintext metadata', async () => {
  const second = JSON.parse(await encryptPortfolioBackup(portfolio, password))
  const first = JSON.parse(encrypted)
  for (const field of ['salt', 'iv', 'ciphertext']) assert.notEqual(first[field], second[field])
  assert.equal(Buffer.from(first.salt, 'base64').length, 16)
  assert.equal(Buffer.from(first.iv, 'base64').length, 12)
  assert.equal(first.iterations, 600_000)
  for (const secret of [portfolio.investorName, portfolio.pan, portfolio.id, portfolio.fundSummaries[0].fundName, password]) assert.equal(encrypted.includes(secret), false)
})

test('wrong password and ciphertext, tag, salt or nonce tampering fail authentication', async () => {
  await assert.rejects(decryptPortfolioBackup(encrypted, 'a wrong test passphrase'), errorCode('authentication'))
  for (const field of ['ciphertext', 'salt', 'iv']) await assert.rejects(decryptPortfolioBackup(changedBase64(field), password), errorCode('authentication'))
  const bytes = Buffer.from(JSON.parse(encrypted).ciphertext, 'base64')
  bytes[bytes.length - 1] ^= 1
  await assert.rejects(decryptPortfolioBackup(changed({ ciphertext: bytes.toString('base64') }), password), errorCode('authentication'))
})

test('truncation is rejected both at JSON and valid-base64 ciphertext level', async () => {
  await assert.rejects(decryptPortfolioBackup(encrypted.slice(0, -20), password), errorCode('format'))
  const bytes = Buffer.from(JSON.parse(encrypted).ciphertext, 'base64')
  await assert.rejects(decryptPortfolioBackup(changed({ ciphertext: bytes.subarray(0, -16).toString('base64') }), password), errorCode('authentication'))
})

test('strict envelope rejects unknown versions, algorithms, attacker-selected work and unknown keys', async () => {
  await assert.rejects(decryptPortfolioBackup(changed({ version: 2 }), password), errorCode('version'))
  for (const fields of [{ iterations: 1 }, { iterations: 1e15 }, { cipher: 'AES-CBC' }, { kdf: 'other' }, { format: 'other' }, { extra: true }, { iv: 'A===' }, { salt: 'YQ==' }, { ciphertext: '' }]) {
    await assert.rejects(decryptPortfolioBackup(changed(fields), password), errorCode('format'))
  }
  await assert.rejects(decryptPortfolioBackup(JSON.stringify(portfolio), password), errorCode('format'))
})

test('file size limits apply before reading and to UTF-8 bytes', async () => {
  let read = false
  await assert.rejects(readPortfolioBackupFile({ size: MAX_BACKUP_BYTES + 1, text: async () => { read = true; return '' } }), errorCode('size'))
  assert.equal(read, false)
  await assert.rejects(readPortfolioBackupFile({ size: 0, text: async () => '' }), errorCode('size'))
  await assert.rejects(decryptPortfolioBackup('x'.repeat(MAX_BACKUP_BYTES + 1), password), errorCode('size'))
  await assert.rejects(decryptPortfolioBackup('é'.repeat(MAX_BACKUP_BYTES / 2 + 1), password), errorCode('size'))
  assert.equal(await readPortfolioBackupFile({ size: encrypted.length, text: async () => encrypted }), encrypted)
})

test('bounded plaintext and collection sizes are enforced before expensive encryption', async () => {
  const large = structuredClone(portfolio)
  large.transactions = Array.from({ length: 20_000 }, () => ({ ...portfolio.transactions[0], fundName: 'x'.repeat(1000) }))
  await assert.rejects(encryptPortfolioBackup(large, password), errorCode('size'))
  large.transactions.push(portfolio.transactions[0])
  assert.throws(() => validateBackupPortfolio(large), errorCode('schema'))
  const tooManyFunds = structuredClone(portfolio)
  tooManyFunds.fundSummaries = Array.from({ length: 2001 }, () => portfolio.fundSummaries[0])
  assert.throws(() => validateBackupPortfolio(tooManyFunds), errorCode('schema'))
})

test('password policy preserves whitespace and rejects weak or unbounded passwords', async () => {
  for (const invalid of ['', 'short', ' '.repeat(12), 'x'.repeat(1025)]) await assert.rejects(encryptPortfolioBackup(portfolio, invalid), errorCode('password'))
  const spaced = `  ${password}  `
  const content = await encryptPortfolioBackup(portfolio, spaced)
  assert.deepEqual(await decryptPortfolioBackup(content, spaced), portfolio)
  await assert.rejects(decryptPortfolioBackup(content, password), errorCode('authentication'))
})

test('strict portfolio schema rejects invalid nested structures and unknown fields', () => {
  const mutations = [
    (p: any) => { p.transactions = {} },
    (p: any) => { p.transactions[0].amount = Infinity },
    (p: any) => { p.transactions[0].nav = -1 },
    (p: any) => { p.transactions[0].type = 'other' },
    (p: any) => { p.transactions[0].date = '2025-02-30' },
    (p: any) => { p.transactions[0].extra = 'no' },
    (p: any) => { p.fundSummaries[0].historyUnusable = 'yes' },
    (p: any) => { p.fundSummaries[0].navDate = 'unknown' },
    (p: any) => { p.fundSummaries[0].openingUnits = -1 },
    (p: any) => { p.fundSummaries[0].fundCode = 1.5 },
    (p: any) => { p.fundCodes = [123456, 123456] },
    (p: any) => { p.fundCodes = [] },
    (p: any) => { p.fundCodes = [123456, 999999] },
    (p: any) => { p.uploadedAt = '2025-02-30T00:00:00.000Z' },
    (p: any) => { p.pan = 'ABCDE1234F' },
    (p: any) => { p.investorName = 'x'.repeat(501) },
    (p: any) => { p.diagnostics.missingValueFunds = [1] },
    (p: any) => { p.diagnostics.statedTotalValue = '100' },
    (p: any) => { p.diagnostics.closedPositions = -1 },
    (p: any) => { p.extra = {} },
  ]
  for (const mutate of mutations) {
    const p = structuredClone(portfolio)
    mutate(p)
    assert.throws(() => validateBackupPortfolio(p), errorCode('schema'))
  }
  assert.throws(() => validateBackupPortfolio(JSON.parse('{"__proto__":{}}')), errorCode('schema'))
})

test('even authenticated arbitrary JSON cannot be imported as a portfolio', async () => {
  for (const value of [{ arbitrary: 'value' }, { ...portfolio, transactions: [{ ...portfolio.transactions[0], amount: '100' }] }]) {
    await assert.rejects(decryptPortfolioBackup(await authenticatedPayload(value), password), errorCode('schema'))
  }
})

test('backup implementation has no network, storage, analytics or content logging API', () => {
  for (const path of ['src/lib/portfolioBackup.ts', 'src/components/PortfolioBackup.tsx']) {
    const source = readFileSync(resolve(path), 'utf8')
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|supabase)\b|console\./)
  }
})

test('browser preview requires explicit approval, cancel preserves saved state, and download is encrypted', async () => {
  const { createRequire } = await import('node:module')
  const { createServer } = await import('node:http')
  const require = createRequire(resolve('package.json'))
  const { buildSync } = require('esbuild')
  const { chromium } = require('playwright')
  const bundle = buildSync({
    stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import PortfolioBackup from './src/components/PortfolioBackup'; window.restored = []; createRoot(document.getElementById('root')).render(React.createElement(PortfolioBackup, { portfolio: ${JSON.stringify(portfolio)}, onRestore: p => { window.restored.push(p) } }));`, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true, format: 'iife', platform: 'browser', write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/app.js' ? bundle : '<div id="root"></div><script src="/app.js"></script>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  let browser: any
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    const unexpectedRequests: string[] = []
    const pageErrors: string[] = []
    page.on('pageerror', (error: Error) => pageErrors.push(error.message))
    await page.route('**/*', (route: any) => {
      if ([`${origin}/`, `${origin}/app.js`].includes(route.request().url()) && route.request().method() === 'GET') return route.continue()
      unexpectedRequests.push(route.request().url())
      return route.abort()
    })
    await page.goto(origin)
    const passwordInput = page.getByLabel('Backup password', { exact: true })
    await page.getByLabel('Restore a backup file').setInputFiles({ name: 'test.ffbackup', mimeType: 'application/json', buffer: Buffer.from(encrypted) })
    await passwordInput.fill('a wrong test passphrase')
    await page.getByRole('button', { name: 'Unlock and preview backup' }).click()
    await page.getByRole('alert').filter({ hasText: 'password is incorrect' }).waitFor()
    assert.deepEqual(await page.evaluate(() => (window as any).restored), [])
    await passwordInput.fill(password)
    await page.getByRole('button', { name: 'Unlock and preview backup' }).click()
    await page.getByRole('heading', { name: 'Review before restoring' }).waitFor()
    assert.equal(await passwordInput.inputValue(), '')
    assert.deepEqual(await page.evaluate(() => (window as any).restored), [])
    assert.equal(await page.getByRole('button', { name: 'Replace saved portfolio' }).isDisabled(), true)
    await page.getByRole('button', { name: 'Cancel restore' }).click()
    assert.deepEqual(await page.evaluate(() => (window as any).restored), [])
    await passwordInput.fill(password)
    await page.getByRole('button', { name: 'Unlock and preview backup' }).click()
    await page.getByRole('heading', { name: 'Review before restoring' }).waitFor()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Replace saved portfolio' }).click()
    await page.getByRole('status').filter({ hasText: 'Portfolio restored' }).waitFor()
    assert.deepEqual(await page.evaluate(() => (window as any).restored), [portfolio])
    await passwordInput.fill(password)
    await page.getByLabel('Confirm password for download').fill(password)
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download encrypted backup' }).click()
    const download = await downloadEvent
    const downloaded = readFileSync(await download.path(), 'utf8')
    assert.deepEqual(await decryptPortfolioBackup(downloaded, password), portfolio)
    assert.equal(await passwordInput.inputValue(), '')
    assert.equal(await page.getByLabel('Confirm password for download').inputValue(), '')
    assert.deepEqual(unexpectedRequests, [])
    assert.deepEqual(pageErrors, [])
  } finally {
    if (browser) await browser.close()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
