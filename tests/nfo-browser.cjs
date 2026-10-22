/** New fund offers page on development and built bundles, at phone and desktop widths. Real committed nfo.json. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
const nfo=require('../src/data/nfo.json');
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
   assert.equal(await cards.count(),nfo.nfos.length,'one card per NFO');
   if(nfo.nfos.length){
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
    // Section headings carry their counts and add up to the list.
    const counts=await page.locator('section[data-testid^="nfo-section-"] h2').allInnerTexts();
    const sum=counts.map(t=>Number((t.match(/\((\d+)\)/)||[])[1]||0)).reduce((a,b)=>a+b,0);
    assert.equal(sum,nfo.nfos.length,'section counts add up');
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
