import type { NavPoint } from '../types'
import corrections from '../data/nav_corrections.json'

/** Source-verified corrections (src/data/nav_corrections.json), the same file the
 *  pipeline applies to its mfapi fetches. Only for raw source responses: the
 *  self-hosted nav files already hold corrected values.
 *  - split: every NAV dated before firstNewDate is divided by factor.
 *  - point: one published value is replaced by the verified nav, or the day is
 *    dropped when nav is null (wrong value, no correct one exists). */
interface Split { code: number; factor: number; firstNewDate: string }
interface Point { code: number; date: string; nav: number | null }
interface Rules { splits: Split[]; points: Map<string, number | null> }
const RULES = new Map<number, Rules>()
const rules = (code: number) => {
  let r = RULES.get(code)
  if (!r) RULES.set(code, r = { splits: [], points: new Map() })
  return r
}
const file = corrections as { splits: Split[]; points?: Point[] }
for (const s of file.splits) {
  if (!(s.factor > 0) || !s.firstNewDate) continue
  rules(s.code).splits.push(s)
}
for (const p of file.points ?? []) {
  if (!p.date || !(p.nav === null || (Number.isFinite(p.nav) && p.nav > 0))) continue
  rules(p.code).points.set(p.date, p.nav)
}

export function correctSourceNav(code: number, points: NavPoint[]): NavPoint[] {
  const r = RULES.get(code)
  if (!r) return points
  const out: NavPoint[] = []
  for (const p of points) {
    if (r.points.has(p.date)) {
      const nav = r.points.get(p.date)
      if (nav != null) out.push(nav === p.nav ? p : { ...p, nav })
      continue
    }
    let nav = p.nav
    for (const s of r.splits) if (p.date < s.firstNewDate) nav = nav / s.factor
    out.push(nav === p.nav ? p : { ...p, nav: Math.round(nav * 1e4) / 1e4 })
  }
  return out
}
