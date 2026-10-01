import { useEffect, useState } from 'react'
import type { Fund } from '../types'
import { fetchFundDetail, mergeFundDetail } from '../lib/data'
import {
  FUND_CHANGES_KEY, MAX_TRACKED_FUNDS, emptyFundChanges, markFundReviewed,
  observeFundChanges, readFundChanges, snapshotFund, writeFundChanges,
} from '../lib/fundChanges'
import type { FundChangesState, FundSnapshot } from '../lib/fundChanges'

const today = () => new Date().toISOString().slice(0, 10)
const labels = { cost: 'Expense ratio', managers: 'Reported managers', holdings: 'Disclosed holdings' }

export default function FundChanges({ funds, savedCodes }: { funds: Fund[]; savedCodes: number[] }) {
  const [state, setState] = useState<FundChangesState>(emptyFundChanges)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [unavailable, setUnavailable] = useState(0)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === FUND_CHANGES_KEY || event.key === null) setRevision(v => v + 1)
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    async function load() {
      try {
        const initial = readFundChanges(window.localStorage)
        if (!active) return
        setState(initial.state)
        if (initial.error) { setError(initial.error); return }
        if (savedCodes.length > MAX_TRACKED_FUNDS) {
          setError(`Change tracking supports up to ${MAX_TRACKED_FUNDS} saved funds. Your wishlist is unchanged.`)
          return
        }
        const snapshots: Record<string, FundSnapshot> = {}
        let missing = savedCodes.length - funds.length
        // Limit concurrent detail requests; reuse the app's cached, pure hydration path.
        for (let i = 0; i < funds.length; i += 5) {
          await Promise.all(funds.slice(i, i + 5).map(async fund => {
            const detail = await fetchFundDetail(fund.code)
            if (!detail || typeof detail !== 'object' || Array.isArray(detail) || !Object.keys(detail).length) {
              missing++
              return
            }
            const snapshot = snapshotFund(mergeFundDetail(fund, detail))
            // Holdings and managers require detail disclosure; cost uses the canonical merged index.
            if (!detail.management) delete snapshot.managers
            if (!detail.holdings || !detail.holdingsMeta) delete snapshot.holdings
            snapshots[fund.code] = snapshot
          }))
          if (!active) return
        }
        const stored = readFundChanges(window.localStorage)
        if (stored.error) { setError(stored.error); return }
        setState(stored.state)
        setUnavailable(missing)
        const next = observeFundChanges(stored.state, snapshots, savedCodes, today())
        const failure = JSON.stringify(next) === JSON.stringify(stored.state)
          ? undefined : writeFundChanges(window.localStorage, next)
        setState(next)
        setError(failure)
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Review history is unavailable in this browser.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [funds, savedCodes, revision])

  function review(code: number) {
    try {
      const stored = readFundChanges(window.localStorage)
      if (stored.error) { setError(stored.error); return }
      const next = markFundReviewed(stored.state, code, today())
      const failure = writeFundChanges(window.localStorage, next)
      if (failure) { setError(failure); return }
      setState(next)
      setError(undefined)
      setRevision(v => v + 1)
    } catch {
      setError('Could not mark reviewed. Previous review history is unchanged.')
    }
  }

  return (
    <section aria-labelledby="fund-changes-title" className="mt-6 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <h2 id="fund-changes-title" className="text-lg font-semibold text-fg">Since your last review</h2>
      <p className="mt-1 text-sm text-muted">
        A baseline is saved on your first visit. Later observations remain here until you mark the fund reviewed.
        History stays in this browser. No notifications are sent.
      </p>
      <p className="mt-2 text-xs text-muted">
        Holdings use portfolio report dates and compare up to 30 disclosed positions, which may be an incomplete list.
        List changes do not establish purchases or sales. Cost and manager source dates are unavailable;
        those observations cannot establish when a change took effect or whether an undated source is newer.
        Observation and review dates are UTC. Missing data is not treated as a change.
      </p>
      {loading && <p role="status" className="mt-3 text-sm text-muted">Loading saved-fund details…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {!loading && unavailable > 0 && <p role="status" className="mt-3 text-sm text-muted">
        Details unavailable for {unavailable} saved fund{unavailable === 1 ? '' : 's'}. Their earlier observations are retained; no new comparison was made.
      </p>}
      {!loading && !error && funds.length === 0 && <p className="mt-3 text-sm text-muted">Save a fund to begin tracking observations.</p>}
      <ul className="mt-4 space-y-4">
        {funds.map(fund => {
          const entry = state.funds[String(fund.code)]
          if (!entry) return null
          return <li key={fund.code} className="border-t border-line pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-sm font-semibold text-fg">{fund.name}</h3>
                <p className="mt-1 text-xs text-muted">Baseline / last reviewed: <time dateTime={entry.reviewedOn}>{entry.reviewedOn}</time></p>
              </div>
              {entry.changes.length > 0 && <button type="button" disabled={loading} onClick={() => review(fund.code)}
                aria-label={`Mark ${fund.name} reviewed`}
                className="min-h-11 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-fg hover:bg-surface2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50">
                Mark reviewed
              </button>}
            </div>
            {entry.changes.length === 0 ? <p className="mt-2 text-sm text-muted">No comparable changes recorded. Some source data may be missing or undated.</p>
              : <ul className="mt-3 space-y-3">{entry.changes.map((change, index) => <li key={index} className="rounded-lg bg-surface2 p-3 text-sm">
                <p className="font-medium text-fg">{labels[change.kind]}</p>
                <p className="mt-1 text-xs text-muted">{change.toDate
                  ? `Portfolio reports: ${change.fromDate} to ${change.toDate}`
                  : 'Source date unavailable'} · Observed {change.observedOn}</p>
                {change.kind === 'holdings' ? <details className="mt-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-fg">View disclosed-list comparison</summary>
                  <p className="break-words text-muted">Earlier list: {change.before}</p>
                  <p className="mt-2 break-words text-fg">Later list: {change.after}</p>
                </details> : <p className="mt-2 break-words text-fg">{change.before} → {change.after}</p>}
              </li>)}</ul>}
          </li>
        })}
      </ul>
    </section>
  )
}
