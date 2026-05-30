import { useMemo, useState } from 'react'
import type { Fund, NavPoint } from '../types'
import { pct, signedPct, num } from '../lib/format'
import { rollingReturnsDistribution, deepestDrawdown, outcomeCone } from '../lib/forward'
import { fmtDate } from '../lib/metrics'
import { funds } from '../lib/data'
import Sparkline from './Sparkline'
import InfoTip from './InfoTip'

const DIR_STYLE: Record<string, { txt: string; tone: string; arrow: string }> = {
  climbing: { txt: 'Climbing', tone: 'text-emerald-600 dark:text-emerald-400', arrow: '↑' },
  fading: { txt: 'Fading', tone: 'text-rose-600 dark:text-rose-400', arrow: '↓' },
  steady: { txt: 'Steady', tone: 'text-muted', arrow: '→' },
}

// Fixed market regimes (mirrors REGIMES in scripts/build_analytics.py). The date
// range + plain-English description make it clear the timeline runs to the
// present (the last regime ends at the data anchor, May 2026).
const REGIME_INFO: Record<string, { range: string; desc: string }> = {
  'COVID crash': { range: 'Feb–Mar 2020', desc: 'The fastest crash in history when COVID hit — a pure stress test of downside protection.' },
  'COVID recovery': { range: 'Mar 2020 – Oct 2021', desc: 'The liquidity-fuelled V-shaped rebound and bull run.' },
  '2022 correction': { range: 'Oct 2021 – Jun 2022', desc: 'Rate hikes and foreign outflows dragged markets down.' },
  '2022-24 bull run': { range: 'Jun 2022 – Sep 2024', desc: 'A strong, broad-based bull led by mid & small caps.' },
  'Recent (since Sep 2024)': { range: 'Sep 2024 – May 2026', desc: 'The latest phase, including the late-2024/2025 correction — right up to today.' },
}

/** Short label for a peer fund in "for context" lines. */
function shortName(f: Fund): string {
  return f.name.length > 30 ? f.name.slice(0, 29) + '…' : f.name
}

/** Plain-English gloss for a mean-reversion z-score, so users needn't know stats.
 *  z = how many standard deviations the recent 1Y sits from the fund's own norm. */
function zWords(z: number): string {
  const a = Math.abs(z)
  if (a < 0.5) return 'about normal'
  const dir = z > 0 ? 'above' : 'below'
  if (a < 1) return `a bit ${dir} normal`
  if (a < 2) return `clearly ${dir} normal`
  return `far ${dir} normal`
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface2/40 p-3">
      <div className="text-xs text-faint">{label}</div>
      <div className={`mt-0.5 text-lg font-bold ${tone ?? 'text-fg'}`}>{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  )
}

function humanDuration(days: number): string {
  if (days < 31) return `${days} days`
  const months = Math.round(days / 30.4)
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`
  return `${(days / 365.25).toFixed(1)} years`
}

export default function ForwardAnalytics({ fund, nav }: { fund: Fund; nav: NavPoint[] }) {
  const a = fund.analytics
  const [horizon, setHorizon] = useState(3)

  const rollDist = useMemo(() => rollingReturnsDistribution(nav, horizon), [nav, horizon])
  const cone = useMemo(() => outcomeCone(nav, horizon), [nav, horizon])
  const dd = useMemo(() => deepestDrawdown(nav), [nav])

  // Up-to-2 category peers for "for context" examples in Skill and Capture cards.
  // We pick the best-ranked OTHER funds in the same category that have the signal.
  const peers = useMemo(() => {
    const same = funds
      .filter((f) => f.code !== fund.code && f.category === fund.category)
      .sort((a, b) => (a.metrics['3Y']?.catRank ?? 999) - (b.metrics['3Y']?.catRank ?? 999))
    return {
      skill: same.filter((f) => f.analytics?.alpha?.confidence != null).slice(0, 2),
      capture: same.filter((f) => f.analytics?.capture?.down != null).slice(0, 2),
    }
  }, [fund])

  const hasAny =
    a && (a.rankTrajectory || a.battingAverage || a.capture || a.alpha || a.meanReversion || a.regimes?.length)
  const navAvailable = nav.length > 30

  if (!hasAny && !navAvailable) {
    return null
  }

  return (
    <div className="mt-6">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-lg font-bold text-fg">Forward-looking signals</h3>
        <span className="pill bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">v3 · beta</span>
      </div>
      <p className="mb-4 text-xs text-muted">
        Beyond past returns: how consistent, skilled, and sustainable this fund looks — framed as
        evidence and probability, never a guarantee.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Rank trajectory */}
        {a?.rankTrajectory && (
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 font-semibold text-fg">
                Form (rank trajectory)
                <InfoTip align="left" width={280}>
                  <strong>What the arrow means:</strong> whether the fund is moving up or down the
                  rankings within its category lately.
                  <br />↑ <span className="text-emerald-600 dark:text-emerald-400">Climbing</span> — its rank improved by more than 5 percentile points recently.
                  <br />↓ <span className="text-rose-600 dark:text-rose-400">Fading</span> — it slipped by more than 5 points.
                  <br />→ Steady — roughly holding its position.
                  <br /><br />The line tracks its rolling <strong>3-year</strong> rank vs peers over
                  time (higher = better). 3Y is long enough to reflect skill, not a lucky month.
                </InfoTip>
              </h4>
              <span className={`text-sm font-bold ${DIR_STYLE[a.rankTrajectory.direction].tone}`}>
                {DIR_STYLE[a.rankTrajectory.direction].arrow} {DIR_STYLE[a.rankTrajectory.direction].txt}
              </span>
            </div>
            <div className="mt-2">
              <Sparkline data={a.rankTrajectory.spark} />
            </div>
            <p className="mt-2 text-xs text-muted">
              Was #{a.rankTrajectory.priorRank}/{a.rankTrajectory.priorPeers}, now #
              {a.rankTrajectory.currentRank}/{a.rankTrajectory.currentPeers} in its category (rolling 3Y
              rank over time; higher line = better).
            </p>
            {a.rankTrajectory.limited && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Limited evidence — small category ({a.rankTrajectory.currentPeers} peers).</p>}
          </div>
        )}

        {/* Consistency / batting average */}
        {a?.battingAverage && (
          <div className="card p-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-fg">
              Consistency
              <InfoTip align="left" width={285}>
                <strong>How often this fund has been a top-half performer, not a one-hit wonder.</strong>
                <br /><br />We look at every rolling <strong>3-year</strong> window in its history (e.g.
                Jan 2018–Jan 2021, Feb 2018–Feb 2021, and so on) and count the share where it beat the
                median fund in its category. {a.battingAverage.pct}% means it finished in the better
                half in {a.battingAverage.pct} of every 100 such windows.
                <br /><br />Higher = more repeatable skill, less luck. We use 3-year windows (not 6-month
                or 1-year) because short windows are mostly noise — a fund can look “consistent” over
                6 months just by riding a hot streak.
              </InfoTip>
            </h4>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-fg">{a.battingAverage.pct}%</span>
              <span className="text-xs text-faint">of 3Y windows beat the category median</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Across {a.battingAverage.n} rolling 3-year windows. Higher = more repeatable, less luck.
            </p>
            {a.battingAverage.limited && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Limited evidence — only {a.battingAverage.n} three-year windows of history so far
                (we like to see at least 24 before trusting the number).
              </p>
            )}
          </div>
        )}

        {/* Skill vs luck */}
        {a?.alpha && (
          <div className="card p-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-fg">
              Skill vs luck
              <InfoTip align="left" width={290}>
                <strong>Is the fund's edge over its peers real, or could it just be chance?</strong>
                <br /><br />We take every month's return, subtract the category-median fund's return
                (its “excess”), and run a statistical test (one-sided t-test) on whether that excess is
                reliably positive. The % is our confidence it's genuine skill.
                <br /><br />We set a high bar: below <strong>95%</strong> confidence we say “could be
                luck”. Below 36 months of data we don't judge at all.
                <br /><br /><em>Example:</em> a fund beating peers by a small amount every month for
                years scores high; one that beat them once by a huge margin and then drifted scores low.
              </InfoTip>
            </h4>
            {a.alpha.insufficient || a.alpha.confidence == null ? (
              <p className="mt-1 text-sm text-muted">Not enough data to assess skill ({a.alpha.n} months).</p>
            ) : (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className={`text-2xl font-extrabold ${a.alpha.couldBeLuck ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {Math.round(a.alpha.confidence)}%
                  </span>
                  <span className="text-xs text-faint">confident it's skill, not chance</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {a.alpha.couldBeLuck
                    ? 'Below our 95% bar — its edge could be luck.'
                    : 'Statistically significant outperformance vs peers.'}{' '}
                  Based on {a.alpha.n} monthly excess returns.
                </p>
                {peers.skill.length > 0 && (
                  <p className="mt-2 border-t border-line pt-2 text-xs text-faint">
                    For context, same-category peers:{' '}
                    {peers.skill.map((p, i) => (
                      <span key={p.code}>
                        {i > 0 && ', '}
                        <a href={`#/fund/${p.code}`} className="text-brand-600 hover:underline">{shortName(p)}</a>{' '}
                        {Math.round(p.analytics!.alpha!.confidence!)}%
                      </span>
                    ))}.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* Capture ratios */}
        {a?.capture && (a.capture.up != null || a.capture.down != null) && (
          <div className="card p-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-fg">
              Up / down capture
              <InfoTip align="left" width={290}>
                <strong>How much of the category's moves this fund rides — up and down.</strong>
                <br /><br /><strong>Up-capture {a.capture.up ?? '—'}%:</strong> in months its category
                rose, it captured {a.capture.up ?? '—'}% of that gain.
                <br /><strong>Down-capture {a.capture.down ?? '—'}%:</strong> in months the category
                fell, it took {a.capture.down ?? '—'}% of that fall.
                <br /><br /><em>Example:</em> 90% up / 70% down is the sweet spot — keeps most of the
                upside but cushions the downside. Over 100% down-capture means it falls harder than its
                peers. Lower down-capture = better protection.
              </InfoTip>
            </h4>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="Up-capture" value={a.capture.up != null ? `${a.capture.up}%` : '—'} tone="text-emerald-600 dark:text-emerald-400" />
              <Stat label="Down-capture" value={a.capture.down != null ? `${a.capture.down}%` : '—'} tone="text-rose-600 dark:text-rose-400" />
            </div>
            <p className="mt-2 text-xs text-muted">
              Of its category's gains it captured {a.capture.up ?? '—'}%, of the losses {a.capture.down ?? '—'}%.
              Lower down-capture = better downside protection.
            </p>
            {peers.capture.length > 0 && (
              <p className="mt-2 border-t border-line pt-2 text-xs text-faint">
                For context, same-category peers (down-capture):{' '}
                {peers.capture.map((p, i) => (
                  <span key={p.code}>
                    {i > 0 && ', '}
                    <a href={`#/fund/${p.code}`} className="text-brand-600 hover:underline">{shortName(p)}</a>{' '}
                    {p.analytics!.capture!.down}%
                  </span>
                ))}.
              </p>
            )}
          </div>
        )}

        {/* Mean reversion */}
        {a?.meanReversion && (
          <div className="card p-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-fg">
              Running hot?
              <InfoTip align="left" width={290}>
                <strong>Is the fund's recent year unusually strong (or weak) versus its own
                normal?</strong>
                <br /><br />Unlike the other signals, this compares the fund only to <strong>itself</strong>
                - not to peers. We take its last-1-year return and measure how far it sits from its own
                typical 1-year return, in standard deviations - a “z-score”.
                <br /><br /><strong>Reading the z-score:</strong> 0 = right at its normal. +1 / -1 = one
                standard deviation above / below normal (notably hot / cold). Beyond ±2 is extreme.
                We flag 🔥 hot above +1 and ❄️ cold below -1; in between is “in line”.
                <br /><br /><em>This fund:</em> recent 1Y {signedPct(a.meanReversion.recent1Y)} vs its
                usual {signedPct(a.meanReversion.norm1Y)} (z = {num(a.meanReversion.z)}). Hot streaks
                tend to cool off (mean-reversion), so it's a caution against chasing - not a prediction.
              </InfoTip>
            </h4>
            <div className="mt-1">
              {a.meanReversion.state === 'hot' && <span className="text-lg font-bold text-amber-600 dark:text-amber-400">🔥 Running hot</span>}
              {a.meanReversion.state === 'cold' && <span className="text-lg font-bold text-sky-600 dark:text-sky-400">❄️ Running cold</span>}
              {a.meanReversion.state === 'normal' && <span className="text-lg font-bold text-muted">In line with its norm</span>}
            </div>
            <p className="mt-1 text-xs text-muted">
              Recent 1Y {signedPct(a.meanReversion.recent1Y)} vs its typical {signedPct(a.meanReversion.norm1Y)}{' '}
              (z = {num(a.meanReversion.z)} - {zWords(a.meanReversion.z)}).
              {a.meanReversion.state === 'hot' && ' Far above norm - be cautious chasing it; returns tend to revert.'}
              {a.meanReversion.state === 'cold' && ' Below its norm - not a guarantee, but mean-reversion can cut both ways.'}
            </p>
          </div>
        )}

        {/* Rolling-returns distribution (client-side) */}
        {rollDist && (
          <div className="card p-4">
            <h4 className="font-semibold text-fg">Range of {horizon}Y outcomes (historical)</h4>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="Worst" value={pct(rollDist.min)} tone="text-rose-600 dark:text-rose-400" />
              <Stat label="Median" value={pct(rollDist.median)} />
              <Stat label="Best" value={pct(rollDist.max)} tone="text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-2 text-xs text-muted">
              Annualized return entering at any point historically and holding {horizon}Y, across {rollDist.n}{' '}
              windows. {rollDist.negPct > 0 ? `${rollDist.negPct.toFixed(0)}% of windows lost money.` : 'No window lost money.'}
            </p>
          </div>
        )}
      </div>

      {/* Horizon selector for client-side analytics */}
      <div className="mt-4 flex items-center gap-2">
        <span className="text-xs text-faint">Horizon:</span>
        {[1, 3, 5, 10].map((h) => (
          <button
            key={h}
            onClick={() => setHorizon(h)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
              horizon === h ? 'bg-brand-600 text-white' : 'border border-line text-muted hover:border-brand-300'
            }`}
          >
            {h}Y
          </button>
        ))}
      </div>

      {/* Outcome cone + drawdown recovery */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {cone && (
          <div className="card p-4">
            <h4 className="font-semibold text-fg">Modeled {horizon}Y outcome range</h4>
            <p className="mt-1 text-xs text-muted">If you invested ₹1,00,000 today (model, not a promise):</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Stat label="Pessimistic (10%)" value={`₹${cone.p10.toFixed(2)}L`} tone="text-rose-600 dark:text-rose-400" />
              <Stat label="Median" value={`₹${cone.p50.toFixed(2)}L`} />
              <Stat label="Optimistic (90%)" value={`₹${cone.p90.toFixed(2)}L`} tone="text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-2 text-xs text-faint">
              {cone.sims.toLocaleString('en-IN')} simulations (block bootstrap of {cone.history} monthly returns,
              fixed seed). Assumes future resembles past — it may not. Not a guarantee.
            </p>
          </div>
        )}

        {dd && (
          <div className="card p-4">
            <h4 className="font-semibold text-fg">Worst fall & recovery</h4>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">{pct(dd.depthPct)}</span>
              <span className="text-xs text-faint">deepest drawdown</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Trough on {fmtDate(dd.troughDate)}.{' '}
              {dd.recovered
                ? `Recovered to its prior peak in ${humanDuration(dd.recoveryDays as number)}.`
                : `Still recovering after ${humanDuration(dd.daysSinceTrough)}.`}
            </p>
          </div>
        )}
      </div>

      {/* Regime performance */}
      {a?.regimes && a.regimes.some((r) => r.active) && (
        <div className="mt-4 card p-4">
          <h4 className="flex items-center gap-1.5 font-semibold text-fg">
            How it behaved in each market regime
            <InfoTip align="left" width={290}>
              We split the last ~6 years into five distinct market phases — from the COVID crash right
              up to today (May 2026) — and show how the fund did in each, plus how that compared to its
              category. It reveals character: who protects in crashes, who leads in bull runs.
              “vs category” is the fund's return minus the category-median fund's return in that phase.
            </InfoTip>
          </h4>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 420 }}>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="px-2 py-1.5 text-left">Regime</th>
                  <th className="px-2 py-1.5 text-right">Fund return</th>
                  <th className="px-2 py-1.5 text-right">vs category</th>
                </tr>
              </thead>
              <tbody>
                {a.regimes.map((r) => (
                  <tr key={r.name} className="border-b border-line last:border-0">
                    <td className="px-2 py-1.5 text-muted">
                      <span className="flex items-center gap-1.5">
                        <span>{r.name}</span>
                        {REGIME_INFO[r.name] && (
                          <InfoTip align="left" width={250} label={`About ${r.name}`}>
                            {REGIME_INFO[r.name].desc}
                          </InfoTip>
                        )}
                      </span>
                      {REGIME_INFO[r.name] && (
                        <span className="block text-xs text-faint">{REGIME_INFO[r.name].range}</span>
                      )}
                    </td>
                    {r.active ? (
                      <>
                        <td className={`px-2 py-1.5 text-right font-semibold ${(r.ret ?? 0) >= 0 ? 'text-fg' : 'text-rose-600 dark:text-rose-400'}`}>{pct(r.ret)}</td>
                        <td className={`px-2 py-1.5 text-right font-semibold ${(r.alpha ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{r.alpha != null ? signedPct(r.alpha) : '—'}</td>
                      </>
                    ) : (
                      <td colSpan={2} className="px-2 py-1.5 text-right text-xs text-faint">fund not active in this period</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        These are probabilistic, data-backed signals — not advice or guarantees. See{' '}
        <a href="#/methodology" className="text-brand-600 hover:underline">Methodology</a> for formulas and caveats.
      </p>
    </div>
  )
}
