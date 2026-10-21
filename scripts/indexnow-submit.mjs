/** Submit every sitemap URL to IndexNow (Bing, Yandex, Seznam, Naver, Yep).
 * Bing's index also feeds DuckDuckGo, Copilot and ChatGPT search.
 *
 * Usage: node scripts/indexnow-submit.mjs [--sitemap <url|path>] [--dry-run]
 *   --sitemap  default: the live ${SITE}/sitemap.xml
 *   --dry-run  validate and print the payload; no network calls
 *
 * Fail-closed: foreign/fragment URLs, an empty sitemap, or a live key file that
 * does not match INDEXNOW_KEY abort before anything is submitted.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { SITE, INDEXNOW_KEY } from './site-config.mjs'

export const ENDPOINT = 'https://api.indexnow.org/indexnow'
const MAX_PER_REQUEST = 10000

export function parseSitemap(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m =>
    m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
}

export function validateUrls(urls, site = SITE) {
  if (!urls.length) throw new Error('Sitemap has no URLs')
  const base = `${site}/`
  const seen = new Set()
  for (const u of urls) {
    const parsed = new URL(u)
    if (parsed.protocol !== 'https:') throw new Error(`Not HTTPS: ${u}`)
    if (!u.startsWith(base)) throw new Error(`Outside ${base}: ${u}`)
    if (parsed.hash) throw new Error(`Fragment URL: ${u}`)
    seen.add(u)
  }
  return [...seen]
}

export function buildPayloads(urls, site = SITE, key = INDEXNOW_KEY) {
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new Error('Invalid IndexNow key format')
  const host = new URL(site).host
  const keyLocation = `${site}/${key}.txt`
  const out = []
  for (let i = 0; i < urls.length; i += MAX_PER_REQUEST) {
    out.push({ host, key, keyLocation, urlList: urls.slice(i, i + MAX_PER_REQUEST) })
  }
  return out
}

async function fetchText(url, attempts = 6) {
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
      if (r.ok) return await r.text()
      last = new Error(`HTTP ${r.status} for ${url}`)
    } catch (e) { last = e }
    await new Promise(res => setTimeout(res, 20000)) // Pages CDN can lag a fresh deploy
  }
  throw last
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const i = args.indexOf('--sitemap')
  const source = i >= 0 ? args[i + 1] : `${SITE}/sitemap.xml`
  if (!source) throw new Error('--sitemap needs a value')
  const xml = /^https?:\/\//.test(source) ? await fetchText(source) : readFileSync(source, 'utf-8')
  const urls = validateUrls(parseSitemap(xml))
  const payloads = buildPayloads(urls)
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, urls: urls.length, requests: payloads.length, host: payloads[0].host, keyLocation: payloads[0].keyLocation, sample: urls.slice(0, 3) }))
    return
  }
  const live = (await fetchText(payloads[0].keyLocation)).trim()
  if (live !== INDEXNOW_KEY) throw new Error(`Live key file ${payloads[0].keyLocation} does not match INDEXNOW_KEY`)
  const waitMs = Number(process.env.INDEXNOW_RETRY_MS ?? 60000)
  for (const body of payloads) await submitWithRetry(body, { waitMs })
}

/** A new key gets 403 SiteVerificationNotCompleted until the engine has fetched
 * the key file; 429/5xx are transient. Retry those with backoff, fail on others. */
export function isRetryable(status, text) {
  return status === 429 || status >= 500 || (status === 403 && /SiteVerificationNotCompleted/.test(text))
}

export async function submitWithRetry(body, { attempts = 8, waitMs = 60000, post = defaultPost, log = console.log } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const { status, text } = await post(body)
    log(`[indexnow] attempt ${i}: ${body.urlList.length} URLs -> HTTP ${status} ${String(text).slice(0, 200)}`)
    if (status === 200 || status === 202) return status
    if (!isRetryable(status, text) || i === attempts) throw new Error(`IndexNow rejected submission: HTTP ${status}`)
    await new Promise(res => setTimeout(res, waitMs * i))
  }
}

async function defaultPost(body) {
  const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) })
  return { status: r.status, text: await r.text().catch(() => '') }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(`[indexnow] ${e.message}`); process.exit(1) })
}
