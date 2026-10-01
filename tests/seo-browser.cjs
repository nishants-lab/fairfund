/** Stable public report pages from a production build. No remote writes. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=(process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190').replace(/\/$/,'');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [320,1280]) for(const js of [false,true]) {
   const ctx=await browser.newContext({viewport:{width,height:900},javaScriptEnabled:js,serviceWorkers:'block'});
   await ctx.route('https://api.mfapi.in/**',r=>r.abort());await ctx.route('**/gc.zgo.at/**',r=>r.abort());
   for(const [route,app] of [['f/122639/','/fund/122639'],['c/flexi-cap/','/category/flexi-cap'],['s/explore/','/explore']]) {
    const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(js)await page.clock.install();
    const url=base+'/'+route;
    const response=await page.goto(url,{waitUntil:'load'});assert.equal(response.status(),200);
    if(js)await page.clock.fastForward(10000);
    assert.equal(page.url(),url,'report must not automatically leave its public URL');
    assert.equal(await page.locator('main h1').count(),1);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'),'https://nishants-lab.github.io/fairfund/'+route);
    assert.equal(await page.locator('script:not([type="application/ld+json"])').count(),0);
    assert.equal(await page.locator('meta[http-equiv=refresh]').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,route+' page overflow');
    assert.equal(await page.locator('main time').count(),1);
    if(route.startsWith('c/'))assert(await page.locator('main a[href*="/f/"]').count()>0);
    if(!route.startsWith('c/')) {
     assert.equal(await page.locator('.metrics-scroll[tabindex="0"]').count(),1);
     assert.equal(await page.locator('.metrics-scroll td').first().evaluate(e=>getComputedStyle(e).whiteSpace),'nowrap');
    }
    if(process.env.FF_SCREENSHOT_DIR&&js){fs.mkdirSync(process.env.FF_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FF_SCREENSHOT_DIR,route.replaceAll('/','-')+width+'.png'),fullPage:true});}
    const link=page.locator('main a[href*="#/"]').last();
    assert((await link.getAttribute('href')).includes('#'+app));
    if(js) {await page.clock.resume();await link.click();await page.waitForURL(u=>u.hash.startsWith('#'+app));await page.locator('main h1').waitFor();}
    assert.deepEqual(errors,[]);await page.close();
   }
   console.log(`PASS SEO ${width}px JS=${js}: stable URLs, canonical/content retained, no automatic redirect, mobile layout and explicit app links`);
   await ctx.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
