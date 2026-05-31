import type { NavPoint } from '../types'

// Simple in-memory cache so we don't refetch the same fund repeatedly
const cache = new Map<number, NavPoint[]>()

interface MfApiResponse {
  meta: { scheme_name: string; fund_house: string }
  data: { date: string; nav: string }[]
}

// Self-hosted compact NAV format: {"d":[ISO...],"v":[num...],"u":"latest"}
interface SelfHostedNav {
  d: string[]
  v: number[]
  u?: string
}

const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'
function selfHostedUrl(code: number): string {
  const b = BASE.endsWith('/') ? BASE : BASE + '/'
  return `${b}nav/${code}.json`
}

const LIVE_TIMEOUT_MS = 4000

function withTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t))
}

function parseLive(json: MfApiResponse): NavPoint[] {
  return json.data
    .map((d) => {
      const [dd, mm, yyyy] = d.date.split('-')
      return { date: `${yyyy}-${mm}-${dd}`, nav: parseFloat(d.nav) }
    })
    .filter((p) => !isNaN(p.nav) && p.nav > 0)
    .reverse() // oldest first
}

function parseSelfHosted(j: SelfHostedNav): NavPoint[] | null {
  if (!j || !Array.isArray(j.d) || !Array.isArray(j.v) || j.d.length !== j.v.length || j.d.length === 0) {
    return null
  }
  return j.d.map((date, i) => ({ date, nav: j.v[i] }))
}

/**
 * Fetch historical NAV. Strategy per requirement: LIVE FIRST, cache fallback.
 *   1. Live mfapi.in (fresh data) - with a 4s timeout so a slow/down API never
 *      hangs the page.
 *   2. Self-hosted same-origin file (./nav/{code}.json) - ALWAYS available on
 *      GitHub Pages, so the page is never blank even if mfapi is down/CORS-blocked.
 * Returns chronological (oldest -> newest) array of {date, nav}.
 */
export async function fetchNavHistory(code: number): Promise<NavPoint[]> {
  if (cache.has(code)) return cache.get(code)!

  // 1) LIVE first (freshest), bounded by timeout
  try {
    const res = await withTimeout(`https://api.mfapi.in/mf/${code}`, LIVE_TIMEOUT_MS)
    if (res.ok) {
      const json = (await res.json()) as MfApiResponse
      const points = parseLive(json)
      if (points.length > 0) {
        cache.set(code, points)
        return points
      }
    }
  } catch {
    // network error / timeout / CORS - fall through to self-hosted
  }

  // 2) Self-hosted cache fallback (same origin, rock solid)
  const res = await fetch(selfHostedUrl(code))
  if (!res.ok) throw new Error(`No NAV available for ${code}`)
  const j = (await res.json()) as SelfHostedNav
  const points = parseSelfHosted(j)
  if (!points) throw new Error(`Invalid self-hosted NAV for ${code}`)
  cache.set(code, points)
  return points
}

/** Filter NAV history to a horizon (in years from latest point). */
export function sliceByYears(points: NavPoint[], years: number): NavPoint[] {
  if (points.length === 0) return []
  const latest = new Date(points[points.length - 1].date)
  const cutoff = new Date(latest)
  cutoff.setFullYear(cutoff.getFullYear() - years)
  return points.filter((p) => new Date(p.date) >= cutoff)
}

/** Normalize a NAV series to start at 100 (for fair comparison overlays). */
export function normalizeToBase(points: NavPoint[], base = 100): NavPoint[] {
  if (points.length === 0) return []
  const start = points[0].nav
  return points.map((p) => ({ date: p.date, nav: (p.nav / start) * base }))
}

/** Compute a drawdown series (% from running peak) from NAV points. */
export function drawdownSeries(points: NavPoint[]): { date: string; dd: number }[] {
  let peak = -Infinity
  return points.map((p) => {
    peak = Math.max(peak, p.nav)
    return { date: p.date, dd: ((p.nav - peak) / peak) * 100 }
  })
}
