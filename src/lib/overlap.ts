import type { Fund, Holding } from '../types'

export interface SharedHolding {
  name: string
  sector?: string | null
  weights: (number | null)[] // weight in each fund, null if not held
  minWeight: number // min across funds that hold it (used for overlap sum)
}

export interface OverlapResult {
  hasData: boolean[] // per fund: does it have usable stock-level holdings?
  shared: SharedHolding[] // holdings present in >=2 funds, sorted by combined weight
  pairOverlap: number[][] // matrix: pairOverlap[i][j] = overlap % between fund i and j
  topByFund: Holding[][] // each fund's top holdings (for the per-fund columns)
}

function normKey(h: Holding): string {
  return (h.key || h.name || '').toString().trim().toLowerCase()
}

// "Usable" = stock-level disclosure (not a foreign feeder single-line / unresolved).
export function hasUsableHoldings(f: Fund): boolean {
  const cov = f.holdingsMeta?.coverage
  if (!f.holdings || f.holdings.length === 0) return false
  if (cov === 'feeder_unresolved' || cov === 'unresolved' || cov === 'no_disclosure' || cov === 'fof_level') return false
  // a single ~100% line is not real stock-level data
  if (f.holdings.length === 1 && f.holdings[0].pct >= 80) return false
  return true
}

/**
 * Portfolio overlap between two funds = sum over shared securities of
 * min(weightA, weightB). This is the standard "common holdings weight"
 * metric: 0% = no shared names, 100% = identical portfolios.
 */
export function pairOverlapPct(a: Fund, b: Fund): number {
  if (!hasUsableHoldings(a) || !hasUsableHoldings(b)) return 0
  const mapA = new Map<string, number>()
  a.holdings!.forEach((h) => mapA.set(normKey(h), (mapA.get(normKey(h)) || 0) + h.pct))
  let sum = 0
  const seen = new Set<string>()
  b.holdings!.forEach((h) => {
    const k = normKey(h)
    if (seen.has(k)) return
    seen.add(k)
    const wa = mapA.get(k)
    if (wa !== undefined) sum += Math.min(wa, h.pct)
  })
  return sum
}

export function computeOverlap(funds: Fund[]): OverlapResult {
  const hasData = funds.map(hasUsableHoldings)

  // Collect union of holdings by key, tracking display name + sector + per-fund weight.
  const byKey = new Map<string, { name: string; sector?: string | null; weights: (number | null)[] }>()
  funds.forEach((f, i) => {
    if (!hasData[i]) return
    f.holdings!.forEach((h) => {
      const k = normKey(h)
      if (!byKey.has(k)) {
        byKey.set(k, { name: h.name, sector: h.sector, weights: funds.map(() => null) })
      }
      const entry = byKey.get(k)!
      entry.weights[i] = (entry.weights[i] || 0) + h.pct
    })
  })

  const shared: SharedHolding[] = []
  byKey.forEach((v) => {
    const held = v.weights.filter((w) => w !== null) as number[]
    const fundsHolding = v.weights.filter((w) => w !== null).length
    if (fundsHolding >= 2) {
      shared.push({
        name: v.name,
        sector: v.sector,
        weights: v.weights,
        minWeight: Math.min(...held),
      })
    }
  })
  // sort by combined weight across funds (most material shared bets first)
  shared.sort((a, b) => {
    const sa = a.weights.reduce<number>((s, w) => s + (w || 0), 0)
    const sb = b.weights.reduce<number>((s, w) => s + (w || 0), 0)
    return sb - sa
  })

  const n = funds.length
  const pairOverlap: number[][] = Array.from({ length: n }, () => Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ov = pairOverlapPct(funds[i], funds[j])
      pairOverlap[i][j] = ov
      pairOverlap[j][i] = ov
    }
  }

  const topByFund = funds.map((f) => (f.holdings || []).slice(0, 10))

  return { hasData, shared, pairOverlap, topByFund }
}
