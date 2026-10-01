/** Local homepage regression. Run against npm run dev on loopback port 4190.
 * Uses synthetic search input only; never uploads a statement or changes remote data.
 * Native Node: node tests/homepage-browser.cjs. FF_TEST_BASE_URL overrides local URL.
 * Optional FF_SCREENSHOT_DIR saves review screenshots.
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.FF_TEST_BASE_URL || 'http://127.0.0.1:4190';
const capture = process.env.FF_SCREENSHOT_DIR;
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/data/funds.json'), 'utf8'));
(async () => {
 const browser = await chromium.launch({headless:true});
 try {
  const errors=[];
  for (const [name,width,height,theme] of [['desktop',1440,1024,'light'],['mobile',360,800,'light'],['narrow',320,760,'light'],['tablet',768,1024,'light'],['dark',1440,1024,'dark']]) {
   const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
   await context.route('https://api.mfapi.in/**',r=>r.abort());
   await context.route('**/gc.zgo.at/**',r=>r.abort());
   const page=await context.newPage();
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base,{waitUntil:'networkidle'});
   await page.getByRole('heading',{level:1,name:/Research and compare.*Indian mutual funds/}).waitFor();
   assert.equal(await page.locator('h1').count(),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name}: overflow`);
   const text=await page.locator('main').innerText();
   assert.doesNotMatch(text,/skill|luck|superpower|batting average|scientific|identical dates|stored CAGR|stored \dY/i);
   assert.equal(await page.getByText('Top 3 by 5Y return',{exact:true}).count(),2);
   assert.equal(await page.getByText('Lower NAV volatility',{exact:true}).count(),3);
   assert.equal(await page.getByText('Broader fund choice',{exact:true}).count(),0);
   assert.equal(await page.getByText('Top 3 by 3Y return',{exact:true}).count(),3);
   assert.equal(await page.getByText('Top 3 by 3Y & 5Y return',{exact:true}).count(),0);
   assert.equal(await page.locator('[data-category-card]').count(),20);
   assert.equal(await page.locator('[data-category-badge]').count(),8);
   for(const [category, label, expected] of [
     ['Index - Mid Cap','Top 3 by 5Y return',/3 eligible funds \(small sample\)/],
     ['Liquid','Lower NAV volatility',/credit or liquidity risk/],
     ['International / Global','Top 3 by 3Y return',/26.74%/],
     ['Index - Other','Top 3 by 3Y return',/16.10%/],
     ['Mid Cap','Top 3 by 3Y return',/3-year annualised returns: 15.68%/],
   ]) {
     const button=page.getByRole('button',{name:`About ${category}: ${label}`,exact:true});
     await button.scrollIntoViewIfNeeded();
     if(width<=360) await button.click(); else await button.focus();
     const tooltip=page.getByRole('tooltip');await tooltip.waitFor();
     assert.match(await tooltip.innerText(),expected);
     assert.equal(await button.getAttribute('aria-describedby'),await tooltip.getAttribute('id'));
     const box=await tooltip.boundingBox();assert(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=height);
     assert.equal(new URL(page.url()).hash,'','badge explanation must not navigate');
     await page.keyboard.press('Escape');assert.equal(await tooltip.count(),0);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(capture){fs.mkdirSync(capture,{recursive:true});}
   if(capture)await page.locator('[aria-labelledby="categories-title"]').screenshot({path:path.join(capture,`category-badges-${name}.png`)});
   assert.equal(await page.getByRole('article',{name:'Fund spotlight'}).count(),1);
   const facts=page.locator('[aria-label="Research facts"] > article');
   assert.equal(await facts.count(),2);
   assert.doesNotMatch(text,/The periods overlap|These periods overlap|analysis coverage|year-labelled/);
   assert.equal(await page.locator('a button').count(),0,'tooltip controls must not nest inside links');
   if(capture){fs.mkdirSync(capture,{recursive:true});await page.screenshot({path:path.join(capture,`fairfund-home-${name}.png`),fullPage:true,timeout:12000,animations:'disabled'});}
   await page.evaluate(()=>scrollTo(0,0));
   const search=page.getByRole('combobox',{name:'Search mutual funds',exact:true});
   assert.equal(await search.getAttribute('placeholder'),'Fund name, AMC or category');
   const inputBox=await search.boundingBox();
   assert(inputBox.y+inputBox.height<height,`${name}: search above fold`);
   await search.fill('Parag Parikh Flexi Cap');
   const option=page.getByRole('option',{name:/Parag Parikh Flexi Cap Fund/}).first();
   await option.waitFor();
   const panel=await page.getByRole('listbox').boundingBox();
   assert(panel.x>=0 && panel.x+panel.width<=width,`${name}: search dropdown outside viewport`);
   await search.press('Escape');
   assert.equal(await search.getAttribute('aria-expanded'),'false');
   await search.press('ArrowDown');
   assert.equal(await search.getAttribute('aria-expanded'),'true');
   await search.press('Home');
   assert.equal(await search.evaluate(el=>el.selectionStart),0);
   await search.press('Enter');
   await page.waitForURL(/#\/fund\/122639/);
   await page.goto(base,{waitUntil:'networkidle'});
   const tipButton=page.getByRole('button',{name:'About spotlight consistency',exact:true});
   if(await tipButton.count()) {
     await tipButton.scrollIntoViewIfNeeded();
     await tipButton.focus();
     const tip=page.getByRole('tooltip');
     await tip.waitFor();
     assert.match(await tip.innerText(),/Each 3-year period starts one month after/);
     assert.equal(await tipButton.getAttribute('aria-describedby'),await tip.getAttribute('id'));
     const box=await tip.boundingBox();
     assert(box.x>=0 && box.x+box.width<=width && box.y>=0 && box.y+box.height<=height,name+': tooltip outside viewport');
     await page.keyboard.press('Escape');
     assert.equal(await tipButton.getAttribute('aria-expanded'),'false');
     await tipButton.press('Enter');
     await tip.waitFor();
     await page.getByRole('heading',{level:1}).click();
     assert.equal(await page.getByRole('tooltip').count(),0,'outside click dismisses tooltip');
   }
   console.log('PASS '+name+': responsive search, keyboard navigation and accessible tooltip');
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  await context.route('https://api.mfapi.in/**',r=>r.abort());
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base,{waitUntil:'networkidle'});
  const board=page.getByRole('group',{name:'Board category'});
  await board.getByRole('button',{name:'Small Cap',exact:true}).click();
  assert.equal(await board.getByRole('button',{name:'Small Cap',exact:true}).getAttribute('aria-pressed'),'true');
  const periods=page.getByRole('group',{name:'Return period'});
  const list=page.getByRole('list',{name:'Small Cap 3Y annualised returns'});
  const expected=data.funds.filter(f=>f.category==='Small Cap' && Number.isFinite(f.metrics['3Y']?.cagr)).sort((a,b)=>b.metrics['3Y'].cagr-a.metrics['3Y'].cagr).slice(0,5);
  assert.equal(await list.locator('li').count(),expected.length);
  for(let i=0;i<expected.length;i++) assert((await list.locator('li').nth(i).innerText()).includes(expected[i].name));
  await periods.getByRole('button',{name:'1Y'}).click();
  assert.equal(await periods.getByRole('button',{name:'1Y'}).getAttribute('aria-pressed'),'true');
  await page.getByRole('list',{name:'Small Cap 1Y annualised returns'}).waitFor();
  await page.locator('[data-category-card="Small Cap"] a').click();
  await page.waitForURL(/#\/explore\?cat=Small(?:%20|\+)Cap/);
  await page.goto(base,{waitUntil:'networkidle'});
  const priorSpotlight = await page.getByRole('article',{name:'Fund spotlight'}).getAttribute('data-fund-code');
  await page.getByRole('button',{name:'Another view'}).click();
  assert.notEqual(await page.getByRole('article',{name:'Fund spotlight'}).getAttribute('data-fund-code'),priorSpotlight);
  assert.equal(await page.getByRole('heading',{level:2,name:/period changes|compared with its peers|closer look|starting point/i}).count(),1);
  await page.getByRole('link',{name:/Start a comparison/}).click();
  await page.waitForURL(/#\/compare/);
  const add=page.getByRole('combobox').filter({visible:true});
  await add.fill('Parag Parikh Flexi Cap');
  await page.getByRole('option',{name:/Parag Parikh Flexi Cap Fund/}).first().click();
  await page.waitForURL(/codes=122639/);
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('link',{name:/Open portfolio review/}).click();
  await page.waitForURL(/#\/my\/portfolio/);
  await page.getByText('Drop your CAMS statement here',{exact:true}).waitFor();
  await page.goto(base,{waitUntil:'networkidle'});
  const search=page.getByRole('combobox',{name:'Search mutual funds',exact:true});
  await search.fill('small cap');
  await page.getByRole('listbox').waitFor();
  await search.press('ArrowDown');
  const active=await search.getAttribute('aria-activedescendant');
  assert(active && await page.locator(`[id="${active}"]`).getAttribute('aria-selected')==='true');
  await search.press('Enter');
  await page.waitForURL(/#\/explore\?cat=Small(?:%20|\+)Cap/);
  await page.goto(base,{waitUntil:'networkidle'});
  await search.fill('compare Parag Parikh Flexi Cap and HDFC Flexi Cap');
  await page.getByRole('option',{name:/^Compare Parag/}).waitFor();
  await search.press('Enter');
  await page.waitForURL(/#\/compare\?codes=\d+,\d+/);
  console.log('PASS rotating edition, period/category returns, category badge, Compare onPick, portfolio landing, search intents');
  await page.goto(base,{waitUntil:'networkidle'});
  await search.fill('zzzzzzzzzz');
  await page.getByText(/No funds match/).waitFor();
  await search.press('Escape');
  assert.equal(await page.getByText(/No funds match/).count(),0);
  await page.getByRole('button',{name:'Take the tour'}).click();
  await page.getByText('Step 1 of 4',{exact:true}).waitFor();
  for(let i=1;i<4;i++) await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByText('Step 4 of 4',{exact:true}).waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(),/superpower|skill or luck|finance degree/i);
  await page.getByRole('button',{name:'Explore funds',exact:true}).click();
  await page.waitForURL(/#\/explore/);
  console.log('PASS empty-result Escape, four-step plain-language tour');
  assert.deepEqual(errors,[]);
  console.log('PASS no JavaScript page errors');
  await context.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
