/**
 * The Movers question box: plain English in, a MoversState out.
 *
 * No language model. A question is normalised, matched phrase by phrase against a
 * vocabulary (longest phrase first, typos corrected against the same vocabulary),
 * then read left to right: numbers pick up their units, comparators pick up the
 * figure they compare, "not"/"except" negate the next thing named, superlatives
 * set the sort, and whatever is left is tried as part of a fund name. What was
 * understood is returned alongside, so the page can show it and let people fix it.
 */
import { normalizeSearch } from './searchText'
import {
  ADVICE_WORDS, AGG_WORDS, AMC_ALIASES, CATEGORY_WORDS, CMP_WORDS, COUNT_WORDS, FILLER, GENERIC_AMC_WORDS, GROUP_WORDS,
  INDEX_CATEGORY, MANAGER_WORDS, MEASURE_WORDS, MONTHS, NEG_WORDS, NOT_COVERED, NUMBER_WORDS, ORDER_WORDS, RISK_LEVELS, RISK_WORDS,
  STOCK_ALIASES, STOCK_VERBS, STOCK_WORDS, THEMES, THEME_WORDS, TIME_WORDS, TYPE_WORDS, UNIT_WORDS, YOUNG_WORDS,
  type MeasureWord,
} from './moversVocab'
import {
  DEFAULT_MEASURE, FILTER_FIELDS, LOWER_IS_BETTER, VIEW_OF, freshState, structuredCloneState,
  type FilterField, type Measure, type MoversState, type Threshold, type View, type Win,
} from './moversState'

export interface ParseContext {
  categories: string[]
  amcs: string[]
  /** Normalised (normalizeSearch) fund names, for words left over at the end. */
  fundNames: string[]
  stocks: { key: string; name: string; sector: string }[]
  refMonth: string | null
  /** Earliest month with a flow figure. */
  firstMonth?: string | null
  /** Windows, in months, that the data has figures for; history builds month by month. */
  flowWindows?: Win[]
  costWindows?: Win[]
  stockWindows?: Win[]
}

export interface ParseOutput {
  state: MoversState
  notes: string[]
  unknown: string[]
  advice: boolean
  understood: boolean
  singular: boolean
  corrected: [string, string][]
}

// ---- tokens ---------------------------------------------------------------------
/** Lowercase, "&" -> "and", "%" and "₹" as words, digits split from letters, numbers kept whole. */
export function tokenize(text: string): string[] {
  let t = (text || '').toLowerCase()
  t = t.replace(/[\u2018\u2019\u201c\u201d`]/g, "'").replace(/[\u2013\u2014]/g, ' - ')
  t = t.replace(/(\d\s*%?)\s*-\s*(?=\d)/g, '$1 to ')
  t = t.replace(/₹|\brs\.?(?=\s|\d|$)|\binr\b|\brupees?\b/g, ' rs ')
  t = t.replace(/(\d),(?=\d{2,3}\b)/g, '$1').replace(/(\d),(?=\d)/g, '$1')
  t = t.replace(/%/g, ' % ').replace(/&/g, ' and ').replace(/\+/g, ' plus ')
  t = t.replace(/>=|\u2265/g, ' gte ').replace(/<=|\u2264/g, ' lte ').replace(/>/g, ' gt ').replace(/</g, ' lt ')
  t = t.replace(/'s\b/g, '').replace(/'/g, ' ')
  t = t.replace(/(\d)\.(\d)/g, '$1\u0001$2').replace(/(^|[\s(])[-\u2212](?=\d)/g, '$1\u0002')
  t = t.replace(/[^a-z0-9\u0001\u0002%#]+/g, ' ').replace(/\u0001/g, '.').replace(/\u0002/g, '-')
  t = t.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
  return t.split(/\s+/).filter(Boolean).map(w => (w === '#' ? 'number' : w))
}

// ---- phrase table ---------------------------------------------------------------
type Payload =
  | { k: 'measure'; v: MeasureWord } | { k: 'mgr'; v: 'joined' | 'left' | 'any' } | { k: 'order'; v: 'desc' | 'asc' | 'good' | 'bad'; fb?: Measure }
  | { k: 'group'; v: 'category' | 'amc' | 'sector' | 'theme' | 'fund' } | { k: 'category'; v: string[] } | { k: 'amc'; v: string }
  | { k: 'theme'; v: string } | { k: 'type'; v: 'index' | 'active' } | { k: 'young'; v: 'only' | 'exclude' } | { k: 'risk'; v: string[] }
  | { k: 'cmp'; v: 'gt' | 'lt'; inc?: boolean } | { k: 'unit'; v: string } | { k: 'time'; v: { win?: number; horizon?: '1Y' | '3Y' | '5Y'; note?: string } }
  | { k: 'month'; v: number } | { k: 'neg' } | { k: 'count' } | { k: 'agg'; v: 'total' | 'average' } | { k: 'advice' }
  | { k: 'nocover'; v: string } | { k: 'stockword' } | { k: 'verb'; v: 'buy' | 'sell' | 'added' | 'exited' } | { k: 'stock'; v: string }
  | { k: 'between' } | { k: 'and' } | { k: 'since' } | { k: 'pctmode' } | { k: 'fundword'; plural: boolean } | { k: 'age'; v: 'gt' | 'lt' | 'any' }
  | { k: 'num'; v: number } | { k: 'currency' } | { k: 'or' } | { k: 'groupHint'; v: 'category' | 'amc' } | { k: 'noop' }

interface Entry { words: string[]; p: Payload; stockOnly?: boolean; full?: boolean }
interface Item { p: Payload | { k: 'word' }; s: number; e: number; text: string; used?: boolean; full?: boolean }

const STATIC: Entry[] = []
function add(phrases: string, p: Payload, stockOnly = false) {
  for (const ph of phrases.split('|')) {
    const words = tokenize(ph)
    if (words.length) STATIC.push({ words, p, stockOnly })
  }
}
for (const [ph, v] of MEASURE_WORDS) add(ph, { k: 'measure', v })
for (const [ph, v] of MANAGER_WORDS) add(ph, { k: 'mgr', v })
for (const [ph, v, fb] of ORDER_WORDS) add(ph, { k: 'order', v, fb })
for (const [ph, v] of GROUP_WORDS) add(ph, { k: 'group', v })
for (const [ph, v] of CATEGORY_WORDS) add(ph, { k: 'category', v: [v] })
add('debt|debt funds|cash|fixed income|cash like|cash equivalent', { k: 'category', v: ['Liquid', 'Money Market'] })
add('equity|equities|equity funds|equity oriented', { k: 'category', v: ['@equity'] })
for (const [ph, v] of THEME_WORDS) add(ph, { k: 'theme', v })
for (const [ph, v] of TYPE_WORDS) add(ph, { k: 'type', v })
for (const [ph, v] of YOUNG_WORDS) add(ph, { k: 'young', v })
for (const [ph, v] of RISK_WORDS) add(ph, { k: 'risk', v })
for (const [ph, v, inc] of CMP_WORDS) add(ph, { k: 'cmp', v, ...(inc ? { inc } : {}) })
for (const [ph, v] of UNIT_WORDS) add(ph, { k: 'unit', v })
for (const [ph, v] of TIME_WORDS) add(ph, { k: 'time', v })
for (const [ph, v] of MONTHS) add(ph, { k: 'month', v })
for (const [ph, v] of NOT_COVERED) add(ph, { k: 'nocover', v })
for (const [ph, v] of AGG_WORDS) add(ph, { k: 'agg', v })
for (const [ph, v] of STOCK_VERBS) add(ph, { k: 'verb', v })
add(STOCK_WORDS, { k: 'stockword' })
add(NEG_WORDS, { k: 'neg' })
add(COUNT_WORDS, { k: 'count' })
add(ADVICE_WORDS, { k: 'advice' })
add('between|from', { k: 'between' })
add('and|to|till|until|through', { k: 'and' })
add('or|either', { k: 'or' })
add('since|starting|after|beginning', { k: 'since' })
add('as percent of aum|as percentage of aum|as a percentage|percentage terms|in percentage terms|in percent|as percent|relative to size|relative to aum|of aum|percent of aum|share of aum|percentage inflow|percentage growth|growth rate of aum|proportionally|proportionate|relative inflow|relative inflows|in relative terms', { k: 'pctmode' })
add('fund|scheme|mutual fund|plan', { k: 'fundword', plural: false })
add('funds|schemes|mutual funds|plans|options|ones', { k: 'fundword', plural: true })
add('older than|old|older|aged|age|history|track record|in existence|been around|vintage|seasoned for', { k: 'age', v: 'gt' })
add('younger than|newer than|launched within', { k: 'age', v: 'lt' })
add('rs|rupee', { k: 'currency' })
add('category|categories', { k: 'groupHint', v: 'category' })
add('how much', { k: 'agg', v: 'total' })
add('how big|how large', { k: 'measure', v: { m: 'aum', field: true } })
add('investors|investor|people|folks|everyone|retail investors', { k: 'noop' })
add('their category|its category|of their category|in their category|within their category|within category|within categories|their categories|their peers|its peers|their peer group|peer group|peers|in category|in their categories', { k: 'noop' })
add('places|place|spots|spot|notches|rungs', { k: 'unit', v: 'places' })
add('whats new|what is new|summary|overview|highlights|what happened|what changed|whats happening|what is happening|movers|show me everything|show everything|show all|everything', { k: 'noop' })
add('biggest movers|top movers|big movers|biggest moves|largest movers', { k: 'measure', v: { m: 'flow', field: true } })
add('launched in|launched in the|launched over|launched during|started in|incepted in|launched within the|launched in last|launched in the last|started in the last|launched over the last|started within|launched|incepted|started', { k: 'age', v: 'lt' })
for (const [w, n] of Object.entries(NUMBER_WORDS)) add(w, { k: 'num', v: n })

const WORD_VOCAB = new Set<string>()
for (const e of STATIC) for (const w of e.words) if (/^[a-z]{4,}$/.test(w)) WORD_VOCAB.add(w)

// ---- typo correction ------------------------------------------------------------
/** Damerau-Levenshtein distance, cut off above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

function correct(word: string, vocab: Set<string>, protectedWords: Set<string>): string | null {
  if (vocab.has(word) || protectedWords.has(word) || !/^[a-z]{4,}$/.test(word)) return null
  const max = word.length >= 7 ? 2 : 1
  let best: string | null = null, bestD = max + 1, tie = false
  for (const v of vocab) {
    if (v[0] !== word[0] && !(word.length >= 6 && v[1] === word[1])) continue
    const dd = editDistance(word, v, max)
    if (dd < bestD) { best = v; bestD = dd; tie = false } else if (dd === bestD && v !== best) tie = true
  }
  return best && !tie && bestD <= max ? best : null
}

// ---- context-dependent entries (AMCs, stocks) -----------------------------------
interface Built { entries: Map<string, Entry[]>; vocab: Set<string>; protectedWords: Set<string>; fundWords: Set<string>; stockNames: Map<string, string> }
const builtCache = new WeakMap<ParseContext, Built>()

function cleanStockName(name: string): string[] {
  return tokenize(name).filter(w => !['ltd', 'limited', 'the', 'co', 'inc', 'plc', 'corp'].includes(w))
}

function build(ctx: ParseContext): Built {
  const hit = builtCache.get(ctx)
  if (hit) return hit
  const entries: Entry[] = [...STATIC]
  const amcSet = new Set(ctx.amcs)
  for (const [ph, amc] of AMC_ALIASES) if (amcSet.has(amc)) for (const w of ph.split('|')) entries.push({ words: tokenize(w), p: { k: 'amc', v: amc } })
  const firstWords = new Map<string, number>()
  for (const amc of ctx.amcs) { const f = tokenize(amc)[0]; firstWords.set(f, (firstWords.get(f) ?? 0) + 1) }
  for (const amc of ctx.amcs) {
    const words = tokenize(amc)
    if (words.length > 1 || !GENERIC_AMC_WORDS.has(words[0])) entries.push({ words, p: { k: 'amc', v: amc } })
    const f = words[0]
    if (words.length > 1 && firstWords.get(f) === 1 && f.length >= 3 && !GENERIC_AMC_WORDS.has(f)) entries.push({ words: [f], p: { k: 'amc', v: amc } })
  }
  // Stocks: full cleaned names, unique two-word prefixes, unique distinctive first words, aliases.
  const stockNames = new Map<string, string>()
  const firstCount = new Map<string, number>(), twoCount = new Map<string, number>()
  const cleaned = ctx.stocks.map(s => ({ s, w: cleanStockName(s.name) }))
  for (const { w } of cleaned) {
    firstCount.set(w[0], (firstCount.get(w[0]) ?? 0) + 1)
    if (w.length > 2) twoCount.set(w.slice(0, 2).join(' '), (twoCount.get(w.slice(0, 2).join(' ')) ?? 0) + 1)
  }
  const common = new Set([...WORD_VOCAB, ...FILLER, 'india', 'indian', 'national', 'new', 'bharat', 'hindustan', 'united', 'first', 'great', 'global', 'power', 'bank', 'tata', 'adani', 'bajaj', 'mahindra', 'jsw', 'godrej', 'aditya', 'hdfc', 'icici', 'sbi', 'axis', 'kotak', 'birla', 'reliance', 'larsen', 'state', 'oil', 'gas', 'steel', 'life', 'housing', 'finance', 'capital', 'general', 'max', 'one', 'star', 'sun', 'gold', 'shree', 'sri', 'shriram', 'lic', 'bse'])
  for (const { s, w } of cleaned) {
    if (!w.length) continue
    stockNames.set(s.key, s.name)
    entries.push({ words: w, p: { k: 'stock', v: s.key }, stockOnly: true, full: true })
    if (w.length > 2 && twoCount.get(w.slice(0, 2).join(' ')) === 1) entries.push({ words: w.slice(0, 2), p: { k: 'stock', v: s.key }, stockOnly: true })
    if (w.length > 1 && firstCount.get(w[0]) === 1 && w[0].length >= 4 && !common.has(w[0])) entries.push({ words: [w[0]], p: { k: 'stock', v: s.key }, stockOnly: true })
  }
  for (const [ph, target] of STOCK_ALIASES) {
    const tw = tokenize(target).join(' ')
    const hitStock = cleaned.find(c => c.w.join(' ').startsWith(tw))
    if (hitStock) for (const w of ph.split('|')) entries.push({ words: tokenize(w), p: { k: 'stock', v: hitStock.s.key }, stockOnly: true, full: true })
  }
  const byFirst = new Map<string, Entry[]>()
  for (const e of entries) {
    const list = byFirst.get(e.words[0]) ?? []
    list.push(e)
    byFirst.set(e.words[0], list)
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length || Number(!!a.stockOnly) - Number(!!b.stockOnly))
  const vocab = new Set(WORD_VOCAB)
  for (const e of entries) if (!e.stockOnly) for (const w of e.words) if (/^[a-z]{4,}$/.test(w)) vocab.add(w)
  const fundWords = new Set<string>()
  for (const n of ctx.fundNames) for (const w of n.split(' ')) fundWords.add(w)
  const protectedWords = new Set<string>([...fundWords, ...COMMON_WORDS])
  for (const { w } of cleaned) for (const x of w) protectedWords.add(x)
  const out = { entries: byFirst, vocab, protectedWords, fundWords, stockNames }
  builtCache.set(ctx, out)
  return out
}

function matchItems(tokens: string[], b: Built, stockContext: boolean): Item[] {
  const items: Item[] = []
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    if (/^-?\d+(\.\d+)?$/.test(tok)) { items.push({ p: { k: 'num', v: Number(tok) }, s: i, e: i + 1, text: tok }); i++; continue }
    let found: Entry | null = null
    for (const e of b.entries.get(tok) ?? []) {
      if (e.stockOnly && !stockContext) continue
      if (e.words.every((w, j) => tokens[i + j] === w)) { found = e; break }
    }
    if (found) {
      items.push({ p: found.p, s: i, e: i + found.words.length, text: tokens.slice(i, i + found.words.length).join(' '), full: found.full })
      i += found.words.length
    } else {
      items.push({ p: { k: 'word' }, s: i, e: i + 1, text: tok })
      i++
    }
  }
  return items
}

add('%', { k: 'unit', v: 'pct' })
add('hold|holds|held|own|owns|owned|owning|holders|holder|exposure|stake|stakes|weight|weights|allocation|allocations', { k: 'stockword' })

/** Stock verbs that also read naturally about fund size or cost ("increased", "reduced"). */
const WEAK_VERBS = new Set(['increased', 'increasing', 'decreased', 'decreasing', 'reduced', 'reducing', 'dropped', 'removed',
  'entered', 'entry', 'upped', 'added', 'adding', 'adds', 'exit', 'exits', 'trim', 'overweight', 'underweight'])
const EXTRA_FILLER = new Set(['change', 'changes', 'changed', 'happened', 'happening', 'moved', 'moves', 'movers', 'mover', 'move',
  'trend', 'trends', 'data', 'info', 'information', 'details', 'detail', 'time', 'period', 'term', 'wise', 'level', 'name',
  'type', 'kind', 'sort', 'sorted', 'order', 'ordered', 'value', 'values', 'figure', 'figures', 'number', 'numbers', 'amount',
  'amounts', 'terms', 'basis', 'compare', 'comparison', 'versus', 'like', 'such', 'other', 'others', 'thing', 'things', 'up',
  'down', 'out', 'off', 'last', 'past', 'previous', 'next', 'month', 'months', 'year', 'years', 'got', 'get', 'gets', 'saw',
  'sees', 'see', 'seeing', 'experienced', 'recorded', 'reported', 'posted', 'witnessed', 'registered', 'seen', 'getting',
  'when', 'why', 'whether', 'if', 'then', 'both', 'same', 'way', 'lot', 'lots', 'bit', 'quite', 'pretty', 'ratio', 'ratios',
  'invest', 'investing', 'lost', 'plus', 'but', 'despite', 'while', 'though', 'although', 'yet', 'whereas', 'even', 'however', 'still',
  'currently', 'right', 'overall', 'net', 'gross', 'so', 'far', 'q', 'h', 'fy', 'cap', 'caps', 'happen', 'went', 'go', 'goes', 'did',
  'everything', 'anything', 'all', 'new', 'going', 'coming', 'summary', 'overview', 'highlights', 'latest', 'whats', 'happened', 'changed', 'going on',
  'only', 'just', 'show', 'please', 'across', 'market', 'industry', 'mutual', 'india', 'indian'])
/** Ordinary English words that must never be "corrected" into a vocabulary word. */
const COMMON_WORDS = new Set(['plus', 'despite', 'better', 'beating', 'negative', 'positive', 'leaders', 'buyers', 'sellers', 'money',
  'lost', 'coming', 'going', 'falling', 'decline', 'growth', 'joins', 'cuts', 'hikes', 'invest', 'joke', 'while', 'about', 'funny',
  'heading', 'meaning', 'mean', 'means', 'helps', 'help', 'hello', 'thanks', 'thank', 'which', 'where', 'there', 'their', 'these',
  'those', 'other', 'every', 'rated', 'rates', 'rate', 'least', 'last', 'past', 'month', 'year', 'week', 'gains', 'loses', 'loser',
  'holds', 'cash', 'core', 'fall', 'fell', 'rose', 'rise', 'drop', 'down', 'upon', 'over', 'under', 'than', 'then', 'them'])
const CONTRAST = new Set(['despite', 'but', 'while', 'though', 'although', 'yet', 'whereas', 'even', 'however', 'still'])
const UP_WORD = /^(increased?|increasing|increases|rose|risen|rise|rising|raised?|raising|hiked?|hikes|hiking|up|grew|grow|growing|growth|jumped|surged|climbed|went up)$/
const DOWN_WORD = /^(decreased?|decreasing|decreases|reduced?|reducing|reduction|cuts?|cutting|fell|fallen|fall|falling|dropped|drop|drops|declined?|declining|down|lowered|slashed|shrank|shrunk)$/
const CAP_PREFIX = new Set(['large', 'mid', 'small', 'flexi', 'multi'])
const CAP_JOIN = new Set(['and', 'or', 'vs', 'versus', 'v', 'to'])
const INFLOW_TEXT = /^(net )?inflows?$|money in|came in|coming in|money coming|flowing in|positive|fresh money|new money|attract|gathered|pulled in|received|got money|poured|collections|subscriptions|mobili[sz]ed/

const PCT_FIELDS = new Set<FilterField>(['cagr', 'vsCategory', 'volatility', 'drawdown', 'alpha', 'ter', 'terChange', 'momentum'])
const MANAGER_WINDOWS: Win[] = [1, 3, 6, 12]
const FLOW_WINDOWS: Win[] = [1, 3, 6]

/** The closest window; a tie goes to the longer one. */
function nearestWin(months: number, allowed: Win[]): Win {
  let best = allowed[0]
  for (const w of allowed) if (Math.abs(w - months) <= Math.abs(best - months)) best = w
  return best
}
function nearestHorizon(years: number): '1Y' | '3Y' | '5Y' {
  return years <= 1.5 ? '1Y' : years <= 4 ? '3Y' : '5Y'
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2026-09" -> "Sep 2026" */
function ym(m: string | null | undefined): string {
  return m ? `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : ''
}
function monthsBetween(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
}

/** `mul`: what the number was multiplied by for its unit, so "10 to 20 bps" can lend it to the 10. */
interface Qty { v: number; u: 'cr' | 'pct' | 'months' | 'years' | 'days' | 'places' | null; s: number; e: number; mul: number }

export function parseQuery(text: string, ctx: ParseContext, base?: MoversState): ParseOutput {
  const b = build(ctx)
  const corrected: [string, string][] = []
  const prot = new Set([...b.protectedWords, ...FILLER, ...EXTRA_FILLER])
  const tokens = tokenize(text).map(t => {
    const c = correct(t, b.vocab, prot)
    if (c) corrected.push([t, c])
    return c ?? t
  }).flatMap(t => {
    const m = /^(large|mid|small|flexi|multi)(caps?)$/.exec(t)
    if (t === 'rotation') return ['stocks', 'by', 'sector']
    return m ? [m[1], m[2]] : [t]
  })
  // "small vs mid cap", "small, mid and large caps": every size word gets its "cap"
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== 'cap' && tokens[i] !== 'caps') continue
    const run: number[] = []
    let j = i - 1
    while (j >= 0) {
      if (CAP_PREFIX.has(tokens[j])) { run.unshift(j); j--; continue }
      if (CAP_JOIN.has(tokens[j]) && run.length && j > 0 && CAP_PREFIX.has(tokens[j - 1])) { j--; continue }
      break
    }
    if (run.length < 2) continue
    const words = run.map(k => tokens[k])
    if (words.length === 2 && words[0] === 'large' && words[1] === 'mid') continue
    const capTok = tokens[i]
    for (const k of run.slice(0, -1).reverse()) tokens.splice(k + 1, 0, capTok)
    i += run.length - 1
  }
  let items = matchItems(tokens, b, false)
  const hasAdvice = items.some(it => it.p.k === 'advice')
  const withStocks = matchItems(tokens, b, true)
  // A stock named on its own ("hdfc bank", "infosys") is a stock question even without "stock" or "bought".
  const namedStock = withStocks.some(it => {
    if (it.p.k !== 'stock') return false
    const nx = withStocks.find(x => x.s === it.e)
    if (nx && ['fundword', 'category', 'type', 'theme'].includes(nx.p.k)) return false
    const span = items.filter(x => x.s >= it.s && x.e <= it.e)
    const plain = span.length > 0 && span.every(x => x.p.k === 'word') && tokens.slice(it.s, it.e).every(w => !b.fundWords.has(w))
    const oneAmc = span.length === 1 && span[0].p.k === 'amc'
    return plain || (!!it.full && it.e - it.s >= 2 && !oneAmc)
  })
  const strongStock = namedStock || items.some(it => it.p.k === 'stockword' ||
    (it.p.k === 'verb' && !WEAK_VERBS.has(it.text) && !(hasAdvice && (it.p as { v: string }).v === 'buy')))
  if (strongStock) items = withStocks
  const stockContext = strongStock

  const notes: string[] = []
  const prevText = (i: number) => (i > 0 ? items[i - 1].text : '')
  // "ter increased", "aum fell", "rank rose": a level plus a direction is a change.
  items.forEach((it, i) => {
    if (it.p.k !== 'measure' || !['ter', 'aum', 'rankNow', 'cagr'].includes(it.p.v.m) || it.p.v.order) return
    for (let k = Math.max(0, i - 3); k < Math.min(items.length, i + 4); k++) {
      const x = items[k]
      if (k === i || !['word', 'verb', 'measure'].includes(x.p.k)) continue
      if (x.p.k === 'measure' && x.text !== 'rise' && x.text !== 'growth') continue
      const up = UP_WORD.test(x.text), down = DOWN_WORD.test(x.text)
      if (!up && !down) continue
      const m = it.p.v.m
      if (m === 'cagr' && x.text === 'growth') continue
      const to: Measure = m === 'ter' ? 'terChange' : m === 'aum' ? 'aumChange' : m === 'cagr' ? 'momentum' : 'rankMove'
      it.p = { k: 'measure', v: { m: to, order: up ? 'desc' : 'asc', sign: up ? 'pos' : 'neg', field: true } }
      it.text = `${it.text} ${x.text}`
      x.p = { k: 'word' }
      x.used = true
      break
    }
  })
  // Words that only mean something next to their neighbours.
  items.forEach((it, i) => {
    if (it.p.k === 'theme' && it.p.v === 'us' && ['show', 'tell', 'give', 'let', 'help'].includes(prevText(i))) it.p = { k: 'word' }
    if (it.p.k === 'groupHint') {
      if (i > 0 && items[i - 1].p.k === 'category') { it.p = { k: 'word' }; it.used = true } else it.p = { k: 'group', v: 'category' }
    }
    if (it.p.k === 'group' && it.p.v === 'amc' && (it.text === 'amc' || it.text === 'amcs') && i > 0 && items[i - 1].p.k === 'amc') it.p = { k: 'word' }
    if (it.p.k === 'verb' && !stockContext) {
      it.p = WEAK_VERBS.has(it.text) && /^(decreas|reduc|dropp|remov|exit|trim|underweight)/.test(it.text) ? { k: 'order', v: 'asc' } : { k: 'order', v: 'desc' }
    }
    // "bought sbi" in a stock question is the bank, not the fund house.
    if (stockContext && it.p.k === 'amc' && i > 0 && items[i - 1].p.k === 'verb') {
      const alt = (b.entries.get(tokens[it.s]) ?? []).find(e => e.stockOnly && e.words.length === it.e - it.s && e.words.every((w, j) => tokens[it.s + j] === w))
      if (alt) it.p = alt.p
    }
  })

  // ---- "not" before a signed figure or a comparator flips it ----
  // "not positive returns", "no inflows", "not under 1%". Category, fund house, theme, type,
  // age and risk are negated further down; anything else is said to be unsupported.
  const flipSign = (w: MeasureWord): MeasureWord => ({ ...w, sign: w.sign === 'pos' ? 'neg' : 'pos', order: w.order === 'desc' ? 'asc' : w.order === 'asc' ? 'desc' : w.order })
  items.forEach((it, i) => {
    if (it.p.k !== 'neg') return
    let j = i + 1
    while (j < items.length && j <= i + 2 && (items[j].p.k === 'fundword' || (items[j].p.k === 'word' && FILLER.has(items[j].text)))) j++
    const t = items[j]
    if (!t) return
    let done = false
    if (t.p.k === 'measure' && t.p.v.sign) { t.p = { k: 'measure', v: flipSign(t.p.v) }; done = true }
    else if (t.p.k === 'measure' && t.p.v.m === 'flow' && INFLOW_TEXT.test(t.text)) { t.p = { k: 'measure', v: { m: 'flow', order: 'asc', sign: 'neg', field: true } }; done = true }
    else if (t.p.k === 'cmp') { t.p = { k: 'cmp', v: t.p.v === 'gt' ? 'lt' : 'gt', ...(t.p.inc ? {} : { inc: true }) }; done = true }
    // "not expensive", "not the biggest": the other end of the same list
    else if (t.p.k === 'measure' && (t.p.v.order === 'desc' || t.p.v.order === 'asc')) { t.p = { k: 'measure', v: { ...t.p.v, order: t.p.v.order === 'desc' ? 'asc' : 'desc' } }; done = true }
    else if (t.p.k === 'order' && (t.p.v === 'desc' || t.p.v === 'asc')) { t.p = { ...t.p, v: t.p.v === 'desc' ? 'asc' : 'desc' }; done = true }
    // an order word keeps its own text: "biggest" still means size
    if (done) { if (t.p.k !== 'order') t.text = `${it.text} ${t.text}`; it.p = { k: 'noop' }; it.used = true }
  })
  // "above 10% and below 20%": "and below" before a number starts the next bound, it does
  // not close the first one ("20% and below").
  items.forEach((it, i) => {
    if (it.p.k !== 'cmp' || !/^(and|or) /.test(it.text)) return
    const nx = items[i + 1]
    if (nx && (nx.p.k === 'num' || nx.p.k === 'currency')) { it.p = { k: 'cmp', v: it.p.v }; it.text = it.text.replace(/^(and|or) /, '') }
  })

  // ---- numbers and their units ----
  const qtys: Qty[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.p.k !== 'num' || it.used) continue
    let v = it.p.v, u: Qty['u'] = null, e = i + 1, mul = 1
    // "5 lakh crore", "10 k cr": a unit, possibly followed by "crore"
    const nx = items[i + 1]
    if (nx && nx.p.k === 'unit') {
      const unit = nx.p.v
      e = i + 2
      const conv: Record<string, [number, Qty['u']]> = {
        cr: [1, 'cr'], lcr: [100000, 'cr'], kcr: [1000, 'cr'], bn: [100, 'cr'], mn: [0.1, 'cr'], pct: [1, 'pct'],
        bps: [0.01, 'pct'], months: [1, 'months'], years: [1, 'years'], quarters: [3, 'months'], days: [1, 'days'], places: [1, 'places'],
      }
      const [m, unitOut] = conv[unit] ?? [1, null]
      v *= m
      mul = m
      u = unitOut
      if ((unit === 'kcr' || unit === 'lcr' || unit === 'bn') && items[i + 2]?.p.k === 'unit' && (items[i + 2].p as { v: string }).v === 'cr') e = i + 3
      for (let j = i + 1; j < e; j++) items[j].used = true
    }
    if (i > 0 && items[i - 1].p.k === 'currency') { items[i - 1].used = true; if (!u) u = 'cr' }
    it.used = true
    qtys.push({ v, u, s: i, e, mul })
  }

  const state = { measureItem: -1 }
  const thresholds: Threshold[] = []
  let limit: number | null = null
  const timeMonths: number[] = [], timeYears: number[] = []
  const usedMeasure = new Set<number>()
  /** `sign`: the side the measure's own wording is on ("outflow", "positive returns"). */
  const fieldAt = (idx: number): { field: FilterField; flip: boolean; pct?: boolean; sign?: 'pos' | 'neg' } | null => {
    const it = items[idx]
    if (!it || usedMeasure.has(idx)) return null
    if (it.p.k === 'measure' && it.p.v.field) {
      const m = it.p.v.m
      const field: FilterField = m === 'rankNow' ? 'rankNow' : (m as FilterField)
      const sign = it.p.v.sign ?? (m === 'flow' && INFLOW_TEXT.test(it.text) ? 'pos' : undefined)
      return { field, flip: it.p.v.sign === 'neg' && (m === 'flow' || m === 'aumChange' || m === 'terChange' || m === 'rankMove'), sign }
    }
    if (it.p.k === 'age') return { field: 'age', flip: false }
    return null
  }
  // A figure with a unit belongs to a measure that unit fits ("sharpe at most 1% expense ratio":
  // the 1% is the expense ratio); without one that fits, the nearest measure.
  const fits = (field: FilterField, unit: Qty['u'] | undefined) =>
    unit === 'pct' ? PCT_FIELDS.has(field) || field === 'flow' || field === 'aumChange' || field === 'aum'
      : unit === 'cr' ? field === 'flow' || field === 'aum' || field === 'aumChange' : true
  const findField = (from: number, to: number, unit?: Qty['u']): [number, ReturnType<typeof fieldAt>] => {
    for (const strict of unit ? [true, false] : [false]) {
      for (let k = from - 1; k >= Math.max(0, from - 4); k--) { const f = fieldAt(k); if (f && (!strict || fits(f.field, unit))) return [k, f] }
      for (let k = to; k < Math.min(items.length, to + 4); k++) { const f = fieldAt(k); if (f && (!strict || fits(f.field, unit))) return [k, f] }
    }
    return [-1, null]
  }
  const ageNear = (from: number, to: number) => items.slice(Math.max(0, from - 3), Math.min(items.length, to + 3)).some(x => x.p.k === 'age')

  // Fund age: "older than 5 years", "launched in the last 2 years", "less than a year old".
  const consumed = new Set<number>()
  items.forEach((a, ai) => {
    if (a.p.k !== 'age' || a.used) return
    const ageOp = a.p.v === 'lt' ? 'lt' : 'gt'
    const blocked = (from: number, to: number) => items.slice(Math.min(from, to), Math.max(from, to)).some(x => x.p.k === 'measure' || x.p.k === 'mgr')
    let hit: { years: number; s: number; e: number; q?: number } | null = null
    qtys.forEach((qq, qi) => {
      if (hit || consumed.has(qi) || (qq.u !== 'years' && qq.u !== 'months' && qq.u !== null) || (qq.u === null && qq.v > 30)) return
      const after = qq.s > ai && qq.s - a.e <= 3 - 0 && qq.s - ai <= 4
      const before = qq.e <= ai && ai - qq.e <= 1
      if ((after || before) && !blocked(ai, after ? qq.s : qq.e)) hit = { years: qq.u === 'months' ? qq.v / 12 : qq.v, s: qq.s, e: qq.e, q: qi }
    })
    if (!hit) {
      for (let k = Math.max(0, ai - 2); k < Math.min(items.length, ai + 4); k++) {
        const t = items[k]
        if (t.p.k !== 'time' || blocked(ai, k)) continue
        const tv = t.p.v
        const years = tv.horizon && !tv.note ? Number(tv.horizon[0]) * (tv.win && tv.win < 12 ? tv.win / 12 : 1) : tv.win ? tv.win / 12 : null
        if (years) { hit = { years, s: k, e: k + 1 }; t.p = { k: 'noop' }; t.used = true; break }
      }
    }
    if (!hit) return
    const h = hit as { years: number; s: number; e: number; q?: number }
    const cmp = items[h.s - 1]
    const op = cmp && cmp.p.k === 'cmp' ? cmp.p.v : ageOp
    const ageInc = !!(cmp && cmp.p.k === 'cmp' && cmp.p.inc)
    if (cmp && cmp.p.k === 'cmp') cmp.used = true
    if (h.q != null) consumed.add(h.q)
    for (let k = h.s; k < h.e; k++) items[k].used = true
    a.used = true
    thresholds.push({ field: 'age', op, a: Math.round(h.years * 100) / 100, ...(ageInc ? { inc: true } : {}) })
  })

  for (let q = 0; q < qtys.length; q++) {
    if (consumed.has(q)) continue
    const { v, u, s, e } = qtys[q]
    const prev = items[s - 1], next = items[e]
    // between X and Y
    const rangeStart = (prev && prev.p.k === 'between') || (next && next.text === 'to')
    if (rangeStart && next && next.p.k === 'and' && qtys[q + 1] && qtys[q + 1].s === e + 1) {
      const q2 = qtys[q + 1]
      const unit = u ?? q2.u
      // "10 to 20 bps", "1 to 2 lakh crore": the unit on the second number scales the first
      const v1 = u == null && q2.u != null ? v * q2.mul : v
      if (prev && prev.p.k === 'between') prev.used = true
      next.used = true
      q++
      if (unit === 'months' || unit === 'years') { (unit === 'months' ? timeMonths : timeYears).push(q2.v); continue }
      const [fi, f] = findField(prev && prev.p.k === 'between' ? s - 1 : s, q2.e, unit)
      const field: FilterField = f ? f.field : unit === 'cr' ? 'aum' : 'cagr'
      if (fi >= 0) usedMeasure.add(fi)
      // "outflows between 100 and 500 cr" are flows of -500 to -100
      let lo = Math.min(v1, q2.v), hi = Math.max(v1, q2.v)
      if (f && f.flip) [lo, hi] = [-hi, -lo]
      thresholds.push({ field, op: 'between', a: lo, b: hi, ...(unit === 'pct' && !PCT_FIELDS.has(field) ? { pct: true } : {}) })
      continue
    }
    let op: 'gt' | 'lt' | null = null
    let inc = false
    const prevOp = prev && prev.p.k === 'currency' && items[s - 2]?.p.k === 'cmp' ? items[s - 2] : prev
    if (prevOp && prevOp.p.k === 'cmp' && !/^(or|and) /.test(prevOp.text)) { op = prevOp.p.v; inc = !!prevOp.p.inc; prevOp.used = true }
    else if (prev && prev.p.k === 'age' && prev.p.v !== 'any' && (prev.text.endsWith('than') || prev.text === 'launched within')) { op = prev.p.v as 'gt' | 'lt'; }
    // "1,000 cr or more", "20% and above", "5 or fewer"
    const post = items[e]?.p.k === 'unit' && items[e + 1]?.p.k === 'cmp' ? items[e + 1] : items[e]
    if (post && post.p.k === 'cmp' && /^(or|and) /.test(post.text)) { op = post.p.v; inc = true; post.used = true }
    if (next && next.p.k === 'word' && next.text === 'plus') { op = 'gt'; inc = true; next.used = true }
    if (items[e] && items[e + 1] && items[e].p.k === 'or' && ['more', 'above', 'higher', 'greater'].includes(items[e + 1].text)) { op = 'gt'; inc = true; items[e].used = items[e + 1].used = true }
    if (items[e] && items[e + 1] && items[e].p.k === 'or' && ['less', 'below', 'lower', 'fewer'].includes(items[e + 1].text)) { op = 'lt'; inc = true; items[e].used = items[e + 1].used = true }
    const isTime = u === 'months' || u === 'years' || u === 'days'
    if (isTime && (!op || !ageNear(s, e))) {
      if (u === 'months') timeMonths.push(v)
      else if (u === 'years') timeYears.push(v)
      else { timeMonths.push(1); notes.push('Flows, sizes and costs are disclosed monthly, so the latest month is shown.') }
      if (op && prev) prev.used = true
      continue
    }
    if (!op && (u === 'cr' || u === 'pct')) {
      // "inflow of rs 1,500 crore", "1,000 cr inflow": skip "of", "rs" and the like, at most three words back or two ahead
      const skippable = (x: Item | undefined) => !!x && (x.p.k === 'currency' || x.p.k === 'fundword' || (x.p.k === 'word' && FILLER.has(x.text)))
      let k = s - 1, steps = 0
      while (k >= 0 && steps < 3 && skippable(items[k])) { k--; steps++ }
      let near = k >= 0 && fieldAt(k) ? k : -1
      if (near < 0) { k = e; steps = 0; while (k < items.length && steps < 2 && skippable(items[k])) { k++; steps++ }; if (k < items.length && fieldAt(k)) near = k }
      if (near >= 0) op = 'gt'
    }
    if (u === 'places') {
      // "dropped more than 5 places", "climbed 10 spots"
      const [fi, f] = findField(s, e)
      const down = items.slice(Math.max(0, s - 4), Math.min(items.length, e + 2)).some(x => DOWN_WORD.test(x.text) || /^(slipped|slid|lost|worsened)$/.test(x.text))
      if (f && f.field === 'rankMove') { usedMeasure.add(fi); items[fi].used = true }
      const neg = f && f.field === 'rankMove' ? f.flip : down
      const o: 'gt' | 'lt' = op ?? 'gt'
      thresholds.push({ ...(neg ? { field: 'rankMove' as FilterField, op: o === 'gt' ? 'lt' as const : 'gt' as const, a: -v } : { field: 'rankMove' as FilterField, op: o, a: v }), ...(inc ? { inc: true } : {}) })
      if (prev && prev.p.k === 'cmp') prev.used = true
      items.slice(Math.max(0, s - 4), Math.min(items.length, e + 2)).forEach(x => { if (DOWN_WORD.test(x.text) || /^(slipped|slid|lost|worsened)$/.test(x.text)) x.used = true })
      continue
    }
    if (op) {
      const prevIsOp = !!prev && (prev.p.k === 'cmp' || prev.p.k === 'age')
      const [fi, f] = prev && prev.p.k === 'age' ? [s - 1, { field: 'age' as FilterField, flip: false }] : findField(prevIsOp ? s - 1 : s, e, u)
      let field: FilterField
      let value = isTime && u === 'months' ? v / 12 : v
      let flip = false
      let side: 'pos' | 'neg' | undefined
      if (f && f.field === 'age') { field = 'age'; items[fi].used = true }
      else if (f) { field = f.field; flip = f.flip; side = (f as { sign?: 'pos' | 'neg' }).sign; usedMeasure.add(fi); items[fi].used = true }
      else if (ageNear(s, e) || isTime) field = 'age'
      else if (u === 'cr') field = items.some(x => x.p.k === 'measure' && x.p.v.m === 'flow') ? 'flow' : 'aum'
      else if (u === 'pct') {
        const m = items.find(x => x.p.k === 'measure' && PCT_FIELDS.has((x.p as { v: MeasureWord }).v.m as FilterField))
        field = m ? ((m.p as { v: MeasureWord }).v.m as FilterField) : 'cagr'
      } else field = items.some(x => x.p.k === 'measure' && x.p.v.m === 'rankNow') ? 'rankNow' : 'aum'
      if (field === 'age' && u === 'months') value = v / 12
      let o: 'gt' | 'lt' = op ?? 'gt'
      if (flip) { value = -value; o = o === 'gt' ? 'lt' : 'gt' }
      thresholds.push({ field, op: o, a: value, ...(u === 'pct' && (field === 'flow' || field === 'aumChange' || field === 'aum') ? { pct: true } : {}), ...(inc && !(field === 'rankNow' && o === 'lt') ? { inc: true } : {}) })
      // "outflow below 500 cr" is an outflow, -500 to 0, not anything above -500; a negative
      // number ("inflow < -200") means the wording was net flow, so no side is added.
      if (side && v >= 0 && !(side === 'neg' ? o === 'lt' && value <= 0 : o === 'gt' && value >= 0)) {
        thresholds.push({ field, op: side === 'neg' ? 'lt' : 'gt', a: 0, ...(u === 'pct' && (field === 'flow' || field === 'aumChange' || field === 'aum') ? { pct: true } : {}) })
      }
      continue
    }
    if (!u && prev && prev.p.k === 'word' && (prev.text === 'q' || prev.text === 'h') && v >= 1 && v <= 4) {
      prev.used = true
      timeMonths.push(prev.text === 'q' ? 3 : 6)
      notes.push(prev.text === 'q' ? 'Quarters are read as the latest 3 months.' : 'Half years are read as the latest 6 months.')
      continue
    }
    if (!u && Number.isInteger(v) && v >= 1990 && v <= 2100 && !(prev && prev.p.k === 'month')) {
      if (ctx.refMonth && v === Number(ctx.refMonth.slice(0, 4))) timeMonths.push(Number(ctx.refMonth.slice(5, 7)))
      else notes.push(`Movers covers the last 6 months; ${v} is outside it.`)
      continue
    }
    // top 5 / 5 best / first 10 / 10 funds
    const pw = prev?.p.k === 'order' || prev?.text === 'first' || prev?.text === 'top' || prev?.text === 'bottom'
    const nw = next && (next.p.k === 'fundword' || next.p.k === 'stockword' || next.p.k === 'order' || next.p.k === 'group' ||
      next.p.k === 'category' || next.p.k === 'amc' || next.p.k === 'theme' || next.p.k === 'type' || next.p.k === 'young')
    if (!u && (pw || nw) && Number.isInteger(v) && v >= 1 && v <= 500) { limit = v; continue }
    if (!u && v >= 1990 && v <= 2100 && prev && prev.p.k === 'month') continue
    if (!u && Number.isInteger(v) && v >= 1 && v <= 500 && !prev) { limit = v; continue }
    if (!u) notes.push(`Not sure what ${v} refers to; ignored it.`)
  }

  // ---- months and "since" ----
  let month = null as string | null
  let sinceWin = null as number | null
  const namedMonths = items.filter(it => it.p.k === 'month').length
  items.forEach((it, i) => {
    if (it.p.k !== 'month' || !ctx.refMonth) return
    const ref = ctx.refMonth
    const yearItem = items[i + 1]
    let year = Number(ref.slice(0, 4))
    if (yearItem && yearItem.p.k === 'num' && yearItem.p.v >= 1990 && yearItem.p.v <= 2100) year = yearItem.p.v
    else if (it.p.v > Number(ref.slice(5, 7))) year -= 1
    const ym = `${year}-${String(it.p.v).padStart(2, '0')}`
    if (i > 0 && items[i - 1].p.k === 'since') { sinceWin = Math.max(1, monthsBetween(ym, ref) + 1); items[i - 1].used = true }
    else month = ym
    it.used = true
  })

  // ---- negation and entities ----
  const cats: string[] = [], notCats: string[] = [], amcs: string[] = [], notAmcs: string[] = []
  const themes: string[] = [], notThemes: string[] = [], stockSectors: string[] = [], risk: string[] = []
  let type: MoversState['type'] = 'all', young: MoversState['young'] = 'all'
  let stock: string | null = null
  let neg = false, negHit = false, negText = '', negKind = '', bothTypes = false
  const notRisk: string[] = []
  // "not" with nothing it can apply to is said so, never silently dropped
  const negMissed = (what: string) => {
    if (neg && !negHit && what) notes.push(`"${negText} ${what}": excluding this is not supported, so the results include it.`)
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const p = it.p
    if (p.k === 'neg') { negMissed(''); neg = true; negHit = false; negKind = ''; negText = it.text; it.used = true; continue }
    // "not hdfc or sbi" negates both; "not very high risk small caps" only the risk
    const entity = ['category', 'amc', 'theme', 'type', 'young', 'risk'].includes(p.k)
    if (neg && negKind && entity && p.k !== negKind) neg = false
    if (neg && entity) { negHit = true; negKind = p.k }
    if (p.k === 'and' || p.k === 'or' || (p.k === 'word' && (FILLER.has(it.text) || EXTRA_FILLER.has(it.text))) || p.k === 'fundword' || (p.k === 'between' && it.text === 'from')) continue
    if (p.k === 'category') {
      for (const c of p.v) {
        if (c === '@equity') (neg ? cats : notCats).push(...(neg ? ['Liquid', 'Money Market'] : ['Liquid', 'Money Market', 'Arbitrage']))
        else (neg ? notCats : cats).push(c)
      }
      it.used = true; continue
    }
    if (p.k === 'amc') { (neg ? notAmcs : amcs).push(p.v); it.used = true; continue }
    if (p.k === 'theme') {
      const nx = items[i + 1]
      const fundTheme = /\bfunds?$/.test(it.text) || (!!nx && nx.p.k === 'fundword')
      if (stockContext && !fundTheme && !neg && THEMES[p.v].sector) stockSectors.push(THEMES[p.v].sector!)
      else {
        (neg ? notThemes : themes).push(p.v)
        if (stockContext && !fundTheme && nx && nx.p.k === 'stockword') notes.push(`Stocks are grouped into broad sectors only; showing what ${THEMES[p.v].label.toLowerCase()} funds did.`)
      }
      it.used = true; continue
    }
    if (p.k === 'type') {
      const t = neg ? (p.v === 'index' ? 'active' : 'index') : p.v
      if (type !== 'all' && type !== t && !neg) bothTypes = true
      type = t; it.used = true; neg = false; continue
    }
    if (p.k === 'young') { young = neg ? (p.v === 'only' ? 'exclude' : 'only') : p.v; it.used = true; neg = false; continue }
    if (p.k === 'risk') { (neg ? notRisk : risk).push(...p.v); it.used = true; continue }
    if (p.k === 'stock') { negMissed(it.text); neg = false; stock = p.v; it.used = true; continue }
    if (p.k !== 'noop') negMissed(it.text)
    neg = false
  }
  // "not high risk": every other grade
  if (notRisk.length) { const keep = (risk.length ? risk : RISK_LEVELS).filter(r => !notRisk.includes(r)); risk.length = 0; risk.push(...keep) }
  // "active vs passive": both sides, grouped by type; a category brings its index counterpart along.
  if (bothTypes) type = 'all'
  // "small cap index funds" are the index category, not active small caps that are also index funds
  let categories = [...new Set(cats)]
  if (bothTypes) categories = [...new Set(categories.flatMap(c => [c, ...(INDEX_CATEGORY[c] ?? [])]))]
  if (type === 'index' && categories.length && categories.every(c => INDEX_CATEGORY[c])) {
    categories = [...new Set(categories.flatMap(c => INDEX_CATEGORY[c]))]
  }
  // "index funds not small cap": the small cap index category goes too
  if (type === 'index') notCats.push(...notCats.flatMap(c => INDEX_CATEGORY[c] ?? []))
  const valid = new Set(ctx.categories)
  categories = categories.filter(c => valid.has(c))

  // ---- measure, order, grouping ----
  const measureItems = items.map((it, i) => ({ it, i })).filter(x => x.it.p.k === 'measure' && !usedMeasure.has(x.i))
  const orderItems = items.map((it, i) => ({ it, i })).filter(x => x.it.p.k === 'order')
  const mgrItems = items.filter(it => it.p.k === 'mgr')
  const verbs = items.filter(it => it.p.k === 'verb').map(it => (it.p as { v: 'buy' | 'sell' | 'added' | 'exited' }).v)
  const groupItem = [...items].reverse().find(it => it.p.k === 'group')
  const mOf = (x: { it: Item }) => (x.it.p as { v: MeasureWord }).v
  // Each order word belongs to the nearest measure within two words; a following one wins a tie ("highest inflow").
  const ownerOf = new Map<number, number>()
  for (const o of orderItems) {
    let best = -1, bd = 99
    for (const x of measureItems) {
      const d = Math.abs(x.i - o.i)
      if (d <= 2 && (d < bd || (d === bd && x.i > o.i))) { best = x.i; bd = d }
    }
    if (best >= 0) ownerOf.set(o.i, best)
  }
  // After "despite", "but", "while" a measure is a condition, not the sort.
  const contrastAt = items.findIndex(it => it.p.k === 'word' && CONTRAST.has(it.text))
  const cands = contrastAt >= 0 && measureItems.some(x => x.i < contrastAt) ? measureItems.filter(x => x.i < contrastAt) : measureItems
  const owned = new Set(ownerOf.values())
  let view: View | null = null
  let measure: Measure | null = null
  let mw: MeasureWord | null = null
  let measureText = ''
  let action: MoversState['action'] = 'any'
  let pick: { it: Item; i: number } | null = null
  let orderOwner = -1
  if (!stockContext && !mgrItems.length && cands.length) {
    pick = cands.find(x => owned.has(x.i)) ?? cands[0]
    orderOwner = pick.i
    // The same measure said twice ("most money ... redemptions"): the signed wording is the specific one.
    const p0 = pick
    const sib = cands.find(x => x !== p0 && mOf(x).m === mOf(p0).m && mOf(x).sign && !mOf(p0).sign)
    if (sib) { pick.it.used = true; pick = sib }
    // "rank improvers", "aum growth": a level next to its change means the change.
    const CHANGE_OF: Partial<Record<Measure, Measure>> = { rankNow: 'rankMove', aum: 'aumChange', ter: 'terChange' }
    const p1 = pick
    const change = CHANGE_OF[mOf(p1).m] ? cands.find(x => mOf(x).m === CHANGE_OF[mOf(p1).m]) : undefined
    if (change) { p1.it.used = true; pick = change; orderOwner = owned.has(change.i) ? change.i : orderOwner }
  }
  // "rank improved by 5 or more": the threshold already names the change; sort by it too.
  const CHANGE_FIELD: Partial<Record<Measure, Measure>> = { rankNow: 'rankMove', aum: 'aumChange', ter: 'terChange' }
  const levelChange = pick && CHANGE_FIELD[mOf(pick).m] && thresholds.some(t => t.field === CHANGE_FIELD[mOf(pick!).m])
    ? CHANGE_FIELD[mOf(pick).m]! : null
  const secondaries = measureItems.filter(x => x !== pick && x.i !== orderOwner && (!pick || mOf(x).m !== mOf(pick).m))
  if (stockContext) {
    view = 'stocks'
    const v = verbs[0]
    action = v ?? 'any'
    measure = v === 'added' ? 'added' : v === 'exited' ? 'exited' : 'netBuyers'
  } else if (mgrItems.length) {
    view = 'managers'
    // "manager changes" counts joins and departures; "new managers" or "managers who left" one side
    const said = new Set(mgrItems.map(it => (it.p as { v: string }).v))
    measure = said.has('joined') && !said.has('left') ? 'joined' : said.has('left') && !said.has('joined') ? 'left' : 'mgrChanges'
  } else if (pick) {
    mw = mOf(pick)
    if (levelChange) { const t = thresholds.find(x => x.field === levelChange)!; mw = { m: levelChange, order: t.op === 'lt' ? 'asc' : 'desc' } }
    measure = mw.m
    measureText = pick.it.text
    view = VIEW_OF[measure]
    pick.it.used = true
  } else {
    const fb = orderItems.find(o => (o.it.p as { fb?: Measure }).fb)
    const sizeWord = orderItems.find(o => /^(biggest|largest|smallest|big|large|small|huge|massive|tiny|major|the biggest|the largest|the smallest)$/.test(o.it.text))
    const goodWord = orderItems.find(o => ['good', 'bad'].includes((o.it.p as { v: string }).v))
    if (fb) measure = (fb.it.p as { fb: Measure }).fb
    else if (sizeWord) measure = 'aum'
    else if (goodWord) measure = 'score'
    else {
      // "returns above 20%", "aum over 50,000 cr": the figure asked about is what to sort by.
      const t = thresholds.find(x => x.field === 'flow') ?? thresholds.find(x => x.field !== 'age')
      if (t) { measure = t.field as Measure; mw = { m: measure, order: t.op === 'lt' ? 'asc' : 'desc' }; if (measure === 'rankNow') mw.order = t.op === 'lt' ? 'asc' : 'desc' }
    }
    if (measure) view = VIEW_OF[measure]
  }
  // Measures that are not the sort become filters where their wording says which side ("outflows despite good returns").
  const unsorted: string[] = []
  for (const x of secondaries) {
    const w = mOf(x)
    const o = orderItems.find(oo => ownerOf.get(oo.i) === x.i)
    const ov = o ? (o.it.p as { v: string }).v : null
    let th: Threshold | null = null
    if (w.sign && (FILTER_FIELDS as readonly string[]).includes(w.m)) th = { field: w.m as FilterField, op: w.sign === 'neg' ? 'lt' : 'gt', a: 0 }
    else if (w.m === 'cagr' && (ov === 'good' || ov === 'bad')) th = { field: 'vsCategory', op: ov === 'good' ? 'gt' : 'lt', a: 0 }
    else if (w.m === 'flow' && INFLOW_TEXT.test(x.it.text)) th = { field: 'flow', op: 'gt', a: 0 }
    if (th) { thresholds.push(th); x.it.used = true; if (o) o.it.used = true }
    else if (view !== 'stocks' && view !== 'managers' && (!measure || VIEW_OF[w.m] !== view) &&
      !(w.m === 'cagr' && (view === 'momentum' || view === 'rank'))) unsorted.push(x.it.text)
    else x.it.used = true
  }
  if (unsorted.length && pick) notes.push(`Sorted by ${pick.it.text}; to sort by ${unsorted[0]} instead, ask for it on its own.`)

  const firstOrder = orderItems.find(o => ownerOf.get(o.i) === orderOwner || (pick && ownerOf.get(o.i) === pick.i)) ??
    orderItems.find(o => !ownerOf.has(o.i))
  let order: 'desc' | 'asc' = mw?.order ?? (measure === 'rankNow' ? 'asc' : 'desc')
  if (firstOrder && view !== 'stocks') {
    const ov = (firstOrder.it.p as { v: 'desc' | 'asc' | 'good' | 'bad' }).v
    firstOrder.it.used = true
    if (ov === 'good' || ov === 'bad') {
      const lowerBetter = measure ? LOWER_IS_BETTER.has(measure) : false
      order = (ov === 'good') !== lowerBetter ? 'desc' : 'asc'
      if (mw?.sign === 'neg') order = ov === 'good' ? 'desc' : 'asc'
    } else {
      order = ov
      if (measure === 'rankNow') order = ov === 'desc' ? 'asc' : 'desc'
      if (mw?.sign === 'neg') order = ov === 'desc' ? 'asc' : 'desc'
    }
  } else if (firstOrder && view === 'stocks') {
    const ov = (firstOrder.it.p as { v: string }).v
    firstOrder.it.used = true
    if ((ov === 'asc' || ov === 'bad') && action !== 'sell') order = 'asc'
  }
  if (view === 'stocks' && action === 'sell') order = 'asc'

  let groupBy: MoversState['groupBy'] = 'fund'
  if (groupItem) {
    groupItem.used = true
    const g = (groupItem.p as { v: MoversState['groupBy'] }).v
    if (g === 'sector' && view !== 'stocks') groupBy = 'theme'
    else if (g === 'theme' && view === 'stocks') groupBy = 'sector'
    else if (g !== 'fund') groupBy = g
  }
  if (bothTypes && groupBy === 'fund' && view !== 'stocks' && view !== 'managers') groupBy = 'type'
  // "nippon vs hdfc", "small cap or mid cap": comparing two fund houses or categories compares their totals.
  const compareWord = tokens.some(t => ['vs', 'versus', 'compare', 'compared', 'comparison', 'against', 'v'].includes(t)) ||
    items.some(it => it.p.k === 'or' && !it.used)
  if (groupBy === 'fund' && compareWord && !limit && view !== 'stocks' && view !== 'managers') {
    const nA = new Set(amcs).size, nC = categories.length
    if (nA >= 2 && nC <= 1) groupBy = 'amc'
    else if (nC >= 2 && nA <= 1) groupBy = 'category'
  }

  // "top 5 ranked", "top 3 in their category": a rank cut-off, not five rows.
  if (measure === 'rankNow' && limit && groupBy === 'fund') { thresholds.push({ field: 'rankNow', op: 'lt', a: limit }); limit = null }
  // "which category has the most funds"
  const mostFunds = !pick && view !== 'stocks' && view !== 'managers' && orderItems.some(o => {
    const nx = items[o.i + 1]
    return nx && nx.p.k === 'fundword' && (nx.p as { plural: boolean }).plural && ['desc', 'asc'].includes((o.it.p as { v: string }).v)
  }) && groupBy !== 'fund'
  const hasCount = items.some(it => it.p.k === 'count') || mostFunds
  const aggItem = items.find(it => it.p.k === 'agg')
  const agg = aggItem ? (aggItem.p as { v: 'total' | 'average' }).v : /^how (big|large)$/.test(measureText) ? 'total' : 'none'
  let sign: MoversState['sign'] = 'any'
  if (mw?.sign && groupBy === 'fund' && (!firstOrder || mw.sign === 'neg') && measure !== 'vsCategory') sign = mw.sign
  if (mw && !mw.sign && measure === 'flow' && INFLOW_TEXT.test(measureText) && !firstOrder && !limit && groupBy === 'fund' && agg === 'none') sign = 'pos'
  if (measure === 'vsCategory' && !firstOrder && mw?.order === 'desc') sign = 'pos'
  if (measure === 'vsCategory' && mw?.sign === 'neg' && !firstOrder) sign = 'neg'
  if (measure === 'rankMove' && !firstOrder && mw?.sign) sign = mw.sign
  if (measure === 'momentum' && !firstOrder) sign = mw?.sign === 'neg' ? 'neg' : 'pos'

  // ---- time ----
  const YTD = /^(this year|ytd|year to date|so far this year|calendar year|this calendar year)$/
  const ytdMonths = ctx.refMonth ? Number(ctx.refMonth.slice(5, 7)) : 12
  const timeItems = items.filter(it => it.p.k === 'time').map(it => {
    const v = (it.p as { v: { win?: number; horizon?: '1Y' | '3Y' | '5Y'; note?: string } }).v
    return YTD.test(it.text) ? { win: ytdMonths, horizon: undefined, note: v.note, ytd: true } : { ...v, ytd: false }
  })
  for (const t of timeItems) if (t.note) notes.push(t.note)
  const months = [...timeMonths, ...timeItems.filter(t => t.win && !t.horizon).map(t => t.win!)]
  const years = [...timeYears, ...timeItems.filter(t => t.horizon).map(t => Number(t.horizon![0]))]
  const finalView: View = view ?? base?.view ?? 'flows'
  const s = view ? freshState(finalView) : structuredCloneState({ ...(base ?? freshState(finalView)), ...freshFilters() })
  if (measure) s.measure = measure
  s.order = order
  if (sinceWin != null) months.push(sinceWin)
  const winChoices = finalView === 'managers' ? MANAGER_WINDOWS : FLOW_WINDOWS
  if (finalView === 'returns' || finalView === 'momentum') {
    if (years.length) s.horizon = nearestHorizon(years[0])
    else if (months.length) {
      s.horizon = '1Y'
      if (months[0] < 12 && !timeItems.some(t => t.ytd)) notes.push('Returns are measured over 1, 3 and 5 years; showing 1 year, the shortest.')
    }
    if (finalView === 'momentum' && s.horizon === '1Y') s.horizon = '3Y'
  } else if (finalView === 'flows' || finalView === 'size' || finalView === 'cost' || finalView === 'managers' || finalView === 'stocks') {
    // "3 year cagr above 25% with inflows": the years belong to the return filter, not the flow window.
    const yearsForReturns = !months.length && years.length > 0 && thresholds.some(t => ['cagr', 'vsCategory', 'volatility', 'drawdown', 'sharpe', 'sortino', 'alpha', 'score'].includes(t.field))
    const want = months.length ? months[0] : years.length && !yearsForReturns ? years[0] * 12 : null
    const choices = (finalView === 'stocks' ? ctx.stockWindows ?? [1, 3] : finalView === 'cost' ? ctx.costWindows ?? winChoices
      : finalView === 'managers' ? winChoices : ctx.flowWindows ?? winChoices) as Win[]
    if (want != null) {
      s.win = nearestWin(want, choices)
      const max = choices[choices.length - 1]
      if (want > max) notes.push(`History here covers ${max} months; showing the full ${max}.`)
      else if (want !== s.win) notes.push(`Windows are ${choices.slice(0, -1).join(', ')} and ${max} months; showing the last ${s.win}.`)
    }
    const yearsAsHorizon = years.length && !months.length
    if (yearsAsHorizon && thresholds.some(t => t.field === 'cagr')) { s.win = 1; s.horizon = nearestHorizon(years[0]) }
  }
  if (thresholds.some(t => t.field === 'cagr' || t.field === 'vsCategory' || t.field === 'volatility' || t.field === 'drawdown') && years.length) s.horizon = nearestHorizon(years[0])
  if (namedMonths > 1 && month) notes.push(`One month at a time: showing ${ym(month)}. Each fund's monthly history is in its row.`)
  if (month && ctx.firstMonth && month < ctx.firstMonth) {
    notes.push(`Monthly history starts at ${ym(ctx.firstMonth)}; showing the latest month instead.`)
    month = null
  }
  if (month && ctx.refMonth && month !== ctx.refMonth && !['flows', 'size', 'managers'].includes(s.view)) {
    notes.push(s.view === 'cost' || s.view === 'stocks'
      ? `Changes here are measured back from the latest month; showing the month to ${ym(ctx.refMonth)}.`
      : `Returns and ranks are as of the latest data, ${ym(ctx.refMonth)}.`)
    month = null
  }
  if (month && ctx.refMonth) {
    if (month > ctx.refMonth) notes.push(`Figures for ${ym(month)} are not disclosed yet; the latest is ${ym(ctx.refMonth)}.`)
    else if (month !== ctx.refMonth) { s.month = month; s.win = 1 }
    else s.win = 1
  }

  // ---- assemble ----
  const pctWord = items.some(it => it.p.k === 'pctmode' || (it.p.k === 'unit' && it.p.v === 'pct' && !it.used))
  if (pctWord) items.forEach(it => { if (it.p.k === 'unit' && it.p.v === 'pct') it.used = true })
  s.mode = pctWord || mw?.pct ? 'pct' : view ? 'abs' : s.mode
  s.sign = sign
  s.groupBy = groupBy
  s.categories = categories
  s.notCategories = [...new Set(notCats)].filter(c => valid.has(c))
  s.amcs = [...new Set(amcs)]
  s.notAmcs = [...new Set(notAmcs)]
  s.themes = [...new Set(themes)]
  s.notThemes = [...new Set(notThemes)]
  s.stockSectors = [...new Set(stockSectors)]
  s.type = type
  s.young = young
  s.risk = [...new Set(risk)]
  s.thresholds = thresholds
  s.stock = stock
  s.action = action
  s.limit = limit
  s.count = hasCount
  s.agg = agg
  if (s.view === 'debt') s.measure = DEFAULT_MEASURE.debt
  const cashOnly = s.categories.length > 0 && s.categories.every(c => c === 'Liquid' || c === 'Money Market')
  if (cashOnly && (s.view === 'flows' || s.view === 'size')) {
    notes.push('Month-end AUM history is not tracked for liquid and money market funds yet; showing their size and cost.')
    s.view = 'debt'; s.measure = 'aum'; s.sign = 'any'
  }

  // ---- a fund's own name ----
  // "kotak emerging equity", "quant active": a run of words that is one fund's name is that fund,
  // not a theme plus a fund type.
  const QUESTION_KINDS = new Set(['measure', 'order', 'cmp', 'num', 'verb', 'stockword', 'mgr', 'count', 'agg', 'time', 'month', 'group',
    'advice', 'stock', 'between', 'since', 'pctmode', 'unit', 'risk', 'neg', 'age', 'groupHint'])
  const nameish = items.filter(it => !(it.p.k === 'word' && (FILLER.has(it.text) || EXTRA_FILLER.has(it.text))) &&
    !['fundword', 'and', 'or', 'noop', 'nocover'].includes(it.p.k))
  let nameQuery = false
  if (nameish.length >= 2 && !items.some(it => QUESTION_KINDS.has(it.p.k))) {
    const NAME_FILLER = new Set(['fund', 'funds', 'scheme', 'schemes', 'plan', 'the', 'of', 'and', 'direct', 'growth', 'option'])
    const all = normalizeSearch(nameish.map(it => it.text).join(' ')).split(' ').filter(Boolean)
    const words = all.filter(w => !NAME_FILLER.has(w)).length ? all.filter(w => !NAME_FILLER.has(w)) : all
    const hits = ctx.fundNames.filter(n => nameMatches(n, words)).length
    if (hits >= 1 && hits <= 5) {
      nameQuery = true
      Object.assign(s, { categories: [], notCategories: [], amcs: [], notAmcs: [], themes: [], notThemes: [], type: 'all', young: 'all', names: words })
      nameish.forEach(it => { it.used = true })
    }
  }

  // ---- notes, advice, leftovers ----
  const advice = items.some(it => it.p.k === 'advice')
  for (const it of items) if (it.p.k === 'nocover') { const n = (it.p as { v: string }).v; if (!notes.includes(n)) notes.push(n) }
  const leftovers = nameQuery ? [] : items.filter(it => it.p.k === 'word' && !it.used && !FILLER.has(it.text) && !EXTRA_FILLER.has(it.text)).map(it => it.text)
  const unknown: string[] = []
  if (leftovers.length) {
    const words = leftovers.map(w => normalizeSearch(w)).filter(Boolean)
    const hits = ctx.fundNames.filter(n => nameMatches(n, words))
    if (hits.length) s.names = words
    else {
      const known = words.filter(w => ctx.fundNames.some(n => (' ' + n + ' ').includes(' ' + w + ' ')))
      if (known.length && known.length < words.length && ctx.fundNames.some(n => known.every(w => (' ' + n + ' ').includes(' ' + w + ' ')))) s.names = known
      unknown.push(...words.filter(w => !s.names.includes(w)))
    }
  }
  // "adani", "tata": several listed companies share the word; say so rather than pick one.
  if (stockContext && !s.stock) {
    for (const w of [...unknown, ...s.names]) {
      const many = ctx.stocks.filter(st => cleanStockName(st.name)[0] === w)
      if (many.length >= 2) {
        notes.push(`Several stocks start with "${w}" (${many.slice(0, 3).map(st => st.name).join(', ')}${many.length > 3 ? ' and more' : ''}); name one to see its buyers and sellers.`)
        const i = unknown.indexOf(w)
        if (i >= 0) unknown.splice(i, 1)
        s.names = s.names.filter(x => x !== w)
        break
      }
    }
  }
  const singular = items.some(it => it.p.k === 'fundword' && !(it.p as { plural: boolean }).plural) &&
    !items.some(it => it.p.k === 'fundword' && (it.p as { plural: boolean }).plural) && !limit && groupBy === 'fund' && (!!firstOrder || !!measure) &&
    s.view !== 'stocks' && s.view !== 'managers' && !s.count && s.agg === 'none'
  const understood = items.some(it => !['word', 'and', 'or', 'fundword'].includes(it.p.k) || it.used) || s.names.length > 0
  if (advice) notes.unshift('FairFund shows what the data says; it does not recommend funds. Here is the data for your question.')
  return { state: s, notes, unknown, advice, understood, singular, corrected }
}

/** Every word is in the fund's search text, whole, or as the start of a word when four letters or more. */
export function nameMatches(searchText: string, words: string[]): boolean {
  const padded = ' ' + searchText + ' '
  return words.every(w => padded.includes(' ' + w + ' ') || (w.length >= 4 && searchText.split(' ').some(x => x.startsWith(w))))
}

function freshFilters(): Partial<MoversState> {
  return {
    sign: 'any', groupBy: 'fund', categories: [], notCategories: [], amcs: [], notAmcs: [], themes: [], notThemes: [],
    stockSectors: [], type: 'all', young: 'all', risk: [], thresholds: [], stock: null, action: 'any', names: [], limit: null,
    month: null, count: false, agg: 'none',
  }
}

export { THEMES }
