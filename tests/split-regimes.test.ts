import test from 'node:test'
import assert from 'node:assert/strict'
import index from '../src/data/funds.json'
import { regimesByCode, withoutRegimes } from '../build/split-regimes'

type Idx = Parameters<typeof withoutRegimes>[0]
const data = index as unknown as Idx

test('every fund with regimes is in the split map, unchanged', () => {
  const map = regimesByCode(data)
  const withRegimes = data.funds.filter((f) => f.analytics?.regimes)
  assert.ok(withRegimes.length > 500, `only ${withRegimes.length} funds carry regimes`)
  assert.equal(Object.keys(map).length, withRegimes.length)
  for (const f of withRegimes) assert.deepEqual(map[f.code], f.analytics!.regimes)
})

test('the bundled index loses only analytics.regimes', () => {
  const before = JSON.stringify(data)
  const stripped = withoutRegimes(data)
  assert.equal(JSON.stringify(data), before, 'the input index was mutated')
  assert.doesNotMatch(JSON.stringify(stripped), /"regimes"/)
  assert.equal(stripped.funds.length, data.funds.length)
  data.funds.forEach((f, i) => {
    const s = stripped.funds[i] as Record<string, unknown> & { analytics?: Record<string, unknown> }
    const { regimes: _r, ...rest } = (f.analytics ?? {}) as Record<string, unknown>
    if (f.analytics) assert.deepEqual(s.analytics, rest)
    assert.deepEqual({ ...s, analytics: undefined }, { ...f, analytics: undefined })
  })
})
