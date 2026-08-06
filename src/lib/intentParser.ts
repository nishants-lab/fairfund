/**
 * Client-side intent parser for natural language search queries.
 * Detects structured intents (compare, explore category, methodology)
 * and returns a navigation target. Falls through to null for regular search.
 */
import { funds, categoryOrder, searchFunds } from './data'
import { fundSlug } from './format'
import type { Fund } from '../types'

export interface Intent {
  type: 'navigate'
  path: string
  label: string // human description shown in dropdown
}

// Normalized category names for matching
const CATEGORY_ALIASES: Record<string, string> = {}
categoryOrder.forEach((cat) => {
  const k = cat.toLowerCase().replace(/[^a-z0-9]/g, '')
  CATEGORY_ALIASES[k] = cat
})
// Extra aliases people might type
const EXTRA_ALIASES: Record<string, string> = {
  'largecap': 'Large Cap',
  'midcap': 'Mid Cap',
  'smallcap': 'Small Cap',
  'flexicap': 'Flexi Cap',
  'multicap': 'Multi Cap',
  'largenmidcap': 'Large & Mid Cap',
  'largemidcap': 'Large & Mid Cap',
  'valuecontra': 'Value/Contra',
  'value': 'Value/Contra',
  'contra': 'Value/Contra',
  'elss': 'ELSS',
  'taxsaver': 'ELSS',
  'tax saver': 'ELSS',
  'thematic': 'Sectoral/Thematic',
  'sectoral': 'Sectoral/Thematic',
  'sector': 'Sectoral/Thematic',
  'international': 'International',
  'global': 'International',
  'focused': 'Focused',
  'dividend': 'Dividend Yield',
  'dividendyield': 'Dividend Yield',
  'index': 'Index Funds',
  'indexfund': 'Index Funds',
  'indexfunds': 'Index Funds',
}

function matchCategory(text: string): string | null {
  const t = text.toLowerCase().trim()
  // Direct match against aliases
  const norm = t.replace(/[^a-z0-9]/g, '')
  if (EXTRA_ALIASES[norm]) return EXTRA_ALIASES[norm]
  if (CATEGORY_ALIASES[norm]) return CATEGORY_ALIASES[norm]
  // Partial match
  for (const [alias, cat] of Object.entries(EXTRA_ALIASES)) {
    if (t.includes(alias) || alias.includes(norm)) return cat
  }
  for (const cat of categoryOrder) {
    if (cat.toLowerCase().includes(t) || t.includes(cat.toLowerCase())) return cat
  }
  return null
}

function matchFund(text: string): Fund | null {
  const results = searchFunds(text, 5)
  if (results.length === 0) return null
  const q = text.toLowerCase().trim()
  const tokens = q.split(/\s+/)

  // Score each candidate by how tightly the query covers the fund name
  let best: Fund | null = null
  let bestScore = 0
  for (const fund of results) {
    const name = fund.name.toLowerCase()
    const matched = tokens.filter((t) => name.includes(t))
    const coverage = matched.length / tokens.length
    if (coverage < 0.6) continue
    // Prefer funds where query tokens cover a larger fraction of the name words
    const nameWords = name.split(/[\s\-]+/).filter(w => w.length > 1)
    const nameHit = nameWords.filter((w) => tokens.some((t) => w.includes(t) || t.includes(w)))
    const tightness = nameHit.length / nameWords.length
    const score = coverage + tightness * 0.5
    if (score > bestScore) {
      bestScore = score
      best = fund
    }
  }
  return best
}

export function parseIntent(query: string): Intent | null {
  const q = query.trim()
  if (q.length < 3) return null
  const lower = q.toLowerCase()

  // --- Compare intent: "compare X and/vs/with Y" or "X vs Y" ---
  const comparePatterns = [
    /^compare\s+(.+?)\s+(?:and|vs\.?|with|versus)\s+(.+)$/i,
    /^(.+?)\s+vs\.?\s+(.+)$/i,
    /^(.+?)\s+versus\s+(.+)$/i,
  ]
  for (const pat of comparePatterns) {
    const m = lower.match(pat)
    if (m) {
      const fundA = matchFund(m[1])
      const fundB = matchFund(m[2])
      if (fundA && fundB) {
        const slugA = `${fundA.code}/${fundSlug(fundA.name)}`
        const slugB = `${fundB.code}/${fundSlug(fundB.name)}`
        return {
          type: 'navigate',
          path: `/compare?funds=${slugA},${slugB}`,
          label: `Compare ${fundA.name.split(' -')[0]} vs ${fundB.name.split(' -')[0]}`,
        }
      }
      // If only one matches, still go to compare with one pre-filled
      if (fundA) {
        return {
          type: 'navigate',
          path: `/compare?funds=${fundA.code}/${fundSlug(fundA.name)}`,
          label: `Compare ${fundA.name.split(' -')[0]} with another fund`,
        }
      }
    }
  }

  // --- Category explore intent: "best/top [category]", "[category] funds" ---
  const categoryPatterns = [
    /^(?:best|top|highest|show|list|find)\s+(.+?)(?:\s+funds?)?$/i,
    /^(.+?)\s+(?:funds?|schemes?)$/i,
    /^(?:show|browse|explore|find)\s+(.+)$/i,
  ]
  for (const pat of categoryPatterns) {
    const m = lower.match(pat)
    if (m) {
      const cat = matchCategory(m[1])
      if (cat) {
        return {
          type: 'navigate',
          path: `/explore?cat=${encodeURIComponent(cat)}`,
          label: `Explore ${cat} funds (ranked)`,
        }
      }
    }
  }
  // Bare category name
  const bareCat = matchCategory(lower.replace(/\s*funds?\s*$/i, ''))
  if (bareCat) {
    return {
      type: 'navigate',
      path: `/explore?cat=${encodeURIComponent(bareCat)}`,
      label: `Explore ${bareCat} funds`,
    }
  }

  // --- Methodology / help intent ---
  if (/^(?:how does|how do|methodology|how it works|how this works|explain|what is)/i.test(lower)) {
    return {
      type: 'navigate',
      path: '/methodology',
      label: 'How FairFund works (methodology)',
    }
  }

  // --- Wishlist intent ---
  if (/^(?:my funds|wishlist|saved|bookmarks?|watchlist)/i.test(lower)) {
    return {
      type: 'navigate',
      path: '/wishlist',
      label: 'Your saved funds (wishlist)',
    }
  }

  // --- Compare page (bare) ---
  if (/^compare\s*$/i.test(lower) || /^compare funds$/i.test(lower)) {
    return {
      type: 'navigate',
      path: '/compare',
      label: 'Compare funds side by side',
    }
  }

  return null
}
