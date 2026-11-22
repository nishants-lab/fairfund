/** After a deploy replaces the code files, a tab opened earlier must still open its next page:
 * one reload picks up the new build. If the file stays missing, the page says so instead of going blank. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
// The Movers page's code: /src/pages/Movers.tsx on the dev server, /assets/Movers-<hash>.js when built.
const MOVERS=/\/(src\/pages\/Movers\.tsx|assets\/Movers-[\w-]+\.js)(\?|$)/;
async function open(browser,failures){
 const ctx=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://api.mfapi.in/**',r=>r.abort());
 await page.route('**/gc.zgo.at/**',r=>r.abort());
 await page.route('**/goatcounter.com/**',r=>r.abort());
 let left=failures;
 await page.route(MOVERS,r=>{if(left>0){left--;return r.fulfill({status:404,body:'gone'})}return r.continue()});
 await page.goto(base+'/#/');
 await page.getByRole('heading',{level:1}).first().waitFor();
 return {ctx,page,errors};
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  // The file is gone once (a deploy happened): one reload, then Movers opens.
  {
   const {ctx,page}=await open(browser,1);
   const loads=[];page.on('load',()=>loads.push(Date.now()));
   await page.evaluate(()=>{location.hash='#/movers'});
   await page.getByRole('heading',{name:'Movers',level:1}).waitFor({timeout:90000});
   // The reloaded page can render Movers a moment before its load event fires; count after it.
   for(const end=Date.now()+15000;loads.length<1&&Date.now()<end;)await page.waitForTimeout(100);
   await page.waitForTimeout(1000); // a second reload would land here
   assert.equal(loads.length,1,'exactly one reload, got '+loads.length);
   assert.equal(await page.getByTestId('page-error').count(),0);
   await ctx.close();
  }
  // The file stays missing: no reload loop, and the page says it did not load instead of going blank.
  {
   const {ctx,page}=await open(browser,99);
   const loads=[];page.on('load',()=>loads.push(Date.now()));
   await page.evaluate(()=>{location.hash='#/movers'});
   await page.getByTestId('page-error').waitFor({timeout:90000});
   assert.match(await page.getByTestId('page-error').innerText(),/This page did not load/);
   for(const end=Date.now()+15000;loads.length<1&&Date.now()<end;)await page.waitForTimeout(100);
   await page.waitForTimeout(1000); // a loop would add reloads here
   assert.equal(loads.length,1,'one reload, then the error, never a loop, got '+loads.length);
   assert.ok(await page.getByRole('banner').isVisible()&&await page.getByRole('contentinfo').count()>0,'header and footer stay');
   // Moving to another page clears the error.
   await page.evaluate(()=>{location.hash='#/methodology'});
   await page.waitForFunction(()=>!document.querySelector('[data-testid="page-error"]'),null,{timeout:90000});
   await ctx.close();
  }
  console.log('PASS stale chunk recovery');
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
