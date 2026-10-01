import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { outcomeCone, rollingReturnsDistribution } from '../src/lib/forward'
import type { NavPoint } from '../src/types'

function history(months: number, monthlyReturn = 0): NavPoint[] {
  const now = new Date()
  return Array.from({ length: months + 1 }, (_, i) => ({
    date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months + i - 1, 1)).toISOString().slice(0, 10),
    nav: 100 * (1 + monthlyReturn) ** i,
  }))
}

const source = readFileSync(resolve(process.cwd(), 'src/components/ForwardAnalytics.tsx'), 'utf8')
const disclaimer = 'These simulated values use the fund’s historical returns and do not predict future performance. Actual results may be lower or higher than the values shown.'

test('simulation copy shows values and keeps percentiles and sampling details in the tooltip', () => {
  const panel = source.slice(source.indexOf('            {cone && ('), source.indexOf('      {/* Fallback:'))
    .split('\n          </div>')[0]
  const tooltip = panel.match(/<InfoTip\b[^>]*>[\s\S]*?<\/InfoTip>/)?.[0] ?? ''
  const visible = panel.replace(tooltip, '')
  for (const label of ['Lower simulated value', 'Median simulated value', 'Higher simulated value']) {
    assert.ok(visible.includes(label), label)
  }
  assert.ok(visible.includes(disclaimer))
  assert.match(visible, /historical-return simulation/)
  assert.match(visible, /Monthly contribution:/)
  assert.match(visible, /Total invested:/)
  assert.doesNotMatch(visible, /Pessimistic|Optimistic|percentile|%ile|×|cone\.p(?:10|50|90)/)
  assert.match(tooltip, /six-month blocks/)
  assert.match(tooltip, /10th, 50th and 90th percentiles/)
  assert.match(tooltip, /not the probabilities of future results/)
  assert.match(tooltip, /fixed seed/)
  assert.match(visible, /grid-cols-1 gap-2 sm:grid-cols-3/)
})

test('historical loss count uses measured periods and retains a future-loss warning', () => {
  assert.doesNotMatch(source, /No window lost money/)
  assert.match(source, /Math.round\(rollDist.negPct \* rollDist.n \/ 100\)/)
  assert.match(source, /Future periods can lose money/)
  for (const change of [0, 0.01, -0.01]) {
    const dist = rollingReturnsDistribution(history(60, change), 3)!
    assert.equal(dist.n, 25)
    assert.equal(Math.round(dist.negPct * dist.n / 100), change < 0 ? 25 : 0)
  }
})

test('simulation requires 36 returns and is deterministic without mutating NAV history', () => {
  assert.equal(outcomeCone(history(35), 3), null)
  const nav = history(36, 0.005)
  const before = JSON.stringify(nav)
  const first = outcomeCone(nav, 3)!
  assert.deepEqual(outcomeCone(nav, 3), first)
  assert.equal(JSON.stringify(nav), before)
  assert.equal(first.sims, 10000)
  assert.equal(first.history, 36)
  assert.ok(first.endP10 <= first.endP50 && first.endP50 <= first.endP90)
})

test('unchanged simulation math uses selected principal and start-of-month SIP contributions', () => {
  for (const horizon of [1, 3, 5, 10]) {
    for (const amount of [5000, 100000, 300000]) {
      const flat = history(60)
      const lump = outcomeCone(flat, horizon, { mode: 'lumpsum', amount })!
      const sip = outcomeCone(flat, horizon, { mode: 'sip', amount })!
      assert.equal(lump.invested, amount)
      assert.equal(sip.invested, amount * horizon * 12)
      for (const result of [lump, sip]) {
        assert.equal(result.endP10, result.invested)
        assert.equal(result.endP50, result.invested)
        assert.equal(result.endP90, result.invested)
      }
    }
  }
  const rate = 0.01
  const amount = 5000
  const months = 36
  const sip = outcomeCone(history(60, rate), 3, { mode: 'sip', amount })!
  const expected = amount * (1 + rate) * ((1 + rate) ** months - 1) / rate
  assert.ok(Math.abs(sip.endP50 - expected) < 0.00001)
})
