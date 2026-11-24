/** A page opened before a deploy must recover when its next page's code file is gone, and never loop. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { isStaleChunkError, reloadForNewDeploy, reloadOnNewWorker, withChunkReload } from '../src/lib/staleChunk'

function store() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

test('stale chunk errors from each browser are recognised; others are not', () => {
  assert.ok(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/Movers-CV8KJiGJ.js')))   // Chromium
  assert.ok(isStaleChunkError(new TypeError('Importing a module script failed.')))                                              // Safari
  assert.ok(isStaleChunkError(new TypeError('error loading dynamically imported module: https://x/a.js')))                      // Firefox
  assert.ok(isStaleChunkError(new Error('Unable to preload CSS for /assets/a.css')))
  assert.ok(!isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'x')")))
  assert.ok(!isStaleChunkError(null))
})

test('reload at most once a minute per tab', () => {
  const s = store(); let reloads = 0; const r = () => { reloads++ }
  assert.equal(reloadForNewDeploy(1_000_000, s, r), true)
  assert.equal(reloadForNewDeploy(1_030_000, s, r), false)       // the reload itself failed to help: show the error
  assert.equal(reloadForNewDeploy(1_061_000, s, r), true)        // a later deploy gets its own reload
  assert.equal(reloads, 2)
  assert.equal(reloadForNewDeploy(1_000_000, null, r), false)    // no storage, no reload: cannot guard a loop
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
  assert.equal(reloadForNewDeploy(1_000_000, broken, r), false)
  assert.equal(reloads, 2)
})

test('withChunkReload: stale chunk reloads and holds; other errors and a spent reload pass through', async () => {
  const ok = await withChunkReload(async () => 7, () => assert.fail('no reload on success'))()
  assert.equal(ok, 7)
  let asked = 0
  const held = withChunkReload(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: a.js')), () => { asked++; return true })()
  const settled = await Promise.race([held.then(() => 'settled', () => 'settled'), new Promise(r => setTimeout(() => r('pending'), 30))])
  assert.equal(settled, 'pending')
  assert.equal(asked, 1)
  await assert.rejects(withChunkReload(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: a.js')), () => false)(), /dynamically imported/)
  await assert.rejects(withChunkReload(() => Promise.reject(new RangeError('bad')), () => assert.fail('not a chunk error'))(), /bad/)
})

function worker(controller: object | null) {
  const fns: Array<() => void> = []
  return { controller: controller as ServiceWorker | null, addEventListener: (type: string, fn: () => void) => { if (type === 'controllerchange') fns.push(fn) }, fire: () => fns.forEach(f => f()) }
}

test('a returning tab reloads once when the new build takes over', () => {
  const sw = worker({}); let reloads = 0
  assert.equal(reloadOnNewWorker(sw, () => { reloads++ }), true)
  sw.fire(); sw.fire()
  assert.equal(reloads, 1)
})

test('a first visit does not reload when the first worker installs', () => {
  const sw = worker(null); let reloads = 0
  assert.equal(reloadOnNewWorker(sw, () => { reloads++ }), false)
  sw.fire()
  assert.equal(reloads, 0)
  assert.equal(reloadOnNewWorker(undefined, () => { reloads++ }), false)
})
