import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import SearchBox from './SearchBox'
import { useWishlist } from '../lib/wishlist'
import { useAuth } from '../lib/auth'
import { useTheme } from '../lib/theme'

const links = [
  { to: '/explore', label: 'Explore' },
  { to: '/compare', label: 'Compare' },
  { to: '/movers', label: 'Movers' },
  { to: '/my', label: 'My Portfolio' },
  { to: '/methodology', label: 'Methodology' },
]

export default function Navbar() {
  const loc = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const searchRefMobile = useRef<HTMLDivElement>(null)
  const wishlistCodes = useWishlist()
  const wishlistCount = wishlistCodes.length
  const { user } = useAuth()
  const { theme, toggle: toggleTheme } = useTheme()

  const isHome = loc.pathname === '/'

  useEffect(() => {
    setMenuOpen(false)
    setSearchOpen(false)
  }, [loc.pathname])

  // Close menu / search on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      if (menuOpen && menuRef.current && !menuRef.current.contains(t)) setMenuOpen(false)
      if (searchOpen && !searchRef.current?.contains(t) && !searchRefMobile.current?.contains(t)) setSearchOpen(false)
    }
    if (menuOpen || searchOpen) {
      document.addEventListener('mousedown', onClick)
      return () => document.removeEventListener('mousedown', onClick)
    }
  }, [menuOpen, searchOpen])

  const signInActive = loc.pathname === '/signin'
  const wishlistActive = loc.pathname === '/wishlist'
  const compareActive = loc.pathname.startsWith('/compare')

  const iconBtn = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition'

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
          {/* Desktop primary nav */}
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

          {/* Wishlist icon (both breakpoints) */}
          <Link
            to="/wishlist"
            aria-label={`Wishlist${wishlistCount > 0 ? ` (${wishlistCount} funds)` : ''}`}
            className={`relative ${iconBtn} ${
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

          {/* Compare icon (mobile only; a desktop nav link already exists) */}
          <Link
            to="/compare"
            aria-label="Compare funds"
            className={`${iconBtn} md:hidden ${
              compareActive
                ? 'border-brand-300 bg-brand-50 text-brand-600 dark:border-brand-700 dark:bg-brand-900/20 dark:text-brand-400'
                : 'border-line text-muted hover:bg-surface2 hover:text-fg'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
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
                  className={`${iconBtn} border-line text-muted hover:bg-surface2 hover:text-fg`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* Mobile search icon (hidden on Home) */}
          {!isHome && (
            <button
              type="button"
              aria-label="Search funds"
              onClick={() => setSearchOpen((s) => !s)}
              className={`${iconBtn} border-line text-muted hover:bg-surface2 hover:text-fg md:hidden`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
              </svg>
            </button>
          )}

          {/* Menu (both breakpoints): secondary items live here to keep the top clean */}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className={`${iconBtn} border-line text-fg hover:bg-surface2`}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-xl">
                {/* Primary links — mobile only (desktop shows them inline) */}
                <div className="md:hidden">
                  {links.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      onClick={() => setMenuOpen(false)}
                      className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                        loc.pathname.startsWith(l.to)
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                          : 'text-fg hover:bg-surface2'
                      }`}
                    >
                      {l.label}
                    </Link>
                  ))}
                  <div className="my-1.5 h-px bg-line" />
                </div>

                {/* Dark mode */}
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-fg transition hover:bg-surface2"
                >
                  <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
                  {theme === 'dark' ? (
                    <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="4" />
                      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                    </svg>
                  )}
                </button>

                {/* Sign in / account */}
                <Link
                  to="/signin"
                  onClick={() => setMenuOpen(false)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    signInActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300' : 'text-fg hover:bg-surface2'
                  }`}
                >
                  <span>{user ? 'Account' : 'Sign in'}</span>
                  {user ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                      {(user.email?.[0] ?? 'U').toUpperCase()}
                    </span>
                  ) : (
                    <svg className="h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                    </svg>
                  )}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile search dropdown */}
      {searchOpen && !isHome && (
        <div className="border-t border-line bg-surface px-4 py-3 md:hidden" ref={searchRefMobile}>
          <SearchBox placeholder="Search funds..." autoFocus />
        </div>
      )}
    </header>
  )
}
