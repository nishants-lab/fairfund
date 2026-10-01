import type { Fund } from '../types'

export const FUND_CHANGES_KEY = 'fairfund_fund_changes_v1'
export const MAX_TRACKED_FUNDS = 100
const MAX_BYTES = 1_000_000
const MAX_CHANGES = 60
const MAX_HOLDINGS = 30

type HoldingSnapshot = { date: string; coverage: string; items: { name: string; pct: number }[] }
export type FundSnapshot = { cost?: number; managers?: string[]; holdings?: HoldingSnapshot }
export type FundChange = {
  kind: 'cost' | 'managers' | 'holdings'
  before: string
  after: string
  fromDate: string | null
  toDate: string | null
  observedOn: string
}
export type FundReview = {
  reviewedOn: string
  baseline: FundSnapshot
  latest: FundSnapshot
  changes: FundChange[]
}
export type FundChangesState = { version: 1; funds: Record<string, FundReview> }
export const emptyFundChanges = (): FundChangesState => ({ version: 1, funds: {} })

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function cost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}
function snapshotValid(value: unknown): value is FundSnapshot {
  if (!record(value) || Object.keys(value).some(k => !['cost', 'managers', 'holdings'].includes(k))) return false
  if (value.cost !== undefined && !cost(value.cost)) return false
  if (value.managers !== undefined && (!Array.isArray(value.managers) || !value.managers.length || value.managers.length > 20 || !value.managers.every(v => text(v)))) return false
  if (value.holdings !== undefined) {
    const h = value.holdings
    if (!record(h) || !date(h.date) || !text(h.coverage) || !Array.isArray(h.items) || !h.items.length || h.items.length > MAX_HOLDINGS) return false
    if (!h.items.every(v => record(v) && text(v.name) && cost(v.pct))) return false
  }
  return true
}
function stateValid(value: unknown): value is FundChangesState {
  if (!record(value) || value.version !== 1 || !record(value.funds) || Object.keys(value.funds).length > MAX_TRACKED_FUNDS) return false
  return Object.entries(value.funds).every(([code, entry]) => {
    if (!/^[1-9]\d{0,8}$/.test(code) || !record(entry) || !date(entry.reviewedOn) || !snapshotValid(entry.baseline) || !snapshotValid(entry.latest)) return false
    if (!Array.isArray(entry.changes) || entry.changes.length > MAX_CHANGES) return false
    return entry.changes.every(c => record(c) && typeof c.kind === 'string' && ['cost', 'managers', 'holdings'].includes(c.kind)
      && text(c.before, 10000) && text(c.after, 10000) && date(c.observedOn)
      && (c.kind === 'holdings'
        ? date(c.fromDate) && date(c.toDate) && c.toDate > c.fromDate
        : c.fromDate === null && c.toDate === null))
  })
}

export function readFundChanges(storage: Pick<Storage, 'getItem'>): { state: FundChangesState; error?: string } {
  try {
    const raw = storage.getItem(FUND_CHANGES_KEY)
    if (raw === null) return { state: emptyFundChanges() }
    if (raw.length > MAX_BYTES) throw new Error('size')
    const parsed: unknown = JSON.parse(raw)
    if (!stateValid(parsed)) throw new Error('schema')
    return { state: parsed }
  } catch {
    return { state: emptyFundChanges(), error: 'Saved review history could not be read. It has not been overwritten. Changes cannot be tracked until browser storage is available or this history is reset.' }
  }
}

export function writeFundChanges(storage: Pick<Storage, 'setItem'>, state: FundChangesState): string | undefined {
  try {
    const raw = JSON.stringify(state)
    if (!stateValid(state) || raw.length > MAX_BYTES) return 'Review history reached its storage limit. Mark reviewed to clear observations before tracking more changes.'
    storage.setItem(FUND_CHANGES_KEY, raw)
    return undefined
  } catch {
    return 'Review history could not be saved in this browser. This visit has not been saved; previous review history is unchanged.'
  }
}

export function snapshotFund(fund: Fund): FundSnapshot {
  const result: FundSnapshot = {}
  if (cost(fund.expenseRatio)) result.cost = fund.expenseRatio
  if (fund.isDebt || fund.isArbitrage) return result
  const managers = fund.management?.managers
  if (fund.management?.available && Array.isArray(managers) && managers.length > 0 && managers.length <= 20 && managers.every(m => text(m?.name))) {
    result.managers = [...new Set(managers.map(m => m.name.trim()))].sort()
  }
  const meta = fund.holdingsMeta
  const holdings = fund.holdings
  if (date(meta?.portfolioDate) && ['stock_level', 'lookthrough_domestic', 'fof_level'].includes(meta?.coverage ?? '')
    && Array.isArray(holdings) && holdings.length > 0 && holdings.length <= 2000
    && holdings.every(h => text(h?.name) && cost(h?.pct))) {
    result.holdings = {
      date: meta!.portfolioDate!, coverage: meta!.coverage,
      items: [...holdings].sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name)).slice(0, MAX_HOLDINGS)
        .map(h => ({ name: h.name.trim(), pct: h.pct })).sort((a, b) => a.name.localeCompare(b.name)),
    }
  }
  return result
}

function describe(value: FundSnapshot, kind: FundChange['kind']): string {
  if (kind === 'cost') return `${value.cost!.toFixed(2)}%`
  if (kind === 'managers') return value.managers!.join(', ')
  return value.holdings!.items.map(h => `${h.name} ${h.pct.toFixed(2)}%`).join('; ')
}

export function observeFundChanges(previous: FundChangesState, snapshots: Record<string, FundSnapshot>, savedCodes: number[], observedOn: string): FundChangesState {
  if (!date(observedOn)) throw new Error('Invalid observation date')
  const codes = [...new Set(savedCodes)].filter(c => Number.isSafeInteger(c) && c > 0 && c < 1e9)
  if (codes.length > MAX_TRACKED_FUNDS) throw new Error(`Change tracking supports up to ${MAX_TRACKED_FUNDS} saved funds.`)
  const next = emptyFundChanges()
  for (const code of codes) {
    const key = String(code)
    const incoming = snapshots[key]
    const old = previous.funds[key]
    if (!incoming || !snapshotValid(incoming)) {
      if (old) next.funds[key] = old
      continue
    }
    if (!old) {
      next.funds[key] = { reviewedOn: observedOn, baseline: incoming, latest: incoming, changes: [] }
      continue
    }
    const entry: FundReview = { ...old, baseline: { ...old.baseline }, latest: { ...old.latest }, changes: [...old.changes] }
    for (const kind of ['cost', 'managers', 'holdings'] as const) {
      if (incoming[kind] === undefined) continue
      if (kind === 'holdings' && entry.latest.holdings) {
        if (incoming.holdings!.date <= entry.latest.holdings.date || incoming.holdings!.coverage !== entry.latest.holdings.coverage) continue
      }
      if (entry.latest[kind] !== undefined && describe(entry.latest, kind) !== describe(incoming, kind)) {
        if (entry.changes.length >= MAX_CHANGES) throw new Error('Unreviewed history is full. Mark reviewed before tracking further changes.')
        entry.changes.push({ kind, before: describe(entry.latest, kind), after: describe(incoming, kind),
          fromDate: kind === 'holdings' ? entry.latest.holdings!.date : null,
          toDate: kind === 'holdings' ? incoming.holdings!.date : null, observedOn })
      }
      if (entry.baseline[kind] === undefined) Object.assign(entry.baseline, { [kind]: incoming[kind] })
      Object.assign(entry.latest, { [kind]: incoming[kind] })
    }
    next.funds[key] = entry
  }
  return next
}

export function markFundReviewed(state: FundChangesState, code: number, reviewedOn: string): FundChangesState {
  const entry = state.funds[String(code)]
  if (!entry || !date(reviewedOn)) return state
  return { ...state, funds: { ...state.funds, [code]: { reviewedOn, baseline: entry.latest, latest: entry.latest, changes: [] } } }
}
