/** Movers page: the question box, chips, every view, drill-downs and the URL, at phone to desktop widths. Real committed data. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
const VIEWS=['Money flows','Fund size','Returns','Category rank','Return momentum','Costs','Manager changes','Portfolio moves','Debt / Cash'];
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
const ready=page=>page.waitForSelector('[data-testid="movers-summary"]',{timeout:90000});
async function ask(page,q){await page.fill('#movers-q',q);await page.getByRole('button',{name:'Ask',exact:true}).click();await ready(page)}
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
   const answer=await page.getByTestId('movers-answer').innerText();
   const first=await page.getByTestId('movers-table').locator('tbody tr').first().innerText();
   assert.ok(first.includes(answer.split(':')[0]),`answer names the first row: ${answer}`);
   assert.match(await page.getByTestId('movers-chips').innerText(),/Small Cap/);
   const cats=await page.getByTestId('movers-table').locator('tbody tr td:nth-child(2) div').allInnerTexts();
   assert.ok(cats.length>5&&cats.every(t=>t.startsWith('Small Cap')),'only small caps');
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
   const gname=await g.innerText();await g.click();await ready(page);
   const squash=t=>t.replace(/\s+/g,'');
   assert.ok(squash(await page.getByTestId('movers-chips').innerText()).includes(squash(gname)),`drilled into ${gname}`);
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
   // Portfolio moves: a stock opens the funds that moved it, and back.
   await page.getByRole('tab',{name:'Portfolio moves',exact:true}).click();
   await page.waitForSelector('[data-testid="movers-table"] tbody tr',{timeout:90000});
   await page.getByTestId('movers-table').locator('tbody tr').first().getByRole('button').click();
   await page.getByRole('button',{name:'← All stocks'}).waitFor();
   assert.match(await page.getByTestId('movers-summary').innerText(),/funds? changed this stock/);
   assert.ok(await page.getByTestId('movers-table').locator('tbody tr').count()>0);
   await page.getByRole('button',{name:'← All stocks'}).click();
   await page.waitForFunction(()=>!/stock=/.test(location.hash));
   // A named stock, asked in words.
   await ask(page,'who bought hdfc bank');
   await page.getByRole('heading',{name:/HDFC Bank/}).waitFor();
   // "who bought" lists the buyers only
   assert.match(await page.getByTestId('movers-summary').innerText(),/funds? bought this stock/);
   const acts=await page.getByTestId('movers-table').locator('tbody tr td:nth-child(2)').allInnerTexts();
   assert.ok(acts.length>0&&acts.every(t=>/^(Added|Bought more)$/.test(t.trim())),`buyers only: ${[...new Set(acts)].join(', ')}`);
   // Sorting by a column header is shareable state.
   await page.getByRole('tab',{name:'Returns',exact:true}).click();await ready(page);
   await page.getByRole('button',{name:/^Sharpe/}).click();
   await page.waitForFunction(()=>/measure=sharpe/.test(location.hash));
   assert.match(await page.getByTestId('movers-summary').innerText(),/Sharpe ratio, highest first/);
   // Fund names link to fund pages.
   const href=await page.getByTestId('movers-table').locator('tbody a').first().getAttribute('href');
   assert.match(href,/#\/fund\/\d+\//);
   assert.deepEqual(errors,[],`page errors at ${width}px`);
   await ctx.close();
   console.log(`PASS movers page at ${width}px`);
  }
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
