/**
 * /my - User dashboard: overview of portfolio + watchlist + quick stats.
 * Local-first: works without sign-in, data in localStorage.
 */
import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { usePortfolio, analyzePortfolio, type PortfolioAnalysis } from '../lib/portfolio'
import { useWishlist } from '../lib/wishlist'
import { getFund } from '../lib/data'
import { getCategoryColor } from '../lib/categoryColors'
import { fundSlug, pct, signedPct, alphaColor } from '../lib/format'
import type { Fund } from '../types'

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-1 text-xl font-bold ${color ?? 'text-fg'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export default function MyDashboard() {
  usePageMeta('My FairFund', 'Your portfolio, watchlist, and analysis.')
  const portfolio = usePortfolio()
  const wishlistCodes = useWishlist()
  const navigate = useNavigate()
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!portfolio) { setAnalysis(null); return }
    setLoading(true)
    analyzePortfolio(portfolio).then(a => { setAnalysis(a); setLoading(false) })
  }, [portfolio])

  const wishlistFunds: Fund[] = useMemo(
    () => wishlistCodes.map(c => getFund(c)).filter((f): f is Fund => f != null),
    [wishlistCodes]
  )

  const hasPortfolio = !!portfolio && !!analysis
  const hasWatchlist = wishlistFunds.length > 0

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">My FairFund</h1>
      <p className="mt-1 text-sm text-muted">
        Your portfolio and watchlist. All data stays on this device.
      </p>

      {/* Portfolio section */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Portfolio</h2>
          <Link to="/my/portfolio" className="text-sm font-medium text-brand-600 hover:underline">
            {hasPortfolio ? 'View details' : 'Upload CAMS'}
          </Link>
        </div>

        {!hasPortfolio && !loading && (
          <div className="mt-4 rounded-xl border-2 border-dashed border-line bg-surface p-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-900/20">
              <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-500" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="font-semibold text-fg">Upload your CAMS statement</p>
            <p className="mt-1 text-sm text-muted">
              Your CAMS statement holds more insight than you think. Deep diagnostics for your mutual fund portfolio.
            </p>
            <Link to="/my/portfolio" className="mt-4 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
              Upload CAMS
            </Link>
            <p className="mt-4 text-xs text-muted">
              Optimized for Direct-plan equity mutual funds. Other fund types (Regular plans, debt, hybrid) may not match or may show approximate values.
            </p>
          </div>
        )}

        {loading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-muted">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
            Analyzing portfolio...
          </div>
        )}

        {hasPortfolio && analysis && (
          <div className="mt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Portfolio value"
                value={`₹${(analysis.totalValue / 100000).toFixed(1)}L`}
                sub={`${analysis.holdings.length} funds`}
              />
              <StatCard
                label="Total gain"
                value={`₹${(analysis.totalGain / 100000).toFixed(1)}L`}
                sub={`${analysis.totalGainPct >= 0 ? '+' : ''}${analysis.totalGainPct.toFixed(1)}%`}
                color={analysis.totalGain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
              />
              <StatCard
                label="Manager alerts"
                value={String(analysis.managerAlerts.length)}
                sub={analysis.managerAlerts.length > 0 ? 'Needs attention' : 'All clear'}
                color={analysis.managerAlerts.length > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}
              />
              <StatCard
                label="Rank drifted"
                value={`${analysis.reshuffleScore.filter(r => r.drift != null && r.drift > 3).length} funds`}
                sub="dropped 3+ ranks"
                color={analysis.reshuffleScore.some(r => r.drift != null && r.drift > 3) ? 'text-amber-600 dark:text-amber-400' : undefined}
              />
            </div>
            <div className="mt-3 text-right">
              <Link to="/my/portfolio" className="text-sm font-medium text-brand-600 hover:underline">
                Full analysis
              </Link>
            </div>
          </div>
        )}
      </section>

      {/* Watchlist section */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Watchlist</h2>
          <Link to="/wishlist" className="text-sm font-medium text-brand-600 hover:underline">
            {hasWatchlist ? `${wishlistFunds.length} funds` : 'Add funds'}
          </Link>
        </div>

        {!hasWatchlist && (
          <p className="mt-3 text-sm text-muted">
            No funds saved yet. Tap the heart icon on any fund to add it to your watchlist.
          </p>
        )}

        {hasWatchlist && (
          <div className="mt-3 space-y-2">
            {wishlistFunds.slice(0, 5).map(f => {
              const m = f.metrics['3Y'] ?? f.metrics['1Y']
              return (
                <div
                  key={f.code}
                  onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition hover:border-brand-300"
                >
                  {m && (
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      m.catRank <= 5 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-surface2 text-muted'
                    }`}>#{m.catRank}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm font-semibold text-fg">{f.name}</span>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className={`pill ${getCategoryColor(f.category).bg} ${getCategoryColor(f.category).text}`}>{f.categoryDisplay}</span>
                      {m && <span className={`font-semibold ${alphaColor(m.alpha)}`}>{signedPct(m.alpha)} alpha</span>}
                    </div>
                  </div>
                  {m && <span className="text-sm font-bold text-fg">{pct(m.cagr)}</span>}
                </div>
              )
            })}
            {wishlistFunds.length > 5 && (
              <Link to="/wishlist" className="block text-center text-sm text-brand-600 hover:underline">
                View all {wishlistFunds.length} funds
              </Link>
            )}
          </div>
        )}
      </section>

      <p className="mt-10 text-center text-xs text-faint">
        All data stored locally on this device. Sign-in to sync across devices coming soon.
      </p>
    </div>
  )
}
