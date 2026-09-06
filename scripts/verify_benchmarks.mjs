// Verify chart benchmark data integrity. Fails the build if a pinned index-fund
// proxy has no self-hosted NAV, is stale, or is too shallow, or if a category
// median series is missing/invalid. Run: node scripts/verify_benchmarks.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const bench = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/benchmarks.json'), 'utf8'))

const MIN_POINTS = 250          // >= ~1 trading year
const MAX_STALE_DAYS = 14       // latest NAV must be within 2 weeks
const errors = []
const ok = []

function daysAgo(iso) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
}

// 1) Benchmark-index proxies: self-hosted NAV present, deep, fresh.
const seen = new Set()
for (const [cat, b] of Object.entries(bench.categoryBenchmark)) {
  const f = path.join(ROOT, 'public/nav', `${b.code}.json`)
  if (!fs.existsSync(f)) { errors.push(`${cat}: proxy ${b.code} has no public/nav/${b.code}.json`); continue }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (!Array.isArray(j.d) || !Array.isArray(j.v) || j.d.length !== j.v.length) { errors.push(`${cat}: proxy ${b.code} nav malformed`); continue }
  if (j.d.length < MIN_POINTS) { errors.push(`${cat}: proxy ${b.code} too shallow (${j.d.length} pts)`); continue }
  const latest = j.d[j.d.length - 1]
  const stale = daysAgo(latest)
  if (stale > MAX_STALE_DAYS) { errors.push(`${cat}: proxy ${b.code} stale (latest ${latest}, ${stale}d ago)`); continue }
  if (j.v.some((x) => typeof x !== 'number' || !(x > 0))) { errors.push(`${cat}: proxy ${b.code} has non-positive NAV`); continue }
  if (!seen.has(b.code)) { ok.push(`proxy ${b.code} (${b.index}): ${j.d.length} pts, latest ${latest}`); seen.add(b.code) }
}

// 2) Category-median series: present, deep, positive, ends recent.
for (const [cat, key] of Object.entries(bench.medianCategories)) {
  const f = path.join(ROOT, 'public/category-median', `${key}.json`)
  if (!fs.existsSync(f)) { errors.push(`${cat}: median ${key}.json missing (run scripts/build_category_median.py)`); continue }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  if (!Array.isArray(j.d) || !Array.isArray(j.v) || j.d.length !== j.v.length) { errors.push(`${cat}: median ${key} malformed`); continue }
  if (j.d.length < MIN_POINTS) { errors.push(`${cat}: median ${key} too shallow (${j.d.length} pts)`); continue }
  if (j.v.some((x) => typeof x !== 'number' || !(x > 0))) { errors.push(`${cat}: median ${key} has non-positive value`); continue }
  const stale = daysAgo(j.d[j.d.length - 1])
  if (stale > MAX_STALE_DAYS) { errors.push(`${cat}: median ${key} stale (latest ${j.d[j.d.length - 1]}, ${stale}d ago)`); continue }
  ok.push(`median ${key} (${cat}): ${j.d.length} pts, ${j.n} funds, 100 -> ${j.v[j.v.length - 1].toFixed(1)}`)
}

for (const o of ok) console.log('  OK  ' + o)
if (errors.length) {
  console.error('\nBENCHMARK VERIFICATION FAILED:')
  for (const e of errors) console.error('  X  ' + e)
  process.exit(1)
}
console.log(`\nAll benchmark data verified (${ok.length} series).`)
