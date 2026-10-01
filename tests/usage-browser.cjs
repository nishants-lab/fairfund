// Standalone privacy regression: all browser network requests are fulfilled locally.
// Frozen ISC provider source: https://gc.zgo.at/count.js
// SHA-256: 792b7abd26c1fb6ae62906833e09a301251e2641816e69e4f95aba518f3fe3f0
const { resolve, join } = require('node:path')
const { readFileSync } = require('node:fs')
const assert = require('node:assert/strict')
const root = resolve(__dirname, '..')
const { chromium } = require('playwright')
const { buildSync } = require('esbuild')
const bundle = buildSync({
  stdin: { contents: `
    import React, {useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import {HashRouter, useNavigate} from 'react-router-dom';
    import UsageTracker from './src/components/UsageTracker';
    import {trackUsageEvent} from './src/lib/usage';
    window.trackUsageEvent=trackUsageEvent;
    window.ready=new Promise(resolve=>window.markReady=resolve);
    function Harness(){const navigate=useNavigate(); window.navigate=navigate;useEffect(()=>window.markReady(),[]);return React.createElement(UsageTracker)}
    createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(HashRouter,null,React.createElement(Harness))));
  `, resolveDir: root, loader: 'tsx' }, absWorkingDir:root,
  bundle:true, write:false, format:'iife', platform:'browser',
  define:{'import.meta.env.PROD':'true','process.env.NODE_ENV':'"development"'},
}).outputFiles[0].text
const provider = readFileSync(join(__dirname, 'fixtures', 'goatcounter-count.js'),'utf8')
const tag = readFileSync(root+'/index.html','utf8').match(/<script data-goatcounter=[^>]+><\/script>/)[0]
const html = '<!doctype html><html><head><title>SECRET_SCHEME ABCDE1234F</title>'+tag+'</head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
;(async()=>{
 const browser=await chromium.launch({headless:true})
 try {
  for(const scenario of ['delayed','loaded','dnt','localhost']){
   const context=await browser.newContext({serviceWorkers:'block'})
   const hits=[]
   const captures=[]
   let release
   const gate=new Promise(resolve=>release=resolve)
   let providerRequested
   const requested=new Promise(resolve=>providerRequested=resolve)
   if(scenario==='dnt') await context.addInitScript(()=>Object.defineProperty(navigator,'doNotTrack',{value:'1'}))
   await context.route('**/*', async route=>{
    const request=route.request(),url=new URL(request.url())
    if(url.hostname==='fairfund.goatcounter.com'){
     const capture=request.allHeaders().then(headers=>hits.push({url:request.url(),headers,body:request.postData(),method:request.method()}))
     captures.push(capture);await capture
     return route.fulfill({status:204})
    }
    if(url.hostname==='gc.zgo.at'){
     providerRequested(); if(scenario==='delayed') await gate
     return route.fulfill({contentType:'application/javascript',body:provider})
    }
    if(url.pathname==='/fixture.js') return route.fulfill({contentType:'application/javascript',body:bundle})
    return route.fulfill({contentType:'text/html',body:html})
   })
   const page=await context.newPage()
   const errors=[]
   page.on('pageerror',error=>errors.push(error.message))
   const origin=scenario==='localhost'?'https://localhost':'https://nishants-lab.github.io'
   await page.goto(origin+'/fairfund/?pan=ABCDE1234F&search=SECRET_SEARCH#/fund/123456/SECRET_SCHEME',{waitUntil:'domcontentloaded'})
   await requested
   await page.evaluate(()=>window.ready)
   if(scenario==='delayed'){
    assert.equal(hits.length,0)
    await page.evaluate(()=>window.trackUsageEvent('portfolio_import_completed'))
    const received=page.waitForRequest(r=>r.url().includes('p=portfolio_import_completed'))
    release(); await received
   }else await page.waitForLoadState('load')
   if(scenario==='dnt'||scenario==='localhost'){
    await page.evaluate(()=>{window.trackUsageEvent('comparison_completed');window.navigate('/compare?funds=SECRET')})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.equal(hits.length,0)
   }else{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    assert.equal(hits.filter(h=>new URL(h.url).searchParams.get('p')==='/fund').length,1,'StrictMode/auto count')
    const compare=page.waitForRequest(r=>new URL(r.url()).searchParams.get('p')==='/compare')
    await page.evaluate(()=>window.navigate('/compare?funds=123456&note=SECRET_NOTE'));await compare
    const completed=page.waitForRequest(r=>new URL(r.url()).searchParams.get('p')==='comparison_completed')
    await page.evaluate(()=>window.trackUsageEvent('comparison_completed'));await completed
    const back=page.waitForRequest(r=>new URL(r.url()).searchParams.get('p')==='/fund')
    await page.evaluate(()=>window.navigate(-1));await back
    const category=page.waitForRequest(r=>new URL(r.url()).searchParams.get('p')==='/category')
    await page.evaluate(()=>location.hash='#/category/SECRET_CATEGORY');await category
    const portfolio=page.waitForResponse(r=>new URL(r.url()).searchParams.get('p')==='/my/portfolio')
    await page.evaluate(()=>window.navigate('/my/portfolio?file=SECRET_FILE&password=SECRET_PASSWORD'));await portfolio
    await Promise.all(captures)
    assert.deepEqual(hits.map(hit=>new URL(hit.url).searchParams.get('p')), [
     '/fund', ...(scenario==='delayed'?['portfolio_import_completed']:[]),
     '/compare', 'comparison_completed', '/fund', '/category', '/my/portfolio',
    ])
    for(const hit of hits){
     const url=new URL(hit.url)
     assert(!/SECRET|ABCDE1234F|123456/.test(JSON.stringify(hit)))
     assert(!hit.headers.referer);assert(!hit.headers.cookie);assert.equal(hit.body,null);assert.equal(hit.method,'POST')
     assert([...url.searchParams.keys()].every(k=>['p','e','b'].includes(k)))
    }
    console.log(scenario+': '+JSON.stringify(hits.map(h=>h.url)))
   }
   assert.deepEqual(errors,[])
   console.log('PASS '+scenario+': all requests intercepted; zero collector writes')
   await context.close()
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
