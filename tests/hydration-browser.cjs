/**
 * Local browser regression against actual React components and production data functions.
 * Start npm run dev -- --host 127.0.0.1 --port 4190 in the repo, then run:
 *   node tests/hydration-browser.cjs
 * Override the local URL with FF_TEST_BASE_URL. Requires installed Playwright Chromium.
 * No real statement data, artifact writes, or remote site changes. Live NAV is stubbed
 * offline; Compare shells are delayed and given sentinel consistency values.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const base = process.env.FF_TEST_BASE_URL || 'http://127.0.0.1:4190';
const built = process.env.FF_TEST_BUILT === '1';
const {routeFundIndex}=require('./fixtures/fund-index-route.cjs');
const {syntheticFund,syntheticMetric,ensureCategory}=require('./fixtures/browser-timebomb-fixtures.cjs');
const data=JSON.parse(fs.readFileSync(`${root}/src/data/funds.json`,'utf8'));
const alphaCode=9100011,peerCode=9100012,peerName='Quorvex Hydration Peer Fund';
const fixtures=[syntheticFund(alphaCode,'Zyxel Hydration Alpha Fund','Flexi Cap'),syntheticFund(peerCode,peerName,'Flexi Cap')]
 .map(f=>({...f,metrics:{'3Y':syntheticMetric('3Y','2023-01-02','2026-01-02')}}));
if(process.env.FF_TEST_DATA_CHURN==='1')data.funds=data.funds.filter(f=>![149936,122639].includes(f.code)).map(f=>({...f,metrics:{},analytics:{}}));
data.funds=[...data.funds.filter(f=>!fixtures.some(x=>x.code===f.code)),...fixtures];
data.totalFunds=data.funds.length;
ensureCategory(data,'Flexi Cap','Flexi Cap','High');
const alphaDetail={analytics:{rollingAlpha:{spark:[['2025-10',1],['2025-11',-1],['2025-12',2]],windowM:36}}};

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
   await routeFundIndex(context,data);
   await context.route('**/fund-data/*.json*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(alphaDetail)}));
  const page = await context.newPage();
  const errors=[];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://api.mfapi.in/**', route => route.abort());
  await page.goto(base+'/#/compare', {waitUntil:'domcontentloaded'});
   await page.locator('main h1').waitFor();
  // Module-level immutability is checked on the dev server. A production bundle
  // does not expose /src modules; its observable navigation is checked below.
  const before = built ? null : await page.evaluate(async () => {
    const m=await import('/src/lib/data.ts');
    return JSON.stringify(m.getFund(9100011));
  });
  await page.evaluate(code => {location.hash='/fund/'+code;},alphaCode);
  await page.getByRole('button',{name:'Alpha vs peers',exact:true}).waitFor();
  await page.getByRole('button',{name:'Alpha vs peers',exact:true}).click();
  await page.locator('path.recharts-area-curve[stroke="url(#alphaStroke)"]').waitFor();
  if (!built) {
    const after = await page.evaluate(async code => JSON.stringify((await import('/src/lib/data.ts')).getFund(code)),alphaCode);
    assert.equal(after,before,'detail page must leave shared index unchanged');
    console.log('PASS shared index unchanged (development-module assertion)');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile overflow');
  console.log('PASS mobile fund hydration and Alpha chart path');
  await context.close();
  const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
   await routeFundIndex(ctx,data);
  const compare=await ctx.newPage();
  compare.on('pageerror',e=>errors.push(e.message));
  await compare.route('https://api.mfapi.in/**',route=>route.abort());
  let release;
  const gate=new Promise(resolve=>{release=resolve});
  let firstSeen;
  const started=new Promise(resolve=>{firstSeen=resolve});
  await compare.route('**/fund-data/*.json*',async route=>{
    const code=route.request().url().match(/fund-data\/(\d+)/)[1];
    firstSeen();
    await gate;
    const data={analytics:{}};
    data.analytics ??={};
    data.analytics.battingAverage={pct:Number(code)===alphaCode?81:82,n:60,windowM:36,limited:false};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await compare.goto(base+'/#/compare?codes='+alphaCode,{waitUntil:'domcontentloaded'});
  await started;
  await compare.evaluate(codes=>{location.hash='/compare?codes='+codes.join(',');},[alphaCode,peerCode]);
  await compare.getByText(peerName,{exact:false}).first().waitFor();
  release();
  const row=compare.getByRole('row').filter({hasText:'Consistency'});
  await row.getByText('81%',{exact:true}).waitFor();
  await row.getByText('82%',{exact:true}).waitFor();
  await compare.evaluate(code=>{location.hash='/compare?codes='+code;},peerCode);
  await compare.waitForFunction(()=>document.querySelectorAll('tr').length>0 && !Array.from(document.querySelectorAll('tr')).find(r=>r.textContent.includes('Consistency'))?.textContent.includes('81%'));
  await compare.evaluate(codes=>{location.hash='/compare?codes='+codes.join(',');},[alphaCode,peerCode]);
  await row.getByText('81%',{exact:true}).waitFor();
  await row.getByText('82%',{exact:true}).waitFor();
  console.log('PASS Compare pending navigation, remove/readd, both shell values restored');
  assert.deepEqual(errors,[],'browser page errors');
  console.log('PASS no browser page errors');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
