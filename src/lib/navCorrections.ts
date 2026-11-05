import type { NavPoint } from '../types'
import corrections from '../data/nav_corrections.json'

/** Source-verified unit splits (src/data/nav_corrections.json), the same file the
 *  pipeline applies to its mfapi fetches. Only for raw source responses: the
 *  self-hosted nav files already hold corrected values. */
interface Split { code: number; factor: number; firstNewDate: string }
const SPLITS = new Map<number, Split[]>()
for (const s of (corrections as { splits: Split[] }).splits) {
  if (!(s.factor > 0) || !s.firstNewDate) continue
  SPLITS.set(s.code, [...(SPLITS.get(s.code) ?? []), s])
}

export function correctSourceNav(code: number, points: NavPoint[]): NavPoint[] {
  const rules = SPLITS.get(code)
  if (!rules) return points
  return points.map(p => {
    let nav = p.nav
    for (const r of rules) if (p.date < r.firstNewDate) nav = nav / r.factor
    return nav === p.nav ? p : { ...p, nav: Math.round(nav * 1e4) / 1e4 }
  })
}
