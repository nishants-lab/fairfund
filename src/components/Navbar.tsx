import { Link, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'

const links = [
  { to: '/explore', label: 'Explore' },
  { to: '/compare', label: 'Compare' },
  { to: '/planner', label: 'Goal Planner' },
  { to: '/methodology', label: 'Methodology' },
]

export default function Navbar() {
  const loc = useLocation()
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
        </div>
      </div>

      {/* Mobile nav */}
      <nav className="flex items-center gap-1 overflow-x-auto px-4 pb-2 md:hidden">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              loc.pathname.startsWith(l.to)
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                : 'text-muted hover:bg-surface2'
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
