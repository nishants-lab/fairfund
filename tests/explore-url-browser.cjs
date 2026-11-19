/** Explore follows its address: changing ?cat= while the page is open (a link to
 * another category, the footer link, an edited URL) must switch the category shown,
 * and choosing a category must still update the address. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://api.mfapi.in/**',r=>r.abort());
  await page.route('**/gc.zgo.at/**',r=>r.abort());
  await page.route('**/goatcounter.com/**',r=>r.abort());
  const active=()=>page.locator('[data-active="true"]').first().innerText();
  await page.goto(base+'/#/explore?cat='+encodeURIComponent('Flexi Cap'));
  await page.locator('[data-active="true"]').first().waitFor({timeout:60000});
  assert.match(await active(),/Flexi Cap/);
  await page.evaluate(()=>{location.hash='#/explore?cat=Liquid'});
  await page.waitForFunction(()=>/Liquid/.test(document.querySelector('[data-active="true"]')?.textContent||''),null,{timeout:15000});
  await page.evaluate(()=>{location.hash='#/explore?cat=Small%20Cap&h=5Y'});
  await page.waitForFunction(()=>/Small Cap/.test(document.querySelector('[data-active="true"]')?.textContent||''),null,{timeout:15000});
  assert.match(page.url(),/h=5Y/,page.url());
  await page.getByRole('button',{name:/^Mid Cap\b/}).first().click();
  await page.waitForFunction(()=>/cat=Mid(\+|%20)Cap/.test(location.hash),null,{timeout:15000});
  assert.match(await active(),/Mid Cap/);
  assert.deepEqual(errors,[]);
  await ctx.close();
  console.log('PASS explore follows its address');
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
