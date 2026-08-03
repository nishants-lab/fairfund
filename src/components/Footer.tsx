import { Link } from 'react-router-dom'
import { data } from '../lib/data'
import { useNavFreshness, fmtNavDate } from '../lib/navFreshness'
import { resetOnboarding } from './Onboarding'

export default function Footer() {
  const navDate = useNavFreshness()
  // Count business days (Mon-Fri) since last NAV to handle weekends + holidays fairly
  const bizDaysSince = (() => {
    const start = new Date(navDate + 'T00:00:00')
    const end = new Date()
    let count = 0
    const d = new Date(start)
    d.setDate(d.getDate() + 1)
    while (d <= end) {
      const dow = d.getDay()
      if (dow !== 0 && dow !== 6) count++
      d.setDate(d.getDate() + 1)
    }
    return count
  })()
  // Green: <=1 biz day (normal next-day), Amber: 2 biz days (likely 1 holiday), Red: 3+ (genuinely stale)
  const freshnessLabel =
    bizDaysSince <= 1 ? 'up to date' : bizDaysSince <= 2 ? 'recent' : `${bizDaysSince} market days old`

  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row">
          <div>
            <div className="font-display text-lg font-bold text-fg">Fair<span className="text-brand-600 dark:text-brand-400">Fund</span></div>
            <p className="mt-1 max-w-md text-sm text-muted">
              Independent mutual fund research for India - backward-tested,
              across {data.totalFunds} funds.
            </p>
          </div>
          <div className="flex gap-8 text-sm">
            <div className="flex flex-col gap-2">
              <Link to="/explore" className="text-muted hover:text-brand-600">Explore Funds</Link>
              <Link to="/compare" className="text-muted hover:text-brand-600">Compare</Link>
              <Link to="/methodology" className="text-muted hover:text-brand-600">How it works</Link>
              <button onClick={resetOnboarding} className="text-left text-muted hover:text-brand-600">
                Take the tour
              </button>
            </div>
          </div>
        </div>

        {/* Data freshness - prominent, not buried */}
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface2/50 px-4 py-2.5 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${bizDaysSince <= 1 ? 'bg-emerald-500' : bizDaysSince <= 2 ? 'bg-amber-500' : 'bg-rose-500'}`} />
            <strong className="text-fg">NAV data: {fmtNavDate(navDate)}</strong>
            <span className="text-faint">({freshnessLabel})</span>
          </span>
          <span className="hidden text-faint sm:inline">·</span>
          <span className="text-faint">
            Fund metrics are computed live from today's NAV. Category rankings refresh every market day.
          </span>
        </div>

        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <strong>Disclaimer:</strong> FairFund is a research and educational tool, not investment
          advice. We are not a SEBI-registered investment adviser. Mutual fund investments are
          subject to market risks. Past performance does not guarantee future returns. Always
          consult a qualified financial advisor before investing.
        </div>

        <div className="mt-4 text-center text-xs text-faint">
          Covers {data.totalFunds} active equity funds · live NAV from AMFI ·
          © {new Date().getFullYear()} FairFund
        </div>
        <p className="mt-3 text-center text-xs text-faint">
          Made with <span className="text-red-500">{"\u2764"}</span> in Bangalore, India
        </p>
      </div>
    </footer>
  )
}
