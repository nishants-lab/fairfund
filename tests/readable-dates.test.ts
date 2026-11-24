import test from 'node:test'
import assert from 'node:assert/strict'
import { aumNote } from '../src/components/FundMeta'
import { blockDate } from '../src/components/PortfolioImportReview'
import { funds } from '../src/lib/data'
import { fmtDate } from '../src/lib/metrics'

const iso = /\d{4}-\d{2}-\d{2}/

test('AUM help text reads dates as 31 Oct 2026, never the raw ISO date', () => {
  assert.equal(fmtDate('2026-10-31'), '31 Oct 2026')
  const note = aumNote({ current: 1234, asOf: '2026-10-31', previous: 1200, prevDate: '2026-09-30', changePct: 2.8 })
  assert.equal(note, `Total fund size as of 31 Oct 2026. Was ₹1.2K Cr on ${fmtDate('2026-09-30')}. Very large AUM can limit agility in small/mid-cap strategies.`)
})

test('AUM help text never prints null when the earlier date is missing', () => {
  const note = aumNote({ current: 1234, asOf: '2026-09-30', previous: 1200 })
  assert.equal(note, `Total fund size as of ${fmtDate('2026-09-30')}. Very large AUM can limit agility in small/mid-cap strategies.`)
  assert.match(aumNote({ current: 1234, asOf: null }), /disclosure date not published/)
})

test('every indexed fund gets AUM help text without raw dates or null', () => {
  let checked = 0
  for (const fund of funds) {
    if (!fund.aum) continue
    const note = aumNote(fund.aum)
    assert.doesNotMatch(note, iso, `${fund.code}: ${note}`)
    assert.doesNotMatch(note, /null|undefined|NaN/, `${fund.code}: ${note}`)
    checked++
  }
  assert.ok(checked > 0, 'index needs funds with AUM')
})

test('portfolio import review shows statement valuation dates as 20 Nov 2026', () => {
  assert.equal(blockDate('2026-11-20'), fmtDate('2026-11-20'))
  assert.doesNotMatch(blockDate('2026-11-20'), iso)
  assert.equal(blockDate(''), 'Unknown')
  assert.equal(blockDate(null), 'Unknown')
  assert.equal(blockDate(undefined), 'Unknown')
})
