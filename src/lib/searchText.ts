/**
 * Text normalisation and alias data for fund search.
 *
 * People type fund names the way they remember them: "smallcap" or "small cap",
 * "nifty50", "PPFAS", "ABSL", an AMC's old name (IDFC, L&T, Principal) or a fund's
 * old name ("Axis Bluechip", "Kotak Emerging Equity"). Queries and fund names go
 * through the same normaliser so spelling variants meet in the middle.
 */
import formerNamesJson from '../data/former_names.json'

const CAP_JOIN: [RegExp, string][] = [
  [/\bsmall cap\b/g, 'smallcap'],
  [/\bmid cap\b/g, 'midcap'],
  [/\blarge cap\b/g, 'largecap'],
  [/\bflexi cap\b/g, 'flexicap'],
  [/\bmulti cap\b/g, 'multicap'],
  [/\bmicro cap\b/g, 'microcap'],
  [/\bblue chip\b/g, 'bluechip'],
]

/** Lowercase, "&" -> "and", L&T -> "lnt", letters split from digits, cap words joined. */
export function normalizeSearch(s: string): string {
  let t = (s || '').toLowerCase()
  t = t.replace(/\bl\s*&\s*t\b/g, ' lnt ').replace(/\bl and t\b/g, ' lnt ')
  t = t.replace(/&/g, ' and ')
  t = t.replace(/[^a-z0-9]+/g, ' ')
  t = t.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
  t = t.replace(/\s+/g, ' ').trim()
  for (const [re, rep] of CAP_JOIN) t = t.replace(re, rep)
  return t
}

/**
 * Other names an AMC is searched by: its abbreviation, or the AMC it used to be.
 * Matched on the normalised start of the fund name, never on the free-text amc
 * field (which is derived from the name and is not reliable).
 */
const AMC_ALIASES: [string, string][] = [
  ['parag parikh', 'ppfas'],
  ['aditya birla sun life', 'absl birla'],
  ['bandhan', 'idfc'],
  ['hsbc', 'lnt'],
  ['sundaram', 'principal'],
  ['groww', 'indiabulls'],
  ['dsp', 'blackrock'],
  ['baroda bnp paribas', 'bnp baroda pioneer'],
  ['360 one', 'iifl'],
  ['icici prudential', 'ipru'],
  ['nippon india', 'reliance'],
  ['motilal oswal', 'mosl'],
  ['navi', 'essel'],
  ['mahindra manulife', 'mahindra'],
]

export function amcAliases(normalizedName: string): string {
  const out: string[] = []
  for (const [prefix, alias] of AMC_ALIASES) {
    if (normalizedName === prefix || normalizedName.startsWith(prefix + ' ')) out.push(alias)
  }
  return out.join(' ')
}

/** Other names each fund is known by, keyed by AMFI code (scripts/build_former_names.py). */
const FORMER = formerNamesJson as Record<string, string[]>

export function otherNames(code: number): string[] {
  return FORMER[String(code)] ?? []
}

/** Words that say nothing about which fund it is, ignored when judging fit. */
export const FILLER = new Set(['fund', 'funds', 'direct', 'plan', 'growth', 'option', 'scheme', 'the', 'of', 'and', 'index'])

/**
 * Words that turn one index into a different one. "Nifty 50 Equal Weight" and
 * "Nifty Next 50" are not "Nifty 50", so a name carrying one the query lacks is
 * ranked below names that do not.
 */
export const MODIFIERS = new Set(['equal', 'weight', 'next', 'momentum', 'quality', 'value', 'low',
  'volatility', 'alpha', 'midcap', 'smallcap', 'microcap', 'largemidcap', 'top', 'enhanced'])

/** Query words that mean the person is looking for an index fund. */
const INDEX_WORDS = new Set(['index', 'nifty', 'sensex', 'bse', 'etf', 'passive', 'equal', 'weight',
  'momentum', 'quality', 'alpha', 'volatility', 'low', 'next', '20', '30', '50', '100', '150', '200', '250', '500'])

export function wantsIndex(tokens: string[]): boolean {
  return tokens.some((t) => INDEX_WORDS.has(t))
}
