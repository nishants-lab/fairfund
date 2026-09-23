/**
 * gen-sitemap.mjs — Generate sitemap.xml + robots.txt from the fund shells
 * and section pages already in dist/. Run AFTER gen-unfurls.mjs.
 *
 * Output:  dist/sitemap.xml, dist/robots.txt
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SITE } from './site-config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

const data = JSON.parse(readFileSync(join(ROOT, 'src/data/funds.json'), 'utf-8'))
const funds = data.funds ?? []
const today = new Date().toISOString().split('T')[0]

const urls = []

// Home
urls.push({ loc: `${SITE}/`, priority: '1.0', changefreq: 'weekly' })

// Section pages
for (const page of ['explore', 'compare', 'movers', 'methodology']) {
  const shellPath = join(DIST, 's', page, 'index.html')
  if (existsSync(shellPath)) {
    urls.push({ loc: `${SITE}/s/${page}/`, priority: '0.8', changefreq: 'weekly' })
  }
}

// Per-fund pages
for (const f of funds) {
  const shellPath = join(DIST, 'f', String(f.code), 'index.html')
  if (existsSync(shellPath)) {
    urls.push({ loc: `${SITE}/f/${f.code}/`, priority: '0.6', changefreq: 'monthly' })
  }
}

// Build sitemap XML
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls.map(u => [
    '  <url>',
    `    <loc>${u.loc}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${u.changefreq}</changefreq>`,
    `    <priority>${u.priority}</priority>`,
    '  </url>',
  ].join('\n')),
  '</urlset>',
].join('\n')

writeFileSync(join(DIST, 'sitemap.xml'), xml)
console.log(`sitemap.xml: ${urls.length} URLs (1 home + ${urls.length - 1 - funds.length > 0 ? urls.length - 1 - funds.length : 0} sections + ${funds.filter(f => existsSync(join(DIST, 'f', String(f.code), 'index.html'))).length} funds)`)

// robots.txt is in public/ (copied by Vite); sitemap URL already added there.
