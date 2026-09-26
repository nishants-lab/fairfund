// Generate a modern 1200x630 Open Graph image per fund at build time.
//
// satori lays out a flexbox card and rasterises the text to vector paths;
// @resvg/resvg-js turns that SVG into a PNG. The result is a fund-specific
// share card (name, category, rank, CAGR, alpha) so links unfurl with a picture
// that matches the fund, not the generic cover.
//
// Runs after `vite build`; writes into dist/og/<code>.png.
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const FONTS = join(__dirname, 'fonts')
const OUT = join(DIST, 'og')

if (!existsSync(DIST)) {
  console.error('[gen-og-images] dist/ not found - run vite build first')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const font = (f) => readFileSync(join(FONTS, f))
const fonts = [
  { name: 'Inter', data: font('Inter-400.woff'), weight: 400, style: 'normal' },
  { name: 'Inter', data: font('Inter-600.woff'), weight: 600, style: 'normal' },
  { name: 'Inter', data: font('Inter-700.woff'), weight: 700, style: 'normal' },
  { name: 'Inter', data: font('Inter-800.woff'), weight: 800, style: 'normal' },
  { name: 'Newsreader', data: font('Newsreader-600.woff'), weight: 600, style: 'normal' },
]

const data = JSON.parse(readFileSync(join(ROOT, 'src/data/funds.json'), 'utf-8'))
const funds = data.funds ?? []
const LIMIT = process.env.OG_LIMIT ? parseInt(process.env.OG_LIMIT, 10) : Infinity

// Per-category accent so different funds feel distinct. Deterministic hash.
const ACCENTS = [
  { glow: '#34d399', chip: 'rgba(52,211,153,0.14)', ring: 'rgba(52,211,153,0.35)' }, // emerald
  { glow: '#818cf8', chip: 'rgba(129,140,248,0.14)', ring: 'rgba(129,140,248,0.35)' }, // indigo
  { glow: '#22d3ee', chip: 'rgba(34,211,238,0.14)', ring: 'rgba(34,211,238,0.35)' }, // cyan
  { glow: '#fbbf24', chip: 'rgba(251,191,36,0.14)', ring: 'rgba(251,191,36,0.35)' }, // amber
  { glow: '#f472b6', chip: 'rgba(244,114,182,0.14)', ring: 'rgba(244,114,182,0.35)' }, // pink
  { glow: '#a78bfa', chip: 'rgba(167,139,250,0.14)', ring: 'rgba(167,139,250,0.35)' }, // violet
  { glow: '#2dd4bf', chip: 'rgba(45,212,191,0.14)', ring: 'rgba(45,212,191,0.35)' }, // teal
  { glow: '#60a5fa', chip: 'rgba(96,165,250,0.14)', ring: 'rgba(96,165,250,0.35)' }, // sky
]
function accentFor(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return ACCENTS[h % ACCENTS.length]
}

const POS = '#34d399'
const NEG = '#fb7185'
const div = (style, children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } })
const txt = (style, s) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: String(s) } })

function statCard(label, value, color, accent) {
  return div(
    { display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 26px', borderRadius: 18,
      background: accent.chip, border: `1px solid ${accent.ring}` },
    [
      txt({ fontFamily: 'Inter', fontSize: 44, fontWeight: 800, color, lineHeight: 1 }, value),
      txt({ fontFamily: 'Inter', fontSize: 20, fontWeight: 600, color: '#94a3b8', letterSpacing: 0.3 }, label),
    ],
  )
}

function card(fund) {
  const name = fund.name
  const cat = fund.categoryDisplay || fund.category || 'Equity'
  const accent = accentFor(cat)
  const m = fund.metrics?.['3Y'] || fund.metrics?.['5Y'] || fund.metrics?.['1Y'] || null
  const win = fund.metrics?.['3Y'] ? '3Y' : fund.metrics?.['5Y'] ? '5Y' : fund.metrics?.['1Y'] ? '1Y' : null

  const stats = []
  if (m?.catRank && m?.catSize) stats.push(statCard('CATEGORY RANK', `#${m.catRank} of ${m.catSize}`, '#f8fafc', accent))
  if (m?.cagr != null && win) stats.push(statCard(`${win} CAGR`, `${m.cagr.toFixed(1)}%`, m.cagr >= 0 ? POS : NEG, accent))
  if (m?.alpha != null && win) stats.push(statCard('ALPHA VS PEERS', `${m.alpha >= 0 ? '+' : ''}${m.alpha.toFixed(1)}%`, m.alpha >= 0 ? POS : NEG, accent))
  if (stats.length === 0 && fund.aum?.current) stats.push(statCard('AUM', `Rs ${Math.round(fund.aum.current).toLocaleString('en-IN')} Cr`, '#f8fafc', accent))

  // Subtitle carries facts shown nowhere else on the card (AUM, expense), not a
  // fragment of the rank. Falls back to the fund house, then the category.
  const subParts = []
  if (fund.aum?.current) subParts.push(`Rs ${Math.round(fund.aum.current).toLocaleString('en-IN')} Cr AUM`)
  if (fund.expenseRatio != null) subParts.push(`${fund.expenseRatio}% expense ratio`)
  const rankSub = subParts.length ? subParts.join('  \u00B7  ') : (fund.amc || cat)

  return div(
    { width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      padding: 64, position: 'relative',
      backgroundColor: '#0a1020',
      backgroundImage: `radial-gradient(900px 500px at 82% 8%, ${accent.chip}, transparent 60%), linear-gradient(135deg, #0a1020 0%, #0f1e3d 100%)`,
      fontFamily: 'Inter' },
    [
      // accent glow bar top-left
      div({ position: 'absolute', top: 0, left: 64, width: 120, height: 8, background: accent.glow, borderRadius: 8 }, []),
      // header: wordmark
      div({ display: 'flex', alignItems: 'center', gap: 16 }, [
        div({ display: 'flex', width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
          background: `linear-gradient(135deg, #2563eb, ${accent.glow})` },
          [txt({ fontFamily: 'Inter', fontSize: 30, fontWeight: 800, color: '#fff' }, 'F')]),
        txt({ fontFamily: 'Newsreader', fontSize: 42, fontWeight: 600, color: '#f8fafc' }, 'FairFund'),
        txt({ fontFamily: 'Inter', fontSize: 18, fontWeight: 600, color: '#64748b', marginTop: 10 }, 'FORWARD-LOOKING MF RESEARCH'),
      ]),
      // body: category chip + fund name
      div({ display: 'flex', flexDirection: 'column', gap: 22 }, [
        div({ display: 'flex' }, [
          txt({ fontFamily: 'Inter', fontSize: 22, fontWeight: 700, color: accent.glow, letterSpacing: 1.5,
            padding: '8px 18px', borderRadius: 999, background: accent.chip, border: `1px solid ${accent.ring}` },
            cat.toUpperCase()),
        ]),
        txt({ fontFamily: 'Newsreader', fontSize: name.length > 42 ? 66 : 78, fontWeight: 600, color: '#f8fafc',
          lineHeight: 1.05, letterSpacing: -0.5, display: 'flex', maxWidth: 1000 }, name),
        txt({ fontFamily: 'Inter', fontSize: 24, fontWeight: 500, color: '#94a3b8' }, rankSub),
      ]),
      // footer: stats + tagline
      div({ display: 'flex', flexDirection: 'column', gap: 26 }, [
        div({ display: 'flex', gap: 18 }, stats),
        div({ display: 'flex', alignItems: 'center', gap: 12 }, [
          div({ width: 28, height: 4, background: accent.glow, borderRadius: 4 }, []),
          txt({ fontFamily: 'Inter', fontSize: 22, fontWeight: 600, color: '#64748b' }, 'Evidence, not advice.'),
        ]),
      ]),
    ],
  )
}

export { card, fonts, funds }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
let n = 0, errs = 0
const t0 = Date.now()
for (const f of funds) {
  if (n >= LIMIT) break
  try {
    const svg = await satori(card(f), { width: 1200, height: 630, fonts })
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
    writeFileSync(join(OUT, `${f.code}.png`), png)
    n++
  } catch (e) {
    errs++
    if (errs <= 3) console.error(`[gen-og-images] ${f.code} ${f.name}: ${e.message}`)
  }
}
console.log(`[gen-og-images] wrote ${n} OG images (${errs} errors) in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
