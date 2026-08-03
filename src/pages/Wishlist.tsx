import { useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { useWishlist } from '../lib/wishlist'
import { getFund } from '../lib/data'
import { pct, signedPct, alphaColor, fundSlug } from '../lib/format'
import { getCategoryColor } from '../lib/categoryColors'
import WishlistButton from '../components/WishlistButton'
import type { Fund } from '../types'

export default function Wishlist() {
  usePageMeta('My Wishlist', 'Your saved funds for quick access.')
  const codes = useWishlist()
  const navigate = useNavigate()

  const funds: Fund[] = useMemo(
    () => codes.map((c) => getFund(c)).filter((f): f is Fund => f != null),
    [codes],
  )

  if (funds.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 dark:bg-rose-900/20">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-rose-400" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-fg">Your wishlist is empty</h1>
        <p className="mt-2 text-muted">
          Tap the heart icon on any fund to save it here for quick access.
        </p>
        <Link to="/explore" className="mt-6 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700">
          Explore Funds
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-fg">My Wishlist</h1>
          <p className="mt-1 text-sm text-muted">
            {funds.length} fund{funds.length !== 1 ? 's' : ''} saved. Tap any row to view details.
          </p>
        </div>
        {funds.length >= 2 && (
          <Link
            to={`/compare?codes=${funds.map((f) => f.code).join(',')}`}
            className="btn-ghost text-sm"
          >
            ⚖️ Compare all
          </Link>
        )}
      </div>

      {/* Fund cards - mobile-first stacked layout */}
      <div className="mt-6 space-y-3">
        {funds.map((f) => {
          const m = f.metrics['3Y'] ?? f.metrics['1Y']
          return (
            <div
              key={f.code}
              onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface p-4 transition hover:border-brand-300 hover:shadow-sm dark:hover:border-brand-700 active:scale-[0.99]"
            >
              {/* Rank badge */}
              {m && (
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  m.catRank <= 3
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : m.catRank <= 5
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400'
                      : 'bg-surface2 text-muted'
                }`}>
                  #{m.catRank}
                </div>
              )}

              {/* Fund info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-fg">{f.name}</span>
                  <span className={`hidden shrink-0 pill text-xs sm:inline ${getCategoryColor(f.category).bg} ${getCategoryColor(f.category).text}`}>
                    {f.categoryDisplay}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span className={`sm:hidden pill text-xs ${getCategoryColor(f.category).bg} ${getCategoryColor(f.category).text}`}>
                    {f.categoryDisplay}
                  </span>
                  <span>{f.amc}</span>
                  {m && (
                    <>
                      <span className="font-semibold text-fg">{pct(m.cagr)} CAGR</span>
                      <span className={`font-semibold ${alphaColor(m.alpha)}`}>{signedPct(m.alpha)} alpha</span>
                    </>
                  )}
                </div>
              </div>

              {/* Wishlist remove button */}
              <WishlistButton code={f.code} compact className="shrink-0" />
            </div>
          )
        })}
      </div>

      <p className="mt-6 text-center text-xs text-faint">
        Saved locally on this device. Sign-in to sync across devices coming soon.
      </p>
    </div>
  )
}
