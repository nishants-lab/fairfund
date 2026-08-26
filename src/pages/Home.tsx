import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import SearchBox from '../components/SearchBox'
import { data, funds, topFundsForCategory, categoryOrder } from '../lib/data'
import { getCategoryColor } from '../lib/categoryColors'
import { signedPct, pct, alphaColor, fundSlug } from '../lib/format'
import { useNavFreshness, fmtNavDate } from '../lib/navFreshness'
import type { Fund } from '../types'

/** Performance tier classification for category cards */
function cagrTier(cagr: number | null | undefined): 'high' | 'normal' | 'low' {
  if (!cagr) return 'normal'
  if (cagr >= 15) return 'high'
  if (cagr < 12) return 'low'
  return 'normal'
}

const tierCagrColor = {
  high: 'text-emerald-700 dark:text-emerald-400 font-extrabold',
  normal: 'text-fg font-bold',
  low: 'text-amber-700 dark:text-amber-400 font-bold',
} as const

/* ------------------------------------------------------------------ */
/* Reshuffling leaderboard: the hero proof that the window decides     */
/* the winner. All real bundle data, top 5 by CAGR per window.         */
/* ------------------------------------------------------------------ */
const DEMO_CATS = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS'] as const
const DEMO_WINDOWS = ['1Y', '3Y', '5Y'] as const
type DemoWindow = (typeof DEMO_WINDOWS)[number]
const ROW_H = 58

function ReshuffleBoard() {
  const navigate = useNavigate()
  const [cat, setCat] = useState<string>(DEMO_CATS[0])
  const [win, setWin] = useState<DemoWindow>('1Y')

  const demo = useMemo(() => {
    const catFunds = funds.filter((f) => f.category === cat)
    const byWin = {} as Record<DemoWindow, Fund[]>
    for (const w of DEMO_WINDOWS) {
      byWin[w] = catFunds
        .filter((f) => f.metrics[w]?.cagr != null)
        .sort((a, b) => (b.metrics[w]?.cagr ?? -999) - (a.metrics[w]?.cagr ?? -999))
        .slice(0, 5)
    }
    const union: Fund[] = []
    for (const w of DEMO_WINDOWS)
      for (const f of byWin[w]) if (!union.some((u) => u.code === f.code)) union.push(f)
    return { byWin, union }
  }, [cat])

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="eyebrow text-[11px] font-bold uppercase text-faint">Live from our data</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-fg">Top 5 {cat} funds by CAGR</div>
        </div>
        <div className="flex rounded-lg border border-line p-0.5" role="tablist" aria-label="Return window">
          {DEMO_WINDOWS.map((w) => (
            <button
              key={w}
              role="tab"
              aria-selected={win === w}
              onClick={() => setWin(w)}
              className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                win === w
                  ? 'bg-brand-600 text-white'
                  : 'text-muted hover:bg-surface2 hover:text-fg'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      <div
        className="flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-5"
        role="tablist"
        aria-label="Category"
      >
        {DEMO_CATS.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={cat === c}
            onClick={() => setCat(c)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              cat === c ? 'bg-fg text-canvas' : 'bg-surface2 text-muted hover:text-fg'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="relative" style={{ height: ROW_H * 5 }}>
        {demo.union.map((f) => {
          const idx = demo.byWin[win].findIndex((x) => x.code === f.code)
          const visible = idx >= 0
          const m = f.metrics[win]
          return (
            <button
              key={f.code}
              onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
              tabIndex={visible ? 0 : -1}
              aria-hidden={!visible}
              className="group absolute inset-x-0 flex items-center gap-3 px-4 text-left transition-all duration-700 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:bg-surface2/70 sm:px-5"
              style={{
                height: ROW_H,
                transform: `translateY(${(visible ? idx : 5.4) * ROW_H}px)`,
                opacity: visible ? 1 : 0,
                pointerEvents: visible ? 'auto' : 'none',
              }}
            >
              <span className="w-5 shrink-0 font-display text-xl italic text-faint">{visible ? idx + 1 : ''}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300">
                  {f.name}
                </span>
                <span className={`text-xs font-medium ${alphaColor(m?.alpha ?? 0)}`}>
                  {signedPct(m?.alpha)} vs category
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-base font-extrabold text-fg">{pct(m?.cagr)}</span>
                <span className="text-[10px] uppercase tracking-wide text-faint">CAGR</span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="border-t border-line bg-surface2/50 px-4 py-2.5 text-xs leading-relaxed text-muted sm:px-5">
        The order reshuffles as the window moves. Tap any fund for its full report.
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export default function Home() {
  usePageMeta(undefined, 'Forward-looking mutual fund research for India. Compare funds fairly over any time period with scientific, probability-based signals.')
  const navDate = useNavFreshness()
  const navigate = useNavigate()

  // Ticker: real category leaders from the bundle
  const tickerItems = useMemo(() => {
    const cats = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Value', 'Focused', 'Dividend Yield']
    const items: { label: string; value: string; tone: string; to: string }[] = []
    for (const c of cats) {
      const f = topFundsForCategory(c, 1)[0]
      const m = f?.metrics['3Y']
      if (!f || !m) continue
      items.push({
        label: `${data.categories[c]?.display ?? c} leader`,
        value: `${f.name} ${signedPct(m.alpha)}/yr alpha`,
        tone: (m.alpha ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
        to: `/fund/${f.code}/${fundSlug(f.name)}`,
      })
    }
    return items
  }, [])

  const categoryCards = categoryOrder
    .filter((c) => data.categories[c])
    .map((c) => ({
      key: c,
      display: data.categories[c].display ?? c,
      fundCount: data.categories[c].fundCount,
      medianCagr5Y: data.categories[c].medianCagr5Y,
    }))

  const sortedByMedian = [...categoryCards]
    .filter((c) => c.medianCagr5Y != null)
    .sort((a, b) => (b.medianCagr5Y ?? 0) - (a.medianCagr5Y ?? 0))
  const top3Keys = new Set(sortedByMedian.slice(0, 3).map((c) => c.key))

  const highlights = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Sectoral/Thematic']
    .map((c) => topFundsForCategory(c, 1)[0])
    .filter(Boolean)
    .slice(0, 6)

  return (
    <div className="overflow-x-hidden">
      {/* Live ticker */}
      <div className="ticker-wrap border-b border-line bg-surface" aria-hidden="true">
        <div className="ticker flex items-center gap-10 whitespace-nowrap py-2 pl-4 text-xs">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center gap-10">
              <span className="flex items-center gap-2 text-muted">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                NAV updated <strong className="font-semibold text-fg">{fmtNavDate(navDate)}</strong>
              </span>
              <span className="text-muted">
                <strong className="font-semibold text-fg">{data.totalFunds}</strong> equity funds tracked across{' '}
                <strong className="font-semibold text-fg">{categoryOrder.length}</strong> categories
              </span>
              {tickerItems.map((t, i) => (
                <span key={i} className="text-muted">
                  <span className="eyebrow mr-1.5 text-[10px] font-bold uppercase text-faint">{t.label}</span>
                  <span className={`font-semibold ${t.tone}`}>{t.value}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Hero: editorial, asymmetric */}
      <section className="relative border-b border-line bg-gradient-to-b from-brand-50/70 to-canvas dark:from-brand-900/20 dark:to-canvas">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-12 pt-10 md:pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pb-16">
          <div className="min-w-0">
            <h1 className="rise text-[clamp(2.4rem,5.2vw+0.8rem,4rem)] font-semibold leading-[1.04] tracking-tight text-fg">
              Fund research
              <br />
              that plays{' '}
              <em className="text-brand-700 dark:text-brand-300">fair.</em>
            </h1>
            <p className="rise rise-1 mt-5 max-w-lg text-lg leading-relaxed text-muted">
              All <strong className="font-semibold text-fg">{data.totalFunds}</strong> Indian equity
              funds, ranked over any time period you pick.
            </p>
            <div className="rise rise-2 relative z-30 mt-7 max-w-xl">
              <SearchBox large autoFocus placeholder="Search any fund, AMC or category" />
            </div>
          </div>
          <div className="rise rise-2 min-w-0">
            <ReshuffleBoard />
          </div>
        </div>
      </section>

      {/* Stats band */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-6xl grid-cols-2 px-4 md:grid-cols-4 md:divide-x md:divide-line">
          {[
            { n: String(data.totalFunds), l: 'equity funds, full AMFI universe' },
            { n: String(categoryOrder.length), l: 'categories, every one covered' },
            { n: 'Daily', l: `NAV refresh, latest ${fmtNavDate(navDate)}` },
            { n: 'Zero', l: 'ads, ratings-for-sale or commissions' },
          ].map((s) => (
            <div key={s.l} className="px-4 py-6 first:pl-0 md:py-7">
              <div className="font-display text-3xl font-semibold text-fg md:text-4xl">{s.n}</div>
              <div className="mt-1 text-xs leading-snug text-muted md:text-sm">{s.l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Why FairFund: numbered editorial columns */}
      <section className="mx-auto max-w-6xl px-4 py-14 md:py-16">
        <div className="max-w-2xl">
          <div className="eyebrow text-xs font-bold uppercase text-faint">Why FairFund</div>
          <h2 className="mt-2 text-2xl font-semibold text-fg md:text-3xl">
            Most fund sites answer <em>what returned the most</em>. We answer{' '}
            <em>what is likely to keep doing it</em>.
          </h2>
        </div>
        <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-3">
          {[
            {
              n: '01',
              t: 'Fair windows',
              d: 'Every fund is judged over the same dates, so young funds cannot flatter themselves with cherry-picked inception returns. Move the window and every metric recomputes live.',
              to: '/explore',
              cta: 'Explore funds',
            },
            {
              n: '02',
              t: 'Skill, separated from luck',
              d: 'Alpha t-stats, consistency, up and down capture, probability cones and rolling-return distributions instead of black-box star ratings.',
              to: '/methodology',
              cta: 'Read the methodology',
            },
            {
              n: '03',
              t: 'Under the hood',
              d: 'Month-on-month holdings changes, stock-level moves priced from the day of the trade, and manager track records across every fund they run.',
              to: highlights[0] ? `/fund/${highlights[0].code}/${fundSlug(highlights[0].name)}` : '/explore',
              cta: 'See a live example',
            },
          ].map((c) => (
            <div key={c.n} className="border-t-2 border-fg/80 pt-4">
              <div className="font-display text-sm italic text-faint">{c.n}</div>
              <h3 className="mt-1.5 text-lg font-semibold text-fg">{c.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{c.d}</p>
              <Link
                to={c.to}
                className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
              >
                {c.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Category leaders */}
      <section className="border-y border-line bg-surface2/50 dark:bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="eyebrow text-xs font-bold uppercase text-faint">Category leaders</div>
              <h2 className="mt-2 text-2xl font-semibold text-fg">The current No. 1 in each major category</h2>
              <p className="mt-1 text-sm text-muted">By risk-adjusted composite score over a fixed 3-year window</p>
            </div>
            <Link
              to="/explore"
              className="hidden shrink-0 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300 sm:block"
            >
              All categories
            </Link>
          </div>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((f) => {
              const m = f.metrics['3Y']
              return (
                <button
                  key={f.code}
                  onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
                  className="card group p-4 text-left transition hover:border-brand-300 hover:shadow-md dark:hover:border-brand-600"
                >
                  <div className="flex items-center justify-between">
                    <span className={`pill text-xs ${getCategoryColor(f.category).bg} ${getCategoryColor(f.category).text}`}>
                      {f.categoryDisplay}
                    </span>
                    <span className="text-xs text-faint">#{m?.catRank} of {m?.catSize}</span>
                  </div>
                  <div className="mt-2 font-semibold leading-snug text-fg transition-colors group-hover:text-brand-700 dark:group-hover:text-brand-300">
                    {f.name}
                  </div>
                  <div className="mt-3 flex items-end justify-between border-t border-line/50 pt-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-faint">3Y CAGR</div>
                      <div className="font-display text-2xl font-semibold text-fg">{pct(m?.cagr)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wide text-faint">Alpha</div>
                      <div className={`text-base font-bold ${alphaColor(m?.alpha ?? 0)}`}>{signedPct(m?.alpha)}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Category index */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="eyebrow text-xs font-bold uppercase text-faint">The index</div>
            <h2 className="mt-2 text-2xl font-semibold text-fg">Browse by category</h2>
            <p className="mt-1 text-sm text-muted">{categoryOrder.length} categories covering the full AMFI equity universe</p>
          </div>
          <div className="hidden items-center gap-3 text-xs text-faint sm:flex">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/60" /> 15% and above
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-zinc-300/60 dark:bg-zinc-500/60" /> 12 to 15%
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/60" /> under 12%
            </span>
          </div>
        </div>
        <div className="mt-7 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {categoryCards.map((c) => {
            const tier = cagrTier(c.medianCagr5Y)
            const isTop3 = top3Keys.has(c.key)
            const catColor = getCategoryColor(c.key)
            return (
              <Link
                key={c.key}
                to={`/explore?cat=${encodeURIComponent(c.key)}`}
                className="group relative flex min-h-[56px] items-center justify-between rounded-lg border border-line bg-canvas px-4 py-3.5 transition hover:border-brand-300 hover:shadow-sm dark:bg-surface dark:hover:border-brand-500"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`inline-block h-7 w-1 rounded-full ${catColor.bg}`} />
                  <div>
                    <div className="flex items-center gap-1.5 font-semibold text-fg transition-colors group-hover:text-brand-700 dark:group-hover:text-brand-300">
                      {c.display}
                      {isTop3 && (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                          Top 5Y
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-faint">{c.fundCount} funds</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm ${tierCagrColor[tier]}`}>{c.medianCagr5Y?.toFixed(1) ?? '—'}%</div>
                  <div className="text-xs text-faint">median 5Y</div>
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Closing CTA band */}
      <section className="border-t border-line bg-slate-900 dark:bg-surface2">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 md:flex-row md:items-center md:justify-between md:py-16">
          <div>
            <h2 className="font-display text-3xl font-semibold text-white md:text-4xl">
              Start with a fund you already own.
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-300">
              See how it really ranks once everyone is judged over the same window, then decide if it
              still deserves your money.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/explore"
              className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-slate-900 transition-colors hover:bg-slate-100"
            >
              Explore all {data.totalFunds} funds
            </Link>
            <Link
              to="/compare"
              className="inline-flex items-center justify-center rounded-xl border border-slate-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-slate-800"
            >
              Compare side by side
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
