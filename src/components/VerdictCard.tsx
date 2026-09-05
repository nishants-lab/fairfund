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
  if (fund.isArbitrage) {
    return (
      <div className="mt-6 card border-l-4 border-l-teal-400 p-5">
        <h3 className="font-bold text-fg">How to read this fund</h3>
        <p className="mt-2 text-sm text-muted">
          This is an arbitrage fund. It buys stocks in the cash market and simultaneously sells
          the matching futures, locking in the price gap between the two. Because every long
          position is hedged by a short, net market exposure is near zero, so returns are
          cash-like and steady rather than equity-like. The equity-style signals we show for
          growth funds (peer alpha, Sharpe, drawdown recovery, manager skill) do not apply here.
        </p>
        <p className="mt-2 text-sm text-muted">
          Judge it on three things: how cheap it is (expense ratio), how consistent its returns
          are, and its size. Note the tax treatment: arbitrage funds are taxed as equity, so gains
          held 12 months or more are long-term (12.5% above the ₹1.25L annual exemption), which is
          why they are often used as a tax-efficient alternative to a liquid fund.
        </p>
      </div>
    )
  }
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
  // Young funds without a full backward window (< ~1Y history) have no
  // meaningful rank/alpha/Sharpe yet. Show an honest since-inception read
  // instead of a fabricated conviction score.
  const hasWindow = fund.metrics['3Y'] ?? fund.metrics['5Y'] ?? fund.metrics['1Y']
  if (!hasWindow) {
    const si = fund.si
    const sinceTxt = fund.inceptionDate
      ? new Date(fund.inceptionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : null
    return (
      <div className="mt-6 card border-l-4 border-l-violet-400 p-5">
        <h3 className="font-bold text-fg">Too new for a full verdict</h3>
        <p className="mt-2 text-sm text-muted">
          This fund launched {sinceTxt ? `on ${sinceTxt}` : 'recently'} and has only{' '}
          {fund.navPoints ? `${fund.navPoints} trading days` : 'a limited history'}, less than the
          ~1 year we need to judge peer rank, risk-adjusted return and consistency. We are not
          hiding it, but we will not
          fabricate a conviction score from too little data. Here is the honest read so far:
        </p>
        {si && (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-line bg-surface2/40 p-3">
              <div className="text-xs uppercase tracking-wide text-faint">Return since launch</div>
              <div className="mt-1 text-lg font-bold text-fg">{si.totalReturn >= 0 ? '+' : ''}{si.totalReturn.toFixed(1)}%</div>
              <div className="mt-0.5 text-xs text-muted">Absolute, not annualised.</div>
            </div>
            {si.cagr != null && (
              <div className="rounded-lg border border-line bg-surface2/40 p-3">
                <div className="text-xs uppercase tracking-wide text-faint">Annualised (CAGR)</div>
                <div className="mt-1 text-lg font-bold text-fg">{si.cagr >= 0 ? '+' : ''}{si.cagr.toFixed(1)}%</div>
                <div className="mt-0.5 text-xs text-muted">Early, small-sample; treat with caution.</div>
              </div>
            )}
            <div className="rounded-lg border border-line bg-surface2/40 p-3">
              <div className="text-xs uppercase tracking-wide text-faint">Track record</div>
              <div className="mt-1 text-lg font-bold text-fg">{si.days} days</div>
              <div className="mt-0.5 text-xs text-muted">Use the chart above to see the full history.</div>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-faint">
          A full risk-adjusted verdict, peer rank and forward signals will appear once this fund
          builds up a longer track record.
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
