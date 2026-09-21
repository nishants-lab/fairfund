// ---------------------------------------------------------------------------
// Per-visit "edition" engine for the homepage.
//
// Every page load seeds a PRNG and composes the page fresh: hero theme and
// headline, spotlight modules (fund spotlight / head-to-head duel / rank
// movers), insight facts, featured categories, stats band, section order,
// ticker order, "why" card order and the closing CTA. A "shuffle" control
// re-rolls the seed without a reload. Everything shown is computed from
// funds.json; nothing is invented.
// ---------------------------------------------------------------------------
import { data, funds, topFundsForCategory, categoryOrder } from './data'
import { fundSlug } from './format'
import type { Fund } from '../types'

// mulberry32: tiny seeded PRNG, plenty for content shuffling.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)]
}

function sample<T>(rnd: () => number, arr: T[], n: number): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

/* ----------------------------- types ----------------------------------- */

export interface EditionTheme {
  hero: string
  em: string
}

export interface EditionHeadline {
  pre: string
  em: string
  post: string
  sub: string
}

export interface EditionFact {
  eyebrow: string
  stat: string
  text: string
  to: string
}

export interface EditionSpotlight {
  fund: Fund
  thesis: string[]
  spark: number[] | null
}

export interface DuelRow {
  label: string
  a: number
  b: number
  fmt: 'pct' | 'num'
  aBetter: boolean
}

export interface EditionDuel {
  display: string
  a: Fund
  b: Fund
  rows: DuelRow[]
}

export interface MoverItem {
  fund: Fund
  prior: number
  current: number
  peers: number
  spark: number[] | null
}

export interface EditionMovers {
  climbing: MoverItem[]
  fading: MoverItem[]
}

export type ModuleKind = 'spotlight' | 'duel' | 'movers'

export interface EditionStat {
  n: string
  l: string
}

export interface Edition {
  theme: EditionTheme
  headline: EditionHeadline
  strip: { eyebrow: string; h: string }
  modules: ModuleKind[]
  spotlight: EditionSpotlight | null
  duel: EditionDuel | null
  movers: EditionMovers | null
  facts: EditionFact[]
  boardCat: string
  boardWin: '1Y' | '3Y' | '5Y'
  leaderCats: string[]
  stats: EditionStat[]
  whyOrder: number[]
  cta: { h: string; sub: string }
  tickerCats: string[]
  sectionOrder: SectionKey[]
}

export type SectionKey = 'pulse' | 'stats' | 'why' | 'leaders' | 'index'

/* ----------------------------- themes ---------------------------------- */
// All class strings are literal so Tailwind's scanner picks them up.
const THEMES: EditionTheme[] = [
  { hero: 'bg-gradient-to-b from-brand-50/70 to-canvas dark:from-brand-900/20 dark:to-canvas', em: 'text-brand-700 dark:text-brand-300' },
  { hero: 'bg-gradient-to-br from-emerald-50/70 to-canvas dark:from-emerald-900/20 dark:to-canvas', em: 'text-emerald-700 dark:text-emerald-300' },
  { hero: 'bg-gradient-to-b from-violet-50/70 to-canvas dark:from-violet-900/20 dark:to-canvas', em: 'text-violet-700 dark:text-violet-300' },
  { hero: 'bg-gradient-to-br from-amber-50/70 to-canvas dark:from-amber-900/20 dark:to-canvas', em: 'text-amber-700 dark:text-amber-300' },
  { hero: 'bg-gradient-to-b from-rose-50/70 to-canvas dark:from-rose-900/20 dark:to-canvas', em: 'text-rose-700 dark:text-rose-300' },
  { hero: 'bg-gradient-to-br from-cyan-50/70 to-canvas dark:from-cyan-900/20 dark:to-canvas', em: 'text-cyan-700 dark:text-cyan-300' },
  { hero: 'bg-gradient-to-b from-indigo-50/70 to-canvas dark:from-indigo-900/20 dark:to-canvas', em: 'text-indigo-700 dark:text-indigo-300' },
  { hero: 'bg-gradient-to-br from-teal-50/70 to-canvas dark:from-teal-900/20 dark:to-canvas', em: 'text-teal-700 dark:text-teal-300' },
  { hero: 'bg-gradient-to-b from-fuchsia-50/70 to-canvas dark:from-fuchsia-900/20 dark:to-canvas', em: 'text-fuchsia-700 dark:text-fuchsia-300' },
  { hero: 'bg-gradient-to-br from-sky-50/70 to-canvas dark:from-sky-900/20 dark:to-canvas', em: 'text-sky-700 dark:text-sky-300' },
]

/* ---------------------------- headlines --------------------------------- */

function headlines(): EditionHeadline[] {
  const n = data.totalFunds
  return [
    { pre: 'A ', em: 'fair', post: ' way to compare mutual funds.', sub: `${n} funds. Any time period you pick. Risk, consistency, skill and cost, all in one score.` },
    { pre: 'The ', em: 'window', post: ' decides the winner. Pick yours.', sub: `Every one of ${n} funds judged over identical dates. Move the window and every metric recomputes, live.` },
    { pre: '', em: 'Skill', post: ' or luck? The numbers can tell.', sub: `Alpha t-stats, batting averages and capture ratios across ${n} funds. No star ratings, no ads.` },
    { pre: 'Past returns flatter. ', em: 'Evidence', post: ' decides.', sub: `Rolling windows, drawdowns and manager records for ${n} funds, all judged over the same dates.` },
    { pre: 'Star ratings are ', em: 'opinions', post: '. These are measurements.', sub: `Batting averages, capture ratios and alpha confidence for ${n} funds, refreshed with every NAV.` },
    { pre: 'Every fund, judged on the ', em: 'same', post: ' dates.', sub: 'No cherry-picked inception returns. Move the window and watch the leaderboard reshuffle in front of you.' },
    { pre: 'Your fund looks good. ', em: 'Compared', post: ' to what?', sub: `Rank any of ${n} funds against its true peers over any window you choose.` },
    { pre: 'Drawdowns, not ', em: 'dreams', post: '.', sub: `See how ${n} funds behaved in crashes, corrections and bull runs before you commit a rupee.` },
    { pre: 'Cut through the ', em: 'noise', post: '. Keep the signal.', sub: `${n} funds distilled into the few numbers that actually predict persistence.` },
    { pre: 'Buy the ', em: 'process', post: ', not the past.', sub: `Manager records, holdings churn and consistency scores across ${n} funds.` },
    { pre: 'Would your fund still ', em: 'win', post: ' on fair terms?', sub: `Same dates, same peers, same math for all ${n} funds. Most winners change.` },
    { pre: 'Returns are loud. ', em: 'Risk', post: ' whispers.', sub: `Sortino ratios, drawdown depth and down-capture for ${n} funds, side by side.` },
  ]
}

const STRIP_TITLES: { eyebrow: string; h: string }[] = [
  { eyebrow: "Today's edition", h: 'A different cut of the data, every visit' },
  { eyebrow: 'Fresh angles', h: 'What the data is saying right now' },
  { eyebrow: "This visit's cut", h: 'Stories the category averages hide' },
  { eyebrow: 'From the data desk', h: 'Signals worth a second look' },
  { eyebrow: 'Rotating spotlight', h: 'Real funds, real numbers, new every load' },
  { eyebrow: 'The daily shuffle', h: 'Same data, another honest angle' },
]

/* --------------------------- spotlight ---------------------------------- */

let _spotlightPool: Fund[] | null = null
function spotlightPool(): Fund[] {
  if (_spotlightPool) return _spotlightPool
  const base = (minConf: number, minBat: number) =>
    funds.filter((f) => {
      const m = f.metrics['3Y']
      const a = f.analytics
      if (!m || !a || f.isYoung || f.isDebt || f.isArbitrage) return false
      // Passive funds have no manager skill story; keep the spotlight active-only.
      if (f.category.startsWith('Index')) return false
      if ((m.catRank ?? 99) > 5 || (m.catSize ?? 0) < 8) return false
      if ((a.alpha?.confidence ?? 0) < minConf) return false
      if ((a.battingAverage?.pct ?? 0) < minBat) return false
      return true
    })
  let pool = base(90, 55)
  if (pool.length < 8) pool = base(80, 50)
  _spotlightPool = pool
  return pool
}

function buildThesis(f: Fund): string[] {
  const m = f.metrics['3Y']!
  const a = f.analytics!
  const t: string[] = []
  t.push(`Ranked #${m.catRank} of ${m.catSize} in ${f.categoryDisplay} over a fixed 3-year window`)
  if (a.battingAverage?.pct != null)
    t.push(`Beat the category median in ${Math.round(a.battingAverage.pct)}% of ${a.battingAverage.n} rolling 3-year windows`)
  if (a.alpha?.confidence != null)
    t.push(
      a.alpha.couldBeLuck
        ? `${Math.round(a.alpha.confidence)}% confidence its alpha reflects skill`
        : `${Math.round(a.alpha.confidence)}% statistical confidence its alpha is skill, not luck`,
    )
  if (a.capture?.down != null && a.capture.down < 95)
    t.push(`Captured only ${Math.round(a.capture.down)}% of the category's down months`)
  return t.slice(0, 3)
}

/* ------------------------------ duel ------------------------------------ */

const DUEL_CATS = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Value', 'Focused', 'Multi Cap', 'Large & Mid Cap', 'Dividend Yield']

function buildDuel(rnd: () => number): EditionDuel | null {
  const cats = sample(rnd, DUEL_CATS, DUEL_CATS.length)
  for (const c of cats) {
    const top = topFundsForCategory(c, 2)
    if (top.length < 2) continue
    const [a, b] = top
    const ma = a.metrics['3Y']
    const mb = b.metrics['3Y']
    if (!ma || !mb) continue
    const rows: DuelRow[] = [
      { label: '3Y CAGR', a: ma.cagr, b: mb.cagr, fmt: 'pct', aBetter: ma.cagr >= mb.cagr },
      { label: 'Sharpe', a: ma.sharpe, b: mb.sharpe, fmt: 'num', aBetter: ma.sharpe >= mb.sharpe },
      { label: 'Max drawdown', a: ma.maxDrawdown, b: mb.maxDrawdown, fmt: 'pct', aBetter: ma.maxDrawdown >= mb.maxDrawdown },
    ]
    return { display: data.categories[c]?.display ?? c, a, b, rows }
  }
  return null
}

/* ----------------------------- movers ----------------------------------- */

function buildMovers(rnd: () => number): EditionMovers | null {
  const eligible = (dir: 'climbing' | 'fading') =>
    funds.filter((f) => {
      const r = f.analytics?.rankTrajectory
      return r && r.direction === dir && !r.limited && (r.currentPeers ?? 0) >= 8 && r.priorRank !== r.currentRank
    })
  const by = (dir: 'climbing' | 'fading') => {
    const p = eligible(dir)
    p.sort((x, y) => {
      const rx = x.analytics!.rankTrajectory!
      const ry = y.analytics!.rankTrajectory!
      const dx = Math.abs(rx.priorRank - rx.currentRank)
      const dy = Math.abs(ry.priorRank - ry.currentRank)
      return dy - dx
    })
    return sample(rnd, p.slice(0, 12), Math.min(3, p.length)).map((f) => {
      const r = f.analytics!.rankTrajectory!
      return { fund: f, prior: r.priorRank, current: r.currentRank, peers: r.currentPeers, spark: r.spark ?? null }
    })
  }
  const climbing = by('climbing')
  const fading = by('fading')
  if (!climbing.length && !fading.length) return null
  return { climbing, fading }
}

/* ------------------------------ facts ----------------------------------- */

const SPREAD_CATS = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Value', 'Focused']

function fundTo(f: Fund): string {
  return `/fund/${f.code}/${fundSlug(f.name)}`
}

function fmtCr(n: number): string {
  if (n >= 100000) return `\u20B9${(n / 100000).toFixed(1)}L Cr`
  if (n >= 1000) return `\u20B9${(n / 1000).toFixed(1)}K Cr`
  return `\u20B9${n.toFixed(0)} Cr`
}

function monthYear(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
}

function factSpread(rnd: () => number): EditionFact | null {
  const spreads = SPREAD_CATS.map((c) => {
    const cs = funds.filter((f) => f.category === c && f.metrics['3Y']?.cagr != null)
    if (cs.length < 10) return null
    const vals = cs.map((f) => f.metrics['3Y']!.cagr)
    return { c, spread: Math.max(...vals) - Math.min(...vals) }
  }).filter((x): x is { c: string; spread: number } => !!x)
  if (!spreads.length) return null
  spreads.sort((a, b) => b.spread - a.spread)
  const s = pick(rnd, spreads.slice(0, 3))
  const display = data.categories[s.c]?.display ?? s.c
  return {
    eyebrow: 'The spread',
    stat: `${s.spread.toFixed(1)}%/yr`,
    text: `separates the best from the worst ${display} fund over the same 3 years. Category averages hide it.`,
    to: `/explore?cat=${encodeURIComponent(s.c)}`,
  }
}

function factBatting(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => {
    const b = f.analytics?.battingAverage
    return b?.pct != null && (b.n ?? 0) >= 60 && !f.isDebt
  })
  if (!pool.length) return null
  pool.sort((a, b) => b.analytics!.battingAverage!.pct - a.analytics!.battingAverage!.pct)
  const f = pick(rnd, pool.slice(0, 6))
  const b = f.analytics!.battingAverage!
  return {
    eyebrow: 'Consistency',
    stat: `${Math.round(b.pct)}%`,
    text: `of ${b.n} rolling 3-year windows saw ${f.name} beat its category median.`,
    to: fundTo(f),
  }
}

function factDownside(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => {
    const m = f.metrics['3Y']
    const d = f.analytics?.capture?.down
    return m && (m.catRank ?? 99) <= 5 && (m.catSize ?? 0) >= 8 && d != null && d <= 90 && !f.isDebt
  })
  if (!pool.length) return null
  pool.sort((a, b) => (a.analytics!.capture!.down ?? 999) - (b.analytics!.capture!.down ?? 999))
  const f = pick(rnd, pool.slice(0, 6))
  const m = f.metrics['3Y']!
  return {
    eyebrow: 'Downside shield',
    stat: `${Math.round(f.analytics!.capture!.down!)}%`,
    text: `of category down-months is all ${f.name} captures, while ranking #${m.catRank} in ${f.categoryDisplay}.`,
    to: fundTo(f),
  }
}

function factUpCapture(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => {
    const m = f.metrics['3Y']
    const u = f.analytics?.capture?.up
    return m && (m.catRank ?? 99) <= 5 && (m.catSize ?? 0) >= 8 && u != null && u >= 110 && !f.isDebt
  })
  if (!pool.length) return null
  pool.sort((a, b) => (b.analytics!.capture!.up ?? 0) - (a.analytics!.capture!.up ?? 0))
  const f = pick(rnd, pool.slice(0, 6))
  const m = f.metrics['3Y']!
  return {
    eyebrow: 'Offense wins',
    stat: `${Math.round(f.analytics!.capture!.up!)}%`,
    text: `of category up-months captured by ${f.name}, ranked #${m.catRank} in ${f.categoryDisplay}.`,
    to: fundTo(f),
  }
}

function factHotCold(): EditionFact | null {
  let hot = 0
  let cold = 0
  for (const f of funds) {
    const st = f.analytics?.meanReversion?.state
    if (st === 'hot') hot++
    else if (st === 'cold') cold++
  }
  if (!hot && !cold) return null
  return {
    eyebrow: 'Hot and cold',
    stat: `${hot} hot, ${cold} cold`,
    text: 'funds are currently running well above or below their own long-run pace.',
    to: '/movers',
  }
}

function factAum(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => f.aum?.changePct != null && (f.aum.current ?? 0) >= 500 && f.aum.changePct > 0)
  if (!pool.length) return null
  pool.sort((a, b) => (b.aum!.changePct ?? 0) - (a.aum!.changePct ?? 0))
  const f = pick(rnd, pool.slice(0, 6))
  return {
    eyebrow: 'Money in motion',
    stat: `+${f.aum!.changePct!.toFixed(1)}%`,
    text: `AUM growth last month at ${f.name}, now ${fmtCr(f.aum!.current)}.`,
    to: fundTo(f),
  }
}

function factCheap(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => {
    const m = f.metrics['3Y']
    return m && f.expenseRatio != null && f.expenseRatio > 0 && (m.catSize ?? 0) >= 8 && (m.catRank ?? 99) / (m.catSize ?? 1) <= 0.25 && !f.isDebt
  })
  if (!pool.length) return null
  pool.sort((a, b) => (a.expenseRatio ?? 9) - (b.expenseRatio ?? 9))
  const f = pick(rnd, pool.slice(0, 6))
  return {
    eyebrow: 'Cost matters',
    stat: `${f.expenseRatio!.toFixed(2)}%`,
    text: `expense ratio at ${f.name}, still top-quartile in ${f.categoryDisplay} over 3 years.`,
    to: fundTo(f),
  }
}

function factRegime(rnd: () => number): EditionFact | null {
  const pool = funds
    .map((f) => {
      const m = f.metrics['3Y']
      const r = f.analytics?.regimes?.find((x) => x.name === '2022 correction')
      if (!m || (m.catRank ?? 99) > 10 || r?.alpha == null || r.alpha <= 0) return null
      return { f, alpha: r.alpha }
    })
    .filter((x): x is { f: Fund; alpha: number } => !!x)
  if (!pool.length) return null
  pool.sort((a, b) => b.alpha - a.alpha)
  const p = pick(rnd, pool.slice(0, 6))
  return {
    eyebrow: 'Stress-tested',
    stat: `+${p.alpha.toFixed(1)}% alpha`,
    text: `is what ${p.f.name} added during the 2022 correction, when most funds just fell.`,
    to: fundTo(p.f),
  }
}

function factCovid(rnd: () => number): EditionFact | null {
  const pool = funds
    .map((f) => {
      const m = f.metrics['3Y']
      const r = f.analytics?.regimes?.find((x) => x.name === 'COVID crash')
      if (!m || (m.catRank ?? 99) > 10 || r?.alpha == null || r.alpha <= 0) return null
      return { f, alpha: r.alpha }
    })
    .filter((x): x is { f: Fund; alpha: number } => !!x)
  if (!pool.length) return null
  pool.sort((a, b) => b.alpha - a.alpha)
  const p = pick(rnd, pool.slice(0, 6))
  return {
    eyebrow: 'Crash test',
    stat: `+${p.alpha.toFixed(1)}% alpha`,
    text: `is what ${p.f.name} preserved versus its category during the COVID crash itself.`,
    to: fundTo(p.f),
  }
}

function factSigAlpha(): EditionFact | null {
  const n = funds.filter((f) => f.analytics?.alpha?.couldBeLuck === false).length
  if (!n) return null
  return {
    eyebrow: 'Rare skill',
    stat: `${n} of ${data.totalFunds}`,
    text: 'funds show alpha too consistent to be luck at 95% confidence. We flag every one.',
    to: '/explore',
  }
}

function factClimber(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => {
    const r = f.analytics?.rankTrajectory
    return r && r.direction === 'climbing' && !r.limited && (r.currentPeers ?? 0) >= 8 && r.priorRank - r.currentRank >= 2
  })
  if (!pool.length) return null
  pool.sort((a, b) => {
    const ra = a.analytics!.rankTrajectory!
    const rb = b.analytics!.rankTrajectory!
    return rb.priorRank - rb.currentRank - (ra.priorRank - ra.currentRank)
  })
  const f = pick(rnd, pool.slice(0, 6))
  const r = f.analytics!.rankTrajectory!
  return {
    eyebrow: 'On the rise',
    stat: `#${r.currentRank}`,
    text: `${f.name} now ranks #${r.currentRank} of ${r.currentPeers} in ${f.categoryDisplay}, up from #${r.priorRank}.`,
    to: fundTo(f),
  }
}

function factFader(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => {
    const r = f.analytics?.rankTrajectory
    return r && r.direction === 'fading' && !r.limited && (r.currentPeers ?? 0) >= 8 && r.currentRank - r.priorRank >= 2
  })
  if (!pool.length) return null
  pool.sort((a, b) => {
    const ra = a.analytics!.rankTrajectory!
    const rb = b.analytics!.rankTrajectory!
    return rb.currentRank - rb.priorRank - (ra.currentRank - ra.priorRank)
  })
  const f = pick(rnd, pool.slice(0, 6))
  const r = f.analytics!.rankTrajectory!
  return {
    eyebrow: 'Losing steam',
    stat: `#${r.currentRank}`,
    text: `${f.name} slipped to #${r.currentRank} of ${r.currentPeers} in ${f.categoryDisplay}, from #${r.priorRank}. Momentum cuts both ways.`,
    to: fundTo(f),
  }
}

function factYoung(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => f.isYoung && f.si?.cagr != null && (f.navPoints ?? 0) >= 250 && !f.isDebt && !f.category.startsWith('Index'))
  if (!pool.length) return null
  pool.sort((a, b) => (b.si!.cagr ?? 0) - (a.si!.cagr ?? 0))
  const f = pick(rnd, pool.slice(0, 6))
  return {
    eyebrow: 'New fund watch',
    stat: `${f.si!.cagr!.toFixed(1)}%/yr`,
    text: `since-inception pace at ${f.name}, live since ${monthYear(f.si!.since)}. Too young for a full verdict.`,
    to: fundTo(f),
  }
}

function factOldest(rnd: () => number): EditionFact | null {
  const pool = funds.filter((f) => f.inceptionDate && f.metrics['5Y'] && f.metrics['3Y']?.catRank != null)
  if (!pool.length) return null
  pool.sort((a, b) => (a.inceptionDate! < b.inceptionDate! ? -1 : 1))
  const f = pick(rnd, pool.slice(0, 6))
  const m = f.metrics['3Y']!
  return {
    eyebrow: 'Endurance',
    stat: String(new Date(f.inceptionDate!).getFullYear()),
    text: `is when ${f.name} launched. Every cycle since, and it currently ranks #${m.catRank} of ${m.catSize} in ${f.categoryDisplay}.`,
    to: fundTo(f),
  }
}

function factBench(): EditionFact | null {
  const counts = new Map<string, number>()
  for (const f of funds) {
    const m = f.metrics['3Y']
    if (!m || (m.catSize ?? 0) < 8 || f.isDebt) continue
    if ((m.catRank ?? 99) / (m.catSize ?? 1) <= 0.25) counts.set(f.amc, (counts.get(f.amc) ?? 0) + 1)
  }
  let best: [string, number] | null = null
  for (const e of counts) if (!best || e[1] > best[1]) best = e
  if (!best) return null
  return {
    eyebrow: 'Depth of bench',
    stat: `${best[1]} funds`,
    text: `from ${best[0]} sit in the top quartile of their categories right now, the deepest bench of any house.`,
    to: '/explore',
  }
}

function factHoldings(): EditionFact | null {
  const n = (data as unknown as { holdingsCoverage?: { stock_level?: number } }).holdingsCoverage?.stock_level
  if (!n) return null
  return {
    eyebrow: 'Under the hood',
    stat: String(n),
    text: 'funds with stock-level holdings disclosed, so you can see every bet a manager makes.',
    to: '/methodology',
  }
}

/* --------------------------- stats band --------------------------------- */

function statsPool(): EditionStat[] {
  const sig = funds.filter((f) => f.analytics?.alpha?.couldBeLuck === false).length
  const tenYr = funds.filter((f) => (f.navPoints ?? 0) >= 2500).length
  const active = funds.filter((f) => !f.isDebt && !f.isArbitrage && !f.category.startsWith('Index')).length
  const stock = (data as unknown as { holdingsCoverage?: { stock_level?: number } }).holdingsCoverage?.stock_level
  const pool: EditionStat[] = [
    { n: String(data.totalFunds), l: 'funds tracked and ranked' },
    { n: String(categoryOrder.length), l: 'categories, every one covered' },
    { n: 'Zero', l: 'ads, ratings-for-sale or commissions' },
    { n: String(tenYr), l: 'funds with 10+ years of daily NAV history' },
    { n: String(active), l: 'actively managed equity funds under the lens' },
    { n: String(sig), l: 'funds whose alpha clears 95% statistical confidence' },
  ]
  if (stock) pool.push({ n: String(stock), l: 'funds with stock-level holdings disclosed' })
  return pool
}

/* ------------------------------ CTA -------------------------------------- */

const CTAS: { h: string; sub: string }[] = [
  { h: 'Start with a fund you already own.', sub: 'See how it really ranks once everyone is judged over the same window, then decide if it still deserves your money.' },
  { h: 'Your SIP deserves better than a star rating.', sub: 'Check any fund against its true peers over the window that matters to you.' },
  { h: 'Five minutes here can save five years of mediocre returns.', sub: 'Look up a fund, move the window, and see if the story still holds.' },
  { h: 'Stop comparing apples to last year\u2019s oranges.', sub: 'Same dates, same peers, same math. That is the whole trick.' },
  { h: 'The best fund is the one that fits your window.', sub: 'Pick a period that matches your horizon and let the leaderboard reshuffle.' },
]

/* ------------------------------ board ------------------------------------ */

export const BOARD_CATS = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Value', 'Focused', 'Multi Cap']
const BOARD_WINS = ['1Y', '3Y', '5Y'] as const

const TICKER_CATS = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Value', 'Focused', 'Dividend Yield']

const SECTIONS: SectionKey[] = ['pulse', 'stats', 'why', 'leaders', 'index']

/* ---------------------------- makeEdition -------------------------------- */

export function makeEdition(seed: number): Edition {
  const rnd = mulberry32(seed)
  const theme = pick(rnd, THEMES)
  const headline = pick(rnd, headlines())
  const strip = pick(rnd, STRIP_TITLES)

  // Modules: 1 or 2 feature cards, facts fill the rest of the grid.
  const moduleCount = rnd() < 0.45 ? 1 : 2
  let modules = sample(rnd, ['spotlight', 'duel', 'movers'] as ModuleKind[], moduleCount)

  const pool = spotlightPool()
  const sf = pool.length ? pick(rnd, pool) : null
  const spotlight: EditionSpotlight | null =
    sf && modules.includes('spotlight')
      ? { fund: sf, thesis: buildThesis(sf), spark: sf.analytics?.rankTrajectory?.spark ?? null }
      : null
  const duel = modules.includes('duel') ? buildDuel(rnd) : null
  const movers = modules.includes('movers') ? buildMovers(rnd) : null

  // Drop any module whose data failed to build; guarantee at least one.
  modules = modules.filter((m) => (m === 'spotlight' ? !!spotlight : m === 'duel' ? !!duel : !!movers))
  let spotlightFinal = spotlight
  if (!modules.length && sf) {
    modules = ['spotlight']
    spotlightFinal = { fund: sf, thesis: buildThesis(sf), spark: sf.analytics?.rankTrajectory?.spark ?? null }
  }

  const candidates = [
    factSpread(rnd),
    factBatting(rnd),
    factDownside(rnd),
    factUpCapture(rnd),
    factHotCold(),
    factAum(rnd),
    factCheap(rnd),
    factRegime(rnd),
    factCovid(rnd),
    factSigAlpha(),
    factClimber(rnd),
    factFader(rnd),
    factYoung(rnd),
    factOldest(rnd),
    factBench(),
    factHoldings(),
  ].filter((f): f is EditionFact => !!f)
  const factCount = modules.length === 1 ? 2 : 4
  const facts = sample(rnd, candidates, Math.min(factCount, candidates.length))

  const boardCat = pick(rnd, BOARD_CATS)
  const boardWin = pick(rnd, [...BOARD_WINS])

  const leaderPool = categoryOrder.filter(
    (c) => data.categories[c] && (data.categories[c].fundCount ?? 0) >= 6 && topFundsForCategory(c, 1).length > 0,
  )
  const leaderCats = sample(rnd, leaderPool, Math.min(6, leaderPool.length))

  const stats = sample(rnd, statsPool(), 3)
  const whyOrder = sample(rnd, [0, 1, 2], 3)
  const cta = pick(rnd, CTAS)
  const tickerCats = sample(rnd, TICKER_CATS, TICKER_CATS.length)
  const sectionOrder = sample(rnd, SECTIONS, SECTIONS.length)

  return {
    theme,
    headline,
    strip,
    modules,
    spotlight: spotlightFinal,
    duel,
    movers,
    facts,
    boardCat,
    boardWin,
    leaderCats,
    stats,
    whyOrder,
    cta,
    tickerCats,
    sectionOrder,
  }
}
