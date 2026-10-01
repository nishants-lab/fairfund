import {test} from "node:test"
import assert from "node:assert/strict"
import {execFileSync} from "node:child_process"
import {computeMetrics} from "../src/lib/metrics"
import type {NavPoint} from "../src/types"

function history(returns: number[]): NavPoint[] {
  let nav=100
  const start=Date.UTC(2020,0,1)
  return [{date:"2020-01-01",nav},...returns.map((r,i)=>({date:new Date(start+(i+1)*86400000).toISOString().slice(0,10),nav:(nav*=1+r)}))]
}
const fixtures=[
 {name:"mixed returns",returns:Array.from({length:100},(_,i)=>[.006,-.003,.002,-.001,.004][i%5])},
 {name:"no downside observations",returns:Array(100).fill(.001)},
 {name:"one downside observation",returns:Array.from({length:100},(_,i)=>i===20?-.01:.001)},
 {name:"constant NAV",returns:Array(100).fill(0)},
]
for(const fixture of fixtures)test(`Sortino cross-language: ${fixture.name}`,()=>{
 const points=history(fixture.returns),actual=computeMetrics(points)!
 const code="import json,sys;sys.path.insert(0,\"pipeline\");from compute_metrics import compute_metrics;print(json.dumps(compute_metrics(json.load(sys.stdin))))"
 const py=process.env.FF_PYTHON||"python"
 const producer=JSON.parse(execFileSync(py,["-c",code],{input:JSON.stringify(points.map(p=>[p.date,p.nav])),encoding:"utf8"}))
 if(fixture.name==="no downside observations") {assert.equal(actual.sortino,null);assert.equal(producer.sortino,null);return}
 const rf=.07/252
 const variance=fixture.returns.reduce((sum,r)=>sum+Math.min(r-rf,0)**2,0)/fixture.returns.length
 const expected=(actual.cagr/100-.07)/Math.sqrt(variance*252)
 assert(Math.abs(actual.sortino!-expected)<1e-9)
 assert(Math.abs(actual.sortino!-producer.sortino)<=.0051)
})
