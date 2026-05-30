import { Link } from 'react-router-dom'
import { data } from '../lib/data'
import { resetOnboarding } from './Onboarding'

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row">
          <div>
            <div className="font-extrabold text-fg">FairFund</div>
            <p className="mt-1 max-w-md text-sm text-muted">
              Forward-looking, easy-to-understand mutual fund research for India - backward-tested and
              probability-based, across {data.totalFunds} funds. Evidence, not advice.
            </p>
          </div>
          <div className="flex gap-8 text-sm">
            <div className="flex flex-col gap-2">
              <Link to="/explore" className="text-muted hover:text-brand-600">Explore Funds</Link>
              <Link to="/compare" className="text-muted hover:text-brand-600">Compare</Link>
              <Link to="/planner" className="text-muted hover:text-brand-600">Goal Planner</Link>
              <Link to="/methodology" className="text-muted hover:text-brand-600">How it works</Link>
              <button onClick={resetOnboarding} className="text-left text-muted hover:text-brand-600">
                Take the tour
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-xl bg-amber-50 p-4 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <strong>Disclaimer:</strong> FairFund is a research and educational tool, not investment
          advice. We are not a SEBI-registered investment adviser. Mutual fund investments are
          subject to market risks. Past performance does not guarantee future returns. Data as of{' '}
          {data.anchor}. Always consult a qualified financial advisor before investing.
        </div>

        <div className="mt-4 text-center text-xs text-faint">
          Covers {data.totalFunds} active equity funds · live NAV from AMFI ·
          © {new Date().getFullYear()} FairFund
        </div>
      </div>
    </footer>
  )
}

