// Prerender static "unfurl shells" for GitHub Pages.
//
// The app uses HashRouter, so social crawlers and search engines never see
// per-route content: everything after '#' is invisible to them. This script
// emits one crawlable HTML shell per fund and per key page. Each shell carries:
//   - route-specific Open Graph / Twitter tags (rich social unfurls)
//   - real indexable content in <body> (fund name, rank, metrics table)
//   - JSON-LD FinancialProduct structured data (rich search snippets)
//   - a short-delay client redirect into the real SPA hash route
// Crawlers read the tags + content; humans get bounced into the app.
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

// Mirror src/lib/format.ts fundSlug exactly so shell paths match ShareButton.
function fundSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}
function catSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
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
<meta property="og:image:alt" content="FairFund - forward-looking mutual fund research for India"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${image}"/>
<link rel="canonical" href="${esc(url)}"/>${jsonld ? `\n<script type="application/ld+json">${jsonld}</script>` : ''}`
}

// Client redirect: strip /f/... or /s/... back to the app root, then hash-route.
// Delayed so pre-rendered content paints and JS-executing crawlers can read it.
function redirectScript(hash, delayMs) {
  return `<script>
  setTimeout(function(){
    var root = location.pathname.replace(/\\/(f|s|c)\\/.*$/, '/');
    location.replace(location.origin + root + '#${hash}');
  }, ${delayMs});
</script>`
}

// Write a shell. `bodyHtml` is the visible/crawlable content (empty for the
// thin page shells). `delayMs` controls how long content shows before redirect.
function writeShell({ dir, hash, title, desc, canonicalPath, image = COVER_IMAGE, jsonld = '', bodyHtml = '', delayMs = 0 }) {
  const outDir = join(DIST, dir)
  mkdirSync(outDir, { recursive: true })
  const url = `${SITE}/${canonicalPath}`
  const fallback = bodyHtml
    ? bodyHtml
    : `Redirecting to <a href="${SHELL_UP}#${hash}">FairFund</a>...`
  const html = `<!doctype html>
<html lang="en">
<head>
${head(title, desc, url, image, jsonld)}
${redirectScript(hash, delayMs)}
${delayMs === 0 ? `<meta http-equiv="refresh" content="0;url=${SHELL_UP}#${hash}"/>` : ''}
</head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:2rem 1.25rem;color:#1e293b;line-height:1.6">
${fallback}
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
  const desc = `${descBits.join(' \u00b7 ')}. Forward-looking analysis, evidence not advice, on FairFund.`
  const title = `${f.name} - ${cat} | FairFund`
  const image = existsSync(join(DIST, 'og', `${f.code}.png`)) ? `${SITE}/og/${f.code}.png` : COVER_IMAGE
  const url = `${SITE}/f/${f.code}/`

  // JSON-LD structured data.
  const jsonld = JSON.stringify({
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
<table style="border-collapse:collapse;font-size:14px"><tbody>${rows.join('')}</tbody></table>`
    : ''

  const bodyHtml = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Forward-looking mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">${esc(f.name)}</h1>
<p style="font-size:15px;color:#475569;margin:0 0 20px">${subline}</p>
<p style="font-size:16px">${leadSentence}</p>
${table}
<p style="margin-top:24px"><a href="${SHELL_UP}#${hash}" style="color:#2563eb;font-weight:600">Open the full interactive analysis &rarr;</a></p>
<p style="font-size:12px;color:#94a3b8;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`

  writeShell({ dir: `f/${f.code}`, hash, title, desc, canonicalPath: `f/${f.code}/`, image, jsonld, bodyHtml, delayMs: 1200 })
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
const exploreBody = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Forward-looking mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">Explore ${total} Indian mutual funds</h1>
<p style="font-size:16px;margin:0 0 20px">Every fund scored within its own category over identical time windows, using peer-relative alpha, consistency and downside protection. No ads, no affiliate links, no sponsored rankings.${stockCov ? ` Stock-level holdings disclosed for ${stockCov} funds.` : ''}</p>
<h2 style="font-size:18px;margin:24px 0 8px">Categories</h2>
<table style="border-collapse:collapse;font-size:14px;width:100%"><thead><tr style="border-bottom:1px solid #e2e8f0"><th style="text-align:left;padding:0 16px 6px 0">Category</th><th style="text-align:right;padding:0 16px 6px 0">Funds</th><th style="text-align:right;padding:0 16px 6px 0">Median 5Y CAGR</th><th style="text-align:right;padding:0 0 6px 0">Best 5Y</th></tr></thead><tbody>${catRows}</tbody></table>
<p style="margin-top:24px"><a href="${SHELL_UP}#/explore" style="color:#2563eb;font-weight:600">Open the full explorer &rarr;</a></p>
<p style="font-size:12px;color:#94a3b8;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`

function pageBody(h1, paras, hash) {
  return `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Forward-looking mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 12px">${esc(h1)}</h1>
${paras.map(p => `<p style="font-size:16px;margin:0 0 14px">${p}</p>`).join('\n')}
<p style="margin-top:20px"><a href="${SHELL_UP}#${hash}" style="color:#2563eb;font-weight:600">Open it on FairFund &rarr;</a></p>
<p style="font-size:12px;color:#94a3b8;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`
}

function pageJsonld(name, desc, path) {
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name, description: desc, url: `${SITE}/${path}` })
}

const moversBody = pageBody("Mutual fund movers", [
  `What moved across ${total} Indian mutual funds: funds gaining or losing assets fastest, funds climbing or falling in their category rank, and funds with the strongest return momentum against their peers.`,
  `Every move is measured within the fund's own category, so a small-cap is compared to small-caps and a liquid fund to liquid funds, never across risk levels.`,
], '/movers')

const compareBody = pageBody("Compare mutual funds side by side", [
  `Put any two or more Indian mutual funds head to head over a shared custom period. FairFund computes CAGR, alpha versus the category median, Sharpe and Sortino ratios, maximum drawdown and a normalized growth chart, highlighting the winner on each metric.`,
  `For equity funds it also shows holdings overlap, so you can see how much two funds actually duplicate each other before holding both.`,
], '/compare')

const methodBody = pageBody("How FairFund works", [
  `FairFund builds its universe from the authoritative AMFI scheme-category classification, then scores every fund over fixed, identical calendar windows (1Y, 3Y, 5Y) within its own category.`,
  `Rankings use peer-relative alpha against the category median rather than raw returns, so a fund is credited for genuine skill, not for sitting in a category that happened to run hot. On top of the backward-looking metrics, each fund gets forward-looking signals: rolling-alpha consistency, up- and down-capture, regime stress tests across 10 real market periods, and worst-case drawdown and recovery.`,
  `Holdings come from monthly portfolio disclosures with fund-of-fund look-through where available. Everything is research, not investment advice.`,
], '/methodology')

const pages = [
  ['s/explore', '/explore', `Explore ${total} funds - FairFund`,
    `Filter and rank India's mutual funds by consistency, skill vs luck and downside protection. Evidence, not advice.`, exploreBody,
    pageJsonld('Explore mutual funds', `Browse and rank ${total} Indian mutual funds by category.`, 's/explore/')],
  ['s/movers', '/movers', `Fund movers - FairFund`,
    `Asset, category-rank and return-momentum movers across ${total} Indian mutual funds on FairFund.`, moversBody,
    pageJsonld('Mutual fund movers', 'Funds moving fastest on assets, category rank and return momentum.', 's/movers/')],
  ['s/compare', '/compare', `Compare funds side by side - FairFund`,
    `Compare Indian mutual funds on risk-adjusted return, alpha, drawdown and holdings overlap. Evidence, not advice.`, compareBody,
    pageJsonld('Compare mutual funds', 'Compare Indian mutual funds side by side over a shared period.', 's/compare/')],
  ['s/methodology', '/methodology', `Methodology - FairFund`,
    `How FairFund scores funds: fixed-window backtests plus probability-based consistency, skill-vs-luck and downside signals.`, methodBody,
    pageJsonld('FairFund methodology', 'How FairFund ranks and scores Indian mutual funds.', 's/methodology/')],
]
for (const [dir, hash, title, desc, bodyHtml, jsonld] of pages) {
  writeShell({ dir, hash, title, desc, canonicalPath: `${dir}/`, bodyHtml, jsonld, delayMs: 1200 })
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
  const desc = `${c.count} ${c.display} funds analyzed: return distribution, regime stress tests, skill vs luck, mean reversion and AUM landscape.${c.median5Y != null ? ` Median 5Y CAGR ${c.median5Y.toFixed(1)}%.` : ''} Evidence, not advice.`
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${c.display} funds - category deep dive`,
    description: desc,
    url: `${SITE}/c/${slug}/`,
  })
  const bodyHtml = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Forward-looking mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">${esc(c.display)} funds</h1>
<p style="font-size:15px;color:#475569;margin:0 0 20px">${c.count} funds &middot; ${c.risk || 'Moderate'} risk${c.median5Y != null ? ` &middot; Median 5Y CAGR ${c.median5Y.toFixed(1)}%` : ''}</p>
<p style="font-size:16px">A statistical deep dive into the ${esc(c.display)} category: how returns are distributed across the field, which funds lead over different horizons, how the category behaves during market stress regimes, and whether past winners tend to revert or persist.</p>
<p style="margin-top:24px"><a href="${SHELL_UP}#${hash}" style="color:#2563eb;font-weight:600">Open the interactive deep dive &rarr;</a></p>
<p style="font-size:12px;color:#94a3b8;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`

  writeShell({ dir: `c/${slug}`, hash, title, desc, canonicalPath: `c/${slug}/`, jsonld, bodyHtml, delayMs: 1200 })
  catN++
}

console.log(`[gen-unfurls] wrote ${n} enriched fund shells + ${pages.length} page shells + ${catN} category shells into dist/`)
