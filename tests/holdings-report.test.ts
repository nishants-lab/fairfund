import test from 'node:test'
import assert from 'node:assert/strict'
import { checkGap, crore, croreShort, monthLabel, monthName, stockName } from '../src/lib/holdingsReport'
import type { MonthReport } from '../src/lib/holdingsReport'
import report from '../src/data/holdings_report.json'
import summary from '../src/data/holdings_summary.json'
import video from '../src/data/report_video.json'

test('report money and month formats', () => {
  assert.equal(crore(35680.2), '₹35,680 cr')
  assert.equal(crore(-2877.9), '−₹2,878 cr')
  assert.equal(crore(3781.7, true), '+₹3,782 cr')
  assert.equal(crore(-0.4, true), '₹0 cr')
  assert.equal(croreShort(35680), '₹35.7K cr')
  assert.equal(croreShort(950, true), '+₹950 cr')
  assert.equal(croreShort(-123456, true), '−₹1.23L cr')
  assert.equal(monthLabel('2026-10'), 'October 2026')
  assert.equal(monthLabel('2026-10', false), 'Oct 2026')
  assert.equal(monthLabel('bad'), 'bad')
  assert.equal(monthName('2026-01'), 'January')
})

test('the check gap compares the estimate with new money plus cash', () => {
  assert.equal(checkGap({ net: 0, inflow: 10, cashUsed: 0 }), null)
  assert.ok(Math.abs((checkGap({ net: 100, inflow: 80, cashUsed: 10 }) ?? 0) - 0.1) < 1e-9)
})

test('the shipped report is self-consistent', () => {
  const r = report as unknown as { lead: string; months: Record<string, MonthReport>; trend: { month: string; net: number }[] }
  const lead = r.months[r.lead]
  assert.ok(lead, 'lead month present')
  for (const [key, keys] of Object.entries(lead.lists)) {
    for (const k of keys as string[]) assert.ok(lead.stocks[k], `${key} lists a stock with a row: ${k}`)
  }
  for (const k of lead.lists.buys) assert.ok(lead.stocks[k].net > 0, 'buys are net positive')
  for (const k of lead.lists.sells) assert.ok(lead.stocks[k].net < 0, 'sells are net negative')
  assert.equal(stockName(lead, lead.lists.buys[0]).length > 0, true)
  assert.ok(r.trend.some(p => p.month === r.lead), 'trend includes the lead month')
  const s = summary as unknown as { lead: string; totals: { net: number } }
  assert.equal(s.lead, r.lead, 'home band summary matches the report lead')
  assert.equal(Math.round(s.totals.net), Math.round(lead.totals.net))
  // The page shows the video only on its own month, so an older video simply stops showing.
  assert.ok(video.month <= r.lead, 'the video is never for a month after the report')
  assert.match(video.video, /^media\/fund-buying-\d{4}-\d{2}\.mp4$/)
})
