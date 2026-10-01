const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { funds } = require('../src/data/funds.json')
const fund = funds.find(f => f.code === 122639)
const metric = fund.metrics['3Y']
assert(metric?.catRank && metric.windowStart && metric.windowEnd, 'Parag Parikh needs a dated current rank')
const base = process.env.FF_TEST_BASE_URL
assert(base, 'FF_TEST_BASE_URL must identify the built or deployed site')
const origin = new URL(base).origin
const disclaimer = 'These simulated values use the fund’s historical returns and do not predict future performance. Actual results may be lower or higher than the values shown.'
;(async () => {
 const browser = await chromium.launch({headless:true})
 try {
  for (const width of [360,1280]) {
   const context = await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'})
   await context.route('**/*', route => {
    const request=route.request(),url=new URL(request.url())
    if(url.origin!==origin || request.method()!=='GET')return route.abort()
    return route.continue()
   })
   const page=await context.newPage(),errors=[]
   page.on('pageerror',error=>errors.push(error.message))
   const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.goto(base.replace(/\/$/,'')+'/#/fund/122639')
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
   if(process.env.FF_SCREENSHOT_DIR){fs.mkdirSync(process.env.FF_SCREENSHOT_DIR,{recursive:true});await verdict.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.FF_SCREENSHOT_DIR,`parag-rank-${width}.png`)});await simulation.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(process.env.FF_SCREENSHOT_DIR,`simulation-${width}.png`)})}
   await page.goto(base.replace(/\/$/,'')+'/#/explore?cat=Flexi%20Cap')
   const row=page.locator('tbody tr').filter({hasText:fund.name})
   await row.waitFor()
   assert.ok((await row.innerText()).includes(`Rank #${metric.catRank} of ${metric.catSize}`))
   assert.ok((await row.innerText()).includes(metric.windowEnd))
   await noOverflow()
   const peer=funds.find(f=>f.category===fund.category&&f.code!==fund.code&&f.metrics['3Y']?.catRank)
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
   console.log(`PASS ${width}px real Parag rank restored with exact dates/count on fund, Explore, Compare; simplified simulation, no overflow/errors`)
  }
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
