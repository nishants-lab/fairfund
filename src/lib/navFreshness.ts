/**
 * Client-side hook that determines the latest NAV date available.
 *
 * Strategy (in priority order):
 *   1. When a live NAV is fetched from mfapi.in, the nav.ts module calls
 *      reportLiveNavDate() with the latest date from that response. This is
 *      the freshest source and reflects what the user actually sees on charts.
 *   2. Falls back to the self-hosted _manifest.json (updated by the daily bot).
 *   3. Falls back to data.anchor from funds.json (the static analysis date).
 *
 * The hook re-renders subscribers whenever a fresher date arrives.
 */
import { useState, useEffect, useSyncExternalStore } from 'react'
import { data } from './data'

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'
const manifestUrl = `${BASE.endsWith('/') ? BASE : BASE + '/'}nav/_manifest.json?v=${__DATA_VERSION__}`

// --- Global reactive store for the freshest known NAV date ---
let latestKnown: string = data.anchor
const listeners = new Set<() => void>()

function getSnapshot() {
  return latestKnown
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Local calendar date (matches the pipeline's date.today()), YYYY-MM-DD. */
function localToday(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

function updateDate(iso: string) {
  // Invariant: never advance the displayed NAV date into the future. A liquid
  // fund's AMFI NAV is sometimes forward-dated; it must not move the site date.
  if (iso > localToday()) return
  if (iso > latestKnown) {
    latestKnown = iso
    listeners.forEach((cb) => cb())
  }
}

/**
 * Called by nav.ts whenever a live NAV response comes back from mfapi.in.
 * This ensures the footer always shows the actual freshest date the user's
 * browser has seen, not a stale manifest or anchor.
 */
export function reportLiveNavDate(iso: string) {
  updateDate(iso)
}

// Fetch manifest once on first import (non-blocking)
let manifestFetched = false
function fetchManifest() {
  if (manifestFetched) return
  manifestFetched = true
  fetch(manifestUrl)
    .then((r) => (r.ok ? r.json() : null))
    .then((manifest) => {
      if (!manifest || typeof manifest !== 'object') return
      const dates = Object.values(manifest).filter(
        (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
      )
      if (!dates.length) return
      // Robust: newest date shared by >= MIN_ANCHOR_FUNDS funds and not in the
      // future. Mirrors config.robust_latest_nav_date so a few forward-dated
      // liquid funds cannot move the site's headline date past the market date.
      const today = localToday()
      const counts = new Map<string, number>()
      for (const d of dates) if (d <= today) counts.set(d, (counts.get(d) ?? 0) + 1)
      const MIN_ANCHOR_FUNDS = 20
      let best = ''
      counts.forEach((n, d) => { if (n >= MIN_ANCHOR_FUNDS && d > best) best = d })
      if (!best) counts.forEach((_n, d) => { if (d > best) best = d })
      if (best) updateDate(best)
    })
    .catch(() => {}) // silently fall back
}
fetchManifest()

// --- Public hook ---
export function useNavFreshness(): string {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Format an ISO date string (2026-06-25) to readable form (25 Jun 2026). */
export function fmtNavDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}
