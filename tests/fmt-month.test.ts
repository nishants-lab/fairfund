import assert from 'node:assert/strict'
import test from 'node:test'
import { fmtDate, fmtMonth } from '../src/lib/metrics.ts'

test('a date or month label never slips to the previous month west of UTC', () => {
  const before = process.env.TZ
  try {
    for (const tz of ['America/Los_Angeles', 'Asia/Kolkata', 'UTC']) {
      process.env.TZ = tz
      assert.equal(fmtMonth('2024-07'), 'Jul 2024', tz)
      assert.equal(fmtMonth('2024-07-01'), 'Jul 2024', tz)
      assert.equal(fmtMonth('2026-01-31'), 'Jan 2026', tz)
      assert.equal(fmtDate('2026-11-01'), '1 Nov 2026', tz)
      assert.equal(fmtDate('2026-11-18'), '18 Nov 2026', tz)
    }
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
})
