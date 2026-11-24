import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MONTHS, dayMonthYear, monthAbbr, monthYear } from '../src/lib/dates'
import { fmtDate, fmtMonth } from '../src/lib/metrics'
import { monthLabel } from '../src/lib/moversData'
import { fmtNavDate } from '../src/lib/navFreshness'

test('September reads Sep everywhere, matching the pre-built pages', () => {
  assert.equal(fmtDate('2026-09-30'), '30 Sep 2026')
  assert.equal(fmtMonth('2026-09-30'), 'Sep 2026')
  assert.equal(monthLabel('2026-09'), 'Sep 2026')
  assert.equal(fmtNavDate('2026-09-30'), '30 Sep 2026')
  assert.equal(monthYear(new Date(2026, 8, 1), true), 'Sep 26')
  assert.equal(monthAbbr(new Date(2026, 8, 1)), 'Sep')
})

test('every month uses the fixed short name and no day shifts', () => {
  for (let m = 0; m < 12; m++) {
    const iso = `2026-${String(m + 1).padStart(2, '0')}-01`
    assert.equal(fmtDate(iso), `1 ${MONTHS[m]} 2026`)
    assert.equal(dayMonthYear(new Date(2026, m, 28)), `28 ${MONTHS[m]} 2026`)
  }
  assert.equal(fmtDate('2026-12-31'), '31 Dec 2026')
  assert.equal(dayMonthYear(new Date('nope')), 'Invalid Date')
})

test('the app formats dates only through src/lib/dates.ts', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) { walk(path); continue }
      if (!/\.(ts|tsx)$/.test(name)) continue
      if (/toLocaleDateString|DateTimeFormat|month:\s*['"]short/.test(readFileSync(path, 'utf8'))) offenders.push(path)
    }
  }
  walk('src')
  assert.deepEqual(offenders, [], 'use dayMonthYear/monthYear/monthAbbr so September never prints as Sept')
})
