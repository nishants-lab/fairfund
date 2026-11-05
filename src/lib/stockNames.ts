import names from '../data/stock_names.json'

/** Stock display names: the same rules as scripts/research-pages.mjs, reading the
 *  same file (src/data/stock_names.json). Keyed by the source holding key's slug.
 *  Portfolio moves carry only a source name, so a slug is built from the name with
 *  its registry suffix removed, 'limited' read as 'ltd', and `aliases` mapping an
 *  old registry spelling to the current key. */
interface StockNames {
  renames: Record<string, { name: string; formerly: string }>
  display: Record<string, string>
  aliases?: Record<string, string>
}
const N = names as unknown as StockNames
const SMALL = new Set(['and', 'of', 'the', 'for', 'in', 'on'])

export const stockSlug = (key: string) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

/** A raw registry string: an 'EQ'/'Equity' suffix, a face-value note, or all capitals. */
export function isRawStockName(name: string): boolean {
  const s = String(name)
  return /\s(EQ|Equity)\b|\bFV\s*RS|\/-/.test(s) || (s === s.toUpperCase() && /[A-Z]{4}/.test(s) && /\s/.test(s))
}

const stripSuffix = (name: string) => name.replace(/\s+(EQ|Equity)\b.*$/, '').trim()

const slugTitle = (slug: string) => slug.split('-').filter(Boolean)
  .map((w, i) => i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)).join(' ')

const known = (slug: string) => slug in N.renames || slug in N.display

function resolveSlug(key: string | null | undefined, sourceName: string): string {
  const base = stockSlug(key || stripSuffix(sourceName))
  const short = base.replace(/-limited$/, '-ltd')
  for (const s of [base, short]) {
    if (known(s)) return s
    const a = N.aliases?.[s]
    if (a) return a
  }
  return short
}

export function displayStockName(key: string | null | undefined, sourceName: string): string {
  const name = String(sourceName ?? '').trim()
  const slug = resolveSlug(key, name)
  if (slug && N.renames[slug]) return N.renames[slug].name
  if (slug && N.display[slug]) return N.display[slug]
  if (!isRawStockName(name)) return name
  if (/^[a-z][a-z-]*[a-z]$/.test(slug) && /-ltd$/.test(slug)) return slugTitle(slug)
  return stripSuffix(name)
}

/** The earlier name of a renamed company, when verified. */
export const formerStockName = (key: string | null | undefined, sourceName = '') =>
  N.renames[resolveSlug(key, sourceName)]?.formerly
