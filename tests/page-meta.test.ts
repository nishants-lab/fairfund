import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// Every routed page sets its own tab title. Explore imported usePageMeta but never called it,
// so the tab kept the previous page's title (a fund's name after "Back to Explore").
test('every routed page calls usePageMeta', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  const routed = [...app.matchAll(/element=\{<(\w+) \/>\}/g)].map((m) => m[1])
  assert.ok(routed.length >= 10, `only ${routed.length} routes found`)
  const missing = routed.filter((name) => !/\busePageMeta\(/.test(readFileSync(`src/pages/${name}.tsx`, 'utf8')))
  assert.deepEqual(missing, [])
})
