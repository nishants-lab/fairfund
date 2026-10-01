/**
 * Regression tests for the NAV date upper bound (Indian market calendar date).
 *
 * Guards the bug class where a forward-dated liquid-fund NAV, or a malformed
 * date, enters the series or moves the headline "NAV as of" date. Exercises the
 * production helpers directly: src/lib/marketDate.ts and the nav.ts parsers.
 *
 * Run: node tests/run-date-guards.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dropFutureNavPoints,
  isFutureOrInvalidNavDate,
  isIsoDate,
  istToday,
} from '../src/lib/marketDate'
import { parseLive, parseSelfHosted } from '../src/lib/nav'

test('istToday uses the India calendar date, not the UTC one', () => {
  // 19:00 UTC on 30 Sep is already 00:30 on 1 Oct in India.
  assert.equal(istToday(new Date('2026-09-30T19:00:00Z')), '2026-10-01')
  // 18:29 UTC is 23:59 IST the same day: still 30 Sep.
  assert.equal(istToday(new Date('2026-09-30T18:29:59Z')), '2026-09-30')
  // Exactly 18:30 UTC flips the India date.
  assert.equal(istToday(new Date('2026-09-30T18:30:00Z')), '2026-10-01')
})

test('istToday is independent of the host timezone', () => {
  const instant = new Date('2026-09-30T19:00:00Z')
  const before = process.env.TZ
  try {
    process.env.TZ = 'America/Los_Angeles'
    assert.equal(istToday(instant), '2026-10-01')
    process.env.TZ = 'Pacific/Auckland'
    assert.equal(istToday(instant), '2026-10-01')
  } finally {
    if (before === undefined) delete process.env.TZ
    else process.env.TZ = before
  }
})

test('isIsoDate accepts only real YYYY-MM-DD calendar dates', () => {
  for (const ok of ['2026-10-01', '2024-02-29', '1999-12-31']) {
    assert.equal(isIsoDate(ok), true, ok)
  }
  for (const bad of [
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-10-32',
    '01-10-2026',
    '2026-1-01',
    '2026-10-01T00:00:00',
    '',
    'undefined-undefined-undefined',
    null,
    undefined,
    20261001,
  ]) {
    assert.equal(isIsoDate(bad), false, String(bad))
  }
})

test('isFutureOrInvalidNavDate rejects future and malformed, accepts today and past', () => {
  const today = '2026-10-01'
  assert.equal(isFutureOrInvalidNavDate('2026-10-01', today), false)
  assert.equal(isFutureOrInvalidNavDate('2026-09-30', today), false)
  assert.equal(isFutureOrInvalidNavDate('2026-10-02', today), true)
  assert.equal(isFutureOrInvalidNavDate('2027-01-01', today), true)
  assert.equal(isFutureOrInvalidNavDate('2026-02-30', today), true)
})

test('dropFutureNavPoints keeps valid past points and drops the rest', () => {
  const points = [
    { date: '2026-09-29', nav: 10 },
    { date: '2026-09-30', nav: 11 },
    { date: '2026-10-01', nav: 12 },
    { date: '2026-10-02', nav: 13 },
    { date: '2026-02-30', nav: 14 },
  ]
  assert.deepEqual(
    dropFutureNavPoints(points, '2026-10-01').map((p) => p.date),
    ['2026-09-29', '2026-09-30', '2026-10-01']
  )
})

test('parseLive converts DD-MM-YYYY, orders oldest first, drops future points', () => {
  const json = {
    meta: { scheme_name: 'Test Liquid Fund', fund_house: 'Test AMC' },
    data: [
      { date: '02-10-2026', nav: '103.0' }, // AMFI forward-dated liquid NAV
      { date: '01-10-2026', nav: '102.0' },
      { date: '30-09-2026', nav: '101.0' },
    ],
  }
  const points = parseLive(json, '2026-10-01')
  assert.deepEqual(points, [
    { date: '2026-09-30', nav: 101 },
    { date: '2026-10-01', nav: 102 },
  ])
})

test('parseLive drops non-positive, unparseable NAV and malformed dates', () => {
  const json = {
    meta: { scheme_name: 'x', fund_house: 'y' },
    data: [
      { date: '30-09-2026', nav: '0' },
      { date: '30-09-2026', nav: 'N.A.' },
      { date: 'not-a-date', nav: '10' },
      { date: '31-02-2026', nav: '10' },
      { date: '29-09-2026', nav: '99.5' },
    ],
  }
  assert.deepEqual(parseLive(json, '2026-10-01'), [{ date: '2026-09-29', nav: 99.5 }])
})

test('parseSelfHosted trims future-dated tail points', () => {
  const j = { d: ['2026-09-30', '2026-10-01', '2026-10-02'], v: [101, 102, 103] }
  assert.deepEqual(parseSelfHosted(j, '2026-10-01'), [
    { date: '2026-09-30', nav: 101 },
    { date: '2026-10-01', nav: 102 },
  ])
})

test('parseSelfHosted returns null for unusable payloads', () => {
  assert.equal(parseSelfHosted({ d: ['2026-10-02'], v: [1] }, '2026-10-01'), null)
  assert.equal(parseSelfHosted({ d: ['2026-09-30'], v: [] }, '2026-10-01'), null)
  assert.equal(parseSelfHosted({ d: [], v: [] }, '2026-10-01'), null)
})
