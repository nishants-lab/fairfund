// Prerender static OG "unfurl shells" for GitHub Pages.
//
// The app uses HashRouter, so social crawlers (WhatsApp, Slack, Twitter,
// iMessage, LinkedIn) never see per-route content: they fetch the URL, and
// everything after '#' is invisible to them. Every shared link therefore
// unfurled with the single generic card from index.html.
//
// This script emits one tiny crawlable HTML shell per fund and per key page,
// each carrying route-specific Open Graph / Twitter tags plus an instant
// client-side redirect into the real SPA hash route. Crawlers read the tags;
// humans get bounced straight into the app.
//
// Runs after `vite build`; writes into dist/ (the deployed artifact).
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const SITE = 'https://nishants-lab.github.io/fairfund'
const IMAGE = `${SITE}/og-cover.png`

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
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function fmtPct(n) {
  return `${n >= 0 ? '' : ''}${n.toFixed(1)}%`
}

// One shell. `hash` is the SPA route (e.g. "/fund/123/name"); `dir` is the
// dist subpath (e.g. "f/123"). Both f/* and s/* live two levels below the app
// root, so "../../" reliably returns to /fairfund/.
function writeShell(dir, hash, title, desc, canonicalPath, image = IMAGE) {
  const outDir = join(DIST, dir)
  mkdirSync(outDir, { recursive: true })
  const url = `${SITE}/${canonicalPath}`
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
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
<link rel="canonical" href="${esc(url)}"/>
<script>
  // Send humans into the SPA hash route; crawlers ignore this and read the
  // meta tags above. Regex strips /f/... or /s/... back to the app root so
  // this survives any deploy-path change.
  var root = location.pathname.replace(/\/(f|s)\/.*$/, '/');
  location.replace(location.origin + root + '#${hash}');
</script>
<meta http-equiv="refresh" content="0;url=../../#${hash}"/>
</head>
<body style="font-family:system-ui,sans-serif;padding:2rem;color:#334155">
Redirecting to <a href="../../#${hash}">FairFund</a>...
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
  const m = f.metrics?.['3Y'] || f.metrics?.['5Y'] || f.metrics?.['1Y'] || null
  const win = f.metrics?.['3Y'] ? '3Y' : f.metrics?.['5Y'] ? '5Y' : f.metrics?.['1Y'] ? '1Y' : null
  const bits = [cat]
  if (m?.catRank && m?.catSize) bits.push(`Rank #${m.catRank} of ${m.catSize}`)
  if (m?.cagr != null && win) bits.push(`${win} CAGR ${fmtPct(m.cagr)}`)
  if (m?.alpha != null && win) bits.push(`alpha ${m.alpha >= 0 ? '+' : ''}${m.alpha.toFixed(1)}%`)
  const desc = `${bits.join(' \u00b7 ')}. Forward-looking analysis, evidence not advice, on FairFund.`
  const title = `${f.name} - FairFund`
  const ogImg = existsSync(join(DIST, 'og', `${f.code}.png`)) ? `${SITE}/og/${f.code}.png` : IMAGE
  writeShell(`f/${f.code}`, `/fund/${f.code}/${slug}`, title, desc, `f/${f.code}/`, ogImg)
  n++
}

// ---- Per-page shells --------------------------------------------------------
const total = data.totalFunds ?? funds.length
const pages = [
  ['s/explore', '/explore', `Explore ${total} funds - FairFund`,
    `Filter and rank India's equity mutual funds by consistency, skill vs luck and downside protection. Evidence, not advice.`],
  ['s/movers', '/movers', `Today's movers - FairFund`,
    `Fund size, category-rank and return-momentum movers across ${total} Indian equity funds on FairFund.`],
  ['s/compare', '/compare', `Compare funds side by side - FairFund`,
    `Compare Indian mutual funds on risk-adjusted return, alpha, drawdown and holdings overlap. Evidence, not advice.`],
  ['s/methodology', '/methodology', `Methodology - FairFund`,
    `How FairFund scores funds: fixed-window backtests plus probability-based consistency, skill-vs-luck and downside signals.`],
]
for (const [dir, hash, title, desc] of pages) {
  writeShell(dir, hash, title, desc, `${dir}/`)
}

console.log(`[gen-unfurls] wrote ${n} fund shells + ${pages.length} page shells into dist/`)
