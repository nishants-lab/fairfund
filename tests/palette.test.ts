import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const script = readFileSync('public/palette.js', 'utf8')
function boot(random: number, previous?: string, blocked = false, dark = false) {
  const values: Record<string, string> = {}
  const root = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => values[k] = v }, classList: { toggle: (_: string, next: boolean) => { root.dark = next } }, dark: false }
  const storage = { getItem: () => { if (blocked) throw Error('denied'); return previous }, setItem: () => { if (blocked) throw Error('denied') } }
  const context = { document: { documentElement: root }, Math: { random: () => random, floor: Math.floor, round: Math.round, abs: Math.abs }, sessionStorage: storage, localStorage: { ...storage, getItem: () => { if (blocked) throw Error('denied'); return null } }, window: { matchMedia: () => ({ matches: dark }) } }
  runInNewContext(script, context)
  return { root, values, context }
}
function luminance(rgb: number[]) { return rgb.map(c => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }).reduce((a,v,i) => a + v * [.2126,.7152,.0722][i], 0) }
function contrast(a: string, b: string) { const x = luminance(a.split(' ').map(Number)), y = luminance(b.split(' ').map(Number)); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
for (let i = 0; i < 6; i++) test(`palette ${i}: all body text and actions meet AA in both modes`, () => {
  const {values:v} = boot((i + .1)/6)
  for (const mode of ['light','dark']) for (const fg of ['fg','muted','faint']) for (const bg of ['canvas','surface','surface2','wash']) {
    const ratio = contrast(v[`--palette-${mode}-${fg}`],v[`--palette-${mode}-${bg}`])
    assert(ratio >= 4.5, `${i} ${mode} ${fg}/${bg}: ${ratio}`)
  }
  assert(contrast('255 255 255',v['--brand-600']) >= 4.5)
  assert(contrast(v['--brand-700'],v['--palette-light-wash']) >= 4.5)
  assert(contrast(v['--brand-300'],v['--palette-dark-wash']) >= 4.5)
})
test('selection is random, excludes last palette and initializes once per document', () => {
  const names = Array.from({length:6},(_,i) => boot((i+.1)/6).root.dataset.palette)
  assert.equal(new Set(names).size,6)
  for (const previous of names) for (const n of [0,.2,.5,.99]) assert.notEqual(boot(n,previous).root.dataset.palette,previous)
  const first = boot(.2); const before = JSON.stringify(first.values); runInNewContext(script,first.context); assert.equal(JSON.stringify(first.values),before)
})
test('storage denial preserves rendering and system dark preference', () => {
  const result = boot(.6,undefined,true,true); assert(result.root.dataset.palette); assert.equal(result.root.dark,true)
})
