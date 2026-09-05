import type { Fund } from '../types'
import { buildVerdict } from '../lib/verdict'

const TONE_RING: Record<string, string> = {
  good: 'border-l-emerald-500',
  warn: 'border-l-amber-500',
  bad: 'border-l-rose-500',
}
const TONE_TEXT: Record<string, string> = {
  good: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
}
const TONE_BAR: Record<string, string> = {
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-rose-500',
}

/**
 * Fund-detail overall verdict: a single conviction read that fuses the backward
 * fixed-window metrics with the forward-looking signals and management quality.
 * Spells out the drivers so it's transparent, never a black-box rating.
 */
export default function VerdictCard({ fund }: { fund: Fund }) {
  // Debt (liquid / money-market) funds are cash-equivalents: they earn accrual,
  // not stock-picking alpha. The equity conviction pillars (peer alpha, Sharpe,
  // downside capture, manager skill) are meaningless at near-zero volatility, so
  // we show an honest note instead of an inflated "Standout" verdict.
  if (fund.isDebt) {
    return (
      <div className="mt-6 card border-l-4 border-l-slate-400 p-5">
        <h3 className="font-bold text-fg">How to read this fund</h3>
        <p className="mt-2 text-sm text-muted">
          This is a {fund.categoryDisplay.toLowerCase()} fund, a cash-equivalent used to park
          money for the short term. It carries very low risk and low, steady returns, so the
          equity-style signals we show for growth funds (peer alpha, Sharpe, drawdown recovery,
          manager skill, stock holdings) do not apply here.
        </p>
        <p className="mt-2 text-sm text-muted">
          Judge it on three things: how cheap it is (expense ratio), how consistent its returns
          are, and its portfolio quality. Small differences in expense ratio, not returns, usually
          decide the winner in this category.
        </p>
      </div>
    )
  }
  const v = buildVerdict(fund)
  return (
    <div className={`mt-6 card border-l-4 ${TONE_RING[v.tone]} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-fg">Our overall verdict</h3>
        <span className={`text-sm font-bold ${TONE_TEXT[v.tone]}`}>
          {v.label} · {v.score}/100 conviction
        </span>
      </div>

      {/* conviction bar */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface2">
        <div className={`h-full rounded-full ${TONE_BAR[v.tone]}`} style={{ width: `${v.score}%` }} />
      </div>

      <p className="mt-3 text-muted">{v.oneLiner}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
            What works for it
          </div>
          {v.positives.length ? (
            <ul className="mt-1.5 space-y-1.5">
              {v.positives.map((p, i) => (
                <li key={i} className="text-sm text-muted">
                  <span className="font-semibold text-fg">{p.label}</span> - {p.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-faint">No standout strengths in the data.</p>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
            What to watch
          </div>
          {v.negatives.length ? (
            <ul className="mt-1.5 space-y-1.5">
              {v.negatives.map((p, i) => (
                <li key={i} className="text-sm text-muted">
                  <span className="font-semibold text-fg">{p.label}</span> - {p.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-faint">No notable red flags in the data.</p>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-faint">
        Conviction blends backward-tested rank, peer-relative alpha and risk-adjusted ratios with
        forward-looking consistency, skill confidence, downside capture and management quality. A
        reading of the data, not a recommendation.
      </p>
    </div>
  )
}
