import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Market-regime returns are about 15% of the gzipped fund index, but only the
 * category regime table and a fund's regime comparison read them. This plugin
 * removes analytics.regimes from the bundled index and serves the same data as
 * `virtual:fund-regimes`, which pages import on demand, so first load skips it.
 * src/data/funds.json on disk is untouched; the pipeline still writes regimes there.
 */
export const REGIMES_MODULE = 'virtual:fund-regimes'
const RESOLVED = '\0' + REGIMES_MODULE

type Index = { funds: { code: number; analytics?: { regimes?: unknown[] } }[] }

export function regimesByCode(index: Index): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const f of index.funds) if (f.analytics?.regimes) out[f.code] = f.analytics.regimes
  return out
}

export function withoutRegimes(index: Index): Index {
  return { ...index, funds: index.funds.map((f) => {
    if (!f.analytics || !('regimes' in f.analytics)) return f
    const { regimes: _drop, ...analytics } = f.analytics
    return { ...f, analytics }
  }) }
}

export function splitRegimes(indexUrl: URL) {
  const indexPath = fileURLToPath(indexUrl).replace(/\\/g, '/')
  return {
    name: 'split-fund-regimes',
    enforce: 'pre' as const,
    resolveId(id: string) {
      return id === REGIMES_MODULE ? RESOLVED : undefined
    },
    load(this: { addWatchFile(path: string): void }, id: string) {
      if (id !== RESOLVED) return undefined
      this.addWatchFile(indexPath)
      const index = JSON.parse(readFileSync(indexPath, 'utf-8')) as Index
      return `export default ${JSON.stringify(regimesByCode(index))}`
    },
    transform(code: string, id: string) {
      if (id.split('?')[0].replace(/\\/g, '/') !== indexPath) return undefined
      return { code: JSON.stringify(withoutRegimes(JSON.parse(code) as Index)), map: null }
    },
  }
}
