/** New fund offers page on development and built bundles, at phone and desktop widths. Real committed nfo.json. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
const nfo=require('../src/data/nfo.json');
// Same rule as src/lib/nfo.ts: closed or trading NFOs leave 7 days after closing (else after the first NAV).
const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const statusOf=n=>n.nav?'trading':n.launchDate>today?'upcoming':n.closeDate&&n.closeDate<today?'closed':'offer';
const listed=nfo.nfos.filter(n=>{const s=statusOf(n);const a=n.closeDate||n.firstNavDate;return !(s==='closed'||s==='trading')||!a||today<=addDays(a,nfo.showDaysAfterClose??7)});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [320,390,768,1280]) {
   const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block'});
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://api.mfapi.in/**',r=>r.abort());
   await page.route('**/gc.zgo.at/**',r=>r.abort());
   await page.route('**/goatcounter.com/**',r=>r.abort());
   await page.goto(base+'/#/nfo');
   await page.getByRole('heading',{name:'New fund offers',level:1}).waitFor();
   const main=await page.locator('main').innerText();
   assert.match(main,/not a recommendation to invest/);
   assert.match(main,/A low NAV is not cheaper than a high one/);
   const cards=page.getByTestId('nfo-card');
   assert.equal(await cards.count(),listed.length,'one card per NFO');
   if(listed.length){
    // Every card fits the viewport: no horizontal overflow on phones.
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`horizontal overflow at ${width}px`);
    // Benchmark, manager and exit load are readable in full unless very long (those clamp to 3 lines with a tooltip).
    const cut=await page.locator('[data-testid="nfo-card"] dd').evaluateAll(els=>els.filter(e=>e.textContent.length<=120&&(e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1)).map(e=>e.textContent));
    assert.deepEqual(cut,[],`facts cut off at ${width}px`);
    // Same-index fund names are never cut off.
    const names=await page.locator('[data-testid="nfo-same-index"] a').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent));
    assert.deepEqual(names,[],`fund names cut off at ${width}px`);
    // An index NFO with a known benchmark lists the funds already tracking it, and each link opens a fund page.
    const same=page.getByTestId('nfo-same-index').first();
    if(await same.count()){
     const link=same.getByRole('link').first();const href=await link.getAttribute('href');
     assert.match(href,/#\/fund\/\d+\//);
     await link.click();await page.waitForURL(/#\/fund\/\d+\//);
     await page.goBack();await page.getByRole('heading',{name:'New fund offers',level:1}).waitFor();
    }
    // Offers show their closing date; closed and trading ones say until when they are listed,
    // and trading ones since when units can be bought.
    for(const n of listed){
     const card=page.locator(`[data-testid="nfo-card"][data-code="${n.code}"]`);const s=statusOf(n);
     const when=await card.getByTestId('nfo-when').innerText();
     if(s==='offer'&&n.closeDate) assert.match(when,/^Open .+ to .+/,`${n.code} closing date`);
     if(s==='closed'||s==='trading'){
      if(n.closeDate||n.firstNavDate) assert.match(await card.getByTestId('nfo-until').innerText(),/^On this list until /,`${n.code} until`);
      if(s==='closed'||n.firstNavDate) assert.ok(await card.getByTestId('nfo-available').count(),`${n.code} says when units are available`);
     }
     if(s==='trading'&&n.firstNavDate) assert.match(await card.getByTestId('nfo-available').innerText(),/^Open for investment since /);
    }
    // Section headings carry their counts and add up to the list.
    const counts=await page.locator('section[data-testid^="nfo-section-"] h2').allInnerTexts();
    const sum=counts.map(t=>Number((t.match(/\((\d+)\)/)||[])[1]||0)).reduce((a,b)=>a+b,0);
    assert.equal(sum,listed.length,'section counts add up');
   }
   // Tablet widths hide the top-bar link; the menu carries it instead.
   if(width>=768&&width<1024){
    await page.goto(base+'/#/');
    assert.equal(await page.locator('header nav').getByRole('link',{name:'NFOs',exact:true}).isVisible(),false,'NFOs hidden in the top bar');
    await page.getByRole('button',{name:'Menu'}).click();
    await page.getByRole('link',{name:'NFOs',exact:true}).first().click();
    await page.waitForURL(/#\/nfo$/);
   }
   // Reachable from the menu on desktop.
   if(width>=1024){
    await page.goto(base+'/#/');
    await page.getByRole('link',{name:'NFOs',exact:true}).first().click();
    await page.waitForURL(/#\/nfo$/);
   }
   assert.deepEqual(errors,[],`page errors at ${width}px`);
   await ctx.close();
   console.log(`PASS new fund offers page at ${width}px`);
  }
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
