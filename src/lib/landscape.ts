import type { Fund } from '../types'

/**
 * Fund size used to scale a Fund Landscape bubble. It reads the bundled index
 * (fund.aum.current), the same value the fund page shows, so a bubble and its
 * tooltip can never disagree with the page they link to. Missing, zero or
 * non-finite sizes return undefined and the chart falls back to a neutral size.
 */
export function landscapeAum(f: Pick<Fund, 'aum'>): number | undefined {
  const a = f.aum?.current
  return typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : undefined
}

/** "₹86 Cr", "₹3.8K Cr", "₹1.2L Cr": the fund page's AUM format. */
export function formatAumCr(a: number): string {
  if (a >= 100000) return `₹${(a / 100000).toFixed(1)}L Cr`
  if (a >= 1000) return `₹${(a / 1000).toFixed(1)}K Cr`
  return `₹${a.toFixed(0)} Cr`
}
