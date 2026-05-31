/**
 * SPECTRUM EVALUATION harness — verifies the COMPUTED LAYOUT of lib/spectrum.ts,
 * not just that a bar renders. This guards the class of bug a human caught by eye:
 * a fund that IS the category best whose marker floated mid-bar under a "highest"
 * label (the scale was secretly pivot-centred while the end labels claimed the
 * category range). The bar must never lie about where a value sits.
 *
 * Two layers:
 *   1. Known-answer cases — hand-computable positions/tones we assert exactly
 *      (fund == category best ⇒ primary marker at the far right; a value below
 *      every peer ⇒ far left; pivot drawn only when it falls in range; etc.).
 *   2. Invariants on REAL category distributions built from funds.json — for
 *      hundreds of funds across every category and metric, properties that must
 *      ALWAYS hold (all marker positions in [0,1]; the higher/lower value sits
 *      further right/left; tone matches the absolute read; gloss is non-empty).
 *
 * spectrum.ts is transpiled in-memory via esbuild (a vite dep). No new packages.
 * Usage: node scripts/qa_spectrum.mjs    Exit 1 on any failure.
 */
import { build } from 'esbuild'
import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SITE = path.join(__dirname, '..')
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${!ok && detail ? ' — ' + detail : ''}`)
}
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps
const inRange01 = (x) => typeof x === 'number' && isFinite(x) && x >= -1e-9 && x <= 1 + 1e-9

// --- transpile spectrum.ts to a temp ESM file and import it ---
const outFile = path.join(__dirname, '.spectrum.compiled.mjs')
await build({
  entryPoints: [path.join(SITE, 'src', 'lib', 'spectrum.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'silent',
})
const S = await import(pathToFileURL(outFile).href + `?t=${Date.now()}`)
const { ratioSpectrum, lowerBetterSpectrum, bandSpectrum, linPos } = S

const primaryOf = (m) => m.markers.find((x) => x.kind === 'primary')
const medianOf = (m) => m.markers.find((x) => x.kind === 'median')

console.log('== SPECTRUM EVAL: known-answer cases ==')

// ---- ratioSpectrum (higher better; domain = real peer range) ----
{
  // Fund IS the category best → primary marker must sit at the FAR RIGHT (1.0),
  // NOT floating mid-bar. This is the exact bug we are guarding against.
  const m = ratioSpectrum({ value: 0.87, min: 0.2, max: 0.87, cat: { median: 0.53, best: 0.87 } })
  const p = primaryOf(m)
  check('R-best: fund==category best ⇒ primary at far right (pos≈1)', approx(p.pos, 1, 1e-6), `pos=${p?.pos}`)
  check('R-best: NO pivot tick when no peer reaches 1.0', m.pivotPos == null, `pivotPos=${m.pivotPos}`)
  check('R-best: gloss says "Best in its category"', /best in its category/i.test(m.gloss || ''), m.gloss)
  check('R-best: primary tone warn (0.87 < 1.0 pivot, but >0)', m.primaryTone === 'warn', m.primaryTone)
}
{
  // Fund is the WEAKEST peer → far left.
  const m = ratioSpectrum({ value: 0.2, min: 0.2, max: 0.87, cat: { median: 0.53, best: 0.87 } })
  check('R-worst: weakest peer ⇒ primary at far left (pos≈0)', approx(primaryOf(m).pos, 0, 1e-6), `pos=${primaryOf(m).pos}`)
  check('R-worst: gloss says "Lowest in its category"', /lowest in its category/i.test(m.gloss || ''))
}
{
  // Pivot (1.0) within the real range → reference tick IS drawn at its true pos.
  const m = ratioSpectrum({ value: 1.4, min: 0.5, max: 2.0, cat: { median: 1.0, best: 2.0 } })
  check('R-pivot-in: pivot tick drawn when 1.0 in range', m.pivotPos != null && approx(m.pivotPos, linPos(1, 0.5, 2.0)), `pivotPos=${m.pivotPos}`)
  check('R-pivot-in: positive≥1 ⇒ tone good', m.primaryTone === 'good', m.primaryTone)
}
{
  // Negative ratio ⇒ tone bad regardless of peer position.
  const m = ratioSpectrum({ value: -0.3, min: -0.3, max: 1.5, cat: { median: 0.6, best: 1.5 } })
  check('R-neg: negative ratio ⇒ tone bad', m.primaryTone === 'bad', m.primaryTone)
}
{
  // Outlier fund ABOVE the peer max → domain widens to include it; it sits at 1.0,
  // median stays strictly left of it. (No marker escapes the bar.)
  const m = ratioSpectrum({ value: 3.0, min: 0.4, max: 1.2, cat: { median: 0.7, best: 1.2 } })
  check('R-outlier: fund above peer max still pos≈1 (domain widened)', approx(primaryOf(m).pos, 1, 1e-6), `pos=${primaryOf(m).pos}`)
  check('R-outlier: median strictly left of fund', medianOf(m).pos < primaryOf(m).pos)
}

// ---- lowerBetterSpectrum (volatility; lower better; green at low end) ----
{
  // Steadiest peer (lowest vol) ⇒ far LEFT, tone good (below median).
  const m = lowerBetterSpectrum({ value: 10, min: 10, max: 22, cat: { median: 16, best: 10 } })
  check('V-steadiest: lowest vol ⇒ primary far left (pos≈0)', approx(primaryOf(m).pos, 0, 1e-6), `pos=${primaryOf(m).pos}`)
  check('V-steadiest: below median ⇒ tone good', m.primaryTone === 'good', m.primaryTone)
}
{
  // Swingiest peer (highest vol) ⇒ far RIGHT, tone bad (above median).
  const m = lowerBetterSpectrum({ value: 22, min: 10, max: 22, cat: { median: 16, best: 10 } })
  check('V-swingiest: highest vol ⇒ primary far right (pos≈1)', approx(primaryOf(m).pos, 1, 1e-6), `pos=${primaryOf(m).pos}`)
  check('V-swingiest: above median ⇒ tone bad (red)', m.primaryTone === 'bad', m.primaryTone)
  check('V: gloss/glossTone agree with primaryTone', m.glossTone === m.primaryTone)
}

// ---- bandSpectrum (0..100; fixed thresholds) ----
{
  const m = bandSpectrum({ value: 95, lowMid: 70, midHigh: 90, leftLabel: 'L', rightLabel: 'R' })
  check('B-high: value 95 ⇒ pos 0.95', approx(primaryOf(m).pos, 0.95), `pos=${primaryOf(m).pos}`)
  check('B-high: ≥midHigh ⇒ tone good', m.primaryTone === 'good', m.primaryTone)
  const m2 = bandSpectrum({ value: 40, lowMid: 70, midHigh: 90, leftLabel: 'L', rightLabel: 'R' })
  check('B-low: <lowMid ⇒ tone bad', m2.primaryTone === 'bad', m2.primaryTone)
  check('B: green band only as wide as (100-midHigh)', (() => {
    const greenStart = m.stops.find((s) => s.color === S.SPECTRUM_GREEN)?.pos
    return approx(greenStart, 0.9)
  })(), 'green should start at 0.90')
}

console.log('\n== SPECTRUM EVAL: invariants on real category distributions ==')
const funds = JSON.parse(fs.readFileSync(path.join(SITE, 'src', 'data', 'funds.json'))).funds

// Rebuild category metric distributions the same way lib/data.ts does.
function catStats(category, metric, higherBetter) {
  const vals = funds
    .filter((f) => f.category === category)
    .map((f) => f.metrics?.['3Y']?.[metric])
    .filter((v) => typeof v === 'number' && isFinite(v))
    .sort((a, b) => a - b)
  if (vals.length < 3) return null
  const mid = Math.floor(vals.length / 2)
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
  return { min: vals[0], max: vals[vals.length - 1], median, best: higherBetter ? vals[vals.length - 1] : vals[0] }
}

const categories = [...new Set(funds.map((f) => f.category))]
const issues = { pos: [], order: [], tone: [], gloss: [], pivot: [], medorder: [] }
let evaluated = 0

for (const cat of categories) {
  for (const [metric, higher] of [['sharpe', true], ['sortino', true], ['calmar', true], ['volatility', false]]) {
    const stat = catStats(cat, metric, higher)
    if (!stat) continue
    const sample = funds.filter((f) => f.category === cat && typeof f.metrics?.['3Y']?.[metric] === 'number')
    for (const f of sample) {
      const v = f.metrics['3Y'][metric]
      const model = higher
        ? ratioSpectrum({ value: v, min: stat.min, max: stat.max, pivot: 1, cat: { median: stat.median, best: stat.best } })
        : lowerBetterSpectrum({ value: v, min: stat.min, max: stat.max, cat: { median: stat.median, best: stat.best } })
      evaluated++
      const p = primaryOf(model)
      const med = medianOf(model)
      // (1) every marker position in [0,1]
      for (const mk of model.markers) if (!inRange01(mk.pos)) issues.pos.push(`${f.code}/${metric}:${mk.kind}=${mk.pos}`)
      if (model.pivotPos != null && !inRange01(model.pivotPos)) issues.pos.push(`${f.code}/${metric}:pivot=${model.pivotPos}`)
      // (2) the fund that equals the category extreme sits at the matching edge
      if (higher) {
        if (approx(v, stat.max, 1e-9) && !approx(p.pos, 1, 1e-6)) issues.order.push(`${f.code}/${metric}: max but pos=${p.pos}`)
        if (approx(v, stat.min, 1e-9) && !(p.pos <= 1e-6)) issues.order.push(`${f.code}/${metric}: min but pos=${p.pos}`)
      } else {
        if (approx(v, stat.min, 1e-9) && !(p.pos <= 1e-6)) issues.order.push(`${f.code}/${metric}: minvol but pos=${p.pos}`)
        if (approx(v, stat.max, 1e-9) && !approx(p.pos, 1, 1e-6)) issues.order.push(`${f.code}/${metric}: maxvol but pos=${p.pos}`)
      }
      // (3) monotonicity vs the median marker: a better value is positioned on the
      //     correct side of the median tick (higher-better ⇒ value>median ⇒ right).
      if (med) {
        if (higher) {
          if (v > stat.median + 1e-9 && !(p.pos >= med.pos - 1e-9)) issues.medorder.push(`${f.code}/${metric}: >median but left`)
          if (v < stat.median - 1e-9 && !(p.pos <= med.pos + 1e-9)) issues.medorder.push(`${f.code}/${metric}: <median but right`)
        } else {
          if (v < stat.median - 1e-9 && !(p.pos <= med.pos + 1e-9)) issues.medorder.push(`${f.code}/${metric}: lower-vol but right`)
          if (v > stat.median + 1e-9 && !(p.pos >= med.pos - 1e-9)) issues.medorder.push(`${f.code}/${metric}: higher-vol but left`)
        }
      }
      // (4) tone is sane: ratios negative ⇒ bad; vol below median ⇒ good, above ⇒ bad
      if (higher) {
        if (v < 0 && model.primaryTone !== 'bad') issues.tone.push(`${f.code}/${metric}: neg not bad`)
        if (v >= 1 && v >= 0 && model.primaryTone !== 'good') issues.tone.push(`${f.code}/${metric}: ≥1 not good (${model.primaryTone})`)
      } else {
        if (v < stat.median - 1e-9 && model.primaryTone !== 'good') issues.tone.push(`${f.code}/${metric}: belowmed not good`)
        if (v > stat.median + 1e-9 && model.primaryTone !== 'bad') issues.tone.push(`${f.code}/${metric}: abovemed not bad`)
      }
      // (5) pivot only drawn when 1.0 is within the (possibly widened) domain
      if (higher) {
        const lo = Math.min(stat.min, v), hi = Math.max(stat.max, v)
        const shouldDraw = 1 >= lo && 1 <= hi
        if (shouldDraw !== (model.pivotPos != null)) issues.pivot.push(`${f.code}/${metric}: pivot draw mismatch (in=${shouldDraw})`)
      }
      // (6) gloss present and non-empty (self-explanatory bar)
      if (!model.gloss || !model.gloss.trim()) issues.gloss.push(`${f.code}/${metric}: empty gloss`)
    }
  }
}

check('I1 all marker + pivot positions in [0,1]', issues.pos.length === 0, issues.pos.slice(0, 4).join(' | '))
check('I2 category extreme sits at the matching bar edge', issues.order.length === 0, issues.order.slice(0, 4).join(' | '))
check('I3 fund positioned on correct side of median tick', issues.medorder.length === 0, issues.medorder.slice(0, 4).join(' | '))
check('I4 primary tone matches absolute read', issues.tone.length === 0, issues.tone.slice(0, 4).join(' | '))
check('I5 pivot tick drawn iff 1.0 in range', issues.pivot.length === 0, issues.pivot.slice(0, 4).join(' | '))
check('I6 every spectrum has a non-empty gloss', issues.gloss.length === 0, issues.gloss.slice(0, 4).join(' | '))
console.log(`  (evaluated ${evaluated} fund×metric spectrums across ${categories.length} categories)`)

try { fs.unlinkSync(outFile) } catch {}

const passed = results.filter((r) => r.ok).length
console.log(`\n== SPECTRUM EVAL: ${passed}/${results.length} passed ==`)
process.exit(passed === results.length ? 0 : 1)
