import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPARISON_LIMITS, SAVED_COMPARISONS_KEY, deleteComparison, loadComparison, parseSavedComparisons, readSavedComparisons, saveComparison, summarizeMaterialDifferences, validateComparison } from '../src/lib/savedComparisons'
import { computeMetrics } from '../src/lib/metrics'

const draft = { name: 'Core funds', note: 'Check overlap', fundCodes: [100, 200], start: '2020-01-01', end: '2021-01-01' }
function memory(raw: string | null = null) {
  return { raw, writes: 0,
    getItem(key: string) { assert.equal(key, SAVED_COMPARISONS_KEY); return this.raw },
    setItem(key: string, value: string) { assert.equal(key, SAVED_COMPARISONS_KEY); this.raw = value; this.writes++ },
  }
}
function saved(storage = memory()) {
  const result = saveComparison(draft, storage)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return { storage, record: result.data[0] }
}
function metric(rate = .03) {
  const points = Array.from({ length: 400 }, (_, i) => ({ date: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), nav: 100 + i * rate }))
  const result = computeMetrics(points)
  assert(result)
  return result
}

test('save, read, load and delete preserve exact funds, dates, private note and version', () => {
  const { storage, record } = saved()
  assert.equal(JSON.parse(storage.raw!).version, 1)
  assert.deepEqual(loadComparison(record.id, storage), { ok: true, data: record })
  assert.deepEqual(record.fundCodes, draft.fundCodes)
  assert.equal(record.note, draft.note)
  assert.equal(record.start, draft.start)
  assert.equal(record.end, draft.end)
  assert.equal(new Date(record.savedAt).toISOString(), record.savedAt)
  assert.deepEqual(deleteComparison(record.id, storage), { ok: true, data: [] })
  assert.equal(loadComparison(record.id, storage).ok, false)
  assert.equal(deleteComparison(record.id, storage).ok, false)
})

test('dates, fund selection and text limits are validated before writing', () => {
  for (const patch of [
    { name: '' }, { name: ' ' }, { name: 'a'.repeat(81) }, { note: 'a'.repeat(1001) }, { note: null },
    { fundCodes: [] }, { fundCodes: [1] }, { fundCodes: [1, 1] }, { fundCodes: [1, 0] }, { fundCodes: [1, -1] },
    { fundCodes: [1, 2.5] }, { fundCodes: [1, Number.MAX_SAFE_INTEGER + 1] }, { fundCodes: [1, '2'] }, { fundCodes: [1, 2, 3, 4, 5, 6] },
    { start: '2020-02-30' }, { end: '2021-02-29' }, { start: '01-01-2020' }, { start: draft.end }, { start: '2022-01-01' }, { end: '9999-01-01' },
  ]) {
    const storage = memory()
    assert(validateComparison({ ...draft, ...patch }), JSON.stringify(patch))
    assert.equal(saveComparison({ ...draft, ...patch } as any, storage).ok, false)
    assert.equal(storage.writes, 0)
  }
  assert.equal(validateComparison({ ...draft, start: '2020-02-29', name: 'a'.repeat(80), note: 'a'.repeat(1000) }), null)
})

test('malformed, oversized and unsupported stored schemas fail closed without overwriting', () => {
  const { record } = saved()
  for (const raw of ['', '{', 'null', '[]', 'x'.repeat(COMPARISON_LIMITS.storageChars + 1),
    ...[
      { version: 2, records: [] }, { version: 1, records: {}, }, { version: 1, records: [], extra: true },
      { version: 1, records: [record, record] }, { version: 1, records: [{ ...record, savedAt: '2020-02-30T00:00:00.000Z' }] },
      { version: 1, records: [{ ...record, id: '' }] }, { version: 1, records: [{ ...record, secret: 'no' }] },
      { version: 1, records: [{ ...record, fundCodes: [1] }] },
    ].map(value => JSON.stringify(value)),
  ]) {
    const storage = memory(raw)
    assert.equal(readSavedComparisons(storage).ok, false)
    assert.equal(saveComparison(draft, storage).ok, false)
    assert.equal(deleteComparison(record.id, storage).ok, false)
    assert.equal(storage.raw, raw)
    assert.equal(storage.writes, 0)
  }
  assert.deepEqual(parseSavedComparisons(null), { ok: true, data: [] })
})

test('denied reads and quota writes give failures and preserve prior records', () => {
  const denied = { getItem() { throw new Error('denied') }, setItem() { assert.fail('must not write') } }
  assert.equal(readSavedComparisons(denied).ok, false)
  assert.equal(saveComparison(draft, denied).ok, false)
  const { storage, record } = saved()
  const before = storage.raw
  storage.setItem = () => { throw new Error('quota') }
  const result = saveComparison({ ...draft, name: 'Second' }, storage)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /not saved/)
  assert.equal(deleteComparison(record.id, storage).ok, false)
  assert.equal(storage.raw, before)
})

test('unique names and bounded records never silently replace or evict a saved comparison', () => {
  const { storage } = saved()
  assert.equal(saveComparison({ ...draft, name: ' CORE FUNDS ' }, storage).ok, false)
  for (let i = 1; i < COMPARISON_LIMITS.records; i++) assert.equal(saveComparison({ ...draft, name: `Comparison ${i}` }, storage).ok, true)
  const before = storage.raw
  assert.equal(saveComparison({ ...draft, name: 'Overflow' }, storage).ok, false)
  assert.equal(storage.raw, before)
  const data = JSON.parse(before!)
  data.records.push({ ...data.records[0], id: 'extra', name: 'extra' })
  assert.equal(parseSavedComparisons(JSON.stringify(data)).ok, false)
})

test('reads current storage for each mutation rather than overwriting other-tab changes', () => {
  const { storage, record } = saved()
  assert.equal(saveComparison({ ...draft, name: 'Other tab' }, storage).ok, true)
  const deleted = deleteComparison(record.id, storage)
  assert(deleted.ok)
  assert.deepEqual(deleted.data.map(row => row.name), ['Other tab'])
})

test('plain text remains plain data, and helper never invokes the network', () => {
  const oldFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('must not send comparison contents') }
  try {
    const storage = memory()
    const result = saveComparison({ ...draft, name: '<img src=x>', note: '<script>alert(1)</script>' }, storage)
    assert(result.ok)
    assert.equal(result.data[0].note, '<script>alert(1)</script>')
  } finally { globalThis.fetch = oldFetch }
})

test('summary compares exact actual dates and reports descriptive bps gaps without winners', () => {
  const first = metric(), second = metric(.07)
  const result = summarizeMaterialDifferences([first, second])
  assert.equal(result.warning, null)
  assert.deepEqual(result.period, { start: first.startDate, end: first.endDate })
  assert.match(result.differences.join(' '), /Annualized return.*bps gap/)
  assert.doesNotMatch(result.differences.join(' '), /winner|best|buy|outperform/)
  assert.match(result.basis, /not statistical significance/)
})

test('mismatched actual starts or ends, missing dates and unavailable metrics withhold every summary', () => {
  const first = metric()
  for (const rows of [[], [first], [first, null], [first, undefined],
    [first, { ...first, startDate: '2020-01-02' }], [first, { ...first, endDate: '2021-01-01' }],
    [first, { ...first, startDate: '' }], [first, { ...first, endDate: '9999-01-01' }],
    [first, { ...first, cagr: NaN }], [first, { ...first, volatility: Infinity }],
  ]) {
    const result = summarizeMaterialDifferences(rows)
    assert(result.warning)
    assert.equal(result.period, null)
    assert.deepEqual(result.differences, [])
  }
})

test('summary thresholds are inclusive, do not round subthreshold gaps up, and ties are not winners', () => {
  const first = { ...metric(), cagr: 10, volatility: 12, maxDrawdown: -15 }
  assert.deepEqual(summarizeMaterialDifferences([first, first]).differences, [])
  assert.deepEqual(summarizeMaterialDifferences([first, { ...first, cagr: 10.999, volatility: 12.499, maxDrawdown: -15.999 }]).differences, [])
  const result = summarizeMaterialDifferences([first, { ...first, cagr: 11, volatility: 12.5, maxDrawdown: -16 }])
  assert.equal(result.differences.length, 3)
  assert.match(result.differences[2], /15.00% to 16.00%, a 100 bps gap/)
})

test('short actual periods use total return rather than extrapolated annualized return', () => {
  const first = { ...metric(), endDate: '2020-02-01', totalReturn: 1, cagr: 100 }
  const result = summarizeMaterialDifferences([first, { ...first, totalReturn: 2, cagr: -100 }])
  assert.equal(result.differences.length, 1)
  assert.match(result.differences[0], /^Total return/)
})
