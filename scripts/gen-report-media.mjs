// Share media for the monthly holdings report, from src/data/holdings_report.json:
//   dist/og/fund-buying.png    1200x630 link preview for /s/fund-buying/
//   dist/media/fund-buying.gif 720x720 animated chart of the top buys and sells, for posts
// Runs after gen-og-images and before gen-unfurls (which points og:image here).
// Skipped, with a note, when the report data is absent.
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import gifenc from 'gifenc'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const { GIFEncoder, quantize, applyPalette } = gifenc
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DIST = join(ROOT, 'dist')
const FONTS = join(__dirname, 'fonts')
const font = f => readFileSync(join(FONTS, f))
export const fonts = [
  { name: 'Inter', data: font('Inter-400.woff'), weight: 400, style: 'normal' },
  { name: 'Inter', data: font('Inter-600.woff'), weight: 600, style: 'normal' },
  { name: 'Inter', data: font('Inter-700.woff'), weight: 700, style: 'normal' },
  { name: 'Newsreader', data: font('Newsreader-600.woff'), weight: 600, style: 'normal' },
]

const INK = '#14171c', PAPER = '#f6f3ec', MUTED = '#9aa3ad', LINE = '#2a3038', UP = '#34d399', DOWN = '#fb7185'
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthLong = ym => { const [y, m] = String(ym).split('-').map(Number); return `${LONG[m - 1]} ${y}` }
export const croreText = (n, signed = false) => {
  const v = Math.round(Math.abs(n)).toLocaleString('en-IN')
  const sign = signed ? (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') : (n < 0 ? '−' : '')
  return `${sign}Rs ${v} cr`
}
// The bundled Inter subset has no rupee glyph, so images write "Rs", as gen-og-images does.
const ABBREV = { 'Life Insurance Corporation of India': 'LIC', 'Zetwerk Manufacturing Businesses': 'Zetwerk', 'Oil & Natural Gas Corporation': 'ONGC' }
/** Cut a name to fit about `chars` characters at the row font size. */
export const fitName = (name, chars) => {
  const n = ABBREV[name] ?? name
  return n.length > chars ? n.slice(0, chars - 1).trimEnd() + '…' : n
}
export const shortName = name => String(name).replace(/\s+(Ltd\.?|Limited)\s*$/i, '').replace(/\.$/, '').replace(/\s*Forgn\.?\s*Eq.*$/i, '').trim()

const el = (type, style, children = []) => ({ type, props: { style: { display: 'flex', ...style }, children } })
const text = (style, value) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: String(value) } })

/** The lead month's headline facts, or null. */
export function leadFacts(report) {
  const mo = report?.lead && report.months?.[report.lead]
  if (!mo) return null
  const pick = (key, n) => mo.lists[key].slice(0, n).map(k => ({ name: shortName(mo.stocks[k].name), net: mo.stocks[k].net, added: mo.stocks[k].added, cut: mo.stocks[k].cut }))
  return { month: mo.month, totals: mo.totals, complete: mo.coverage.complete, buys: pick('buys', 5), sells: pick('sells', 5) }
}

function barRows(rows, max, color, progress, width, chars) {
  return rows.map((r, i) => {
    const p = Math.max(0, Math.min(1, progress * 1.6 - i * 0.12))
    return el('div', { flexDirection: 'column', gap: 6 }, [
      el('div', { justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }, [
        text({ fontSize: 24, fontWeight: 600, color: PAPER, whiteSpace: 'nowrap' }, fitName(r.name, chars)),
        text({ fontSize: 24, fontWeight: 700, color, whiteSpace: 'nowrap', flexShrink: 0 }, croreText(r.net, true)),
      ]),
      el('div', { height: 10, width, background: LINE, borderRadius: 5 }, [
        el('div', { height: 10, width: Math.max(2, (Math.abs(r.net) / max) * width * p), background: color, borderRadius: 5 }),
      ]),
    ])
  })
}

export function ogCard(f) {
  const max = Math.max(...f.buys.slice(0, 3).concat(f.sells.slice(0, 3)).map(r => Math.abs(r.net)), 1)
  return el('div', { width: 1200, height: 630, background: INK, padding: '56px 64px', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'Inter' }, [
    el('div', { justifyContent: 'space-between', alignItems: 'center' }, [
      text({ fontFamily: 'Newsreader', fontSize: 36, fontWeight: 600, color: PAPER }, 'FairFund'),
      text({ fontSize: 20, fontWeight: 600, color: MUTED, letterSpacing: 2 }, `FUND BUYING · ${monthLong(f.month).toUpperCase()}`),
    ]),
    el('div', { flexDirection: 'column', gap: 10 }, [
      text({ fontFamily: 'Newsreader', fontSize: 64, fontWeight: 600, color: PAPER, lineHeight: 1.05 }, `Funds bought ${croreText(f.totals.net)}`),
      text({ fontFamily: 'Newsreader', fontSize: 64, fontWeight: 600, color: MUTED, lineHeight: 1.05 }, `of shares in ${monthLong(f.month).split(' ')[0]}.`),
    ]),
    el('div', { gap: 56 }, [
      el('div', { flexDirection: 'column', gap: 16, width: 508 }, [text({ fontSize: 16, fontWeight: 700, color: MUTED, letterSpacing: 2 }, 'MOST BOUGHT'), ...barRows(f.buys.slice(0, 3), max, UP, 1, 508, 24)]),
      el('div', { flexDirection: 'column', gap: 16, width: 508 }, [text({ fontSize: 16, fontWeight: 700, color: MUTED, letterSpacing: 2 }, 'MOST SOLD'), ...barRows(f.sells.slice(0, 3), max, DOWN, 1, 508, 24)]),
    ]),
  ])
}

export function gifFrame(f, progress) {
  const max = Math.max(...f.buys.concat(f.sells).map(r => Math.abs(r.net)), 1)
  const shown = Math.round(Math.abs(f.totals.net) * Math.min(1, progress * 1.4))
  return el('div', { width: 720, height: 720, background: INK, padding: '44px 48px', flexDirection: 'column', justifyContent: 'space-between', fontFamily: 'Inter' }, [
    el('div', { flexDirection: 'column', gap: 8 }, [
      text({ fontSize: 18, fontWeight: 700, color: MUTED, letterSpacing: 2 }, `WHAT FUNDS BOUGHT · ${monthLong(f.month).toUpperCase()}`),
      text({ fontFamily: 'Newsreader', fontSize: 58, fontWeight: 600, color: UP, lineHeight: 1.05 }, croreText(shown)),
      text({ fontSize: 22, color: PAPER }, `net shares bought by ${f.totals.funds} funds (estimate)`),
    ]),
    el('div', { flexDirection: 'column', gap: 10 }, [text({ fontSize: 15, fontWeight: 700, color: MUTED, letterSpacing: 2 }, 'MOST BOUGHT'), ...barRows(f.buys.slice(0, 3), max, UP, progress, 624, 32)]),
    el('div', { flexDirection: 'column', gap: 10 }, [text({ fontSize: 15, fontWeight: 700, color: MUTED, letterSpacing: 2 }, 'MOST SOLD'), ...barRows(f.sells.slice(0, 3), max, DOWN, Math.max(0, progress - 0.2), 624, 32)]),
    el('div', { justifyContent: 'space-between' }, [
      text({ fontFamily: 'Newsreader', fontSize: 26, fontWeight: 600, color: PAPER }, 'FairFund'),
      text({ fontSize: 18, color: MUTED }, 'Estimates from monthly portfolio disclosures'),
    ]),
  ])
}

async function raster(node, width, height) {
  const svg = await satori(node, { width, height, fonts })
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render()
}

export async function writeGif(f, path, frames = 34) {
  const gif = GIFEncoder()
  let palette = null
  const ease = t => 1 - Math.pow(1 - t, 4)
  for (let i = 0; i < frames; i++) {
    const p = ease(Math.min(1, i / (frames - 10)))
    const img = await raster(gifFrame(f, p), 720, 720)
    const rgba = new Uint8Array(img.pixels.buffer, img.pixels.byteOffset, img.pixels.length)
    palette ??= quantize(rgba, 64)
    const index = applyPalette(rgba, palette)
    gif.writeFrame(index, 720, 720, { palette: i === 0 ? palette : undefined, delay: i === frames - 1 ? 4000 : 40 })
  }
  gif.finish()
  writeFileSync(path, gif.bytes())
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const src = join(ROOT, 'src/data/holdings_report.json')
  const facts = existsSync(src) ? leadFacts(JSON.parse(readFileSync(src, 'utf-8'))) : null
  if (!facts) {
    console.log('[gen-report-media] no holdings report data; skipped')
  } else if (!existsSync(DIST)) {
    console.error('[gen-report-media] dist/ not found - run vite build first'); process.exit(1)
  } else {
    const t0 = Date.now()
    mkdirSync(join(DIST, 'og'), { recursive: true })
    mkdirSync(join(DIST, 'media'), { recursive: true })
    writeFileSync(join(DIST, 'og/fund-buying.png'), (await raster(ogCard(facts), 1200, 630)).asPng())
    await writeGif(facts, join(DIST, 'media/fund-buying.gif'))
    console.log(`[gen-report-media] ${facts.month}: og/fund-buying.png + media/fund-buying.gif in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }
}
