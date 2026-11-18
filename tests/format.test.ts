import assert from 'node:assert/strict'
import test from 'node:test'
import { fixed, num, pct, signedPct } from '../src/lib/format.ts'

test('a value that rounds to zero prints without a minus sign', () => {
  assert.equal(fixed(-0.04, 0), '0')
  assert.equal(fixed(-0.04, 1), '0.0')
  assert.equal(pct(-0.04), '0.0%')
  assert.equal(num(-0.001), '0.00')
  assert.equal(signedPct(-0.04), '0.0%')
  assert.equal(signedPct(0.04), '0.0%')
  assert.equal(signedPct(0), '0.0%')
})

test('other values keep their sign', () => {
  assert.equal(pct(-0.06), '-0.1%')
  assert.equal(signedPct(-0.06), '-0.1%')
  assert.equal(signedPct(1.25, 2), '+1.25%')
  assert.equal(fixed(-3.4, 0), '-3')
  assert.equal(pct(null), '\u2014')
})
