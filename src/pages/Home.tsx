import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import SearchBox from '../components/SearchBox'
import { data, topFundsForCategory, categoryOrder } from '../lib/data'
import { getCategoryColor } from '../lib/categoryColors'
import { signedPct, pct, alphaColor, fundSlug } from '../lib/format'
import { useNavFreshness, fmtNavDate } from '../lib/navFreshness'

/** Performance tier classification for category cards */
function cagrTier(cagr: number | null | undefined): 'top' | 'good' | 'average' | 'below' {
  if (!cagr) return 'average'
  if (cagr >= 18) return 'top'
  if (cagr >= 15) return 'good'
  if (cagr >= 12) return 'average'
  return 'below'
}

/** Text color for the CAGR number based on tier */
const tierCagrColor = {
  top: 'text-emerald-700 dark:text-emerald-400 font-extrabold',
  good: 'text-brand-700 dark:text-brand-300 font-bold',
  average: 'text-fg font-bold',
  below: 'text-amber-700 dark:text-amber-400 font-bold',
} as const

export default function Home() {
  usePageMeta(undefined, 'Forward-looking mutual fund research for India. Compare funds fairly over any time period with scientific, probability-based signals.')
  const navDate = useNavFreshness()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((i) => (i + 1) % 2), 2500)
    return () => clearInterval(t)
  }, [])
  const navigate = useNavigate()

  // Category leaders (top 1 per category, for the grid)
  const categoryCards = categoryOrder
    .filter((c) => data.categories[c])
    .map((c) => ({
      key: c,
      display: data.categories[c].display ?? c,
      topFund: topFundsForCategory(c, 1)[0],
      fundCount: data.categories[c].fundCount,
      medianCagr5Y: data.categories[c].medianCagr5Y,
      topCagr5Y: data.categories[c].topCagr5Y,
    }))

  // Determine top 3 categories by median 5Y CAGR for badge
  const sortedByMedian = [...categoryCards]
    .filter((c) => c.medianCagr5Y != null)
    .sort((a, b) => (b.medianCagr5Y ?? 0) - (a.medianCagr5Y ?? 0))
  const top3Keys = new Set(sortedByMedian.slice(0, 3).map((c) => c.key))

  // Standout picks: highest alpha across key categories
  const highlights = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Sectoral/Thematic']
    .map((c) => topFundsForCategory(c, 1)[0])
    .filter(Boolean)
    .slice(0, 6)

  return (
    <div className="overflow-x-hidden">
      {/* Hero - tight, action-first */}
      <section className="relative bg-gradient-to-b from-brand-50 via-brand-50/50 to-canvas dark:from-brand-900/30 dark:via-brand-900/10 dark:to-canvas">
        {/* Decorative radial glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 left-1/2 h-96 w-[600px] -translate-x-1/2 rounded-full bg-brand-200/30 blur-3xl dark:bg-brand-600/10" />
        </div>
        <div className="relative mx-auto max-w-4xl px-4 pt-12 pb-6 text-center md:pt-16 md:pb-8">
          <h1 className="text-[clamp(1.875rem,4.5vw+0.5rem,3rem)] font-bold leading-[1.1] tracking-tight text-fg">
            Research funds with{' '}
            <span className="bg-gradient-to-r from-brand-600 to-emerald-600 bg-clip-text text-transparent dark:from-brand-400 dark:to-emerald-400">
              clarity and confidence
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted leading-relaxed">
            Scientific, probability-based analysis across{' '}
            <strong className="text-fg">{data.totalFunds}</strong> Indian equity mutual funds.
            Any time period you choose.
          </p>

          <div className="relative z-30 mx-auto mt-9 max-w-2xl">
            <SearchBox large autoFocus />
          </div>

          {/* Live stats strip */}
          <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
            <span><strong className="text-fg">{data.totalFunds}</strong> funds tracked</span>
            <span className="text-faint">·</span>
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500 animate-pulse" />
            <span className="inline-flex items-center gap-1">
              NAV updated
              <span className="relative inline-flex h-[1.4em] w-[6.5rem] items-center overflow-hidden">
                <span
                  className="absolute left-0 font-semibold text-fg transition-all duration-700 ease-in-out"
                  style={{ transform: tick === 0 ? 'translateY(0)' : 'translateY(-100%)', opacity: tick === 0 ? 1 : 0 }}
                >
                  daily
                </span>
                <span
                  className="absolute left-0 font-semibold text-fg transition-all duration-700 ease-in-out"
                  style={{ transform: tick === 1 ? 'translateY(0)' : 'translateY(100%)', opacity: tick === 1 ? 1 : 0 }}
                >
                  {fmtNavDate(navDate)}
                </span>
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* Differentiation: one-glance comparison */}
      <section className="relative z-10 mx-auto mt-8 max-w-5xl px-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card border-rose-200 bg-rose-50/60 p-6 dark:border-rose-800/40 dark:bg-rose-900/15">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              What most sites show
            </div>
            <ul className="mt-4 space-y-2.5 text-sm text-muted">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-rose-400">✗</span>
                Returns since inception (flatters younger funds)
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-rose-400">✗</span>
                Star ratings with no explanation
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-rose-400">✗</span>
                Fixed time periods (1Y, 3Y, 5Y only)
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-rose-400">✗</span>
                No probability framing or confidence levels
              </li>
            </ul>
          </div>
          <div className="card border-emerald-200 bg-emerald-50/60 p-6 dark:border-emerald-800/40 dark:bg-emerald-900/15">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              What FairFund shows
            </div>
            <ul className="mt-4 space-y-2.5 text-sm text-muted">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-emerald-500">✓</span>
                Same fixed window for everyone (fair comparison)
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-emerald-500">✓</span>
                Skill-vs-luck, consistency, capture ratios
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-emerald-500">✓</span>
                Any custom date range, and every metric recomputes live
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-emerald-500">✓</span>
                Probability cones and rolling-return distributions
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Category Leaders */}
      <section className="mx-auto max-w-5xl px-4 py-14">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold text-fg">Top fund in each category</h2>
            <p className="mt-1 text-sm text-muted">
              #1 by risk-adjusted composite score (3-year fixed window)
            </p>
          </div>
          <Link to="/explore" className="group inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
            All categories <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
          </Link>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {highlights.map((f) => {
            const m = f.metrics['3Y']
            return (
              <button
                key={f.code}
                onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
                className="card group p-4 text-left transition hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600"
              >
                <div className="flex items-center justify-between">
                  <span className={`pill text-xs ${getCategoryColor(f.category).bg} ${getCategoryColor(f.category).text}`}>{f.categoryDisplay}</span>
                  <span className="text-xs text-faint">#{m?.catRank}/{m?.catSize}</span>
                </div>
                <div className="mt-2 font-bold text-fg leading-snug group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">{f.name}</div>
                <div className="mt-3 flex items-end justify-between border-t border-line/50 pt-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-faint">3Y CAGR</div>
                    <div className="text-xl font-extrabold text-fg">{pct(m?.cagr)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-faint">Alpha</div>
                    <div className={`text-base font-bold ${alphaColor(m?.alpha ?? 0)}`}>
                      {signedPct(m?.alpha)}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Category Browser - color-coded performance grid */}
      <section className="border-y border-line bg-surface2/50 dark:bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-14">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-xl font-bold text-fg">Browse by category</h2>
              <p className="mt-1 text-sm text-muted">
                {categoryOrder.length} categories covering the full AMFI equity universe
              </p>
            </div>
            <div className="hidden sm:flex items-center gap-3 text-xs text-faint">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500/60" /> ≥18%
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-brand-400/60" /> 15–18%
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-400/60" /> &lt;12%
              </span>
            </div>
          </div>
          <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {categoryCards.map((c) => {
              const tier = cagrTier(c.medianCagr5Y)
              const isTop3 = top3Keys.has(c.key)
              const catColor = getCategoryColor(c.key)
              return (
                <Link
                  key={c.key}
                  to={`/explore?cat=${encodeURIComponent(c.key)}`}
                  className={`group relative flex items-center justify-between rounded-lg border border-line border-l-[3px] ${catColor.border} px-4 py-3.5 min-h-[56px] transition hover:shadow-sm hover:border-brand-300 dark:hover:border-brand-500 bg-canvas dark:bg-surface`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`inline-block h-7 w-1 rounded-full ${catColor.bg}`} />
                    <div>
                      <div className="flex items-center gap-1.5 font-semibold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
                        {c.display}
                        {isTop3 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                            ★ Top 5Y
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-faint">{c.fundCount} funds</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm ${tierCagrColor[tier]}`}>
                      {c.medianCagr5Y?.toFixed(1) ?? '—'}%
                    </div>
                    <div className="text-xs text-faint">median 5Y</div>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* Actions row */}
      <section className="mx-auto max-w-5xl px-4 py-14">
        <div className="grid gap-4 md:grid-cols-3">
          <Link to="/compare" className="card group p-6 transition hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6v12M15 6v12" />
              </svg>
            </div>
            <div className="mt-3 font-bold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">Compare side by side</div>
            <p className="mt-1.5 text-sm text-muted leading-relaxed">
              Up to 5 funds over any period. Holdings overlap, risk metrics, conviction scores.
            </p>
          </Link>
          <Link to="/methodology" className="card group p-6 transition hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5m-4.25-11.396c.251.023.501.05.75.082M5 14.5l-1.703 4.258A1.125 1.125 0 004.347 20h15.306a1.125 1.125 0 001.05-1.242L19 14.5" />
              </svg>
            </div>
            <div className="mt-3 font-bold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">Our methodology</div>
            <p className="mt-1.5 text-sm text-muted leading-relaxed">
              Fully transparent scoring. No black-box stars, no hidden weights.
            </p>
          </Link>
          <Link to="/explore" className="card group p-6 transition hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <div className="mt-3 font-bold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">Explore all {data.totalFunds} funds</div>
            <p className="mt-1.5 text-sm text-muted leading-relaxed">
              Filter by category, sort by any metric, find your next investment.
            </p>
          </Link>
        </div>
      </section>


    </div>
  )
}
