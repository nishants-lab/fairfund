import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeEdition, validConsistency } from '../src/lib/edition'
import type { Fund, FundsData } from '../src/types'

function fund(code: number, cagr = 10): Fund {
 return { code, name: `Fund ${code}`, fullName: `Fund ${code}`, amc: 'Example', category: 'Flexi Cap', categoryDisplay: 'Flexi Cap', riskLevel: 'High', categorySize: 3,
 metrics: { '3Y': { cagr, maxDrawdown: -12, catRank: code, catSize: 3 }, '5Y': { cagr } },
 analytics: { battingAverage: { pct: 70, n: 42, windowM: 36, limited: false }, alpha: { confidence: code * 10, n: 50 } } } as Fund
}
const fixture = (funds: Fund[]): FundsData => ({ funds, totalFunds: funds.length, anchor: '2024-03-28', generatedAt: '2024-03-29', methodology: '', categories: { 'Flexi Cap': { display: 'Flexi Cap', fundCount: funds.length, riskLevel: 'High', medianCagr5Y: 10, topCagr5Y: 12 } } })

test('edition is deterministic, does not mutate data and formats return differences in bps', () => {
 const input=fixture([fund(1,10),fund(2,12),fund(3,11)])
 const before=JSON.stringify(input)
 const a=makeEdition(17,input)
 assert.deepEqual(a,makeEdition(17,input))
 assert.equal(JSON.stringify(input),before)
 assert.equal(a.facts.find(f=>f.label==='3-year return range')?.value,'200 bps')
 assert.equal(a.facts.find(f=>f.label==='Rolling 3-year comparison')?.value,'70%')
 assert.match(a.facts.find(f=>f.label==='Rolling 3-year comparison')!.explanation,/return history is shared/)
 assert.deepEqual(a.leaders.map(f=>f.code),[1])
})
test('next edition avoids repeating the previous spotlight where alternatives exist', () => {
 const input=fixture([fund(1),fund(2)])
 const prior=makeEdition(10,input).spotlight!.code
 assert.notEqual(makeEdition(10,input,prior).spotlight!.code,prior)
})
test('selection does not depend on legacy confidence, returns need not be positive', () => {
 const input=fixture([fund(1,-5),fund(2,-4)])
 const selected=makeEdition(8,input).spotlight!.code
 input.funds.forEach(f=>f.analytics!.alpha!.confidence=99)
 assert.equal(makeEdition(8,input).spotlight!.code,selected)
})
test('missing data has no manufactured spotlight, leaders, or financial facts', () => {
 const input=fixture([])
 const result=makeEdition(0,input)
 assert.equal(result.spotlight,null); assert.deepEqual(result.facts,[]); assert.deepEqual(result.leaders,[])
})
test('reduced/young funds are excluded from equity spotlight and nonfinite returns are ignored', () => {
 const bad=fund(1,Infinity);const young={...fund(2),isYoung:true};const debt={...fund(3),isDebt:true};const arb={...fund(4),isArbitrage:true}
 assert.equal(makeEdition(0,fixture([bad,young,debt,arb])).spotlight,null)
})
test('consistency validates range, count and rolling period rather than mislabelling', () => {
 for(const override of [{pct:NaN},{pct:101},{pct:-1},{n:0},{n:1.5},{windowM:12}]) {
  const f=fund(1);Object.assign(f.analytics!.battingAverage!,override);assert.equal(validConsistency(f),null)
 }
})
test('all seed variants retain factual wording and valid local destinations', () => {
 const input=fixture([fund(1),fund(2)])
 for(let seed=0;seed<100;seed++) {
  const e=makeEdition(seed,input)
  assert.doesNotMatch(JSON.stringify(e.facts),/skill|luck|same dates|stored CAGR|prediction/i)
  for(const fact of e.facts) assert.match(fact.to,/^\/(fund\/\d+\/|explore\?cat=)/)
 }
})

test('homepage facts omit internal coverage counts and do not promote reduced-surface return outliers', () => {
 const input=fixture([fund(1,10),fund(2,12),{...fund(3,99),isDebt:true}])
 for(let seed=0;seed<20;seed++) {
  const facts=makeEdition(seed,input).facts
  assert.equal(facts.length,2)
  assert.equal(facts.find(f=>f.label==='3-year return range')?.value,'200 bps')
  assert.ok(facts.every(f=>f.explanation.length>0))
  assert.ok(facts.every(f=>!f.label.includes('coverage')))
 }
})
test('limited-history warning stays visible when the rolling explanation moves to a tooltip', () => {
 const f=fund(1); f.analytics!.battingAverage!.limited=true
 const fact=makeEdition(1,fixture([f])).facts.find(f=>f.label==='Rolling 3-year comparison')!
 assert.equal(fact.note,'Limited history.')
 assert.match(fact.explanation,/42 measured periods/)
})
