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
    <footer className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4">
        {/* Top: wordmark + nav columns */}
        <div className="grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="font-display text-2xl font-bold tracking-tight text-fg">
              Fair<span className="text-brand-600 dark:text-brand-400">Fund</span>
            </div>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
              Independent mutual fund research for India. Every score is tested
              against history, across {data.totalFunds} equity funds.
            </p>
            <div className="mt-5 flex items-center gap-2 text-xs text-muted">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${bizDaysSince <= 1 ? 'bg-emerald-500' : bizDaysSince <= 2 ? 'bg-amber-500' : 'bg-rose-500'}`} />
              <span>
                NAV data <span className="font-medium text-fg">{fmtNavDate(navDate)}</span>
                <span className="text-faint"> · {freshnessLabel}</span>
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-faint">
              Metrics are computed live from today's NAV. Rankings refresh every market day.
            </p>
          </div>

          <div>
            <div className="eyebrow text-faint">Research</div>
            <div className="mt-3 flex flex-col gap-2.5 text-sm">
              <Link to="/explore" className="text-muted transition-colors hover:text-fg">Explore funds</Link>
              <Link to="/compare" className="text-muted transition-colors hover:text-fg">Compare</Link>
            </div>
          </div>

          <div>
            <div className="eyebrow text-faint">About</div>
            <div className="mt-3 flex flex-col gap-2.5 text-sm">
              <Link to="/methodology" className="text-muted transition-colors hover:text-fg">How it works</Link>
              <button onClick={resetOnboarding} className="text-left text-muted transition-colors hover:text-fg">
                Take the tour
              </button>
            </div>
          </div>
        </div>

        {/* Disclaimer: quiet editorial small print, not an alert box */}
        <div className="border-t border-line py-6">
          <p className="max-w-3xl text-xs leading-relaxed text-faint">
            <span className="font-medium uppercase tracking-wide text-muted">Disclaimer</span>
            <span className="mx-2 text-line">|</span>
            FairFund is a research and educational tool, not investment advice. We are not a
            SEBI-registered investment adviser. Mutual fund investments are subject to market
            risks. Past performance does not guarantee future returns. Always consult a
            qualified financial advisor before investing.
          </p>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col gap-2 border-t border-line py-5 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} FairFund · {data.totalFunds} active equity funds · live NAV from AMFI
          </span>
          <span>Made in Bangalore, India</span>
        </div>
      </div>
    </footer>
  )
}
