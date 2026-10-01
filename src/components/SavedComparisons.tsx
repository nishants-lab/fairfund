import { useEffect, useId, useState } from 'react'
import {
  COMPARISON_LIMITS, SAVED_COMPARISONS_KEY, deleteComparison, loadComparison,
  readSavedComparisons, saveComparison, type SavedComparison,
} from '../lib/savedComparisons'

interface Props {
  fundCodes: number[]
  start: string
  end: string
  onLoad: (comparison: SavedComparison) => string | void
}

export default function SavedComparisons({ fundCodes, start, end, onLoad }: Props) {
  const id = useId()
  const [records, setRecords] = useState<SavedComparison[]>([])
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  function refresh() {
    const result = readSavedComparisons()
    setRecords(result.ok ? result.data : [])
    setError(result.ok ? '' : result.error)
    setMessage('')
  }
  useEffect(() => {
    refresh()
    const handler = (event: StorageEvent) => {
      if (event.key === SAVED_COMPARISONS_KEY || event.key === null) refresh()
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  function save() {
    setMessage('')
    const result = saveComparison({ name, note, fundCodes, start, end })
    setError(result.ok ? '' : result.error)
    if (result.ok) {
      setRecords(result.data)
      setMessage('Comparison saved in this browser.')
      setName('')
      setNote('')
    }
  }
  function load(id: string) {
    setMessage('')
    const result = loadComparison(id)
    if (!result.ok) { setError(result.error); return }
    const issue = onLoad(result.data)
    if (issue) { setError(issue); return }
    setError('')
    setName(result.data.name)
    setNote(result.data.note)
    setMessage('Saved funds and dates loaded. Metrics are recalculated from available data.')
  }
  function remove(id: string) {
    setMessage('')
    const result = deleteComparison(id)
    setError(result.ok ? '' : result.error)
    if (result.ok) { setRecords(result.data); setMessage('Saved comparison deleted from this browser.') }
  }

  return (
    <section className="card p-4" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="font-semibold text-fg">Saved comparisons</h2>
      <p className="mt-1 text-xs text-muted">Names, dates and private notes stay in this browser. They are not encrypted. Anyone using this browser profile can read them. Clearing site data removes them.</p>
      <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); save() }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-sm text-muted" htmlFor={`${id}-name`}>Comparison name</label>
            <input id={`${id}-name`} value={name} onChange={event => setName(event.target.value)} maxLength={COMPARISON_LIMITS.name} required className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-fg" />
          </div>
          <div>
            <label className="text-sm text-muted" htmlFor={`${id}-note`}>Private note (optional)</label>
            <textarea id={`${id}-note`} value={note} onChange={event => setNote(event.target.value)} maxLength={COMPARISON_LIMITS.note} rows={2} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-fg" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary text-sm" type="submit">Save comparison</button>
          <span className="text-xs text-muted">{fundCodes.length} funds{start && end ? `, ${start} to ${end}` : ', select dates above'}</span>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{error}</p>}
      <p role="status" className="mt-2 text-sm text-muted">{message}</p>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
        <span>{records.length} of {COMPARISON_LIMITS.records} saved</span>
        <button type="button" className="btn-ghost text-xs" onClick={refresh}>Refresh list</button>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {records.map(record => (
          <li key={record.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-fg">{record.name}</p>
                <p className="text-xs text-muted">{record.fundCodes.length} funds, {record.start} to {record.end}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost text-xs" onClick={() => load(record.id)} aria-label={`Load ${record.name}`}>Load</button>
                <button type="button" className="btn-ghost text-xs" onClick={() => remove(record.id)} aria-label={`Delete ${record.name}`}>Delete</button>
              </div>
            </div>
            {record.note && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted">{record.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}
