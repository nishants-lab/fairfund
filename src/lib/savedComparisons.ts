import { isIsoDate, istToday } from './marketDate'
import type { ComputedMetrics } from './metrics'

export const SAVED_COMPARISONS_KEY = 'fairfund_saved_comparisons'
export const COMPARISON_LIMITS = { records: 20, funds: 5, name: 80, note: 1000, storageChars: 64000 } as const

export interface ComparisonDraft {
  name: string
  note: string
  fundCodes: number[]
  start: string
  end: string
}
export interface SavedComparison extends ComparisonDraft {
  id: string
  savedAt: string
}
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>
export type ComparisonResult<T> = { ok: true; data: T } | { ok: false; error: string }
const fail = (error: string): ComparisonResult<never> => ({ ok: false, error })
const success = <T,>(data: T): ComparisonResult<T> => ({ ok: true, data })
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function validateComparison(value: unknown): string | null {
  if (!object(value)) return 'This comparison is not valid.'
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > COMPARISON_LIMITS.name)
    return `Enter a comparison name of up to ${COMPARISON_LIMITS.name} characters.`
  if (typeof value.note !== 'string' || value.note.length > COMPARISON_LIMITS.note)
    return `Keep the private note within ${COMPARISON_LIMITS.note} characters.`
  if (!Array.isArray(value.fundCodes) || value.fundCodes.length < 2 || value.fundCodes.length > COMPARISON_LIMITS.funds ||
    value.fundCodes.some(code => !Number.isSafeInteger(code) || code <= 0) || new Set(value.fundCodes).size !== value.fundCodes.length)
    return 'Choose between 2 and 5 different funds.'
  if (!isIsoDate(value.start) || !isIsoDate(value.end) || value.start >= value.end)
    return 'Choose valid dates with the start before the end.'
  if (value.end > istToday()) return 'The comparison end date cannot be in the future.'
  return null
}

export function parseSavedComparisons(raw: string | null): ComparisonResult<SavedComparison[]> {
  if (raw === null) return success([])
  const invalid = 'Saved comparisons could not be read. Existing browser data has not been changed.'
  if (raw.length > COMPARISON_LIMITS.storageChars) return fail(invalid)
  let data: unknown
  try { data = JSON.parse(raw) } catch { return fail(invalid) }
  if (!object(data) || data.version !== 1 || !Array.isArray(data.records) || data.records.length > COMPARISON_LIMITS.records ||
    Object.keys(data).some(key => !['version', 'records'].includes(key))) return fail(invalid)
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const row of data.records) {
    if (!object(row) || validateComparison(row) || typeof row.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(row.id) ||
      typeof row.savedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.savedAt) ||
      !Number.isFinite(Date.parse(row.savedAt)) || new Date(row.savedAt).toISOString() !== row.savedAt ||
      Object.keys(row).some(key => !['id', 'savedAt', 'name', 'note', 'fundCodes', 'start', 'end'].includes(key))) return fail(invalid)
    const name = (row.name as string).trim().toLowerCase()
    if (ids.has(row.id) || names.has(name)) return fail(invalid)
    ids.add(row.id)
    names.add(name)
  }
  return success(data.records as unknown as SavedComparison[])
}

export function readSavedComparisons(storage?: StorageAccess): ComparisonResult<SavedComparison[]> {
  try { return parseSavedComparisons((storage ?? window.localStorage).getItem(SAVED_COMPARISONS_KEY)) }
  catch { return fail('Browser storage is unavailable. Saved comparisons cannot be read or changed.') }
}

function writeComparisons(records: SavedComparison[], storage?: StorageAccess): ComparisonResult<SavedComparison[]> {
  const raw = JSON.stringify({ version: 1, records })
  const checked = parseSavedComparisons(raw)
  if (!checked.ok) return checked
  try { (storage ?? window.localStorage).setItem(SAVED_COMPARISONS_KEY, raw) }
  catch { return fail('Changes were not saved. Browser storage may be full or blocked. Existing saved comparisons were kept.') }
  return success(records)
}

export function saveComparison(draft: ComparisonDraft, storage?: StorageAccess): ComparisonResult<SavedComparison[]> {
  const invalid = validateComparison(draft)
  if (invalid) return fail(invalid)
  const current = readSavedComparisons(storage)
  if (!current.ok) return current
  if (current.data.length >= COMPARISON_LIMITS.records) return fail(`You can save up to ${COMPARISON_LIMITS.records} comparisons. Delete one before saving another.`)
  const name = draft.name.trim()
  if (current.data.some(row => row.name.trim().toLowerCase() === name.toLowerCase())) return fail('That comparison name is already saved. Choose a different name.')
  const record: SavedComparison = {
    id: crypto.randomUUID(), savedAt: new Date().toISOString(), name, note: draft.note,
    fundCodes: [...draft.fundCodes], start: draft.start, end: draft.end,
  }
  return writeComparisons([record, ...current.data], storage)
}

export function loadComparison(id: string, storage?: StorageAccess): ComparisonResult<SavedComparison> {
  const current = readSavedComparisons(storage)
  if (!current.ok) return current
  const record = current.data.find(row => row.id === id)
  return record ? success(record) : fail('This saved comparison is no longer available. Refresh the list.')
}

export function deleteComparison(id: string, storage?: StorageAccess): ComparisonResult<SavedComparison[]> {
  const current = readSavedComparisons(storage)
  if (!current.ok) return current
  if (!current.data.some(row => row.id === id)) return fail('This saved comparison is no longer available. Refresh the list.')
  return writeComparisons(current.data.filter(row => row.id !== id), storage)
}

export interface MaterialDifferenceSummary {
  warning: string | null
  period: { start: string; end: string } | null
  differences: string[]
  basis: string
}

export function summarizeMaterialDifferences(metrics: (ComputedMetrics | null | undefined)[]): MaterialDifferenceSummary {
  const result: MaterialDifferenceSummary = {
    warning: null, period: null, differences: [],
    basis: 'Descriptive gaps of at least 100 bps for returns or largest falls, and 50 bps for volatility. These thresholds are not statistical significance or a recommendation.',
  }
  const unavailable = (warning: string) => ({ ...result, warning })
  if (metrics.length < 2) return unavailable('Choose at least two funds to compare differences.')
  if (metrics.some(m => !m)) return unavailable('Differences are unavailable until every fund has calculated metrics for the selected period.')
  const rows = metrics as ComputedMetrics[]
  const first = rows[0]
  if (rows.some(m => !isIsoDate(m.startDate) || !isIsoDate(m.endDate) || m.startDate >= m.endDate || m.endDate > istToday()))
    return unavailable('Differences are unavailable because actual metric dates are missing or invalid.')
  if (rows.some(m => m.startDate !== first.startDate || m.endDate !== first.endDate))
    return unavailable('Actual metric dates differ between funds. No material-difference summary is shown. Choose a period with matching observations.')
  const annualized = (Date.parse(first.endDate) - Date.parse(first.startDate)) / 86400000 >= 365.25
  const fields = [
    { label: annualized ? 'Annualized return' : 'Total return', key: annualized ? 'cagr' : 'totalReturn', threshold: 100 },
    { label: 'Volatility', key: 'volatility', threshold: 50 },
    { label: 'Largest fall', key: 'maxDrawdown', threshold: 100 },
  ] as const
  if (rows.some(m => fields.some(field => typeof m[field.key] !== 'number' || !Number.isFinite(m[field.key]))))
    return unavailable('Differences are unavailable because one or more calculated metrics are missing.')
  result.period = { start: first.startDate, end: first.endDate }
  for (const field of fields) {
    const values = rows.map(m => field.key === 'maxDrawdown' ? Math.abs(m[field.key]) : m[field.key])
    const low = Math.min(...values), high = Math.max(...values)
    const gapBps = (high - low) * 100
    if (gapBps + 1e-8 >= field.threshold)
      result.differences.push(`${field.label} ranges from ${low.toFixed(2)}% to ${high.toFixed(2)}%, a ${Math.round(gapBps)} bps gap.`)
  }
  return result
}
