import test from 'node:test'
import assert from 'node:assert/strict'
import {navQualityIssue,NavQualityError} from '../src/lib/navQuality'
import {computeMetrics} from '../src/lib/metrics'
import {fetchNavHistory} from '../src/lib/nav'
import {mergeFundDetail} from '../src/lib/data'
import type {Fund} from '../src/types'
import fundsJson from '../src/data/funds.json'
import {correctSourceNav} from '../src/lib/navCorrections'
import corrections from '../src/data/nav_corrections.json'
const points=Array.from({length:80},(_,i)=>({date:new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),nav:100+i/10}))
test('suspicious source discontinuity withholds all range metrics without changing NAV',()=>{
 const broken=points.map((p,i)=>({...p,nav:i<40?p.nav:p.nav/10}))
 const before=JSON.stringify(broken)
 assert.match(navQualityIssue(broken)!,/50%/)
 assert.equal(computeMetrics(broken),null)
 assert.equal(JSON.stringify(broken),before)
 assert.equal(navQualityIssue(points),null)
 assert(computeMetrics(points))
})
test('invalid and out-of-order observations are rejected',()=>{
 for(const broken of [[...points].reverse(),[points[0],points[0]],[{...points[0],nav:Infinity}],[{...points[0],nav:0}]])assert(navQualityIssue(broken))
})
test('quarantined index cannot regain stale detail analytics',()=>{
 const f={code:1,metrics:{},analytics:{},dataQuality:{status:'quarantined',issues:[]}} as unknown as Fund
 const merged=mergeFundDetail(f,{analytics:{rollingAlpha:{spark:[['2020-01',1]],windowM:36}}} as any)
 assert.deepEqual(merged.analytics,{})
 assert.deepEqual(merged.metrics,{})
})
test('suspect live history cannot silently fall back to a clean older stored history',async()=>{
 const old=globalThis.fetch
 try {
  globalThis.fetch=async (input)=>String(input).startsWith('https:')
   ?new Response(JSON.stringify({data:[{date:'02-01-2020',nav:'10'},{date:'01-01-2020',nav:'100'}]}))
   :new Response(JSON.stringify({d:points.map(p=>p.date),v:points.map(p=>p.nav)}))
  await assert.rejects(fetchNavHistory(99999901),NavQualityError)
 }finally{globalThis.fetch=old}
})
test('stored anomalous history rejected when live API is unavailable',async()=>{
 const old=globalThis.fetch
 try {
  globalThis.fetch=async(input)=>String(input).startsWith('https:')?new Response('',{status:503}):new Response(JSON.stringify({d:['2020-01-01','2020-01-02'],v:[100,10]}))
  await assert.rejects(fetchNavHistory(99999902),NavQualityError)
 }finally{globalThis.fetch=old}
})

test('sticky published quarantine blocks even a clean live response before any request',async(t)=>{
 const held=(fundsJson as {funds:Fund[]}).funds.find(f=>f.dataQuality?.status==='quarantined')
 if(!held){t.skip('no published hold in the current data');return}
 const old=globalThis.fetch; let calls=0
 try {
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({data:points.map(p=>({date:p.date.split('-').reverse().join('-'),nav:String(p.nav)})).reverse()}))}
  await assert.rejects(fetchNavHistory(held.code),NavQualityError)
  assert.equal(calls,0)
 }finally{globalThis.fetch=old}
})

test('a verified unit split puts the live source history in today\'s units',async()=>{
 const split=(corrections as {splits:{code:number,factor:number,firstNewDate:string}[]}).splits.find(s=>s.code===120304)!
 assert.equal(split.factor,10)
 const raw=[{date:'2026-06-18',nav:4588.2967},{date:'2026-06-19',nav:4589.1243},{date:'2026-06-20',nav:458.9915},{date:'2026-06-21',nav:459.0706}]
 assert.match(navQualityIssue(raw)!,/50%/)
 const fixed=correctSourceNav(120304,raw)
 assert.deepEqual(fixed.map(p=>p.nav),[458.8297,458.9124,458.9915,459.0706])
 assert.equal(navQualityIssue(fixed),null)
 assert.equal(correctSourceNav(119551,raw),raw,'other funds are untouched')
 assert.equal(raw[0].nav,4588.2967,'input is not mutated')
 const old=globalThis.fetch
 try {
  globalThis.fetch=async(input)=>String(input).startsWith('https://api.mfapi.in/mf/120304')
   ?new Response(JSON.stringify({data:raw.map(p=>({date:p.date.split('-').reverse().join('-'),nav:String(p.nav)})).reverse()}))
   :new Response('',{status:404})
  const got=await fetchNavHistory(120304)
  assert.deepEqual(got.map(p=>p.nav),[458.8297,458.9124,458.9915,459.0706])
 }finally{globalThis.fetch=old}
})
