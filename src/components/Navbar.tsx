import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'
import SearchBox from './SearchBox'
import { useWishlist } from '../lib/wishlist'
import { useAuth } from '../lib/auth'

const links = [
  { to: '/explore', label: 'Explore' },
  { to: '/compare', label: 'Compare' },
  { to: '/my', label: 'My Portfolio' },
  { to: '/methodology', label: 'Methodology' },
]

export default function Navbar() {
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchRefMobile = useRef<HTMLDivElement>(null)
  const wishlistCodes = useWishlist()
  const wishlistCount = wishlistCodes.length
  const { user } = useAuth()

  const isHome = loc.pathname === '/'

  useEffect(() => {
    setOpen(false)
    setSearchOpen(false)
  }, [loc.pathname])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      const inDesktop = searchRef.current?.contains(t)
      const inMobile = searchRefMobile.current?.contains(t)
      if (!inDesktop && !inMobile) setSearchOpen(false)
    }
    if (searchOpen) {
      document.addEventListener('mousedown', onClick)
      return () => document.removeEventListener('mousedown', onClick)
    }
  }, [searchOpen])

  const signInActive = loc.pathname === '/signin'
  const wishlistActive = loc.pathname === '/wishlist'

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600">
            <svg viewBox="0 0 32 32" className="h-6 w-6">
              <rect x="6" y="18" width="5" height="8" rx="1.5" fill="#fff" />
              <rect x="13.5" y="13" width="5" height="13" rx="1.5" fill="#fff" />
              <rect x="21" y="7" width="5" height="19" rx="1.5" fill="#10b981" />
              <rect x="4" y="26.5" width="24" height="2" rx="1" fill="#fff" opacity=".9" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-bold leading-none text-fg">Fair<span className="text-brand-600 dark:text-brand-400">Fund</span></div>
            <div className="text-xs font-medium uppercase tracking-wider text-faint">Forward-looking MF Research</div>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  loc.pathname.startsWith(l.to)
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                    : 'text-muted hover:bg-surface2'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Sign-in / avatar */}
          <Link
            to="/signin"
            aria-label={user ? 'Account' : 'Sign in'}
            className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              signInActive
                ? 'border-brand-300 bg-brand-50 text-brand-600 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                : 'border-line text-muted hover:bg-surface2 hover:text-fg'
            }`}
          >
            {user ? (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {(user.email?.[0] ?? 'U').toUpperCase()}
              </div>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            )}
          </Link>

          {/* Wishlist icon */}
          <Link
            to="/wishlist"
            aria-label={`Wishlist${wishlistCount > 0 ? ` (${wishlistCount} funds)` : ''}`}
            className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              wishlistActive
                ? 'border-rose-300 bg-rose-50 text-rose-500 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-400'
                : 'border-line text-muted hover:bg-surface2 hover:text-rose-400'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill={wishlistActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={wishlistActive ? 0 : 1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
            {wishlistCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-xs font-bold text-white">
                {wishlistCount > 99 ? '99+' : wishlistCount}
              </span>
            )}
          </Link>

          {/* Desktop search (hidden on Home) */}
          {!isHome && (
            <div className="relative hidden md:block" ref={searchRef}>
              {searchOpen ? (
                <div className="w-72">
                  <SearchBox placeholder="Search funds..." autoFocus />
                </div>
              ) : (
                <button
                  type="button"
                  aria-label="Search funds"
                  onClick={() => setSearchOpen(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition hover:bg-surface2 hover:text-fg"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
                  </svg>
                </button>
              )}
            </div>
          )}

          <ThemeToggle />

          {/* Mobile search icon (hidden on Home) */}
          {!isHome && (
            <button
              type="button"
              aria-label="Search funds"
              onClick={() => setSearchOpen((s) => !s)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition hover:bg-surface2 hover:text-fg md:hidden"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
              </svg>
            </button>
          )}

          {/* Mobile hamburger */}
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-fg transition hover:bg-surface2 md:hidden"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile search dropdown */}
      {searchOpen && !isHome && (
        <div className="border-t border-line bg-surface px-4 py-3 md:hidden" ref={searchRefMobile}>
          <SearchBox placeholder="Search funds..." autoFocus />
        </div>
      )}

      {/* Mobile slide-down menu */}
      {open && (
        <div className="md:hidden">
          <div
            className="fixed inset-0 top-[57px] z-30 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <nav className="relative z-40 border-t border-line bg-surface px-4 py-2 shadow-lg">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={`block rounded-lg px-3 py-3 text-base font-medium transition ${
                  loc.pathname.startsWith(l.to)
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                    : 'text-fg hover:bg-surface2'
                }`}
              >
                {l.label}
              </Link>
            ))}
            <Link
              to="/wishlist"
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-3 text-base font-medium transition ${
                wishlistActive
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300'
                  : 'text-fg hover:bg-surface2'
              }`}
            >
              Wishlist{wishlistCount > 0 ? ` (${wishlistCount})` : ''}
            </Link>
            <Link
              to="/signin"
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-3 text-base font-medium transition ${
                signInActive
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                  : 'text-fg hover:bg-surface2'
              }`}
            >
              {user ? 'Account' : 'Sign in'}
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
