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
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SITE, SHELL_UP, COVER_IMAGE } from './site-config.mjs'
import { buildResearch, PAIR_TOP_N, isIndexFund, median, hasMonthOnMonth, hasUsableHoldings, isLiveFund, stockSlug, pairPath, currentStock } from './research-pages.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')

if (!existsSync(DIST)) {
  console.error('[gen-unfurls] dist/ not found - run vite build first')
  process.exit(1)
}

const data = JSON.parse(readFileSync(join(ROOT, 'src/data/funds.json'), 'utf-8'))
const funds = data.funds ?? []
const research = buildResearch(ROOT, funds)
// Holdings research pages are regenerated in full: clear earlier output so a
// stock or pair that no longer qualifies cannot linger as an unlisted page.
for (const dir of ['st', 'o', 's/stocks', 's/overlap']) rmSync(join(DIST, dir), { recursive: true, force: true })
// One display name per category (fund records can carry older spellings).
const catLabel = f => data.categories?.[f.category]?.display || f.categoryDisplay || f.category || 'Equity'
const numberWord = n => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  // Output is HTML-safe: a valid date prints digits and a month name, anything else is escaped.
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : esc(String(iso ?? ''))
}
const isActive = isLiveFund
const isQuarantined = f => f.dataQuality?.status === 'quarantined'
const erByCategory = new Map()
for (const f of funds) {
  if (!isActive(f) || typeof f.expenseRatio !== 'number') continue
  if (!erByCategory.has(f.category)) erByCategory.set(f.category, [])
  erByCategory.get(f.category).push(f.expenseRatio)
}
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
// toFixed without a negative zero: -0.02 prints as 0.0, not -0.0.
function fixed(n, d = 1) {
  const s = n.toFixed(d)
  return Number(s) === 0 ? (0).toFixed(d) : s
}
function sign(n) {
  const s = fixed(n)
  return Number(s) > 0 ? `+${s}` : s
}
function fmtAum(cr) {
  if (cr == null) return null
  return cr >= 100000 ? `Rs&nbsp;${(cr / 100000).toFixed(1)}L&nbsp;Cr` : `Rs&nbsp;${Math.round(cr).toLocaleString('en-IN')}&nbsp;Cr`
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
*{box-sizing:border-box}body{overflow-wrap:anywhere}a{color:#1d4ed8}a:focus-visible{outline:2px solid #1e293b;outline-offset:4px}nav{display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem}table{max-width:100%}.metrics-scroll{overflow-x:auto}.metrics-scroll th,.metrics-scroll td{white-space:nowrap;overflow-wrap:normal}.data-scroll{overflow-x:auto}.data-scroll table{border-collapse:collapse;font-size:14px}.data-scroll th,.data-scroll td{white-space:nowrap;overflow-wrap:normal;padding:6px 10px 6px 0;text-align:left;vertical-align:top}.data-scroll thead th{border-bottom:1px solid #e2e8f0;font-weight:600;white-space:normal;font-size:13px}.data-scroll td.name{white-space:normal;min-width:7.5rem}.data-scroll tr>:last-child{padding-right:0}.data-scroll td.label{white-space:normal;min-width:5rem}.metrics-scroll thead th{white-space:normal}.data-scroll .sub{display:block;font-size:12px;color:#64748b}.data-scroll .num{text-align:right}h2{font-size:18px;margin:28px 0 8px}img{max-width:100%;height:auto}
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


// ---- Shared pieces for the research sections --------------------------------
const H2 = text => `<h2>${text}</h2>`
const pct = (n, d = 1) => `${fixed(n, d)}%`
// Totals of disclosed weights (4 decimals) are added in whole 1/10000ths and
// rounded half up from that exact value, so 29.55 shows as 29.6, not 29.5.
const weightUnits = list => list.reduce((s, w) => s + Math.round(w * 10000), 0)
const pctUnits = (units, d = 1) => `${(Math.round(units / 10 ** (4 - d)) / 10 ** d).toFixed(d)}%`
const fundLink = f => `<a href="${SITE}/f/${f.code}/">${esc(f.name)}</a>`
const stockLabel = name => String(name).replace(/\s+(Ltd\.?|Limited)\s*$/i, '').replace(/\.$/, '').trim()
function dataTable(label, headers, rows) {
  if (!rows.length) return ''
  return `<div class="data-scroll" role="region" aria-label="${esc(label)}" tabindex="0"><table><thead><tr>${headers.map(([h, cls]) => `<th${cls ? ` class="${cls}"` : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}
const td = (html, cls) => `<td${cls ? ` class="${cls}"` : ''}>${html}</td>`
function bps(change) {
  if (change === undefined) return ''
  if (change === null) return 'No earlier weight'
  if (change === 0) return 'No change'
  // Round the size, not the signed value, so +0.5 and -0.5 bps both round away from zero.
  const size = Math.round(Math.abs(change) * 100)
  return `${change > 0 ? '+' : '-'}${size === 0 ? '&lt;1' : size} bps`
}
function lockInText(lock) {
  if (!lock) return null
  const parts = [['years', 'year'], ['months', 'month'], ['days', 'day']]
    .filter(([k]) => typeof lock[k] === 'number' && Number.isFinite(lock[k]) && lock[k] > 0)
    .map(([k, unit]) => `${lock[k]} ${unit}${lock[k] === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' ') : null
}
const rupees = n => `Rs&nbsp;${Math.round(n).toLocaleString('en-IN')}`
const DISCLAIMER = '<p style="font-size:12px;color:#475569;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>'
const EYEBROW = '<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Indian mutual fund research</p>'
const OVERLAP_RULE = 'Overlap adds up the smaller of the two weights for every holding both funds own: 0% means no shared holdings, 100% means the same holdings at the same weights.'
// Whole-percent overlap that never prints the 0% or 100% endpoints of the rule
// above for a value that only rounds to them. Disclosed weights can add up to a
// little over 100% (net receivables are negative), so funds tracking one index
// can score just above 100: shown as over 99%.
const ovPct = x => {
  const r = Math.round(x)
  if (x > 0 && r === 0) return '&lt;1%'
  if (r >= 100) return '&gt;99%'
  return `${r}%`
}
// How catRank is scored (pipeline/compute_rankings.py): cash-like and arbitrage
// categories rank on cost, size and return; the rest on six return and risk measures.
const RANK_BASIS = {
  Liquid: { lead: 'cost, fund size and', note: 'expense ratio (70%), fund size (20%) and return (10%)' },
  'Money Market': { lead: 'cost, fund size and', note: 'expense ratio (70%), fund size (20%) and return (10%)' },
  Arbitrage: { lead: 'cost, fund size and', note: 'expense ratio (45%), return (35%) and fund size (20%)' },
}
const rankLead = (category, win) => RANK_BASIS[category] ? `on ${RANK_BASIS[category].lead} ${win} return` : `on ${win} risk-adjusted return`
const rankNote = category => RANK_BASIS[category]
  ? `Ranks in this category weigh ${RANK_BASIS[category].note}, because costs take a large share of these funds' returns.`
  : 'Ranks combine six measures: return, return versus the category median, the largest fall, and the Sharpe, Sortino and Calmar ratios of return to risk. A fund with a lower return can rank above one with a higher return if its price swung less.'

function fmtCr(cr) { return `Rs&nbsp;${Math.round(cr).toLocaleString('en-IN')}&nbsp;Cr` }
const nameCell = (main, sub) => td(`${main}${sub ? `<span class="sub">${sub}</span>` : ''}`, 'name')
const stockName = h => {
  const cur = currentStock(h)
  const slug = h?.instrument === 'Equity' && h.key ? stockSlug(h.key) : null
  const name = slug && research.stockBySlug.has(slug) ? `<a href="${SITE}/st/${slug}/">${esc(cur.name)}</a>` : esc(cur.name)
  return name + (cur.formerly ? ` <span style="color:#64748b">(formerly ${esc(stockLabel(cur.formerly))})</span>` : '')
}
const DEBT_CATEGORIES = new Set(['Liquid', 'Money Market'])
// Source rows with no sector carry placeholders; treat them as no sector.
const sectorOf = h => {
  const s = typeof h?.sector === 'string' ? h.sector.trim() : ''
  return s && !/^(unspecified|others?|n\/?a|-)$/i.test(s) ? s : ''
}

function factsSection(f, d) {
  const items = []
  const peersEr = erByCategory.get(f.category) || []
  if (typeof f.expenseRatio === 'number') {
    const med = median(peersEr)
    items.push(`Expense ratio: <strong>${f.expenseRatio.toFixed(2)}%</strong> a year (direct plan)${med != null && peersEr.length > 1 ? `; the ${esc(catLabel(f))} median is ${med.toFixed(2)}% across ${peersEr.length} funds` : ''}.`)
  }
  // Prefer the fund-data record when it describes the same current size, as it carries the dates.
  const a = d?.aum?.current != null && (f.aum?.current == null || Math.abs(d.aum.current - f.aum.current) < 0.5) ? d.aum : f.aum
  if (a?.current != null) {
    const change = a.previous > 0 ? (a.current / a.previous - 1) * 100 : null
    items.push(`Fund size: ${fmtCr(a.current)}${a.asOf ? ` on ${fmtDay(a.asOf)}` : ''}${a.previous != null && a.prevDate ? `, ${change != null ? `${sign(change)}% ` : ''}from ${fmtCr(a.previous)} on ${fmtDay(a.prevDate)}` : ''}.`)
  }
  const managers = (d?.management?.managers || []).filter(m => m?.name)
  if (managers.length) {
    items.push(`Fund manager${managers.length > 1 ? 's' : ''}: ${managers.map(m => `${esc(m.name)}${typeof m.sinceYears === 'number' ? ` (${m.sinceYears} ${m.sinceYears === 1 ? 'year' : 'years'} on this fund)` : ''}`).join(', ')}.`)
  }
  const inv = { ...(f.investInfo || {}), ...(d?.investInfo || {}) }
  if (inv.exit_load) {
    const load = String(inv.exit_load).trim().replace(/^exit load\s*(of\s*)?:?\s*/i, '')
    items.push(`Exit load: ${esc(load.charAt(0).toUpperCase() + load.slice(1))}${/[.]$/.test(load) ? '' : '.'}`)
  }
  const mins = [typeof inv.min_sip === 'number' && inv.min_sip > 0 ? `SIP ${rupees(inv.min_sip)}` : null,
    typeof inv.min_lumpsum === 'number' && inv.min_lumpsum > 0 ? `lump sum ${rupees(inv.min_lumpsum)}` : null].filter(Boolean)
  if (mins.length) items.push(`Minimum investment: ${mins.join(', ')}.`)
  const lock = lockInText(inv.lock_in)
  if (lock) items.push(`Lock-in: ${lock}.`)
  if (!items.length) return ''
  return `${H2('Costs and fund facts')}<ul style="padding-left:18px;margin:0">${items.map(i => `<li style="margin:4px 0">${i}</li>`).join('')}</ul>`
}

function holdingsSection(f, d) {
  if (!d || DEBT_CATEGORIES.has(f.category)) return ''
  const meta = d.holdingsMeta || {}
  const holdings = Array.isArray(d.holdings) ? d.holdings.filter(h => h && typeof h.pct === 'number' && Number.isFinite(h.pct)) : []
  if (!hasUsableHoldings(d)) {
    return `${H2('Portfolio holdings')}<p>Stock-level holdings for this fund are not available from its public monthly disclosure.${meta.underlying ? ` It invests through ${esc(meta.underlying)}.` : ''}</p>`
  }
  const top = holdings.slice(0, 10)
  const mom = hasMonthOnMonth(holdings)
  const since = research.changeSince.get(f.code)
  const changeHead = since ? `Change in weight since ${fmtDay(since)}` : 'Change in weight since previous disclosure'
  const rows = top.map(h => `<tr>${nameCell(stockName(h), esc(sectorOf(h)))}${td(pct(h.pct, 2), 'num')}${mom ? td(bps(h.change), 'num') : ''}</tr>`)
  const sectors = new Map()
  for (const h of holdings) if (sectorOf(h)) sectors.set(sectorOf(h), (sectors.get(sectorOf(h)) || 0) + Math.round(h.pct * 10000))
  const topSectors = [...sectors.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5)
  const topSum = weightUnits(top.map(h => h.pct))
  const count = Number.isInteger(meta.count) && meta.count > 0 ? meta.count : holdings.length
  const hedged = f.category === 'Arbitrage' ? ' Arbitrage funds typically pair their stock positions with short futures positions, so their net exposure to share prices is usually small.' : ''
  return `${H2(`Top ${top.length} holdings`)}
<p>Portfolio disclosed for ${meta.portfolioDate ? fmtDay(meta.portfolioDate) : 'the latest month'}: ${count} holdings. The top ${top.length} make up ${pctUnits(topSum)} of the portfolio.${hedged}</p>
${dataTable('Top holdings', [['Holding'], ['Weight', 'num'], ...(mom ? [[changeHead, 'num']] : [])], rows)}
${topSectors.length ? `<p>Largest sectors: ${topSectors.map(([s, w]) => `${esc(s)} ${pctUnits(w)}`).join(', ')}.</p>` : ''}`
}

function similarSection(f) {
  const { all, index } = research.closest(f.code)
  const others = all.filter(s => s.fund.amc !== f.amc && !isIndexFund(s.fund)).slice(0, 5)
  const sameHouse = all.find(s => s.fund.amc === f.amc && !isIndexFund(s.fund)) || null
  if (!others.length && !sameHouse && !index) return ''
  const link = fund => {
    const path = pairPath(f.code, fund.code)
    return research.pairByPath.has(path) ? `<a href="${SITE}/${path}">${esc(fund.name)}</a>` : fundLink(fund)
  }
  // Where a pair page exists, show its figure, so the link and the page agree
  // (the pair page reads the larger fund's repeated lines as summed).
  const shown = (fund, overlap) => research.pairByPath.get(pairPath(f.code, fund.code))?.overlap ?? overlap
  const item = ({ fund, overlap }) => `<li style="margin:4px 0">${link(fund)} (${esc(catLabel(fund))}): ${ovPct(shown(fund, overlap))} overlap</li>`
  return `${H2('Funds with the most similar portfolios')}
<p>${OVERLAP_RULE}</p>
${others.length ? `<p style="margin:0">From other fund houses:</p><ul style="padding-left:18px;margin:4px 0 0">${others.map(item).join('')}</ul>` : ''}
${sameHouse ? `<p>Closest fund from ${esc(f.amc)}: ${link(sameHouse.fund)} (${esc(catLabel(sameHouse.fund))}), ${ovPct(shown(sameHouse.fund, sameHouse.overlap))} overlap.</p>` : ''}
${index ? `<p>Closest index fund: ${fundLink(index.fund)}, ${ovPct(index.overlap)} overlap.</p>` : ''}`
}

function peersSection(f, win) {
  if (isQuarantined(f) || !['3Y', '5Y'].includes(win)) return ''
  const peers = funds.filter(p => p.category === f.category && isActive(p) && !isQuarantined(p) && p.metrics?.[win]?.catRank && p.metrics[win].cagr != null)
    .sort((a, b) => a.metrics[win].catRank - b.metrics[win].catRank || a.name.localeCompare(b.name))
  if (peers.length < 2) return ''
  const shown = peers.slice(0, 10)
  if (!shown.some(p => p.code === f.code) && peers.some(p => p.code === f.code)) shown.push(peers.find(p => p.code === f.code))
  const cat = esc(catLabel(f))
  const rows = shown.map(p => {
    const m = p.metrics[win]
    const name = p.code === f.code ? `<strong>${esc(p.name)}</strong>` : fundLink(p)
    return `<tr>${td(`#${m.catRank}`, 'num')}${nameCell(name, typeof p.expenseRatio === 'number' ? `Expense ratio ${p.expenseRatio.toFixed(2)}%` : '')}${td(pct(m.cagr), 'num')}${td(m.alpha != null ? `${sign(m.alpha)}%` : '-', 'num')}</tr>`
  })
  return `${H2(`${cat} funds by ${win} rank`)}
<p>${peers.length} ${cat} funds have a ${win} rank. ${rankNote(f.category)}</p>
${dataTable(`${cat} ranking`, [['Rank', 'num'], ['Fund'], [`${win} return a year`, 'num'], ['Versus category median', 'num']], rows)}`
}

// ---- Per-fund shells --------------------------------------------------------
let n = 0
for (const f of funds) {
  const slug = fundSlug(f.name)
  const cat = catLabel(f)
  const hash = `/fund/${f.code}/${slug}`
  const detail = research.details.get(f.code)

  // Pick the fund's best available long window to lead with (3Y preferred, then
  // 5Y), so search snippets show the fund's strongest honest read, not its 1Y.
  const qualityWarning = f.dataQuality?.status === 'quarantined' ? '<p role="status">NAV history needs source verification. Returns and rankings are withheld. Raw observations have not been adjusted.</p>' : ''
  const m3 = f.metrics?.['3Y'] || null
  const m5 = f.metrics?.['5Y'] || null
  const lead = m3 || m5 || f.metrics?.['1Y'] || null
  const leadWin = m3 ? '3Y' : m5 ? '5Y' : f.metrics?.['1Y'] ? '1Y' : null

  const descBits = [cat]
  if (lead?.catRank && lead?.catSize) descBits.push(`Rank #${lead.catRank} of ${lead.catSize}`)
  if (lead?.cagr != null && leadWin) descBits.push(`${leadWin} CAGR ${fixed(lead.cagr)}%`)
  if (lead?.alpha != null && leadWin) descBits.push(`alpha ${sign(lead.alpha)}%`)
  if (typeof f.expenseRatio === 'number') descBits.push(`expense ratio ${f.expenseRatio.toFixed(2)}%`)
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
  const subline = [cat && esc(cat), f.amc && esc(f.amc), 'Direct', 'Growth', aum].filter(Boolean).join(' &middot; ')

  let leadSentence = `${esc(f.name)} is a ${esc(cat)} fund.`
  if (lead?.catRank && lead?.catSize && lead?.cagr != null && leadWin) {
    leadSentence = `${esc(f.name)} ranks <strong>#${lead.catRank} of ${lead.catSize}</strong> in the ${esc(cat)} category ${rankLead(f.category, leadWin)}, with a ${leadWin} CAGR of <strong>${fixed(lead.cagr)}%</strong>${lead.alpha != null ? ` (${sign(lead.alpha)}% versus the category median)` : ''}.`
    if (m3 && m5) {
      leadSentence += ` Over 5 years it ranks #${m5.catRank} of ${m5.catSize} with a ${fixed(m5.cagr)}% CAGR.`
    }
  }

  const wins = [['3Y', m3], ['5Y', m5]].filter(([, mm]) => mm)
  const metricRows = [
    ['Return a year (CAGR)', mm => `${fixed(mm.cagr)}%`],
    ['Versus category median', mm => mm.alpha != null ? `${sign(mm.alpha)}%` : '-'],
    ['Category rank', mm => `#${mm.catRank} of ${mm.catSize}`],
    ['Sharpe ratio', mm => typeof mm.sharpe === 'number' && Number.isFinite(mm.sharpe) ? String(mm.sharpe) : '-'],
    ['Largest fall (max drawdown)', mm => mm.maxDrawdown != null ? `${fixed(mm.maxDrawdown)}%` : '-'],
  ]
  const cell = 'padding:6px 16px 6px 0'
  const table = wins.length
    ? `<h2 style="font-size:18px;margin:24px 0 8px">Key metrics</h2>
<div class="metrics-scroll" role="region" aria-label="Fund metrics" tabindex="0"><table style="border-collapse:collapse;font-size:14px;width:100%"><thead><tr><th style="${cell}"></th>${wins.map(([win, mm]) => `<th style="text-align:right;${cell};font-weight:600;white-space:normal;min-width:5.5rem">${win}${mm.windowStart && mm.windowEnd ? `<span style="display:block;font-size:12px;font-weight:400">${fmtDay(mm.windowStart)} to ${fmtDay(mm.windowEnd)}</span>` : ''}</th>`).join('')}</tr></thead><tbody>${metricRows.map(([label, fn]) => `<tr><th style="text-align:left;${cell};font-weight:400;white-space:normal">${label}</th>${wins.map(([, mm]) => `<td style="text-align:right;${cell}">${fn(mm)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : ''

  const bodyHtml = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Indian mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">${esc(f.name)}</h1>
<p style="font-size:15px;color:#475569;margin:0 0 20px">${subline}</p>
${qualityWarning}<p style="font-size:16px">${leadSentence}</p>
${table}
${factsSection(f, detail)}
${holdingsSection(f, detail)}
${similarSection(f)}
${peersSection(f, leadWin)}
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
  `<tr><td style="padding:6px 12px 6px 0;white-space:normal;min-width:7rem"><a href="${SITE}/c/${catSlug(c.key)}/" style="color:#2563eb">${esc(c.display)}</a></td><td style="padding:6px 12px 6px 0;text-align:right">${c.count}</td><td style="padding:6px 12px 6px 0;text-align:right">${c.median5Y != null ? c.median5Y.toFixed(1) + '%' : '-'}</td><td style="padding:6px 0;text-align:right">${c.top5Y != null ? c.top5Y.toFixed(1) + '%' : '-'}</td></tr>`
).join('')
const exploreBody = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Indian mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">Explore ${total} Indian mutual funds</h1>
<p style="font-size:16px;margin:0 0 20px">Browse Indian mutual funds by category and compare historical returns, risk and costs. Check the dates and available history before comparing results.${stockCov ? ` Stock-level holdings disclosed for ${stockCov} funds.` : ''}</p>
<h2 style="font-size:18px;margin:24px 0 8px">Categories</h2>
<div class="metrics-scroll" role="region" aria-label="Category metrics" tabindex="0"><table style="border-collapse:collapse;font-size:14px;width:100%"><thead><tr style="border-bottom:1px solid #e2e8f0"><th style="text-align:left;padding:0 12px 6px 0">Category</th><th style="text-align:right;padding:0 12px 6px 0">Funds</th><th style="text-align:right;padding:0 12px 6px 0">Median 5Y CAGR</th><th style="text-align:right;padding:0 0 6px 0">Highest 5Y CAGR</th></tr></thead><tbody>${catRows}</tbody></table></div>
${research.paths.length ? `<h2 style="font-size:18px;margin:24px 0 8px">Holdings research</h2><ul><li><a href="${SITE}/s/stocks/">Which mutual funds hold a stock</a></li><li><a href="${SITE}/s/overlap/">Portfolio overlap between funds</a></li></ul>` : ''}
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
  `What moved across ${total} Indian mutual funds: estimated net flows with the market effect taken out, fund size, returns, category rank, return momentum, expense ratio changes, fund manager changes, and the stocks funds bought and sold.`,
  `Ask in plain English, such as "which small cap fund had the highest inflow", or group the figures by category, fund house, index vs active or theme. Ranks are measured within each fund's own category; momentum compares a fund's recent 1-year return with its own 3- or 5-year record.`,
], '/movers')

const compareBody = pageBody("Compare mutual funds side by side", [
  `Select dates on a fund or comparison page to recalculate returns and risk from the available NAV data. Category ranks and portfolio disclosures use their own reporting periods.`,
  `Compare monthly portfolio disclosures to review overlap in equity holdings.`,
], '/compare')

// New fund offers: the list itself in plain HTML, so a search for an NFO can
// land here. Status uses the build date, as in src/lib/nfo.ts statusOn.
const nfoPath = join(ROOT, 'src/data/nfo.json')
const nfoData = existsSync(nfoPath) ? JSON.parse(readFileSync(nfoPath, 'utf-8')) : { nfos: [], generatedAt: '' }
const buildDay = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
const nfoStatus = n => n.nav ? 'Now trading' : n.launchDate > buildDay ? `Opens ${n.launchDate}` : n.closeDate && n.closeDate < buildDay ? `Closed ${n.closeDate}` : n.closeDate ? `Open until ${n.closeDate}` : `Opened ${n.launchDate}`
const nfoRows = nfoData.nfos.map(n =>
  `<tr><td style="padding:6px 16px 6px 0">${esc(n.name)}<div style="font-size:12px;color:#64748b">${esc(n.amc)}</div></td><td style="padding:6px 16px 6px 0">${esc(n.category.replace('-', ' - '))}</td><td style="padding:6px 16px 6px 0">${esc(n.details?.benchmark || '-')}</td><td style="padding:6px 0">${esc(nfoStatus(n))}</td></tr>`
).join('')
const nfoBody = `<p style="font-size:13px;color:#64748b;margin:0 0 4px">FairFund &middot; Indian mutual fund research</p>
<h1 style="font-size:28px;margin:0 0 6px">New fund offers (NFOs)</h1>
<p style="font-size:16px;margin:0 0 14px">New fund offers in the categories FairFund covers, from AMFI's scheme list. Each is shown on FairFund next to the funds that already track the same index, because a new fund has no performance record of its own.</p>
<p style="font-size:16px;margin:0 0 20px">A new fund starts at a round NAV, usually &#8377;10. A low NAV is not cheaper than a high one.</p>
${nfoRows ? `<div class="metrics-scroll" role="region" aria-label="New fund offers" tabindex="0"><table style="border-collapse:collapse;font-size:14px;width:100%"><thead><tr style="border-bottom:1px solid #e2e8f0"><th style="text-align:left;padding:0 16px 6px 0">Scheme</th><th style="text-align:left;padding:0 16px 6px 0">Category</th><th style="text-align:left;padding:0 16px 6px 0">Benchmark</th><th style="text-align:left;padding:0 0 6px 0">Status</th></tr></thead><tbody>${nfoRows}</tbody></table></div>` : '<p style="font-size:16px">No new fund offers in FairFund\'s categories right now.</p>'}
<p style="margin-top:24px"><a href="${SHELL_UP}#/nfo" style="color:#2563eb;font-weight:600">Open it on FairFund &rarr;</a></p>
<p style="font-size:12px;color:#475569;margin-top:20px">Source: AMFI${nfoData.generatedAt ? `, ${esc(nfoData.generatedAt)}` : ''}. Data for research only, not investment advice. Past performance does not indicate future returns. Read the scheme information document before investing.</p>`

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
    `Estimated net flows, fund size, rank, costs, manager changes and portfolio moves across ${total} Indian mutual funds on FairFund.`, moversBody,
    pageJsonld('Mutual fund movers', 'Estimated net flows, fund size, returns, rank, costs, manager changes and portfolio moves across Indian mutual funds.', 's/movers/')],
  ['s/compare', '/compare', `Compare funds side by side - FairFund`,
    `Compare mutual funds over a selected period and review overlap in their disclosed holdings.`, compareBody,
    pageJsonld('Compare mutual funds', 'Compare mutual funds over a selected period and review overlap in their disclosed holdings.', 's/compare/')],
  ['s/nfo', '/nfo', `New fund offers (NFOs) - FairFund`,
    `New fund offers in the mutual fund categories FairFund covers, next to the funds that already track the same index.`, nfoBody,
    pageJsonld('New fund offers', 'New fund offers in the categories FairFund covers, with the funds that already track the same index.', 's/nfo/')],
  ['s/methodology', '/methodology', `Methodology - FairFund`,
    `How FairFund calculates returns, compares funds within categories and handles data limitations.`, methodBody,
    pageJsonld('FairFund methodology', 'How FairFund calculates returns, compares funds within categories and handles data limitations.', 's/methodology/')],
]
for (const [dir, hash, title, desc, bodyHtml, jsonld] of pages) {
  writeShell({ dir, hash, title, desc, canonicalPath: `${dir}/`, bodyHtml, jsonld })
}


// ---- Per-category deep-dive shells -----------------------------------------
function categoryOverlap(key) {
  const pairs = research.pairs.filter(p => p.category === key).sort((x, y) => y.overlap - x.overlap)
  if (!pairs.length) return ''
  const n = new Set(pairs.flatMap(p => [p.a.code, p.b.code])).size
  return `<h2 style="font-size:20px">Portfolio overlap among the ${numberWord(n)} largest funds with stock-level holdings</h2>
<p>${OVERLAP_RULE}</p>
<ul>${pairs.map(p => `<li style="margin:.4rem 0"><a href="${SITE}/${p.path}">${esc(p.a.name)} vs ${esc(p.b.name)}</a>: ${ovPct(p.overlap)}</li>`).join('')}</ul>
<p><a href="${SITE}/s/overlap/">Overlap for every category</a></p>`
}
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
<p style="font-size:15px;color:#475569;margin:0 0 20px">${c.count} funds &middot; ${esc(c.risk || 'Moderate')} risk${c.median5Y != null ? ` &middot; Median 5Y CAGR ${c.median5Y.toFixed(1)}%` : ''}</p>
<p style="font-size:16px">Explore the ${esc(c.display)} category: historical return distributions, category comparisons and performance during past market falls. Check the dates and available history before comparing results.</p>
<p style="margin-top:24px"><a href="${SHELL_UP}#${hash}" style="color:#2563eb;font-weight:600">Open the interactive deep dive &rarr;</a></p>
${categoryOverlap(c.key)}
<h2 style="font-size:20px">Fund reports in this category</h2><ul>${fundLinks}</ul>
<p style="font-size:12px;color:#475569;margin-top:20px">Data for research only, not investment advice. Past performance does not indicate future returns.</p>`

  writeShell({ dir: `c/${slug}`, hash, title, desc, canonicalPath: `c/${slug}/`, jsonld, bodyHtml })
  catN++
}

// ---- Stock pages: which funds hold a stock ----------------------------------
const portfolioMonth = dates => {
  const counts = new Map()
  for (const d of dates) if (d) counts.set(d, (counts.get(d) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null
}
const MAX_HOLDER_ROWS = 200
const MAX_INDEX_ROWS = 50
const coveredCount = research.covered.length
const formerlyText = st => st.formerly ? ` (formerly ${esc(stockLabel(st.formerly))})` : ''
let stockN = 0
for (const st of research.stocks) {
  const label = stockLabel(st.name)
  const holders = st.holders
  const n = holders.length
  const activeHolders = holders.filter(h => !isIndexFund(h.fund))
  const indexHolders = holders.filter(h => isIndexFund(h.fund))
  const med = median(holders.map(h => h.pct))
  const largest = holders[0]
  const withMom = holders.filter(h => h.change !== undefined)
  const added = withMom.filter(h => h.change === null).length
  const raised = withMom.filter(h => typeof h.change === 'number' && h.change > 0).length
  const cut = withMom.filter(h => typeof h.change === 'number' && h.change < 0).length
  const month = portfolioMonth(holders.map(h => h.date))
  const otherDates = holders.filter(h => h.date && h.date !== month).length
  // Weight changes compare each fund's two latest disclosures; most share one earlier date.
  const sinceMain = portfolioMonth(withMom.map(h => h.since))
  const changeCell = h => h.change === undefined ? '-' : `${bps(h.change)}${h.since && h.since !== sinceMain ? `<span class="sub">since ${fmtDay(h.since)}</span>` : !h.since ? '<span class="sub">since previous disclosure</span>' : ''}`
  const sinceOthers = withMom.filter(h => h.since !== sinceMain).length
  const path = `st/${st.slug}/`
  const searchName = st.formerly ? `${label} (${stockLabel(st.formerly)})` : label
  const title = `Which mutual funds hold ${searchName}? ${n} funds | FairFund`
  const desc = `${n} Indian mutual funds hold ${label} in their latest portfolio disclosures. Median weight ${pct(med)}. Each fund's weight and its change since the previous disclosure.`
  const holderTable = (list, heading, limit) => {
    if (!list.length) return ''
    const rows = list.slice(0, limit).map(h => `<tr>${nameCell(fundLink(h.fund), esc(catLabel(h.fund)))}${td(pct(h.pct, 2), 'num')}${td(changeCell(h), 'num')}</tr>`)
    return `${H2(`${heading} (${list.length})`)}
${dataTable(heading, [['Fund'], ['Weight', 'num'], [sinceMain ? `Change in weight since ${fmtDay(sinceMain)}` : 'Change in weight since previous disclosure', 'num']], rows)}
${list.length > limit ? `<p>${list.length - limit} more hold it at a smaller weight.</p>` : ''}`
  }
  const bodyHtml = `${EYEBROW}
<h1 style="font-size:28px;margin:0 0 6px">Mutual funds that hold ${esc(label)}</h1>
<p style="font-size:15px;color:#475569;margin:0 0 20px">${esc(st.name)}${formerlyText(st)}${st.sector ? ` &middot; ${esc(st.sector)}` : ''}</p>
<p style="font-size:16px">${n} of the ${coveredCount} funds with stock-level portfolios on FairFund hold ${esc(label)}${month ? `, per disclosures for ${fmtDay(month)}` : ''}${otherDates ? ` (${otherDates} ${otherDates === 1 ? 'has' : 'have'} a different disclosure date)` : ''}. ${activeHolders.length} are actively managed and ${indexHolders.length} are index funds.</p>
<p style="font-size:16px">Where held, the median weight is ${pct(med)} of the portfolio. The largest weight is ${pct(largest.pct)}, in ${fundLink(largest.fund)}.${withMom.length ? ` Compared with each fund's previous disclosure${sinceMain ? ` (${fmtDay(sinceMain)}${sinceOthers ? ` for all but ${sinceOthers}` : ''})` : ''}, ${raised} ${raised === 1 ? 'fund' : 'funds'} had a higher weight, ${cut} a lower one and ${added} had no earlier weight for it (usually a new holding). A weight can also change because the share price moved against the rest of the portfolio, and funds that sold out entirely are not listed.` : ''}</p>
${holderTable(activeHolders, `Actively managed funds holding ${esc(label)}`, MAX_HOLDER_ROWS)}
${holderTable(indexHolders, `Index funds holding ${esc(label)}`, MAX_INDEX_ROWS)}
<p><a href="${SITE}/s/stocks/">All stocks</a> &middot; <a href="${SHELL_UP}#/movers" style="color:#2563eb;font-weight:600">Fund buying and selling on FairFund &rarr;</a></p>
${DISCLAIMER}`
  const jsonld = pageJsonld(`Mutual funds that hold ${label}`, desc, path)
  writeShell({ dir: path.slice(0, -1), hash: '/movers', title, desc, canonicalPath: path, jsonld, bodyHtml })
  stockN++
}

// ---- Overlap pages: fund A vs fund B -----------------------------------------
let pairN = 0
for (const pair of research.pairs) {
  const { a, b, overlap } = pair
  const da = research.details.get(a.code), db = research.details.get(b.code)
  const ma = research.maps.get(a.code).sum, mb = research.maps.get(b.code).first
  const names = new Map()
  for (const h of [...da.holdings, ...db.holdings]) {
    const k = String(h.key || h.name || '').trim().toLowerCase()
    if (k && !names.has(k)) names.set(k, h)
  }
  const shared = [...ma.keys()].filter(k => mb.has(k))
    .map(k => ({ k, h: names.get(k), wa: ma.get(k), wb: mb.get(k) }))
    .sort((x, y) => Math.min(y.wa, y.wb) - Math.min(x.wa, x.wb) || x.k.localeCompare(y.k))
  const only = (m, other) => [...m.entries()].filter(([k]) => !other.has(k)).sort((x, y) => y[1] - x[1]).slice(0, 5)
    .map(([k, w]) => ({ h: names.get(k), w }))
  const short = f => esc(f.name.replace(/\s+Fund$/i, ''))
  const dateA = da.holdingsMeta?.portfolioDate, dateB = db.holdingsMeta?.portfolioDate
  const datesText = dateA && dateA === dateB ? `Both portfolios are as disclosed for ${fmtDay(dateA)}.` : `Portfolios as disclosed for ${dateA ? fmtDay(dateA) : 'n/a'} (${short(a)}) and ${dateB ? fmtDay(dateB) : 'n/a'} (${short(b)}).`
  const sharedRows = shared.slice(0, 15).map(x => `<tr>${nameCell(stockName(x.h), '')}${td(pct(x.wa, 2), 'num')}${td(pct(x.wb, 2), 'num')}</tr>`)
  const factRows = []
  const fact = (label, fn) => {
    const va = fn(a), vb = fn(b)
    if (va == null && vb == null) return
    factRows.push(`<tr>${td(label, 'label')}${td(va ?? '-', 'num')}${td(vb ?? '-', 'num')}</tr>`)
  }
  fact('Fund size', f => fmtAum(f.aum?.current))
  fact('Expense ratio', f => typeof f.expenseRatio === 'number' ? `${f.expenseRatio.toFixed(2)}%` : null)
  const quarantined = isQuarantined(a) || isQuarantined(b)
  for (const win of quarantined ? [] : ['3Y', '5Y']) {
    fact(`${win} return a year`, f => f.metrics?.[win]?.cagr != null ? pct(f.metrics[win].cagr) : null)
    fact(`${win} category rank`, f => f.metrics?.[win]?.catRank ? `#${f.metrics[win].catRank} of ${f.metrics[win].catSize}` : null)
    fact(`${win} largest fall`, f => f.metrics?.[win]?.maxDrawdown != null ? pct(f.metrics[win].maxDrawdown) : null)
  }
  fact('Holdings disclosed', f => {
    const d = research.details.get(f.code), c = d.holdingsMeta?.count
    return String(Number.isInteger(c) && c > 0 ? c : d.holdings.length)
  })
  const onlyList = (f, list) => list.length ? `<p><strong>Largest holdings only in ${short(f)}:</strong> ${list.map(x => `${stockName(x.h)} ${pct(x.w)}`).join(', ')}.</p>` : ''
  const cat = esc(catLabel(a))
  const title = `${a.name} vs ${b.name}: portfolio overlap | FairFund`
  const desc = `${a.name} and ${b.name} have ${ovPct(overlap).replace('&lt;', 'under ').replace('&gt;', 'over ')} portfolio overlap with ${shared.length} holdings in common. Shared holdings, costs and returns side by side.`
  const bodyHtml = `${EYEBROW}
<h1 style="font-size:28px;margin:0 0 6px">${esc(a.name)} vs ${esc(b.name)}</h1>
<p style="font-size:15px;color:#475569;margin:0 0 20px">${cat} &middot; ${esc(a.amc)} and ${esc(b.amc)}</p>
<p style="font-size:16px">These two ${cat} funds have <strong>${ovPct(overlap)} portfolio overlap</strong>, with ${shared.length} holdings in common. ${OVERLAP_RULE}</p>
<p>${datesText}</p>
${H2('Side by side')}
${dataTable('Fund comparison', [['', ''], [short(a), 'num'], [short(b), 'num']], factRows)}
${H2('Largest shared holdings')}
<p>Each shared holding adds the smaller of its two weights to the overlap.</p>
${dataTable('Shared holdings', [['Holding'], [`Weight in ${short(a)}`, 'num'], [`Weight in ${short(b)}`, 'num']], sharedRows)}
${onlyList(a, only(ma, mb))}
${onlyList(b, only(mb, ma))}
<p>Fund reports: ${fundLink(a)} &middot; ${fundLink(b)} &middot; <a href="${SITE}/s/overlap/">More overlap pairs</a></p>
<p style="margin-top:24px"><a href="${SHELL_UP}#/compare?codes=${a.code},${b.code}" style="color:#2563eb;font-weight:600">Compare these funds over any period &rarr;</a></p>
${DISCLAIMER}`
  const jsonld = pageJsonld(`${a.name} vs ${b.name}: portfolio overlap`, desc, pair.path)
  writeShell({ dir: pair.path.slice(0, -1), hash: '/compare', title, desc, canonicalPath: pair.path, jsonld, bodyHtml })
  pairN++
}

// ---- Hub pages ---------------------------------------------------------------
if (research.paths.length) {
  const stockRows = research.stocks.map(st => `<tr>${nameCell(`<a href="${SITE}/st/${st.slug}/">${esc(stockLabel(st.name))}</a>${formerlyText(st)}`, st.sector ? esc(st.sector) : '')}${td(String(st.holders.length), 'num')}${td(pct(median(st.holders.map(h => h.pct))), 'num')}</tr>`)
  const stocksBody = `${EYEBROW}
<h1 style="font-size:28px;margin:0 0 6px">Which mutual funds hold a stock</h1>
<p style="font-size:16px">${research.stocks.length} stocks held by at least ${research.stocks.at(-1)?.holders.length ?? 0} of the ${coveredCount} funds with stock-level portfolios on FairFund, from their latest monthly disclosures, most widely held first. Open a stock to see the funds that hold it, largest weight first, and the change in weight since each fund's previous disclosure.</p>
${dataTable('Stocks', [['Stock'], ['Funds holding it', 'num'], ['Median weight', 'num']], stockRows)}
<p style="margin-top:24px"><a href="${SHELL_UP}#/movers" style="color:#2563eb;font-weight:600">Fund buying and selling on FairFund &rarr;</a></p>
${DISCLAIMER}`
  writeShell({ dir: 's/stocks', hash: '/movers', title: 'Which mutual funds hold a stock - FairFund',
    desc: `How many Indian mutual funds hold each stock, and at what weight, from ${coveredCount} funds' latest portfolio disclosures.`,
    canonicalPath: 's/stocks/', bodyHtml: stocksBody,
    jsonld: pageJsonld('Which mutual funds hold a stock', `How many Indian mutual funds hold each stock, and at what weight.`, 's/stocks/') })

  const groups = [...new Set(research.pairs.map(p => p.category))].map(cat => {
    const ps = research.pairs.filter(p => p.category === cat).sort((x, y) => y.overlap - x.overlap)
    return `<h2>${esc(catLabel(ps[0].a))}</h2><ul>${ps.map(p => `<li style="margin:.4rem 0"><a href="${SITE}/${p.path}">${esc(p.a.name)} vs ${esc(p.b.name)}</a>: ${ovPct(p.overlap)}</li>`).join('')}</ul>`
  }).join('\n')
  const overlapBody = `${EYEBROW}
<h1 style="font-size:28px;margin:0 0 6px">Portfolio overlap between mutual funds</h1>
<p style="font-size:16px">How much the ${numberWord(PAIR_TOP_N)} largest funds (by fund size) with disclosed stock-level holdings in each actively managed equity category hold in common, from their latest monthly disclosures, highest overlap first. ${OVERLAP_RULE}</p>
${groups}
<p style="margin-top:24px"><a href="${SHELL_UP}#/compare" style="color:#2563eb;font-weight:600">Check the overlap between any funds &rarr;</a></p>
${DISCLAIMER}`
  writeShell({ dir: 's/overlap', hash: '/compare', title: 'Portfolio overlap between mutual funds - FairFund',
    desc: 'Portfolio overlap between the largest Indian mutual funds in each equity category, with the stocks they share.',
    canonicalPath: 's/overlap/', bodyHtml: overlapBody,
    jsonld: pageJsonld('Portfolio overlap between mutual funds', 'Portfolio overlap between the largest Indian mutual funds in each equity category.', 's/overlap/') })
}


console.log(`[gen-unfurls] wrote ${n} enriched fund shells + ${pages.length} page shells + ${catN} category shells + ${stockN} stock shells + ${pairN} overlap shells${research.paths.length ? ' + 2 hubs' : ''} into dist/`)
