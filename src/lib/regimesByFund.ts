import { useEffect, useState } from 'react'
import type { RegimePerf } from '../types'

/** Regime returns by fund code. Split out of the bundled index (build/split-regimes.ts). */
export type RegimesByFund = Record<string, RegimePerf[]>

let pending: Promise<RegimesByFund> | null = null

export function loadRegimesByFund(): Promise<RegimesByFund> {
  pending ??= import('virtual:fund-regimes')
    .then((m) => m.default as RegimesByFund)
    .catch(() => { pending = null; return {} })
  return pending
}

/** Null until the regimes chunk has loaded. */
export function useRegimesByFund(): RegimesByFund | null {
  const [map, setMap] = useState<RegimesByFund | null>(null)
  useEffect(() => {
    let live = true
    loadRegimesByFund().then((m) => { if (live) setMap(m) })
    return () => { live = false }
  }, [])
  return map
}
