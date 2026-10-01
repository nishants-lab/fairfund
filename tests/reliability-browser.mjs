import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
const server=await createServer({root,plugins:[{name:'observe-events',enforce:'pre',transform(code,id){if(id.endsWith('/src/lib/usage.ts'))return code.replace('export function trackUsageEvent(event: UsageEvent) {','export function trackUsageEvent(event: UsageEvent) { (window as any).__events ??= []; (window as any).__events.push(event);')}}],server:{host:'127.0.0.1',port:0}})
let browser
try {
 await server.listen()
 const base='http://127.0.0.1:'+server.httpServer.address().port
 browser=await chromium.launch({headless:true})
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'})
 const page=await context.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 const points=Array.from({length:1462},(_,i)=>({date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),nav:100+i*.025+Math.sin(i/7)*.5}))
 await context.route('**/*',route=>{
  const url=new URL(route.request().url())
  if(url.hostname==='api.mfapi.in')return route.fulfill({contentType:'application/json',body:JSON.stringify({data:points.map((p,i)=>({date:p.date.split('-').reverse().join('-'),nav:String(url.pathname.endsWith('/120503') ? 100*1.001**i : p.nav)})).reverse()})})
  if(url.origin!==base)return route.abort()
  return route.continue()
 })
 for(const code of [120304,120826]){
  await page.goto(base+'/#/fund/'+code)
  await page.getByRole('status').filter({hasText:'NAV history needs source verification'}).waitFor()
  await page.waitForFunction(()=>!document.body.textContent.includes('Loading NAV history'))
  assert.equal(await page.locator('#verdict,#forward').count(),0)
  assert.equal(await page.locator('path.recharts-line-curve,path.recharts-area-curve').count(),0)
  assert.equal(await page.locator('input[type=date]').count(),0)
 }
 await page.goto(base+'/#/compare?codes=120304,120826')
 await page.getByRole('status').filter({hasText:'NAV source verification is needed'}).waitFor()
 assert.equal(await page.getByRole('row').filter({hasText:'Composite score'}).getByText('No score',{exact:true}).count(),2)
 assert.equal(await page.locator('path.recharts-line-curve,path.recharts-area-curve').count(),0)
 assert.deepEqual(await page.evaluate(()=>window.__events||[]),[])
 console.log('PASS sticky holds despite clean live fixtures: debt/equity detail and Compare metrics, chart, score, events')
 await page.goto(base+'/#/compare?codes=111549,120503')
 await page.waitForFunction(()=>window.__events?.length===1)
 const sortino=page.getByRole('row').filter({hasText:'Sortino Ratio'}).locator('td').nth(2)
  assert.equal((await sortino.innerText()).trim().charCodeAt(0),0x2014,'Unavailable Sortino has no numeric gap or winner')
 assert.equal(await sortino.locator('.bg-emerald-100').count(),0)
 await page.locator('input[type=date]').first().fill('2021-01-04')
 await page.waitForFunction(()=>window.__events?.length===2)
 await page.getByText('Save or load a comparison',{exact:true}).click()
 await page.getByLabel('Comparison name',{exact:true}).fill('Synthetic research')
 await page.getByLabel('Private note (optional)',{exact:true}).fill('Private sentinel')
 await page.getByRole('button',{name:'Save comparison',exact:true}).click()
 await page.getByRole('status').filter({hasText:'saved in this browser'}).waitFor()
 await page.getByRole('button',{name:'1Y',exact:true}).click()
 await page.waitForFunction(()=>window.__events?.length===3)
 await page.getByRole('button',{name:'Load Synthetic research',exact:true}).click()
 assert.equal(await page.locator('input[type=date]').first().inputValue(),'2021-01-04')
 await page.getByText('Custom',{exact:true}).waitFor()
 assert.deepEqual(await page.evaluate(()=>window.__events),Array(3).fill('comparison_completed'))
 await page.reload()
 await page.getByText('Save or load a comparison',{exact:true}).click()
 await page.getByRole('button',{name:'Load Synthetic research',exact:true}).click()
 assert.equal(await page.locator('input[type=date]').first().inputValue(),'2021-01-04')
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 if(process.env.FF_SCREENSHOT_DIR){mkdirSync(process.env.FF_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.FF_SCREENSHOT_DIR,'saved-comparison-mobile.png'),fullPage:true,animations:'disabled'})}
 console.log('PASS actual Compare save/reload/custom load, fixed completion events and dedup, mobile layout')
}finally{if(browser)await browser.close();await server.close()}
