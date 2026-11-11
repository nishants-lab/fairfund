const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const fundData = require('../src/data/funds.json')
const { funds } = fundData
const { routeFundIndex } = require('./fixtures/fund-index-route.cjs')
const { syntheticFund, syntheticMetric, ensureCategory } = require('./fixtures/browser-timebomb-fixtures.cjs')
const dated = f => !f.dataQuality && !f.isDebt && !f.isArbitrage && f.metrics?.['3Y']?.catRank && f.metrics['3Y'].windowStart && f.metrics['3Y'].windowEnd
const peerOf = f => funds.find(p => p.category === f.category && p.code !== f.code && dated(p))
// Live scenario: Parag Parikh when currently dated-ranked, else any dated-ranked fund with a
// ranked peer. The synthetic scenario always runs, so absence of live data cannot silently
// remove the dated-rank assertions.
const liveFund = [funds.find(f => f.code === 122639), ...funds].find(f => f && dated(f) && peerOf(f))
const synthMetric = syntheticMetric('3Y', '2023-01-02', '2026-01-02', { catRank: 3, catSize: 7, score: 0.61 })
const synthFunds = [
 syntheticFund(990011, 'Synthetic Review Fund', 'Synthetic Review', { metrics: { '3Y': synthMetric } }),
 syntheticFund(990012, 'Synthetic Review Peer', 'Synthetic Review', { metrics: { '3Y': { ...synthMetric, catRank: 4 } } }),
]
const synthData = { ...fundData, funds: [...funds, ...synthFunds], totalFunds: funds.length + synthFunds.length, categories: { ...fundData.categories } }
ensureCategory(synthData, 'Synthetic Review', 'Synthetic Review', 'Moderately High', { fundCount: 2 })
const scenarios = [
 ...(liveFund ? [{ label: 'live', fund: liveFund, peer: peerOf(liveFund), data: null }] : []),
 { label: 'synthetic', fund: synthFunds[0], peer: synthFunds[1], data: synthData },
]
const base = process.env.FF_TEST_BASE_URL
assert(base, 'FF_TEST_BASE_URL must identify the built or deployed site')
const origin = new URL(base).origin
const disclaimer = 'These simulated values use the fund’s historical returns and do not predict future performance. Actual results may be lower or higher than the values shown.'
;(async () => {
 const browser = await chromium.launch({headless:true})
 try {
  for (const { label, fund, peer, data } of scenarios) for (const width of [360,1280]) {
   const metric = fund.metrics['3Y']
   const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'})
   await context.route('**/*', route => {
    const request=route.request(),url=new URL(request.url())
    if(url.origin!==origin || request.method()!=='GET')return route.abort()
    return route.continue()
   })
   if(data)await routeFundIndex(context,data)
   {
    const dates=Array.from({length:181},(_,i)=>new Date(Date.UTC(new Date(fundData.anchor+'T00:00:00Z').getUTCFullYear(),new Date(fundData.anchor+'T00:00:00Z').getUTCMonth()-181+i,1)).toISOString().slice(0,10))
    await context.route('**/nav/*.json*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({d:dates,v:dates.map((_,i)=>100*1.005**i*(1+0.02*Math.sin(i)))})}))
   }
   const page=await context.newPage(),errors=[]
   page.on('pageerror',error=>errors.push(error.message))
   const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.goto(base.replace(/\/$/,'')+`/#/fund/${fund.code}`)
   const verdict=page.locator('#verdict')
   await verdict.getByText('Composite data score',{exact:true}).waitFor()
   const rank=verdict.locator('[data-ranking="current"]')
   assert.match(await rank.innerText(),new RegExp(`Rank #${metric.catRank} of ${metric.catSize}`))
   assert.ok((await rank.innerText()).includes(`${metric.windowStart} to ${metric.windowEnd}`))
   assert.equal(await page.getByText('No matched-period score available',{exact:true}).count(),0)
   assert.equal(await page.getByText('Monthly excess-return test',{exact:true}).count(),0)
   const simulation=page.locator('.card').filter({has:page.getByRole('heading',{name:/historical-return simulation/})})
   await simulation.waitFor()
   assert.ok((await simulation.innerText()).includes(disclaimer))
   assert.doesNotMatch(await simulation.innerText(),/Pessimistic|Optimistic|%ile|×/)
   await noOverflow()
   if(process.env.FF_SCREENSHOT_DIR){fs.mkdirSync(process.env.FF_SCREENSHOT_DIR,{recursive:true});await verdict.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.FF_SCREENSHOT_DIR,`${label}-rank-${width}.png`)});await simulation.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.FF_SCREENSHOT_DIR,`${label}-simulation-${width}.png`)})}
   await page.goto(base.replace(/\/$/,'')+`/#/explore?cat=${encodeURIComponent(fund.category)}`)
   const row=page.locator('tbody tr').filter({hasText:fund.name})
   await row.waitFor()
   assert.ok((await row.innerText()).includes(`Rank #${metric.catRank} of ${metric.catSize}`))
   assert.ok((await row.innerText()).includes(metric.windowEnd))
   await noOverflow()
   await page.goto(base.replace(/\/$/,'')+`/#/compare?codes=${fund.code},${peer.code}`)
   const rankRow=page.getByRole('row').filter({hasText:'Category Rank'})
   await rankRow.waitFor()
   const cells=rankRow.locator('[data-ranking="current"]')
   assert.equal(await cells.count(),2)
   assert.ok((await cells.first().innerText()).includes(`Rank #${metric.catRank} of ${metric.catSize}`))
   assert.ok((await cells.first().innerText()).includes(metric.windowEnd))
   await noOverflow()
   assert.deepEqual(errors,[])
   await context.close()
   console.log(`PASS ${label} ${width}px ${fund.code} rank restored with exact dates/count on fund, Explore, Compare; simplified simulation, no overflow/errors`)
  }
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
