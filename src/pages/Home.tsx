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
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-surface px-4 py-1.5 text-xs font-semibold text-brand-700 dark:border-brand-800 dark:text-brand-300">
            <span className="h-2 w-2 rounded-full bg-accent"></span>
            Every major Indian equity fund, compared fairly
          </div>
          <h1 className="text-4xl font-extrabold leading-tight text-fg md:text-5xl">
            Mutual fund research that’s
            <span className="text-brand-600 dark:text-brand-400"> actually honest</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">
            Picking a fund shouldn’t feel like a gamble. We compare every fund on a level playing
            field and let you check how it performed over <strong>any time period you choose</strong> —
            so you see the real story, not a flattering one.
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
              Put 2–3 funds side by side over any period. Same category or across — we’ll flag it.
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
          <h2 className="text-xl font-bold text-fg">Why FairFund is different</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-4">
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Any time period</div>
              <p className="mt-1 text-sm text-muted">
                Analyze the last 6 months, a specific year, or drag to any custom range. Every metric
                recomputes live. No other free tool does this.
              </p>
            </div>
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Fixed time windows</div>
              <p className="mt-1 text-sm text-muted">
                Baseline rankings measure every fund over identical dates. A fund launched at a market
                bottom won’t look artificially great.
              </p>
            </div>
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Peer-relative alpha</div>
              <p className="mt-1 text-sm text-muted">
                We show whether a manager beat the median fund in their own category — real skill, not
                just riding a hot asset class.
              </p>
            </div>
            <div>
              <div className="text-lg font-semibold text-brand-700 dark:text-brand-400">Within-category ranking</div>
              <p className="mt-1 text-sm text-muted">
                We never rank a small-cap against a large-cap. You pick the risk level; we find the
                best fund inside it.
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
