import type { NavPoint } from '../types'

export function sliceByRange(points: NavPoint[], start: string, end: string): NavPoint[] {
  return points.filter((p) => p.date >= start && p.date <= end)
}

export function normalizeRange(points: NavPoint[], base = 100): NavPoint[] {
  if (points.length === 0) return []
  const startNav = points[0].nav
  return points.map((p) => ({ date: p.date, nav: (p.nav / startNav) * base }))
}
