/** Movers page: the question box, chips, every view, drill-downs and the URL, at phone to desktop widths. Real committed data. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
const VIEWS=['Money flows','Fund size','Returns','Category rank','Return momentum','Costs','Manager changes','Portfolio moves','Debt / Cash'];
const built=process.env.FF_TEST_BUILT==='1';
const {syntheticMovers,syntheticFund,ensureCategory}=require('./fixtures/browser-timebomb-fixtures.cjs');
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
const ready=page=>page.waitForSelector('[data-testid="movers-summary"]',{timeout:90000});
async function ask(page,q){await page.fill('#movers-q',q);await page.getByRole('button',{name:'Ask',exact:true}).click();await ready(page)}
async function portfolioMoves(page,mustHaveRows){
 await page.getByRole('tab',{name:'Portfolio moves',exact:true}).click();
 await page.waitForSelector('[data-testid="movers-summary"]',{timeout:90000});
 await page.waitForSelector('[data-testid="movers-loading"]',{state:'detached',timeout:90000});
 const rows=page.getByTestId('movers-table').locator('tbody tr');
 const n=await rows.count();
 if(n===0){
  assert.ok(!mustHaveRows,'synthetic portfolio moves must not be empty');
  assert.equal(await page.getByTestId('movers-empty').count(),1,'an empty month needs an explained empty state');
  return {stock:null};
 }
 const stock=(await rows.first().getByRole('button').innerText()).trim();
 await rows.first().getByRole('button').click();
 await page.getByRole('button',{name:'← All stocks'}).waitFor();
 assert.match(await page.getByTestId('movers-summary').innerText(),/funds? changed this stock/);
 assert.ok(await page.getByTestId('movers-table').locator('tbody tr').count()>0);
 await page.getByRole('button',{name:'← All stocks'}).click();
 await page.waitForFunction(()=>!/stock=/.test(location.hash));
 return {stock};
}
async function purchasesOnly(page,mustHaveRows){
 assert.match(await page.getByTestId('movers-summary').innerText(),/funds? bought this stock/);
 const acts=await page.getByTestId('movers-table').locator('tbody tr td:nth-child(2)').allInnerTexts();
 if(mustHaveRows)assert.ok(acts.length>0,'buyers expected');
 else if(!acts.length)assert.equal(await page.getByTestId('movers-empty').count(),1,'no buyers needs an explained empty state');
 assert.ok(acts.every(t=>/^(Added|Bought more)$/.test(t.trim())),`buyers only: ${[...new Set(acts)].join(', ')}`);
}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [390,1280]) {
   const ctx=await browser.newContext({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block'});
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://api.mfapi.in/**',r=>r.abort());
   await page.route('**/gc.zgo.at/**',r=>r.abort());
   await page.route('**/goatcounter.com/**',r=>r.abort());
   await page.goto(base+'/#/movers');
   await page.getByRole('heading',{name:'Movers',level:1}).waitFor();
   await ready(page);
   assert.match(await page.getByTestId('movers-summary').innerText(),/^\d+ funds · Estimated net flow, highest first/);
   assert.match(await page.getByTestId('movers-footnote').innerText(),/estimate rather than the fund house's reported figure/);
   // The question in the brief: small caps only, the top fund named, its row first.
   await ask(page,'which small cap fund had the highest inflow');
   assert.match(page.url(),/categories=Small\+Cap|categories=Small%20Cap/);
   assert.match(page.url(),/q=which/);
   const smallRows=page.getByTestId('movers-table').locator('tbody tr');
   const smallCount=await smallRows.count();
   if(smallCount){
    const answer=await page.getByTestId('movers-answer').innerText();
    const first=await smallRows.first().innerText();
    assert.ok(first.includes(answer.split(':')[0]),`answer names the first row: ${answer}`);
   } else assert.equal(await page.getByTestId('movers-empty').count(),1,'no small-cap flow rows needs an explained empty state');
   assert.match(await page.getByTestId('movers-chips').innerText(),/Small Cap/);
   const cats=await page.getByTestId('movers-table').locator('tbody tr td:nth-child(2) div').allInnerTexts();
   assert.equal(cats.length,smallCount);
   assert.ok(cats.every(t=>t.startsWith('Small Cap')),'only small caps');
   // The view survives a reload from its URL.
   await page.reload();await ready(page);
   assert.match(await page.getByTestId('movers-chips').innerText(),/Small Cap/);
   assert.match(await page.getByTestId('movers-notes').innerText(),/Understood/);
   // Removing the chip widens back to every fund and drops the question.
   await page.getByTestId('movers-chips').getByRole('button',{name:'Remove filter'}).first().click();
   await page.waitForFunction(()=>!document.querySelector('[data-testid="movers-chips"]'));
   assert.doesNotMatch(page.url(),/q=/);
   // Advice is declined in words, data still shown; nonsense says so.
   await ask(page,'should i buy quant small cap');
   assert.match(await page.getByTestId('movers-notes').innerText(),/does not recommend funds/);
   await ask(page,'asdf qwerty');
   assert.match(await page.getByTestId('movers-notes').innerText(),/not understood/);
   // Grouping, then drilling into a group.
   await ask(page,'inflows by category');
   assert.match(await page.getByTestId('movers-summary').innerText(),/groups from \d+ funds/);
   // Back and Forward bring back the question that made each view, not the last one typed.
   await page.goBack();await ready(page);
   assert.equal(await page.inputValue('#movers-q'),'asdf qwerty');
   assert.match(await page.getByTestId('movers-notes').innerText(),/not understood/);
   await page.goForward();await ready(page);
   assert.equal(await page.inputValue('#movers-q'),'inflows by category');
   assert.match(await page.getByTestId('movers-summary').innerText(),/groups from \d+ funds/);
   const g=page.getByTestId('movers-table').locator('tbody tr').first().getByRole('button');
   if(await g.count()){
    const gname=await g.innerText();await g.click();await ready(page);
    const squash=t=>t.replace(/\s+/g,'');
    assert.ok(squash(await page.getByTestId('movers-chips').innerText()).includes(squash(gname)),`drilled into ${gname}`);
   } else assert.equal(await page.getByTestId('movers-empty').count(),1,'no groups needs an explained empty state');
   // A fund name typed just before switching view applies to the new view, never pulls it back.
   await page.getByRole('tab',{name:'Money flows',exact:true}).click();await ready(page);
   await page.getByLabel('Filter by fund name').fill('hdfc');
   await page.getByRole('tab',{name:'Returns',exact:true}).click();
   await page.waitForFunction(()=>/names=hdfc/.test(location.hash),null,{timeout:5000});
   assert.match(page.url(),/view=returns/);
   await page.getByLabel('Filter by fund name').fill('');
   await page.waitForFunction(()=>!/names=/.test(location.hash),null,{timeout:5000});
   // Every view renders a table or an explained empty state, without overflowing the page.
   for(const v of VIEWS){
    await page.getByRole('tab',{name:v,exact:true}).click();await ready(page);
    const rows=await page.getByTestId('movers-table').locator('tbody tr').count();
    const empty=await page.getByTestId('movers-empty').count();
    assert.ok(rows>0||empty===1,`${v}: rows or an empty state`);
    assert.equal(await noOverflow(page),true,`${v} overflows at ${width}px`);
    for(const w of width<640?[320]:[768]){await page.setViewportSize({width:w,height:900});assert.equal(await noOverflow(page),true,`${v} overflows at ${w}px`);await page.setViewportSize({width,height:900})}
   }
   // Portfolio moves on the current data: a stock opens the funds that moved it, or the empty state is explained.
   const live=await portfolioMoves(page);
   if(live.stock){
    // "who bought <a stock that moved this month>" lists purchases only; no buyer at all must be said in words.
    await ask(page,'who bought '+live.stock);
    await page.getByRole('heading',{name:live.stock}).first().waitFor();
    await purchasesOnly(page,false);
   }
   // Sorting by a column header is shareable state.
   await page.getByRole('tab',{name:'Returns',exact:true}).click();await ready(page);
   await page.getByRole('button',{name:/^Sharpe/}).click();
   await page.waitForFunction(()=>/measure=sharpe/.test(location.hash));
   assert.match(await page.getByTestId('movers-summary').innerText(),/Sharpe ratio, highest first/);
   // Fund names link to fund pages.
   const links=page.getByTestId('movers-table').locator('tbody a');
   if(await links.count())assert.match(await links.first().getAttribute('href'),/#\/fund\/\d+\//);
   else assert.equal(await page.getByTestId('movers-empty').count(),1,'no rows needs an explained empty state');
   assert.deepEqual(errors,[],`page errors at ${width}px`);
   await ctx.close();
   if(!built){
    // Deterministic nonempty coverage: synthetic monthly payloads (dev server serves these modules; a bundle inlines them).
    const sctx=await browser.newContext({viewport:{width,height:900},isMobile:width<640,hasTouch:width<640,serviceWorkers:'block'});
    const sp=await sctx.newPage();const serrors=[];sp.on('pageerror',e=>serrors.push(e.message));
    const live=JSON.parse(JSON.stringify(require('../src/data/funds.json')));
    const synth=[9000001,9000002].map((c,i)=>syntheticFund(c,'Synthetic Flexi Cap '+(i+1),'Flexi Cap'));
    ensureCategory(live,'Flexi Cap','Flexi Cap','Moderately High');
    live.funds=synth;live.totalFunds=synth.length;
    const fx=syntheticMovers(synth.map(f=>f.code));
    await sp.route('**/src/data/funds.json*',r=>r.fulfill({contentType:'text/javascript',body:'export default '+JSON.stringify(live)}));
    await sp.route('**/fund-data/*.json*',r=>r.fulfill({contentType:'application/json',body:'{}'}));
    await sp.route('https://api.mfapi.in/**',r=>r.abort());
    await sp.route('**/gc.zgo.at/**',r=>r.abort());
    await sp.route('**/src/data/movers.json*',r=>r.fulfill({contentType:'text/javascript',body:'export default '+JSON.stringify(fx.movers)}));
    await sp.route('**/src/data/movers_stocks.json*',r=>r.fulfill({contentType:'text/javascript',body:'export default '+JSON.stringify(fx.stocks)}));
    await sp.goto(base+'/#/movers');await ready(sp);
    const got=await portfolioMoves(sp,true);
    assert.ok(got.stock,'synthetic portfolio moves must list a stock');
    await ask(sp,'who bought '+fx.STOCK_NAME);
    await sp.getByRole('heading',{name:fx.STOCK_NAME}).first().waitFor();
    await purchasesOnly(sp,true);
    assert.deepEqual(serrors,[],`synthetic page errors at ${width}px`);
    await sctx.close();
   }
   console.log(`PASS movers page at ${width}px`);
  }
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
