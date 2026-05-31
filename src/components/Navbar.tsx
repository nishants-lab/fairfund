import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'

const links = [
  { to: '/explore', label: 'Explore' },
  { to: '/compare', label: 'Compare' },
  { to: '/methodology', label: 'Methodology' },
]

export default function Navbar() {
  const loc = useLocation()
  const [open, setOpen] = useState(false)

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false)
  }, [loc.pathname])

  // Lock body scroll while the mobile menu overlay is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

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
          <ThemeToggle />
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
          </nav>
        </div>
      )}
    </header>
  )
}
