/** Compare's overlap cards name each fund by the words that tell it apart: a Nifty 50 fund and a
 * Nifty 500 fund must not both read "... Nifty", and the names wrap rather than overflow on a phone. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const base=process.env.FF_TEST_BASE_URL||'http://127.0.0.1:4190';
// UTI Nifty 50 Index Fund and Motilal Oswal Nifty 500 Index Fund: both have stock-level holdings.
const CODES=[120716,147625];
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [320,1280]){
   const ctx=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
   const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://api.mfapi.in/**',r=>r.abort());
   await page.route('**/gc.zgo.at/**',r=>r.abort());
   await page.route('**/goatcounter.com/**',r=>r.abort());
   await page.goto(base+'/#/compare?codes='+CODES.join(','));
   const names=page.getByTestId('overlap-pair-names').first();
   await names.waitFor({timeout:60000});
   const text=(await names.innerText()).replace(/\s+/g,' ');
   assert.match(text,/UTI Nifty 50\b/,text);
   assert.match(text,/Motilal Oswal Nifty 500\b/,text);
   const box=await names.evaluate(el=>({sw:el.scrollWidth,cw:el.clientWidth,doc:document.documentElement.scrollWidth,win:document.documentElement.clientWidth}));
   assert.ok(box.sw<=box.cw+1,'pair names overflow their card: '+JSON.stringify(box));
   assert.ok(box.doc<=box.win,'page overflows: '+JSON.stringify(box));
   assert.deepEqual(errors,[]);
   await ctx.close();
   console.log(`PASS compare overlap labels ${width}px: ${text}`);
  }
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
