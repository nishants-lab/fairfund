/** Stable public report pages from a production build. No remote writes. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fundData=require('../src/data/funds.json');
const {funds}=fundData;
const {routeFundIndex}=require('./fixtures/fund-index-route.cjs');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
fs.mkdirSync(process.env.FF_TEST_TMPDIR||path.join(os.homedir(),'.aki','tmp'),{recursive:true});
const hasWindow=f=>!!(f.metrics?.['3Y']||f.metrics?.['5Y']);
// Real pages are chosen from the current build when such a fund exists. The three
// page branches (eligible, unavailable-period, held) are also generated from
// synthetic funds by the real generator, so a data refresh that removes a branch
// from the live universe cannot remove its coverage.
const realEligible=funds.find(f=>!f.dataQuality&&hasWindow(f));
const realUnavailable=funds.find(f=>!f.dataQuality&&!hasWindow(f));
const realHeld=funds.find(f=>f.dataQuality?.status==='quarantined');
const root=path.resolve(__dirname,'..');
const metric={cagr:12.5,volatility:10,sharpe:0.6,sortino:0.9,maxDrawdown:-11,calmar:0.5,windowStart:'2023-01-02',windowEnd:'2026-01-02',targetStart:'2023-01-02',targetHorizon:'3Y',startOffsetDays:0,endOffsetDays:0,alpha:0.1,catMedianCagr:11,catRank:1,catSize:2,score:0.7};
const synth=(code,name,metrics,extra={})=>({code,name,fullName:name+' - Direct Plan - Growth',amc:'Synthetic AMC',category:'Synthetic Equity',categoryDisplay:'Synthetic Equity',metrics,...extra});
const syntheticFunds=[
 synth(990001,'Synthetic Eligible Fund',{'3Y':metric,'5Y':{...metric,targetHorizon:'5Y',windowStart:'2021-01-01',windowEnd:'2026-01-02'}}),
 synth(990002,'Synthetic Peer Fund',{'3Y':{...metric,catRank:2,cagr:11.5}}),
 synth(990003,'Synthetic Unavailable Fund',{}),
 synth(990004,'Synthetic Held Fund',{'3Y':metric},{dataQuality:{status:'quarantined'}}),
];
function buildSyntheticPages(){
 const tmp=fs.mkdtempSync(path.join((process.env.FF_TEST_TMPDIR||path.join(os.homedir(),'.aki','tmp')),'ff-seo-browser-'));
 for(const d of ['scripts','src/data','dist'])fs.mkdirSync(path.join(tmp,d),{recursive:true});
 for(const n of ['gen-unfurls.mjs','site-config.mjs','research-pages.mjs'])fs.copyFileSync(path.join(root,'scripts',n),path.join(tmp,'scripts',n));
 fs.copyFileSync(path.join(root,'src/data/stock_names.json'),path.join(tmp,'src/data/stock_names.json'));
 fs.writeFileSync(path.join(tmp,'src/data/funds.json'),JSON.stringify({generatedAt:'2026-01-02T00:00:00Z',anchor:'2026-01-02',totalFunds:syntheticFunds.length,categories:{'Synthetic Equity':{display:'Synthetic Equity',fundCount:syntheticFunds.length}},funds:syntheticFunds}));
 fs.copyFileSync(path.join(root,'dist/index.html'),path.join(tmp,'dist/index.html'));
 const run=spawnSync(process.execPath,[path.join(tmp,'scripts/gen-unfurls.mjs')],{cwd:tmp,encoding:'utf8',timeout:60000});
 assert.equal(run.status,0,'synthetic SEO generation failed: '+run.stderr);
 return tmp;
}
const catSlug=n=>n.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const liveCategory=Object.entries(fundData.categories||{}).find(([k,v])=>(v.fundCount||0)>0&&funds.some(f=>f.category===k&&!f.dataQuality));
assert(liveCategory,'a live category page is required');
const mergedData={...fundData,funds:[...funds,...syntheticFunds],totalFunds:funds.length+syntheticFunds.length,categories:{...fundData.categories,'Synthetic Equity':{display:'Synthetic Equity',riskLevel:'Moderately High',fundCount:syntheticFunds.length}}};
const syntheticDir=buildSyntheticPages();
process.on('exit',()=>fs.rmSync(syntheticDir,{recursive:true,force:true}));
const syntheticRoute=f=>'f/'+f.code+'/';
for(const f of syntheticFunds.filter(f=>f.code!==990002))assert(fs.existsSync(path.join(syntheticDir,'dist',syntheticRoute(f),'index.html')),'generator must emit synthetic page '+syntheticRoute(f));
const entry=(f,synthetic)=>({route:'f/'+f.code+'/',app:'/fund/'+f.code,table:!f.dataQuality&&hasWindow(f),held:f.dataQuality?.status==='quarantined',synthetic});
const routes=[
 ...[realEligible,realUnavailable,realHeld].filter(Boolean).map(f=>entry(f,false)),
 ...[syntheticFunds[0],syntheticFunds[2],syntheticFunds[3]].map(f=>entry(f,true)),
 {route:'c/'+catSlug(liveCategory[0])+'/',app:'/category/'+catSlug(liveCategory[0]),table:false},
 {route:'s/explore/',app:'/explore',table:true},
];
assert(routes.filter(r=>r.synthetic&&r.table).length===1&&routes.filter(r=>r.synthetic&&r.held).length===1,'synthetic eligible and held branches required');
if(!realHeld)console.log('NOTE no real held fund in this data; synthetic held page covers that branch');
const base=(process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190').replace(/\/$/,'');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [320,1280]) for(const js of [false,true]) {
   const ctx=await browser.newContext({viewport:{width,height:900},javaScriptEnabled:js,serviceWorkers:'block'});
   await ctx.route('https://api.mfapi.in/**',r=>r.abort());await ctx.route('**/gc.zgo.at/**',r=>r.abort());
   if(js)await routeFundIndex(ctx,mergedData);
   for(const {route,app,table,held:quarantined,synthetic} of routes) {
    const page=await ctx.newPage(),errors=[];
    if(synthetic)await page.route(base+'/'+route,r=>r.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fs.readFileSync(path.join(syntheticDir,'dist',route,'index.html'),'utf8')}));page.on('pageerror',e=>errors.push(e.message));
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
     assert.equal(await page.locator('.metrics-scroll[tabindex]').count(),table?1:0,route+' only eligible windows render metric tables');
     if(table) {
      assert.equal(await page.locator('.metrics-scroll').getAttribute('tabindex'),'0');
      // Figures stay on one line; a name column may wrap so the table fits at 320px.
      assert.equal(await page.locator('.metrics-scroll tr td:last-child').first().evaluate(e=>getComputedStyle(e).whiteSpace),'nowrap');
     }
     if(quarantined) {
      assert.match(await page.locator('main [role=status]').innerText(),/NAV history needs source verification/);
      assert.doesNotMatch(await page.locator('main').innerText(),/ranks #|CAGR [+-]?[0-9]/);
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
