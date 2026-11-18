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

test('Movers crore and point figures that round to zero carry no sign', async () => {
  const { fmtCrore } = await import('../src/lib/moversRows.ts')
  assert.equal(fmtCrore(-0.04, true), '\u20b90.0 Cr')
  assert.equal(fmtCrore(0.04, true), '\u20b90.0 Cr')
  assert.equal(fmtCrore(-0.04), '\u20b90.0 Cr')
  assert.equal(fmtCrore(-12.6, true), '-\u20b913 Cr')
  assert.equal(fmtCrore(1250, true), '+\u20b91.3K Cr')
  assert.equal(fmtCrore(-250000), '-\u20b92.50L Cr')
})
