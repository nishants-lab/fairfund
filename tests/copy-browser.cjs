/** UI disclosure regressions on both development and built bundles. Synthetic input only. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [360,1280]) {
   const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width===360,hasTouch:width===360});
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://api.mfapi.in/**',r=>r.abort());
   await page.goto(base+'/#/compare?codes=122639,149936');
   const btn=page.getByRole('button',{name:'About consistency',exact:true});
   await btn.waitFor();await btn.scrollIntoViewIfNeeded();
   if(width===360)await btn.tap();else await btn.focus();
   const tip=page.getByRole('tooltip');await tip.waitFor();
   assert.match(await tip.innerText(),/overlapping 3Y periods/);
   assert.equal(await btn.getAttribute('aria-describedby'),await tip.getAttribute('id'));
   assert.equal(await tip.evaluate(el=>{
    const r=el.getBoundingClientRect();
    return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&
     [[.1,.1],[.5,.5],[.9,.9]].every(([x,y])=>el.contains(document.elementFromPoint(r.x+r.width*x,r.y+r.height*y)));
   }),true,'tooltip must be visible, not clipped by scroll containers');
   await page.keyboard.press('Escape');assert.equal(await tip.count(),0);
   await page.goto(base+'/#/fund/122639');
   const summary=page.locator('summary').filter({hasText:'How this score is calculated'});
   await summary.waitFor();const details=summary.locator('..');
   assert.equal(await details.getAttribute('open'),null);
   await summary.click();
   assert.match(await details.innerText(),/12% score input/);
   assert.match(await details.innerText(),/not a probability of skill/);
   assert.match(await page.locator('main').innerText(),/This score is not an investment recommendation/);
   await page.goto(base+'/#/signin');
   await page.getByRole('heading',{name:'Sign-in is unavailable',exact:true}).waitFor();
   assert.doesNotMatch(await page.locator('main').innerText(),/Coming Soon|Never lose|Personalized alerts|What you.ll get/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(errors,[]);
   console.log(`PASS ${width}: touch/keyboard tooltip unclipped, score explanation collapsed, warnings retained, honest account copy`);
   await ctx.close();
  }
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
