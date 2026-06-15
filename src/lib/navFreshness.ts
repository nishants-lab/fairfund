/**
 * Client-side hook that reads the latest NAV date from the self-hosted manifest.
 * The daily-NAV bot updates public/nav/_manifest.json on every successful run,
 * so this always reflects the ACTUAL freshest NAV date — not the stale analysis
 * anchor from funds.json.
 *
 * Falls back to data.anchor if the manifest can't be loaded (offline/error).
 */
import { useState, useEffect } from 'react'
import { data } from './data'

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'
const manifestUrl = `${BASE.endsWith('/') ? BASE : BASE + '/'}nav/_manifest.json`

let cachedDate: string | null = null

export function useNavFreshness(): string {
  const [date, setDate] = useState(cachedDate ?? data.anchor)

  useEffect(() => {
    if (cachedDate) {
      setDate(cachedDate)
      return
    }
    fetch(manifestUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((manifest) => {
        if (!manifest || typeof manifest !== 'object') return
        const dates = Object.values(manifest).filter((d): d is string => typeof d === 'string' && d.length === 10)
        if (!dates.length) return
        dates.sort()
        const latest = dates[dates.length - 1]
        cachedDate = latest
        setDate(latest)
      })
      .catch(() => {}) // silently fall back to anchor
  }, [])

  return date
}

/** Format an ISO date string (2026-06-12) to a readable form (12 Jun 2026). */
export function fmtNavDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}
