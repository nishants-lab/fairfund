// Prerender static "unfurl shells" for GitHub Pages.
//
// Hash routes do not provide reliable separate indexing URLs. This script
// emits one crawlable HTML shell per fund and per key page. Each shell carries:
//   - route-specific Open Graph / Twitter tags (rich social unfurls)
//   - real indexable content in <body> (fund name, rank, metrics table)
//   - JSON-LD FinancialProduct structured data (rich search snippets)
//   - an explicit link to the interactive app, with no automatic navigation
// Humans and crawlers receive the same stable, self-canonical public page.
//
// Runs after `vite build`; writes into dist/ (the deployed artifact).
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SITE, SHELL_UP, COVER_IMAGE } from './site-config.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')

if (!existsSync(DIST)) {
  console.error('[gen-unfurls] dist/ not found - run vite build first')
  process.exit(1)
}

const data = JSON.parse(readFileSync(join(ROOT, 'src/data/funds.json'), 'utf-8'))
const funds = data.funds ?? []
const asOf = /^\d{4}-\d{2}-\d{2}$/.test(data.anchor ?? '')
  ? `<p style="font-size:13px;color:#475569">Analysis snapshot through <time datetime="${data.anchor}">${data.anchor}</time>. Reporting periods can differ.</p>` : ''

// Mirror src/lib/format.ts fundSlug exactly so shell paths match ShareButton.
function fundSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}
function catSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function structuredData(value) {
  // External fund names must not close the JSON-LD script element.
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function sign(n) { return n >= 0 ? `+${n.toFixed(1)}` : `${n.toFixed(1)}` }
function fmtAum(cr) {
  if (cr == null) return null
  return cr >= 100000 ? `Rs ${(cr / 100000).toFixed(1)}L Cr` : `Rs ${Math.round(cr).toLocaleString('en-IN')} Cr`
}

// Base <head> tags shared by every shell.
function head(title, desc, url, image, jsonld) {
  return `<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="FairFund"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(url)}"/>
<meta property="og:image" content="${image}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:alt" content="FairFund - Indian mutual fund research"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${image}"/>
<link rel="canonical" href="${esc(url)}"/>${jsonld ? `\n<script type="application/ld+json">${jsonld}</script>` : ''}`
}

// Keep the public URL and its content stable even when JavaScript executes.
// The interactive view remains available through an explicit ordinary link.
function writeShell({ dir, hash, title, desc, canonicalPath, image = COVER_IMAGE, jsonld = '', bodyHtml = '' }) {
  const outDir = join(DIST, dir)
  mkdirSync(outDir, { recursive: true })
  const url = `${SITE}/${canonicalPath}`
  const fallback = bodyHtml
    ? bodyHtml
    : `<a href="${SHELL_UP}#${hash}">Open the interactive analysis on FairFund</a>`
  const html = `<!doctype html>
<html lang="en">
<head>
${head(title, desc, url, image, jsonld)}
<style>
*{box-sizing:border-box}body{overflow-wrap:anywhere}a{color:#1d4ed8}a:focus-visible{outline:2px solid #1e293b;outline-offset:4px}nav{display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem}table{max-width:100%}.metrics-scroll{overflow-x:auto}.metrics-scroll th,.metrics-scroll td{white-space:nowrap;overflow-wrap:normal}img{max-width:100%;height:auto}
</style>
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:2rem 1.25rem;color:#1e293b;line-height:1.6">
<nav aria-label="Research pages"><a href="${SITE}/">FairFund home</a><a href="${SITE}/s/explore/">Browse categories</a><a href="${SITE}/s/methodology/">Methodology</a></nav>
<main>${fallback}${asOf}</main>
</body>
</html>
`
  writeFileSync(join(outDir, 'index.html'), html, 'utf-8')
}

// ---- Per-fund shells --------------------------------------------------------
let n = 0
for (const f of funds) {
  const slug = fundSlug(f.name)
  const cat = f.categoryDisplay || f.category || 'Equity'
  const hash = `/fund/${f.code}/${slug}`

  // Pick the fund's best available long window to lead with (3Y preferred, then
  // 5Y), so search snippets show the fund's strongest honest read, not its 1Y.
  const m3 = f.metrics?.['3Y'] || null
  const m5 = f.metrics?.['5Y'] || null
  const lead = m3 || m5 || f.metrics?.['1Y'] || null
  const leadWin = m3 ? '3Y' : m5 ? '5Y' : f.metrics?.['1Y'] ? '1Y' : null

  const descBits = [cat]
  if (lead?.catRank && lead?.catSize) descBits.push(`Rank #${lead.catRank} of ${lead.catSize}`)
  if (lead?.cagr != null && leadWin) descBits.push(`${leadWin} CAGR ${lead.cagr.toFixed(1)}%`)
  if (lead?.alpha != null && leadWin) descBits.push(`alpha ${sign(lead.alpha)}%`)
  const desc = `${descBits.join(' \u00b7 ')}. Mutual fund research on FairFund.`
  const title = `${f.name} - ${cat} | FairFund`
  const image = existsSync(join(DIST, 'og', `${f.code}.png`)) ? `${SITE}/og/${f.code}.png` : COVER_IMAGE
  const url = `${SITE}/f/${f.code}/`

  // JSON-LD structured data.
  const jsonld = structuredData({
    '@context': 'https://schema.org',
    '@type': 'FinancialProduct',
    name: f.name,
    category: cat,
    provider: { '@type': 'Organization', name: f.amc },
    url,
    description: desc,
  })

  // Visible/crawlable body. Lead sentence + metrics table for long windows only
  // (drop 1Y from the shell: it swings hard and misrepresents a fund in search).
  const aum = fmtAum(f.aum?.current)
  const subline = [cat, f.amc, 'Direct', 'Growth', aum].filter(Boolean).join(' &middot; ')

  let leadSentence = `${esc(f.name)} is a ${esc(cat)} fund.`
  if (lead?.catRank && lead?.catSize && lead?.cagr != null && leadWin) {
    leadSentence = `${esc(f.name)} ranks <strong>#${lead.catRank} of ${lead.catSize}</strong> in the ${esc(cat)} category on ${leadWin} risk-adjusted return, with a ${leadWin} CAGR of <strong>${lead.cagr.toFixed(1)}%</strong> (${sign(lead.alpha ?? 0)}% versus the category median).`
    if (m3 && m5) {
      leadSentence += ` Over 5 years it ranks #${m5.catRank} of ${m5.catSize} with a ${m5.cagr.toFixed(1)}% CAGR.`
    }
  }

  const rows = []
  for (const [win, mm] of [['3Y', m3], ['5Y', m5]]) {
    if (!mm) continue
    rows.push(`<tr><th style="text-align:left;padding:6px 12px 6px 0;font-weight:600">${win}</th><td style="padding:6px 16px 6px 0">CAGR ${mm.cagr.toFixed(1)}%</td><td style="padding:6px 16px 6px 0">Alpha ${sign(mm.alpha ?? 0)}%</td><td style="padding:6px 16px 6px 0">Rank #${mm.catRank}/${mm.catSize}</td><td style="padding:6px 16px 6px 0">Sharpe ${mm.sharpe}</td><td style="padding:6px 0">Max DD ${mm.maxDrawdown?.toFixed(1)}%</td></tr>`)
  }
  const table = rows.length
    ? `<h2 style="font-size:18px;margin:24px 0 8px">Key metrics</h2>
<div class="metrics-scroll" role="region" aria-label="Fund metrics" tabindex="0"><table style="border-collapse:collapse;font-size:14px"><tbody>${rows.join('')}</tbody></table></div>`
    : ''

  const bodyHtml = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Indian mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">${esc(f.name)}</h1>
<p style="font-size:15px;color:#475569;margin:0 0 20px">${subline}</p>
<p style="font-size:16px">${leadSentence}</p>
${table}
<p style="margin-top:24px"><a href="${SHELL_UP}#${hash}" style="color:#2563eb;font-weight:600">Open the full interactive analysis &rarr;</a></p>
<p style="font-size:12px;color:#475569;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`

  writeShell({ dir: `f/${f.code}`, hash, title, desc, canonicalPath: `f/${f.code}/`, image, jsonld, bodyHtml })
  n++
}

// ---- Per-page shells --------------------------------------------------------
const total = data.totalFunds ?? funds.length
const stockCov = data.holdingsCoverage?.stock_level ?? null

// Explore page: a real category table (great for "best <category> funds" queries).
// Order by fund count so the biggest, most-searched categories lead.
const cats = Object.entries(data.categories ?? {})
  .map(([key, c]) => ({ key, display: c.display || key, count: c.fundCount ?? 0, median5Y: c.medianCagr5Y, top5Y: c.topCagr5Y, risk: c.riskLevel }))
  .filter(c => c.count > 0)
  .sort((a, b) => b.count - a.count)
const catRows = cats.map(c =>
  `<tr><td style="padding:6px 16px 6px 0"><a href="${SITE}/c/${catSlug(c.key)}/" style="color:#2563eb">${esc(c.display)}</a></td><td style="padding:6px 16px 6px 0;text-align:right">${c.count}</td><td style="padding:6px 16px 6px 0;text-align:right">${c.median5Y != null ? c.median5Y.toFixed(1) + '%' : '-'}</td><td style="padding:6px 0;text-align:right">${c.top5Y != null ? c.top5Y.toFixed(1) + '%' : '-'}</td></tr>`
).join('')
const exploreBody = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Indian mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">Explore ${total} Indian mutual funds</h1>
<p style="font-size:16px;margin:0 0 20px">Browse Indian mutual funds by category and compare historical returns, risk and costs. Check the dates and available history before comparing results.${stockCov ? ` Stock-level holdings disclosed for ${stockCov} funds.` : ''}</p>
<h2 style="font-size:18px;margin:24px 0 8px">Categories</h2>
<div class="metrics-scroll" role="region" aria-label="Category metrics" tabindex="0"><table style="border-collapse:collapse;font-size:14px;width:100%"><thead><tr style="border-bottom:1px solid #e2e8f0"><th style="text-align:left;padding:0 16px 6px 0">Category</th><th style="text-align:right;padding:0 16px 6px 0">Funds</th><th style="text-align:right;padding:0 16px 6px 0">Median 5Y CAGR</th><th style="text-align:right;padding:0 0 6px 0">Best 5Y</th></tr></thead><tbody>${catRows}</tbody></table></div>
<p style="margin-top:24px"><a href="${SHELL_UP}#/explore" style="color:#2563eb;font-weight:600">Open the full explorer &rarr;</a></p>
<p style="font-size:12px;color:#475569;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`

function pageBody(h1, paras, hash) {
  return `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Indian mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 12px">${esc(h1)}</h1>
${paras.map(p => `<p style="font-size:16px;margin:0 0 14px">${p}</p>`).join('\n')}
<p style="margin-top:20px"><a href="${SHELL_UP}#${hash}" style="color:#2563eb;font-weight:600">Open it on FairFund &rarr;</a></p>
<p style="font-size:12px;color:#475569;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`
}

function pageJsonld(name, desc, path) {
  return structuredData({ '@context': 'https://schema.org', '@type': 'WebPage', name, description: desc, url: `${SITE}/${path}` })
}

const moversBody = pageBody("Mutual fund movers", [
  `What moved across ${total} Indian mutual funds: funds gaining or losing assets fastest, funds climbing or falling in their category rank, and funds with the strongest return momentum against their peers.`,
  `Every move is measured within the fund's own category, so a small-cap is compared to small-caps and a liquid fund to liquid funds, never across risk levels.`,
], '/movers')

const compareBody = pageBody("Compare mutual funds side by side", [
  `Select dates on a fund or comparison page to recalculate returns and risk from the available NAV data. Category ranks and portfolio disclosures use their own reporting periods.`,
  `Compare monthly portfolio disclosures to review overlap in equity holdings.`,
], '/compare')

const methodBody = pageBody("How FairFund works", [
  `FairFund compares mutual funds within their categories using NAV history and published portfolio data. This page explains the calculations, ranking rules and data limitations.`,
  `Returns measured over different periods include different market conditions. A since-launch return can therefore give a different picture from a trailing 3-year return. Check the dates and available history before comparing results.`,
  `Rankings compare funds within the same category. Categories can differ substantially in risk and investment strategy, so their ranks should be read separately.`,
  `These analyses describe past returns across different periods and market conditions. Simulations reuse past monthly returns to illustrate outcomes under a specified model.`,
  `Holdings come from monthly portfolio disclosures with fund-of-fund look-through where available. Data for research only, not investment advice.`,
], '/methodology')

const pages = [
  ['s/explore', '/explore', `Explore ${total} funds - FairFund`,
    `Browse Indian mutual funds by category and compare historical returns, risk and costs.`, exploreBody,
    pageJsonld('Explore mutual funds', `Browse ${total} Indian mutual funds by category and compare historical returns, risk and costs.`, 's/explore/')],
  ['s/movers', '/movers', `Fund movers - FairFund`,
    `Asset, category-rank and return-momentum movers across ${total} Indian mutual funds on FairFund.`, moversBody,
    pageJsonld('Mutual fund movers', 'Funds moving fastest on assets, category rank and return momentum.', 's/movers/')],
  ['s/compare', '/compare', `Compare funds side by side - FairFund`,
    `Compare mutual funds over a selected period and review overlap in their disclosed holdings.`, compareBody,
    pageJsonld('Compare mutual funds', 'Compare mutual funds over a selected period and review overlap in their disclosed holdings.', 's/compare/')],
  ['s/methodology', '/methodology', `Methodology - FairFund`,
    `How FairFund calculates returns, compares funds within categories and handles data limitations.`, methodBody,
    pageJsonld('FairFund methodology', 'How FairFund calculates returns, compares funds within categories and handles data limitations.', 's/methodology/')],
]
for (const [dir, hash, title, desc, bodyHtml, jsonld] of pages) {
  writeShell({ dir, hash, title, desc, canonicalPath: `${dir}/`, bodyHtml, jsonld })
}


// ---- Per-category deep-dive shells -----------------------------------------
const categories = Object.entries(data.categories ?? {})
  .map(([key, c]) => ({ key, display: c.display || key, count: c.fundCount ?? 0, median5Y: c.medianCagr5Y, top5Y: c.topCagr5Y, risk: c.riskLevel }))
  .filter(c => c.count > 0)
let catN = 0
for (const c of categories) {
  const slug = catSlug(c.key)
  const hash = `/category/${slug}`
  const title = `${c.display} funds - deep dive | FairFund`
  const desc = `Explore ${c.count} ${c.display} funds, their historical returns and category comparisons.`
  const jsonld = structuredData({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${c.display} funds - category deep dive`,
    description: desc,
    url: `${SITE}/c/${slug}/`,
  })
  const fundLinks = funds.filter(f => f.category === c.key)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(f => `<li style="margin:.5rem 0"><a href="${SITE}/f/${f.code}/">${esc(f.name)}</a></li>`).join('')
  const bodyHtml = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Indian mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">${esc(c.display)} funds</h1>
<p style="font-size:15px;color:#475569;margin:0 0 20px">${c.count} funds &middot; ${c.risk || 'Moderate'} risk${c.median5Y != null ? ` &middot; Median 5Y CAGR ${c.median5Y.toFixed(1)}%` : ''}</p>
<p style="font-size:16px">Explore the ${esc(c.display)} category: historical return distributions, category comparisons and performance during past market falls. Check the dates and available history before comparing results.</p>
<p style="margin-top:24px"><a href="${SHELL_UP}#${hash}" style="color:#2563eb;font-weight:600">Open the interactive deep dive &rarr;</a></p>
<h2 style="font-size:20px">Fund reports in this category</h2><ul>${fundLinks}</ul>
<p style="font-size:12px;color:#475569;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`

  writeShell({ dir: `c/${slug}`, hash, title, desc, canonicalPath: `c/${slug}/`, jsonld, bodyHtml })
  catN++
}

console.log(`[gen-unfurls] wrote ${n} enriched fund shells + ${pages.length} page shells + ${catN} category shells into dist/`)
