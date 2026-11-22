/** Regime returns ship in their own lazy chunk (build/split-regimes.ts), not in the bundled
 * fund index. The category stress table, a fund's regime table and its regime comparison must
 * still fill in, and the production index chunk must not carry regimes any more. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
const built=process.env.FF_TEST_BUILT==='1';
// Parag Parikh Flexi Cap, compared with HDFC Flexi Cap: both active in several regimes.
const FUND=122639, OTHER='HDFC Flexi Cap';
(async()=>{
 if(built){
  const dir=path.join(__dirname,'..','dist','assets');
  const files=fs.readdirSync(dir);
  const index=files.filter(f=>/^fund-data-.*\.js$/.test(f));
  const regimes=files.filter(f=>/fund-regimes-.*\.js$/.test(f));
  assert.equal(index.length,1,'one fund index chunk: '+index);
  assert.equal(regimes.length,1,'one regimes chunk: '+regimes);
  assert.doesNotMatch(fs.readFileSync(path.join(dir,index[0]),'utf8'),/regimes/,'the index chunk still carries regimes');
  assert.match(fs.readFileSync(path.join(dir,regimes[0]),'utf8'),/"122639":\[|122639:\[/,'the regimes chunk lacks a known fund');
 }
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/gc.zgo.at/**',r=>r.abort());
  await page.route('**/goatcounter.com/**',r=>r.abort());

  await page.goto(base+'/#/category/flexi-cap');
  const stress=page.locator('section',{has:page.getByRole('heading',{name:'Regime stress test'})});
  await stress.waitFor({timeout:60000});
  const catRows=await stress.locator('tbody tr').count();
  assert.ok(catRows>=3,'category stress table rows: '+catRows);

  await page.goto(base+'/#/fund/'+FUND+'/x');
  const card=page.locator('div.card',{has:page.getByRole('heading',{name:'How it behaved in each market regime'})});
  await card.waitFor({timeout:60000});
  assert.ok(await card.locator('tbody tr').count()>=3,'fund regime table is short');
  await card.getByRole('button',{name:'+ Compare'}).click();
  const box=card.getByPlaceholder('Pick a fund to compare…');
  await box.fill(OTHER);
  await page.getByRole('option').filter({hasText:OTHER}).first().click();
  await card.getByText('Comparing with:').waitFor({timeout:10000});
  assert.equal(await card.locator('thead th').count(),3,'comparison column missing');
  const pairs=await card.locator('tbody tr').evaluateAll(rows=>rows.filter(r=>(r.textContent.match(/%/g)||[]).length>=2).length);
  assert.ok(pairs>=2,'rows with both funds\' returns: '+pairs);
  assert.deepEqual(errors,[]);
  console.log(`PASS regimes (${built?'built':'dev'}): category rows ${catRows}, compared rows ${pairs}`);
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
