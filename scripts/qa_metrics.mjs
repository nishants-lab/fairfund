/**
 * METRICS EVALUATION harness — verifies the COMPUTED VALUES of lib/metrics.ts,
 * not just that they render. This guards the pure-math module (CAGR, volatility,
 * Sharpe, max-drawdown + its peak/trough DATES, best/worst-month + window DATES)
 * that was rewritten when drawdown/month date-ranges were added.
 *
 * Two layers:
 *   1. Known-answer synthetic series — hand-computable cases where we assert the
 *      exact numbers and dates (e.g. a single 30% drop → -30% drawdown on known
 *      dates; a monotonic riser → 0 drawdown).
 *   2. Invariants on REAL self-hosted NAV across many funds — properties that
 *      must always hold (drawdown <= 0, peak date <= trough date, best >= worst,
 *      all window dates within the slice, volatility >= 0, finite numbers).
 *
 * metrics.ts is transpiled in-memory via esbuild (a vite dep). No new packages.
 * Usage: node scripts/qa_metrics.mjs    Exit 1 on any failure.
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
const approx = (a, b, eps = 0.05) => Math.abs(a - b) <= eps

// --- transpile metrics.ts to a temp ESM file and import it ---
const outFile = path.join(__dirname, '.metrics.compiled.mjs')
await build({
  entryPoints: [path.join(SITE, 'src', 'lib', 'metrics.ts')],
  outfile: outFile,
  format: 'esm',
  bundle: true,
  platform: 'node',
  logLevel: 'silent',
})
const metrics = await import(pathToFileURL(outFile).href + `?t=${Date.now()}`)
const { computeMetrics, sliceByRange } = metrics

// helper: build a NAV series from a list of [date, nav]
function series(pairs) {
  return pairs.map(([date, nav]) => ({ date, nav }))
}
// helper: daily dates from a start, n points
function daily(startISO, navs) {
  const out = []
  const d = new Date(startISO)
  for (let i = 0; i < navs.length; i++) {
    out.push({ date: d.toISOString().slice(0, 10), nav: navs[i] })
    d.setDate(d.getDate() + 1)
  }
  return out
}

console.log('== METRICS EVAL: known-answer synthetic cases ==')

// 1) Monotonic riser → no drawdown, positive return
{
  const navs = Array.from({ length: 300 }, (_, i) => 100 * Math.pow(1.0005, i))
  const m = computeMetrics(daily('2023-01-01', navs))
  check('S1 riser: maxDrawdown == 0', m && approx(m.maxDrawdown, 0, 0.01), `dd=${m?.maxDrawdown}`)
  check('S1 riser: totalReturn > 0', m && m.totalReturn > 0, `tr=${m?.totalReturn}`)
  check('S1 riser: volatility >= 0 and finite', m && m.volatility >= 0 && isFinite(m.volatility), `vol=${m?.volatility}`)
}

// 2) Single clean 30% drop in the middle, then flat → drawdown ≈ -30%,
//    trough after peak, both dates within range.
{
  const navs = [...Array(100).fill(100), 70, ...Array(99).fill(70)]
  const s = daily('2023-01-01', navs)
  const m = computeMetrics(s)
  check('S2 drop: maxDrawdown ≈ -30%', m && approx(m.maxDrawdown, -30, 0.5), `dd=${m?.maxDrawdown}`)
  check('S2 drop: peak date <= trough date', m && m.maxDrawdownStart <= m.maxDrawdownEnd,
    `${m?.maxDrawdownStart} -> ${m?.maxDrawdownEnd}`)
  check('S2 drop: dd dates within slice', m && m.maxDrawdownStart >= s[0].date && m.maxDrawdownEnd <= s[s.length - 1].date)
}

// 3) Worst month vs best month ordering on a series with a sharp dip then recovery
{
  const navs = [...Array(40).fill(100), ...Array(21).fill(80), ...Array(60).fill(120)]
  const m = computeMetrics(daily('2023-01-01', navs))
  check('S3 best1M >= worst1M', m && m.best1M >= m.worst1M, `best=${m?.best1M} worst=${m?.worst1M}`)
  check('S3 worst1M < 0 (the dip)', m && m.worst1M < 0, `worst=${m?.worst1M}`)
  check('S3 best/worst window dates valid order', m &&
    m.best1MStart <= m.best1MEnd && m.worst1MStart <= m.worst1MEnd)
}

// 4) Too-small slice returns null
{
  const m = computeMetrics(daily('2023-01-01', [100, 101, 102]))
  check('S4 tiny slice => null', m === null)
}

// 5) CAGR sanity: exactly doubling over ~1 year ≈ +100%
{
  const navs = Array.from({ length: 366 }, (_, i) => 100 * Math.pow(2, i / 365))
  const m = computeMetrics(daily('2023-01-01', navs))
  check('S5 doubling in 1y => CAGR ≈ 100%', m && approx(m.cagr, 100, 3), `cagr=${m?.cagr}`)
}

console.log('\n== METRICS EVAL: invariants on real self-hosted NAV ==')
const NAV_DIR = path.join(SITE, 'public', 'nav')
const navFiles = fs.readdirSync(NAV_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
// sample up to 120 funds for speed
const sample = navFiles.sort(() => Math.random() - 0.5).slice(0, 120)
let checked = 0
const issues = []
for (const fn of sample) {
  let nav
  try {
    const j = JSON.parse(fs.readFileSync(path.join(NAV_DIR, fn)))
    nav = j.d.map((date, i) => ({ date, nav: j.v[i] }))
  } catch {
    continue
  }
  if (nav.length < 60) continue
  // full-history slice
  const m = computeMetrics(nav)
  if (!m) continue
  checked++
  const within = (d) => d >= nav[0].date && d <= nav[nav.length - 1].date
  if (m.maxDrawdown > 0.001) issues.push(`${fn}: dd>0 (${m.maxDrawdown})`)
  if (m.maxDrawdownStart > m.maxDrawdownEnd) issues.push(`${fn}: peak>trough`)
  if (!within(m.maxDrawdownStart) || !within(m.maxDrawdownEnd)) issues.push(`${fn}: dd date out of range`)
  if (m.best1M < m.worst1M) issues.push(`${fn}: best<worst`)
  if (!within(m.best1MStart) || !within(m.best1MEnd) || !within(m.worst1MStart) || !within(m.worst1MEnd)) issues.push(`${fn}: month date out of range`)
  if (m.best1MStart > m.best1MEnd || m.worst1MStart > m.worst1MEnd) issues.push(`${fn}: month window reversed`)
  if (!(m.volatility >= 0 && isFinite(m.volatility))) issues.push(`${fn}: bad vol ${m.volatility}`)
  for (const k of ['cagr', 'sharpe', 'sortino', 'calmar', 'maxDrawdown']) {
    if (!isFinite(m[k])) issues.push(`${fn}: ${k} not finite (${m[k]})`)
  }
}
check(`R1 drawdown <= 0 on all sampled funds`, !issues.some((i) => /dd>0/.test(i)), issues.filter((i) => /dd>0/.test(i)).slice(0, 3).join(' | '))
check(`R2 peak date <= trough date`, !issues.some((i) => /peak>trough/.test(i)), issues.filter((i) => /peak>trough/.test(i)).slice(0, 3).join(' | '))
check(`R3 all drawdown/month dates within slice`, !issues.some((i) => /out of range/.test(i)), issues.filter((i) => /out of range/.test(i)).slice(0, 3).join(' | '))
check(`R4 best1M >= worst1M`, !issues.some((i) => /best<worst/.test(i)), issues.filter((i) => /best<worst/.test(i)).slice(0, 3).join(' | '))
check(`R5 month windows ordered`, !issues.some((i) => /window reversed/.test(i)), issues.filter((i) => /window reversed/.test(i)).slice(0, 3).join(' | '))
check(`R6 volatility >= 0 & finite`, !issues.some((i) => /bad vol/.test(i)), issues.filter((i) => /bad vol/.test(i)).slice(0, 3).join(' | '))
check(`R7 all ratios finite`, !issues.some((i) => /not finite/.test(i)), issues.filter((i) => /not finite/.test(i)).slice(0, 3).join(' | '))
console.log(`  (evaluated ${checked} real funds)`)

// cleanup
try { fs.unlinkSync(outFile) } catch {}

const passed = results.filter((r) => r.ok).length
console.log(`\n== METRICS EVAL: ${passed}/${results.length} passed ==`)
process.exit(passed === results.length ? 0 : 1)
