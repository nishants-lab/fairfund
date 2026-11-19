import assert from 'node:assert/strict'
import test from 'node:test'
import { niceTicks } from '../src/lib/niceTicks.ts'

test('a padded return range gets round, evenly spaced ticks inside it', () => {
  const a = niceTicks(-6.2, 21.2)
  assert.deepEqual(a.ticks, [-5, 0, 5, 10, 15, 20])
  assert.deepEqual(a.domain, [-6.2, 21.2])
  assert.equal(a.decimals, 0)
  assert.deepEqual(niceTicks(12.4, 16.2).ticks, [13, 14, 15, 16])
})

test('ticks stay inside the range, step evenly and print distinctly', () => {
  for (const [lo, hi] of [[11.8, 19.4], [0.21, 0.93], [-27.5, -3.1], [3, 3], [9.63, 11.17], [0, 140], [-6.2, 21.2], [4.1, 18.9]]) {
    const a = niceTicks(lo, hi)
    assert.ok(a.ticks.every((t) => t >= a.domain[0] - 1e-9 && t <= a.domain[1] + 1e-9), `${lo}..${hi} -> ${a.ticks}`)
    assert.ok(a.ticks.length >= 2 && a.ticks.length <= 6, `${lo}..${hi} -> ${a.ticks}`)
    const steps = a.ticks.slice(1).map((t, i) => +(t - a.ticks[i]).toFixed(9))
    assert.ok(steps.every((s) => s === steps[0]), `${lo}..${hi} uneven ${a.ticks}`)
    const labels = a.ticks.map((t) => t.toFixed(a.decimals))
    assert.equal(new Set(labels).size, labels.length, `${lo}..${hi} labels collide ${labels}`)
    assert.ok(!labels.includes('-0') && !labels.includes('-0.0'), `${lo}..${hi} negative zero`)
  }
})

test('small ranges get decimals so labels stay distinct', () => {
  const a = niceTicks(0.21, 0.93)
  assert.deepEqual(a.ticks, [0.4, 0.6, 0.8])
  assert.equal(a.decimals, 1)
})
