import { Link, useNavigate } from 'react-router-dom'
import SearchBox from '../components/SearchBox'
import RiskBadge from '../components/RiskBadge'
import { data, topFundsForCategory } from '../lib/data'
import { signedPct, pct, alphaColor } from '../lib/format'

const popularCategories = [
  { key: 'Flexi Cap', emoji: '🌐' },
  { key: 'Mid Cap', emoji: '📈' },
  { key: 'Small Cap', emoji: '🚀' },
  { key: 'International', emoji: '🌎' },
  { key: 'Sectoral/Thematic', emoji: '🎯' },
  { key: 'ELSS', emoji: '🧾' },
]

export default function Home() {
  const navigate = useNavigate()
  // A few standout picks for the hero strip (best alpha across the board, 3Y)
  const highlights = ['Flexi Cap', 'Mid Cap', 'Small Cap']
    .map((c) => topFundsForCategory(c, 1)[0])
    .filter(Boolean)

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-canvas dark:from-brand-900/20 dark:to-canvas">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center md:py-24">
          <h1 className="text-center text-3xl font-extrabold leading-tight text-fg md:text-4xl">
            <span className="block">Mutual Fund Research</span>
            <span className="mt-1 block text-brand-600 dark:text-brand-400">
              Backward-tested and Forward-looking
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
            Most fund tools are a rear-view mirror - trailing returns and a point-in-time rank. We add
            scientific, <strong>forward-looking signals</strong> - consistency, skill-vs-luck, downside
            protection, and probability-based outlooks - across {data.totalFunds} funds, over <strong>any time period
            you choose</strong>. Evidence and probabilities, never advice.
          </p>

          <div className="mx-auto mt-8 max-w-2xl">
            <SearchBox large autoFocus />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
            <span>Popular:</span>
            {popularCategories.slice(0, 4).map((c) => (
              <Link
                key={c.key}
                to={`/explore?cat=${encodeURIComponent(c.key)}`}
                className="rounded-full border border-line bg-surface px-3 py-1 font-medium text-muted hover:border-brand-300 hover:text-brand-600"
              >
                {c.emoji} {data.categories[c.key]?.display ?? c.key}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <section className="mx-auto -mt-8 max-w-5xl px-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Link to="/planner" className="card group p-6 transition hover:shadow-md">
            <div className="text-3xl">🎯</div>
            <div className="mt-3 font-bold text-fg">Plan a Goal</div>
            <p className="mt-1 text-sm text-muted">
              Tell us your target. We’ll show if it’s achievable and what return you need.
            </p>
            <div className="mt-3 text-sm font-semibold text-brand-600 group-hover:underline">
              Start planning →
            </div>
          </Link>
          <Link to="/compare" className="card group p-6 transition hover:shadow-md">
            <div className="text-3xl">⚖️</div>
            <div className="mt-3 font-bold text-fg">Compare Funds</div>
            <p className="mt-1 text-sm text-muted">
              Put 2-3 funds side by side over any period. Same category or across - we'll flag it.
            </p>
            <div className="mt-3 text-sm font-semibold text-brand-600 group-hover:underline">
              Compare now →
            </div>
          </Link>
          <Link to="/explore" className="card group p-6 transition hover:shadow-md">
            <div className="text-3xl">🔍</div>
            <div className="mt-3 font-bold text-fg">Explore by Category</div>
            <p className="mt-1 text-sm text-muted">
              Browse the top funds in each category, ranked fairly on risk-adjusted alpha.
            </p>
            <div className="mt-3 text-sm font-semibold text-brand-600 group-hover:underline">
              Explore →
            </div>
          </Link>
        </div>
      </section>

      {/* Highlights */}
      <section className="mx-auto max-w-5xl px-4 py-12">
        <h2 className="text-xl font-bold text-fg">Category leaders right now</h2>
        <p className="mt-1 text-sm text-muted">
          #1 by risk-adjusted score in each category (3-year fixed window). Alpha = how much it beat
          the median peer fund per year.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {highlights.map((f) => {
            const m = f.metrics['3Y']
            return (
              <button
                key={f.code}
                onClick={() => navigate(`/fund/${f.code}`)}
                className="card p-5 text-left transition hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="pill bg-surface2 text-muted">{f.categoryDisplay}</span>
                  <RiskBadge level={f.riskLevel} showWord={false} />
                </div>
                <div className="mt-3 font-bold text-fg">{f.name}</div>
                <div className="text-xs text-faint">{f.amc}</div>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <div className="text-xs text-faint">3Y CAGR</div>
                    <div className="text-2xl font-bold text-fg">{pct(m?.cagr)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-faint">Alpha vs peers</div>
                    <div className={`text-lg font-bold ${alphaColor(m?.alpha ?? 0)}`}>
                      {signedPct(m?.alpha)}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Why different */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="text-xl font-bold text-fg">More than a rear-view mirror</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            We do the rigorous backward-looking work every site should - then go further with
            forward-looking, probability-based signals. All evidence-based, with clear caveats.
            Never financial advice.
          </p>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Forward-looking signals</div>
              <p className="mt-1 text-sm text-muted">
                Consistency, skill-vs-luck (is the edge real or chance?), up/down capture, “running
                hot?”, and probability-based outcome ranges - framed as evidence and confidence, never
                a guarantee.
              </p>
            </div>
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Any time period</div>
              <p className="mt-1 text-sm text-muted">
                Analyze the last 6 months, a specific year, or drag to any custom range. Every metric
                recomputes live. No other free tool does this.
              </p>
            </div>
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Peer-relative alpha</div>
              <p className="mt-1 text-sm text-muted">
                We show whether a manager beat the median fund in their own category - real skill, not
                just riding a hot asset class.
              </p>
            </div>
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Holdings &amp; overlap</div>
              <p className="mt-1 text-sm text-muted">
                See what a fund actually owns, and how much two funds overlap - so you don't
                unknowingly buy the same stocks three times.
              </p>
            </div>
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Management quality</div>
              <p className="mt-1 text-sm text-muted">
                Manager tenure plus a cross-fund track record - does the person running it have a
                repeatable record across the other funds they manage?
              </p>
            </div>
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Fair, like-for-like ranking</div>
              <p className="mt-1 text-sm text-muted">
                Identical fixed windows so a fund born at a market bottom can’t look artificially
                great, and we never rank a small-cap against a large-cap.
              </p>
            </div>
          </div>
          <Link to="/methodology" className="mt-6 inline-block text-sm font-semibold text-brand-600 hover:underline">
            Read the full methodology →
          </Link>
        </div>
      </section>
    </div>
  )
}
