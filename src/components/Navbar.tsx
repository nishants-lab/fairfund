import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'
import SearchBox from './SearchBox'
import { useWishlist } from '../lib/wishlist'

const links = [
  { to: '/explore', label: 'Explore' },
  { to: '/compare', label: 'Compare' },
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

  const isHome = loc.pathname === '/'

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false)
    setSearchOpen(false)
  }, [loc.pathname])

  // Lock body scroll while the mobile menu overlay is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Close search when clicking outside (check both desktop and mobile containers)
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      const inDesktop = searchRef.current?.contains(t)
      const inMobile = searchRefMobile.current?.contains(t)
      if (!inDesktop && !inMobile) {
        setSearchOpen(false)
      }
    }
    if (searchOpen) {
      document.addEventListener('mousedown', onClick)
      return () => document.removeEventListener('mousedown', onClick)
    }
  }, [searchOpen])

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600">
            <svg viewBox="0 0 32 32" className="h-6 w-6">
              <path d="M8 22 L13 14 L18 18 L24 9" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="24" cy="9" r="2.2" fill="#10b981" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="font-extrabold text-fg">FairFund</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-faint">Forward-looking MF Research</div>
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

          {/* Wishlist icon (desktop + mobile) */}
          <Link
            to="/wishlist"
            aria-label={`Wishlist${wishlistCount > 0 ? ` (${wishlistCount} funds)` : ''}`}
            className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              loc.pathname === '/wishlist'
                ? 'border-rose-300 bg-rose-50 text-rose-500 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-400'
                : 'border-line text-muted hover:bg-surface2 hover:text-rose-400'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill={loc.pathname === '/wishlist' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={loc.pathname === '/wishlist' ? 0 : 1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
            {wishlistCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {wishlistCount > 99 ? '99+' : wishlistCount}
              </span>
            )}
          </Link>

          {/* Desktop search (hidden on Home) */}
          {!isHome && (
            <div className="relative hidden md:block" ref={searchRef}>
              {searchOpen ? (
                <div className="w-72">
                  <SearchBox placeholder="Search funds…" autoFocus />
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

          {/* Mobile hamburger button */}
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

      {/* Mobile search dropdown (full width below navbar) */}
      {searchOpen && !isHome && (
        <div className="border-t border-line bg-surface px-4 py-3 md:hidden" ref={searchRefMobile}>
          <SearchBox placeholder="Search funds…" autoFocus />
        </div>
      )}

      {/* Mobile slide-down menu + backdrop */}
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
                loc.pathname === '/wishlist'
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300'
                  : 'text-fg hover:bg-surface2'
              }`}
            >
              Wishlist{wishlistCount > 0 ? ` (${wishlistCount})` : ''}
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}
