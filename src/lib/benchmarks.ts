import benchmarksJson from '../data/benchmarks.json'

/** A passive index fund whose NAV stands in for the SEBI category benchmark
 *  index (there is no free daily raw-index feed matching our NAV pipeline). */
export interface BenchmarkProxy {
  code: number
  index: string // display name of the underlying index, e.g. "Nifty 100 TRI"
  proxy: string // the index fund used as the stand-in
  note?: string // caveat shown in Methodology when the proxy is approximate
}

interface BenchmarksData {
  categoryBenchmark: Record<string, BenchmarkProxy>
  medianCategories: Record<string, string>
}

const B = benchmarksJson as unknown as BenchmarksData

/** Benchmark-index proxy for an equity category, or null if none is defined
 *  (sectoral/thematic, international, index funds, and cash-like categories). */
export function benchmarkForCategory(category: string): BenchmarkProxy | null {
  return B.categoryBenchmark[category] ?? null
}

/** File key for a category's precomputed median series (public/category-median/{key}.json),
 *  defined only for cash-like categories (Liquid, Money Market, Arbitrage). */
export function medianKeyForCategory(category: string): string | null {
  return B.medianCategories[category] ?? null
}
