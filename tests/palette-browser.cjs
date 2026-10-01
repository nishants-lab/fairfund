/** Coordinated palette checks against real app navigation. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const names=['sage','apricot','lavender','rose','sky','butter'];
  for(let i=0;i<names.length;i++) {
   const ctx=await browser.newContext({viewport:{width:360,height:800},reducedMotion:'reduce'});
   await ctx.route('**/gc.zgo.at/**',r=>r.abort());
   await ctx.route('https://api.mfapi.in/**',r=>r.abort());
   await ctx.addInitScript(n=>{Math.random=()=> (n+.1)/6},i);
   const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base);await page.locator('main h1').waitFor();
   const state=()=>page.evaluate(()=>({id:document.documentElement.dataset.palette,bg:getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(),brand:getComputedStyle(document.documentElement).getPropertyValue('--brand-600')}));
   const initial=await state();assert.equal(initial.id,names[i]);
   assert.notEqual(initial.bg,'rgba(0, 0, 0, 0)');assert(initial.brand.trim());
   for(const route of ['/explore','/compare','/my','/methodology','/']) {
    await page.evaluate(r=>{location.hash='#'+r},route);await page.locator('main h1').waitFor();
    assert.deepEqual(await state(),initial,'route navigation must preserve palette');
   }
   for(const mode of ['light','dark']) {
    if(mode==='dark') { await page.getByRole('button',{name:'Open menu',exact:true}).click(); await page.getByRole('button',{name:'Dark mode',exact:true}).click(); await page.waitForFunction(()=>document.documentElement.classList.contains('dark')); await page.getByRole('button',{name:'Close menu',exact:true}).click(); }
    assert.equal((await state()).id,initial.id);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.FF_SCREENSHOT_DIR){fs.mkdirSync(process.env.FF_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.FF_SCREENSHOT_DIR,names[i]+'-'+mode+'.png'),fullPage:true,animations:'disabled'});}
   }
   await page.reload();await page.locator('main h1').waitFor();assert.notEqual((await state()).id,initial.id,'refresh selects a different palette');
   assert.deepEqual(errors,[]);await ctx.close();console.log('PASS palette '+names[i]+': navigation, refresh, light/dark, mobile');
  }
  const ctx=await browser.newContext();await ctx.route('**/palette.js',r=>r.abort());await ctx.route('**/gc.zgo.at/**',r=>r.abort());
  const page=await ctx.newPage();await page.goto(base);await page.locator('main h1').waitFor();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--brand-600').trim()),'37 99 235');
  console.log('PASS palette script unavailable: original brand fallback retained');await ctx.close();
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
