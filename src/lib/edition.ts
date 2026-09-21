// ---------------------------------------------------------------------------
// Per-visit "edition" engine for the homepage.
//
// Every page load seeds a tiny PRNG and rotates the hero theme and headline,
// the spotlight fund, the insight facts and the featured categories, so each
// visit surfaces a different, real cut of the bundled data. A "shuffle"
// control re-rolls the seed without a reload. Everything shown is computed
// from funds.json; nothing is invented.
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

export interface EditionTheme {
  hero: string // gradient classes for the hero section
  em: string // accent text classes for the emphasised word + spotlight accents
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

export interface Edition {
  theme: EditionTheme
  headline: EditionHeadline
  spotlight: EditionSpotlight | null
  facts: EditionFact[]
  boardCat: string
  boardWin: '1Y' | '3Y' | '5Y'
  leaderCats: string[]
}

// All class strings are literal so Tailwind's scanner picks them up.
const THEMES: EditionTheme[] = [
  {
    hero: 'from-brand-50/70 to-canvas dark:from-brand-900/20 dark:to-canvas',
    em: 'text-brand-700 dark:text-brand-300',
  },
  {
    hero: 'from-emerald-50/70 to-canvas dark:from-emerald-900/20 dark:to-canvas',
    em: 'text-emerald-700 dark:text-emerald-300',
  },
  {
    hero: 'from-violet-50/70 to-canvas dark:from-violet-900/20 dark:to-canvas',
    em: 'text-violet-700 dark:text-violet-300',
  },
  {
    hero: 'from-amber-50/70 to-canvas dark:from-amber-900/20 dark:to-canvas',
    em: 'text-amber-700 dark:text-amber-300',
  },
]

function headlines(): EditionHeadline[] {
  const n = data.totalFunds
  return [
    {
      pre: 'A ',
      em: 'fair',
      post: ' way to compare mutual funds.',
      sub: `${n} funds. Any time period you pick. Risk, consistency, skill and cost, all in one score.`,
    },
    {
      pre: 'The ',
      em: 'window',
      post: ' decides the winner. Pick yours.',
      sub: `Every one of ${n} funds judged over identical dates. Move the window and every metric recomputes, live.`,
    },
    {
      pre: '',
      em: 'Skill',
      post: ' or luck? The numbers can tell.',
      sub: `Alpha t-stats, batting averages and capture ratios across ${n} funds. No star ratings, no ads.`,
    },
    {
      pre: 'Past returns flatter. ',
      em: 'Evidence',
      post: ' decides.',
      sub: `Rolling windows, drawdowns and manager records for ${n} funds, all judged over the same dates.`,
    },
  ]
}

// --- Spotlight pool: top-ranked funds with statistically credible alpha ----
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
    t.push(
      `Beat the category median in ${Math.round(a.battingAverage.pct)}% of ${a.battingAverage.n} rolling 3-year windows`,
    )
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

// --- Insight facts: each generator returns a fact or null ------------------
const SPREAD_CATS = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Value', 'Focused']

function fundTo(f: Fund): string {
  return `/fund/${f.code}/${fundSlug(f.name)}`
}

function fmtCr(n: number): string {
  if (n >= 100000) return `\u20B9${(n / 100000).toFixed(1)}L Cr`
  if (n >= 1000) return `\u20B9${(n / 1000).toFixed(1)}K Cr`
  return `\u20B9${n.toFixed(0)} Cr`
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
  const pool = funds.filter(
    (f) => f.aum?.changePct != null && (f.aum.current ?? 0) >= 500 && f.aum.changePct > 0,
  )
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
    return (
      m &&
      f.expenseRatio != null &&
      f.expenseRatio > 0 &&
      (m.catSize ?? 0) >= 8 &&
      (m.catRank ?? 99) / (m.catSize ?? 1) <= 0.25 &&
      !f.isDebt
    )
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

const BOARD_CATS = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS']
const BOARD_WINS = ['1Y', '3Y', '5Y'] as const

export function makeEdition(seed: number): Edition {
  const rnd = mulberry32(seed)
  const theme = pick(rnd, THEMES)
  const headline = pick(rnd, headlines())

  const pool = spotlightPool()
  const sf = pool.length ? pick(rnd, pool) : null
  const spotlight: EditionSpotlight | null = sf
    ? { fund: sf, thesis: buildThesis(sf), spark: sf.analytics?.rankTrajectory?.spark ?? null }
    : null

  const candidates = [
    factSpread(rnd),
    factBatting(rnd),
    factDownside(rnd),
    factHotCold(),
    factAum(rnd),
    factCheap(rnd),
    factRegime(rnd),
  ].filter((f): f is EditionFact => !!f)
  const facts = sample(rnd, candidates, Math.min(3, candidates.length))

  const boardCat = pick(rnd, BOARD_CATS)
  const boardWin = pick(rnd, [...BOARD_WINS])

  const leaderPool = categoryOrder.filter(
    (c) => data.categories[c] && (data.categories[c].fundCount ?? 0) >= 6 && topFundsForCategory(c, 1).length > 0,
  )
  const leaderCats = sample(rnd, leaderPool, Math.min(6, leaderPool.length))

  return { theme, headline, spotlight, facts, boardCat, boardWin, leaderCats }
}
