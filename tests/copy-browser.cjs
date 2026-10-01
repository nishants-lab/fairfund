/** UI disclosure regressions on both development and built bundles. Synthetic input only. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
const data=require('../src/data/funds.json');
const scored=data.funds.find(f=>!f.isDebt&&!f.isArbitrage&&!f.dataQuality&&Object.keys(f.metrics).length);
assert(scored,'An eligible equity fund is required for score disclosure verification');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [320,360,1280]) {
   const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640});
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://api.mfapi.in/**',r=>r.abort());
   const anchor=new Date(data.anchor+'T00:00:00Z');
   const dates=Array.from({length:181},(_,i)=>new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()-181+i,1)).toISOString().slice(0,10));
   await page.route('**/nav/*.json*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({d:dates,v:dates.map((_,i)=>100*1.005**i)})}));
   await page.goto(base+'/#/compare?codes=122639,149936');
   const btn=page.getByRole('button',{name:'About consistency',exact:true});
   await btn.waitFor();await btn.scrollIntoViewIfNeeded();
   if(width<640)await btn.tap();else await btn.focus();
   const tip=page.getByRole('tooltip');await tip.waitFor();
   assert.match(await tip.innerText(),/overlapping 3Y periods/);
   assert.equal(await btn.getAttribute('aria-describedby'),await tip.getAttribute('id'));
   assert.equal(await tip.evaluate(el=>{
    const r=el.getBoundingClientRect();
    return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&
     [[.1,.1],[.5,.5],[.9,.9]].every(([x,y])=>el.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)));
   }),true,'tooltip must be visible, not clipped by scroll containers');
   await page.keyboard.press('Escape');assert.equal(await tip.count(),0);
   await page.goto(base+'/#/fund/'+scored.code);
   const summary=page.locator('summary').filter({hasText:'How this score is calculated'});
   await summary.waitFor();const details=summary.locator('..');
   assert.equal(await details.getAttribute('open'),null);
   await summary.click();
   assert.match(await details.innerText(),/monthly excess-return test is excluded/);
   assert.match(await details.innerText(),/peer rank \(25%\)/);
   assert.match(await page.locator('main').innerText(),/This score is not an investment recommendation/);
   assert.equal(await page.getByText('Monthly excess-return test',{exact:true}).count(),0);
   const simulation=page.locator('.card').filter({has:page.getByRole('heading',{name:/historical-return simulation/})});
   await simulation.waitFor();
   const disclaimer='These simulated values use the fund’s historical returns and do not predict future performance. Actual results may be lower or higher than the values shown.';
   assert.match(await simulation.innerText(),/₹1,00,000 after 3 years: historical-return simulation/);
   assert.ok((await simulation.innerText()).includes(disclaimer));
   for(const label of ['Lower simulated value','Median simulated value','Higher simulated value']) {
    assert.equal(await simulation.getByText(label,{exact:true}).count(),1);
   }
   assert.doesNotMatch(await simulation.innerText(),/Pessimistic|Optimistic|percentile|%ile|×/);
   assert.match(await page.locator('main').innerText(),/0 of 145 measured 3-year periods lost money/);
   assert.match(await page.locator('main').innerText(),/Future periods can lose money/);
   const simulationTip=simulation.getByRole('button',{name:'About the historical-return simulation',exact:true});
   await simulationTip.scrollIntoViewIfNeeded();
   if(width<640)await simulationTip.tap();else await simulationTip.focus();
   await tip.waitFor();
   assert.match(await tip.innerText(),/six-month blocks/);
   assert.match(await tip.innerText(),/10th, 50th and 90th percentiles/);
   assert.match(await tip.innerText(),/not the probabilities of future results/);
   assert.equal(await tip.evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight}),true);
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'Monthly SIP',exact:true}).click();
   for(const [input,used] of [['5000',5000],['300000',300000],['1',5000],['999999',300000]]) {
    await page.getByLabel('Monthly contribution (₹):',{exact:true}).fill(input);
    await page.getByLabel('Monthly contribution (₹):',{exact:true}).blur();
    await page.waitForFunction(({used})=>document.querySelector('#sip-amt')?.value===String(used),{used});
    const rupees=n=>'₹'+n.toLocaleString('en-IN');
    assert.ok((await simulation.innerText()).includes(`${rupees(used)} monthly SIP after 3 years`));
    assert.ok((await simulation.innerText()).includes(`Monthly contribution: ${rupees(used)}. Total invested: ${rupees(used*36)}`));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`fund mobile overflow at ${width}, contribution ${used}`);
   }
   const outcomes=page.getByRole('heading',{name:'Historical returns and simulated outcomes',exact:true}).locator('..');
   for(const years of [1,5,10]) {
    await outcomes.getByRole('button',{name:years+' year'+(years===1?'':'s'),exact:true}).click();
    assert.ok((await simulation.innerText()).includes(`after ${years} year${years===1?'':'s'}: historical-return simulation`));
    assert.ok((await simulation.innerText()).includes('Total invested: ₹'+(300000*years*12).toLocaleString('en-IN')));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`fund overflow at ${width}, horizon ${years}`);
   }
   await page.getByRole('button',{name:'One-time',exact:true}).click();
   assert.match(await simulation.innerText(),/₹1,00,000 after 10 years/);
   assert.doesNotMatch(await simulation.innerText(),/Monthly contribution:|Total invested:/);
   await page.goto(base+'/#/signin');
   await page.getByRole('heading',{name:'Sign-in is unavailable',exact:true}).waitFor();
   assert.doesNotMatch(await page.locator('main').innerText(),/Coming Soon|Never lose|Personalized alerts|What you.ll get/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(errors,[]);
   console.log(`PASS ${width}: touch/keyboard tooltip unclipped, score explanation collapsed, warnings retained, simulation amounts/horizons/SIP bounds and overflow checked, honest account copy`);
   await ctx.close();
  }
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
