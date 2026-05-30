import type { NavPoint } from '../types'

// Simple in-memory cache so we don't refetch the same fund repeatedly
const cache = new Map<number, NavPoint[]>()

interface MfApiResponse {
  meta: { scheme_name: string; fund_house: string }
  data: { date: string; nav: string }[]
}

/**
 * Fetch historical NAV from the public mfapi.in endpoint.
 * Returns chronological (oldest -> newest) array of {date, nav}.
 */
export async function fetchNavHistory(code: number): Promise<NavPoint[]> {
  if (cache.has(code)) return cache.get(code)!
  const res = await fetch(`https://api.mfapi.in/mf/${code}`)
  if (!res.ok) throw new Error(`Failed to fetch NAV for ${code}`)
  const json = (await res.json()) as MfApiResponse
  const points: NavPoint[] = json.data
    .map((d) => {
      const [dd, mm, yyyy] = d.date.split('-')
      return { date: `${yyyy}-${mm}-${dd}`, nav: parseFloat(d.nav) }
    })
    .filter((p) => !isNaN(p.nav) && p.nav > 0)
    .reverse() // oldest first
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
