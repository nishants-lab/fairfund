/** Give crawlers a real homepage: run after gen-unfurls.mjs, before gen-sitemap.mjs.
 * The interactive app is a JS-only shell, so crawlers that do not execute
 * JavaScript (Bing often, ChatGPT/Perplexity/Brave crawlers usually) saw an
 * empty page with no links. This injects plain HTML into #root (React replaces
 * it on mount, so users see the same app), a canonical URL and WebSite JSON-LD.
 * Every injected link must point at a generated page, or the build fails.
 * Idempotent: re-running replaces the previous injection.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SITE } from './site-config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const INDEX = join(DIST, 'index.html')
const data = JSON.parse(readFileSync(join(ROOT, 'src/data/funds.json'), 'utf-8'))
const total = data.totalFunds ?? (data.funds ?? []).length
if (!total) throw new Error('No fund inventory for homepage')

// Mirror gen-unfurls.mjs / gen-sitemap.mjs exactly so links match real pages.
const catSlug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const sections = [
  ['s/explore/', 'Explore all categories'],
  ['s/compare/', 'Compare funds'],
  ['s/movers/', 'Fund flows and movers'],
  ['s/nfo/', 'New fund offers'],
  ['s/methodology/', 'How the numbers are calculated'],
]
const cats = Object.entries(data.categories ?? {})
  .map(([key, c]) => ({ key, display: c.display || key, count: c.fundCount ?? 0 }))
  .filter(c => c.count > 0)
  .sort((a, b) => b.count - a.count || a.display.localeCompare(b.display))
const links = [...sections.map(([p]) => p), ...cats.map(c => `c/${catSlug(c.key)}/`)]
for (const path of links) {
  if (!existsSync(join(DIST, path, 'index.html'))) throw new Error(`Homepage links to missing page: ${path}`)
}

const desc = `Research ${total} Indian mutual funds, compare funds within their categories and review the holdings in your portfolio.`
const body = `<!--crawl-home--><main style="max-width:760px;margin:0 auto;padding:32px 20px;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#1e293b">
<h1 style="font-size:28px;margin:0 0 8px">FairFund: Indian mutual fund research</h1>
<p style="margin:0 0 16px">${esc(desc)} Rankings use NAV history, costs and disclosed portfolios, updated every weekday.</p>
<nav aria-label="Research pages"><ul style="padding-left:18px">${sections.map(([p, label]) => `<li><a href="${SITE}/${p}">${esc(label)}</a></li>`).join('')}</ul></nav>
<h2 style="font-size:20px;margin:24px 0 8px">Fund categories</h2>
<ul style="padding-left:18px">${cats.map(c => `<li><a href="${SITE}/c/${catSlug(c.key)}/">${esc(c.display)} funds</a> (${c.count})</li>`).join('')}</ul>
<p style="font-size:12px;color:#475569;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>
</main><!--/crawl-home-->`

let html = readFileSync(INDEX, 'utf-8')
const injected = /<div id="root"><!--crawl-home-->[\s\S]*?<!--\/crawl-home--><\/div>/
const empty = /<div id="root"><\/div>/
const matches = (html.match(new RegExp(injected.source, 'g')) || []).length + (html.match(new RegExp(empty.source, 'g')) || []).length
if (matches !== 1) throw new Error(`Expected exactly one #root container in dist/index.html, found ${matches}`)
html = html.replace(injected.test(html) ? injected : empty, `<div id="root">${body}</div>`)

const canonical = `<link rel="canonical" href="${SITE}/" />`
html = html.replace(/\s*<link rel="canonical"[^>]*>/g, '')
const jsonld = `<script type="application/ld+json" id="ff-home-jsonld">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'WebSite', name: 'FairFund', url: `${SITE}/`, description: desc, inLanguage: 'en-IN',
}).replace(/</g, '\\u003c')}</script>`
html = html.replace(/\s*<script type="application\/ld\+json" id="ff-home-jsonld">[\s\S]*?<\/script>/g, '')
if (!html.includes('</head>')) throw new Error('dist/index.html has no </head>')
html = html.replace('</head>', `    ${canonical}\n    ${jsonld}\n  </head>`)
writeFileSync(INDEX, html, 'utf-8')
console.log(`[gen-home] crawlable homepage: ${sections.length} section + ${cats.length} category links, canonical ${SITE}/`)
