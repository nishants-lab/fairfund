/** Generate a complete, canonical sitemap after gen-unfurls.mjs.
 * Missing or redirecting public pages are build failures, never silent omissions.
 * Omit optional lastmod until per-page content modification dates are available.
 * A build timestamp is not evidence that every page's content changed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SITE } from './site-config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const data = JSON.parse(readFileSync(join(ROOT, 'src/data/funds.json'), 'utf-8'))
if (!Array.isArray(data.funds) || !data.funds.length) throw new Error('No fund inventory for sitemap')
const funds = data.funds
const site = new URL(SITE)
if (site.protocol !== 'https:' || site.search || site.hash || SITE.endsWith('/')) throw new Error('SITE must be an HTTPS base without query, fragment or trailing slash')
const paths = ['','s/explore/','s/compare/','s/movers/','s/methodology/']
const catSlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
for (const [key, category] of Object.entries(data.categories ?? {})) {
  if (category.fundCount > 0) {
    const slug = catSlug(key)
    if (!slug) throw new Error(`Empty category slug: ${key}`)
    paths.push(`c/${slug}/`)
  }
}
for (const fund of funds) {
  if (!Number.isSafeInteger(fund.code) || fund.code <= 0) throw new Error('Invalid fund code for sitemap')
  paths.push(`f/${fund.code}/`)
}
if (new Set(paths).size !== paths.length) throw new Error('Duplicate sitemap path')
if (paths.length > 50000) throw new Error('Sitemap exceeds 50000 URLs; split before publication')
const escapeXml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
for (const path of paths) {
  const file = join(DIST, path, 'index.html')
  if (!existsSync(file)) throw new Error(`Missing sitemap page: ${path || '/'}`)
  if (!path) continue // The home entry is the interactive app, not a generated report.
  const html = readFileSync(file, 'utf-8')
  const expected = `${SITE}/${path}`
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/)
  if (!canonical || canonical[1] !== escapeXml(expected)) throw new Error(`Canonical mismatch: ${path}`)
  if (/location\s*\.\s*(replace|assign)|http-equiv\s*=\s*["']refresh/i.test(html)) throw new Error(`Automatic redirect in sitemap page: ${path}`)
  if (!/<h1[\s>]/i.test(html)) throw new Error(`Missing page heading: ${path}`)
}
const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...paths.map(path => `  <url><loc>${escapeXml(`${SITE}/${path}`)}</loc></url>`), '</urlset>', ''].join('\n')
if (Buffer.byteLength(xml) > 50 * 1024 * 1024) throw new Error('Sitemap exceeds 50MB')
writeFileSync(join(DIST, 'sitemap.xml'), xml)
console.log(`sitemap.xml: ${paths.length} validated URLs (1 home + ${paths.length - 1 - funds.length} sections + ${funds.length} funds)`)
