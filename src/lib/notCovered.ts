/** Fund types and questions FairFund does not cover, with the line shown for each. Shared by the
 * Movers question box and fund search, so the two never word it differently. */
export const NOT_COVERED: [string, string][] = [
  ['hybrid|hybrids|balanced|balanced advantage|baf|dynamic asset allocation|multi asset|multi asset allocation|aggressive hybrid|conservative hybrid|equity savings', 'Hybrid funds are not part of FairFund yet.'],
  ['gold|silver|precious metals', 'Gold and silver funds are not part of FairFund yet.'],
  ['gilt|corporate bond|credit risk|overnight|dynamic bond|short duration|ultra short|low duration|medium duration|long duration|banking and psu debt|banking and psu fund|banking and psu funds|floater|bond|bonds|g sec|gsec|target maturity', 'Only liquid and money market funds are covered on the debt side.'],
  ['etf|etfs|exchange traded', 'ETFs are not part of FairFund; index funds are.'],
  ['ulip|ulips|nps|ppf|fixed deposit|fd|fds|insurance|crypto|bitcoin|pms|aif', 'FairFund covers mutual funds only.'],
  ['direct plan|direct plans|regular plan|regular plans|direct|regular|idcw|dividend option|dividend payout|growth option|growth plan|payout|reinvestment', 'FairFund tracks the direct growth plan of each fund; figures here are for that plan.'],
  ['fund of funds|fof|fofs', 'Funds of funds that invest abroad are listed under International; other funds of funds are not covered.'],
  ['nav|navs|price|nav change', 'Movers works with month-end size, flows, costs, ranks and returns; for a fund\'s NAV open its page.'],
  ['exit load|exit loads|lock in|lockin|sip|sips|minimum investment|min sip|lumpsum', 'Exit loads and investment minimums are on each fund\'s page.'],
]

// Search uses the fund-type lines only: plan and option words ("direct"), funds of funds, NAV and
// exit-load questions all name funds FairFund does cover. Results are narrowed for types that have
// no fund here, so "hdfc balanced advantage" no longer lists HDFC equity funds; an ETF query keeps
// its results, because the index fund on the same index is the useful answer.
const SEARCH_TYPES: { words: string[]; note: string; narrow: boolean }[] = NOT_COVERED
  .filter(([words]) => /^(hybrid|gold|gilt|etf|ulip)\|/.test(words))
  .map(([words, note]) => ({ words: words.split('|'), note, narrow: !words.startsWith('etf|') }))

export interface SearchCoverage {
  note: string
  /** Drop results whose name does not mention the type (true for every type but ETFs). */
  narrow: boolean
  /** Whether a normalized fund name mentions the type the query asked about. */
  mentions: (normalizedName: string) => boolean
}

/** The not-covered line for a search, from an already normalized query (normalizeSearch). */
export function searchCoverage(normalizedQuery: string): SearchCoverage | null {
  const q = ` ${normalizedQuery} `
  for (const t of SEARCH_TYPES) {
    const hits = t.words.filter((w) => q.includes(` ${w} `))
    if (!hits.length) continue
    return { note: t.note, narrow: t.narrow, mentions: (name) => hits.some((w) => ` ${name} `.includes(` ${w} `)) }
  }
  return null
}

/**
 * Apply coverage to fund search results. A type FairFund leaves out gets one line saying so, and
 * matches on the fund house alone are dropped rather than shown as if they were the answer. No line
 * when a listed fund carries the type in its name (an ETF fund of funds for "nasdaq etf").
 * `normalize` is normalizeSearch, passed in so this module stays free of the search code.
 */
export function applyCoverage<T extends { name: string }>(query: string, found: T[], normalize: (s: string) => string): { results: T[]; note: string | null } {
  const coverage = searchCoverage(normalize(query))
  if (!coverage) return { results: found, note: null }
  const named = found.filter((f) => coverage.mentions(normalize(f.name)))
  return { results: coverage.narrow ? named : found, note: named.length === 0 ? coverage.note : null }
}
