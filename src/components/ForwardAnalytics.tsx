import { useMemo, useState } from 'react'
import type { Fund, NavPoint } from '../types'
import { pct, signedPct, num, inr, fundSlug } from '../lib/format'
import { rollingReturnsDistribution, deepestDrawdown, outcomeCone } from '../lib/forward'
import { fmtDate, fmtMonth } from '../lib/metrics'
import { funds, data, usesReducedSurface } from '../lib/data'
import { bandSpectrum } from '../lib/spectrum'
import Sparkline from './Sparkline'
import InfoTip from './InfoTip'
import Spectrum from './Spectrum'
import { matchRegime, regimeInfo } from '../lib/regimes'
import SearchBox from './SearchBox'

const DIR_STYLE: Record<string, { txt: string; tone: string }> = {
  climbing: { txt: 'Climbing', tone: 'text-emerald-600 dark:text-emerald-400' },
  fading: { txt: 'Fading', tone: 'text-rose-600 dark:text-rose-400' },
  steady: { txt: 'Steady', tone: 'text-muted' },
  new: { txt: 'New', tone: 'text-violet-600 dark:text-violet-400' },
}
const DIR_FALLBACK = DIR_STYLE.steady



function shortName(f: Fund): string {
  return f.name.length > 30 ? f.name.slice(0, 29) + '…' : f.name
}

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

// SIP amount bounds (#10): min 5,000, max 3,00,000 per month, non-negative.
const SIP_MIN = 5000
const SIP_MAX = 300000
const SIP_DEFAULT = 100000

export default function ForwardAnalytics({ fund, nav }: { fund: Fund; nav: NavPoint[] }) {
  const a = fund.analytics
  const [horizon, setHorizon] = useState(3)
  const [invMode, setInvMode] = useState<'lumpsum' | 'sip'>('lumpsum')
  const [sipAmount, setSipAmount] = useState(SIP_DEFAULT)
  const [lumpAmount] = useState(100000)
  const [regimeCompare, setRegimeCompare] = useState<Fund | undefined>(undefined)
  const [regimeCompareOpen, setRegimeCompareOpen] = useState(false)

  const rollDist = useMemo(() => rollingReturnsDistribution(nav, horizon), [nav, horizon])
  const dd = useMemo(() => deepestDrawdown(nav), [nav])
  const cone = useMemo(
    () =>
      outcomeCone(nav, horizon, {
        mode: invMode,
        amount: invMode === 'sip' ? clampSip(sipAmount) : lumpAmount,
      }),
    [nav, horizon, invMode, sipAmount, lumpAmount],
  )

  const peers = useMemo(() => {
    const same = funds
      .filter((f) => f.code !== fund.code && f.category === fund.category)
      .sort((a, b) => (a.metrics['3Y']?.catRank ?? 999) - (b.metrics['3Y']?.catRank ?? 999))
    return {
      capture: same.filter((f) => f.analytics?.capture?.down != null).slice(0, 2),
    }
  }, [fund])

  const formPeer = useMemo(() => {
    const inCat = funds.filter(
      (f) => f.category === fund.category && f.analytics?.rankTrajectory?.spark?.length,
    )
    const myRank = a?.rankTrajectory?.currentRank ?? 999
    const ranked = inCat
      .filter((f) => f.code !== fund.code)
      .sort((x, y) => x.analytics!.rankTrajectory!.currentRank - y.analytics!.rankTrajectory!.currentRank)
    if (!ranked.length) return null
    const target = myRank === 1 ? ranked[0] : ranked.find((f) => f.analytics!.rankTrajectory!.currentRank === 1) ?? ranked[0]
    return target
  }, [fund, a])

  // Category context for the consistency spectrum (median + best peer).
  const catSignals = useMemo(() => {
    const same = funds.filter((f) => f.category === fund.category)
    const bat = same.map((f) => f.analytics?.battingAverage?.pct).filter((v): v is number => v != null)
    const med = (xs: number[]) => {
      if (!xs.length) return null
      const s = [...xs].sort((a, b) => a - b)
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    return {
      consistency: bat.length >= 3 ? { median: med(bat), best: Math.max(...bat) } : undefined,
    }
  }, [fund.category])

  const hasAny =
    a && (a.rankTrajectory || a.battingAverage || a.capture || a.alpha || a.meanReversion || a.regimes?.length)
  const navAvailable = nav.length > 30

  if (usesReducedSurface(fund)) return null // forward analytics are not meaningful for cash-equivalent debt or fully-hedged arbitrage funds
  if (!hasAny && !navAvailable) return null

  return (
    <div className="mt-6">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-base font-bold text-fg">Performance history and scenarios</h3>
        <span className="rounded-full bg-surface2 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-faint">beta</span>
      </div>
      <p className="mb-4 text-xs text-muted">
        Review performance across rolling periods and past market conditions.
        Scenario results depend on their stated assumptions.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Rank trajectory (#3 clarity) */}
        {a?.rankTrajectory && (
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 font-semibold text-fg">
                Rank trajectory
                <InfoTip width={280}>
                  The line shows the fund's category rank percentile over time (100 = top of category,
                  0 = bottom). It is recomputed on a rolling 3-year-return basis, one step per month.
                  <br /><br /><span className="text-emerald-600 dark:text-emerald-400">Climbing</span>: rank improved more than 5 points lately.
                  <br /><span className="text-rose-600 dark:text-rose-400">Fading</span>: it slipped more than 5 points.
                  <br /><span className="text-muted">Steady</span>: roughly holding position.
                  <br /><br />A higher line is a better return rank. The headline category rank uses a
                  risk-adjusted score, so the two can differ.
                </InfoTip>
              </h4>
              <span className={`text-sm font-bold ${(DIR_STYLE[a.rankTrajectory.direction] ?? DIR_FALLBACK).tone}`}>
                {(DIR_STYLE[a.rankTrajectory.direction] ?? DIR_FALLBACK).txt}
              </span>
            </div>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-faint">
              Category rank percentile over time
            </p>
            <div className="mt-2">
              <Sparkline
                data={a.rankTrajectory.spark}
                peer={formPeer?.analytics?.rankTrajectory?.spark}
                width={260}
                height={96}
                endDate={data.anchor}
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0.5 w-4 rounded bg-brand-600" /> This fund
              </span>
              {formPeer && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'repeating-linear-gradient(90deg,#94a3b8 0 3px,transparent 3px 6px)' }} />
                  {formPeer.analytics?.rankTrajectory?.currentRank === 1 ? 'Return rank #1' : 'Top peer (returns)'}: {shortName(formPeer)}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">
              By 3-year return, was #{a.rankTrajectory.priorRank}/{a.rankTrajectory.priorPeers}, now #
              {a.rankTrajectory.currentRank}/{a.rankTrajectory.currentPeers} in its category.
            </p>
            {a.rankTrajectory.limited && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Limited evidence: small category ({a.rankTrajectory.currentPeers} peers).</p>}
          </div>
        )}

        {/* Consistency / batting average */}
        {a?.battingAverage && (
          <div className="card p-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-fg">
              Consistency
              <InfoTip width={285}>
                We calculate returns over rolling 36-month periods, moving the endpoint forward one month at a time.
                This percentage shows how often the fund's return exceeded its category median.
                The periods overlap, so the observations are related.
              </InfoTip>
            </h4>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-2xl font-extrabold ${a.battingAverage.pct >= 65 ? 'text-emerald-600 dark:text-emerald-400' : a.battingAverage.pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>{a.battingAverage.pct}%</span>
              <span className="text-xs text-faint">of measured 3-year periods beat the category median</span>
            </div>
            <Spectrum
              model={bandSpectrum({
                value: a.battingAverage.pct,
                lowMid: 50,
                midHigh: 65,
                leftLabel: 'Beat median less often',
                rightLabel: 'Beat median more often',
                cat: catSignals.consistency,
              })}
            />
            <p className="mt-2 text-xs text-muted">
              Based on {a.battingAverage.n} overlapping 3-year periods.
            </p>
            {a.battingAverage.limited && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Limited history: {a.battingAverage.n} rolling periods available; the current history threshold is 24 periods.
              </p>
            )}
          </div>
        )}

        {a?.alpha && (
          <details className="card p-4">
            <summary className="cursor-pointer font-semibold text-fg">Monthly excess-return test</summary>
            <p className="mt-2 text-xs text-muted">
              Tests whether the fund's average monthly return above its category median is positive.
              Based on {a.alpha.n} paired monthly returns.
            </p>
            {a.alpha.insufficient || a.alpha.tStat == null ? (
              <p className="mt-2 text-sm text-muted">
                Test unavailable. At least 36 paired monthly returns and non-zero variation in excess returns are required.
              </p>
            ) : (
              <p className="mt-2 text-sm text-fg">t-statistic: {num(a.alpha.tStat)}</p>
            )}
            <p className="mt-2 text-xs text-muted">
              This one-sided t-test assumes independent monthly observations and does not adjust for testing many funds.
              It does not measure the probability of manager skill or future outperformance.
            </p>
            <p className="mt-2 text-xs text-faint">
              Raw p-value and observation dates are unavailable in the current dataset.
              The stored rounded (1-p) × 100 statistic remains a 12% input to the equity fund-page composite score.
            </p>
          </details>
        )}

        {/* Capture ratios — suppress when values are misleading (negative, near-zero,
           or extreme), which indicates the fund doesn't correlate with its category
           median and the metric is not useful. */}
        {a?.capture && (a.capture.up != null || a.capture.down != null) &&
         (a.capture.up == null || a.capture.up >= 10) &&
         (a.capture.down == null || (a.capture.down >= 0 && a.capture.down <= 200)) && (
          <div className="card p-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-fg">
              Up / down capture
              <InfoTip width={290}>
                The fund's compounded return divided by the category comparison's compounded return,
                calculated separately for months when the category median rose or fell.
                These ratios describe the measured history; they are not a share of months.
                Down-capture below 100% indicates a smaller compounded loss over those down months.
              </InfoTip>
            </h4>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat
                label="Up-capture"
                value={a.capture.up != null ? `${a.capture.up}%` : '—'}
                tone={a.capture.up == null ? 'text-faint' : a.capture.up >= 100 ? 'text-emerald-600 dark:text-emerald-400' : a.capture.up >= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}
              />
              <Stat
                label="Down-capture"
                value={a.capture.down != null ? `${a.capture.down}%` : '—'}
                tone={a.capture.down == null ? 'text-faint' : a.capture.down < 100 ? 'text-emerald-600 dark:text-emerald-400' : a.capture.down <= 110 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              Compounded return ratios across {a.capture.upMonths} category up months and {a.capture.downMonths} down months.
            </p>
            {peers.capture.length > 0 && (
              <p className="mt-2 border-t border-line pt-2 text-xs text-faint">
                Peer down-capture:{' '}
                {peers.capture.map((p, i) => (
                  <span key={p.code}>
                    {i > 0 && ', '}
                    <a href={`#/fund/${p.code}/${fundSlug(p.name)}`} className="text-brand-600 hover:underline">{shortName(p)}</a>{' '}
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
              Recent return versus history
              <InfoTip width={290}>
                <strong>Is the fund's recent year unusually strong (or weak) versus its own normal?</strong>
                <br /><br />This compares the fund only to itself. We take its last-1-year return and
                measure how far it sits from its own typical 1-year return, in standard deviations (a
                z-score). 0 = normal, +1/-1 = notably hot/cold, beyond ±2 is extreme.
                <br /><br />This fund: recent 1Y {signedPct(a.meanReversion.recent1Y)} vs its usual{' '}
                {signedPct(a.meanReversion.norm1Y)} (z = {num(a.meanReversion.z)}). Future returns may differ.
              </InfoTip>
            </h4>
            <div className="mt-1">
              {a.meanReversion.state === 'hot' && <span className="text-lg font-bold text-amber-600 dark:text-amber-400">Above historical average</span>}
              {a.meanReversion.state === 'cold' && <span className="text-lg font-bold text-sky-600 dark:text-sky-400">Below historical average</span>}
              {a.meanReversion.state === 'normal' && <span className="text-lg font-bold text-muted">Near historical average</span>}
            </div>
            <Spectrum
              value={Math.max(0, Math.min(1, (a.meanReversion.z + 3) / 6))}
              leftLabel="Below average"
              rightLabel="Above average"
              gradient="emerald-amber-rose"
              markerLabel={`z = ${num(a.meanReversion.z)}`}
            />
            <p className="mt-2 text-xs text-muted">
              Recent 1Y {signedPct(a.meanReversion.recent1Y)} vs its typical {signedPct(a.meanReversion.norm1Y)}{' '}
              (z = {num(a.meanReversion.z)}, {zWords(a.meanReversion.z)}).
              {a.meanReversion.z > 0 && ' The latest 1-year return is above this fund’s historical average.'}
              {a.meanReversion.z < 0 && ' The latest 1-year return is below this fund’s historical average.'}
              {' '}Future returns may differ.
            </p>
          </div>
        )}
      </div>



      {/* ---- "If you stay invested" outcomes (horizon + SIP/lumpsum driven) ---- */}
      {(rollDist || cone) && (
        <div className="mt-6">
          <h3 className="text-base font-bold text-fg">Historical returns and simulated outcomes</h3>
          <p className="mt-1 text-xs text-muted">
            Historical returns and simulations based on past monthly returns.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-faint">Holding period:</span>
              {[1, 3, 5, 10].map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  aria-pressed={horizon === h}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    horizon === h ? 'bg-brand-600 text-white' : 'border border-line text-muted hover:border-brand-300'
                  }`}
                >
                  {h} year{h > 1 ? 's' : ''}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-faint">Invest as:</span>
              <div className="inline-flex rounded-lg border border-line bg-surface2 p-0.5">
                {(['lumpsum', 'sip'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setInvMode(m)}
                    aria-pressed={invMode === m}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                      invMode === m ? 'bg-surface text-brand-700 shadow-sm dark:text-brand-300' : 'text-muted'
                    }`}
                  >
                    {m === 'lumpsum' ? 'One-time' : 'Monthly SIP'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* SIP amount input (#10): editable, ₹5k–₹3L/mo, default ₹1L */}
          {invMode === 'sip' && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label htmlFor="sip-amt" className="font-semibold text-faint">Monthly amount (₹):</label>
              <input
                id="sip-amt"
                type="number"
                min={SIP_MIN}
                max={SIP_MAX}
                step={1000}
                value={sipAmount}
                onChange={(e) => setSipAmount(Number(e.target.value))}
                onBlur={(e) => setSipAmount(clampSip(Number(e.target.value)))}
                className="w-28 rounded-lg border border-line bg-surface px-2 py-1 text-fg focus:border-brand-400 focus:outline-none"
              />
              <span className="text-faint">
                ₹{SIP_MIN.toLocaleString('en-IN')} - ₹{SIP_MAX.toLocaleString('en-IN')}/mo.
                {(sipAmount < SIP_MIN || sipAmount > SIP_MAX) && (
                  <span className="text-amber-600 dark:text-amber-400"> Using ₹{clampSip(sipAmount).toLocaleString('en-IN')}.</span>
                )}
              </span>
            </div>
          )}

          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {/* Historical rolling-returns distribution (#8 window dates) */}
            {rollDist && (
              <div className="card p-4">
                <h4 className="flex items-center gap-1.5 font-semibold text-fg">
                  What {horizon}-year holds actually returned
                  <InfoTip width={270} label="About historical holds">
                    We slide a {horizon}-year window across the fund's whole history (start any month,
                    hold {horizon} years) and annualize each result. Worst / Median / Best are the range
                    across all {rollDist.n} such windows: a reality check on how much the outcome
                    depended on when you happened to enter.
                  </InfoTip>
                </h4>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Stat label="Worst" value={pct(rollDist.min)} sub={`${fmtMonth(rollDist.minStart)}–${fmtMonth(rollDist.minEnd)}`} tone="text-rose-600 dark:text-rose-400" />
                  <Stat label="Median" value={pct(rollDist.median)} sub="per year" />
                  <Stat label="Best" value={pct(rollDist.max)} sub={`${fmtMonth(rollDist.maxStart)}–${fmtMonth(rollDist.maxEnd)}`} tone="text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="mt-2 text-xs text-muted">
                  Annualized returns over measured {horizon}-year periods, across {rollDist.n}{' '}
                  windows. {rollDist.negPct > 0 ? `${rollDist.negPct.toFixed(0)}% of those windows lost money.` : 'No window lost money.'}
                </p>
              </div>
            )}

            {/* Modeled outcome cone (#10 SIP-aware) */}
            {cone && (
              <div className="card p-4">
                <h4 className="flex items-center gap-1.5 font-semibold text-fg">
                  Modeled {horizon}-year range
                  <InfoTip width={285} label="About the modeled range">
                    We run {cone.sims.toLocaleString('en-IN')} simulations that re-shuffle this fund's
                    own past monthly returns in 6-month blocks, then see where your money lands after{' '}
                    {horizon} years. Pessimistic / Median / Optimistic are the 10th, 50th and 90th
                    percentiles of the simulations. The model uses {cone.history} monthly returns and a fixed seed.
                    "×" is the multiple of money invested.
                  </InfoTip>
                </h4>
                <p className="mt-1 text-xs text-muted">
                  {cone.mode === 'sip'
                    ? `Investing ${inr(clampSip(sipAmount))}/mo (${inr(cone.invested)} total over ${horizon}y) simulated outcomes:`
                    : `Simulated outcomes for ${inr(cone.invested)} invested:`}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Stat label="Pessimistic" value={inr(cone.endP10)} sub={`${cone.p10.toFixed(2)}× · 10th %ile`} tone="text-rose-600 dark:text-rose-400" />
                  <Stat label="Median" value={inr(cone.endP50)} sub={`${cone.p50.toFixed(2)}× · 50th %ile`} />
                  <Stat label="Optimistic" value={inr(cone.endP90)} sub={`${cone.p90.toFixed(2)}× · 90th %ile`} tone="text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="mt-2 text-xs text-faint">
                  Assumes the future resembles the past, which it may not.
                  Actual returns can fall outside the displayed range. Not a guarantee.
                </p>
              </div>
            )}
          </div>
        </div>
      )}



      {/* Regime performance */}
      {a?.regimes && a.regimes.some((r) => r.active) && (
        <div className="mt-4 card p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="font-semibold text-fg">How it behaved in each market regime</h4>
            {!regimeCompare && (
              <button
                onClick={() => setRegimeCompareOpen(true)}
                className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-muted hover:border-brand-400 hover:text-brand-600 transition"
              >
                + Compare
              </button>
            )}
          </div>

          {/* Comparison fund picker */}
          {regimeCompareOpen && !regimeCompare && (
            <div className="mt-2 flex justify-end">
              <div className="w-72">
                <SearchBox placeholder="Pick a fund to compare…" onPick={(f) => { setRegimeCompare(f); setRegimeCompareOpen(false) }} />
              </div>
            </div>
          )}
          {regimeCompare && (
            <div className="mt-2 flex items-center justify-end gap-2 flex-wrap">
              <span className="text-xs text-faint">Comparing with:</span>
              <a href={`#/fund/${regimeCompare.code}/${fundSlug(regimeCompare.name)}`} className="text-xs font-semibold text-brand-600 hover:underline">{shortName(regimeCompare)}</a>
              <button
                onClick={() => setRegimeCompareOpen(true)}
                className="text-xs text-muted hover:text-brand-600 underline"
              >change</button>
              <button
                onClick={() => { setRegimeCompare(undefined); setRegimeCompareOpen(false) }}
                className="text-xs text-muted hover:text-rose-600"
              >× remove</button>
            </div>
          )}
          {regimeCompareOpen && regimeCompare && (
            <div className="mt-2 flex justify-end">
              <div className="w-72">
                <SearchBox placeholder="Pick a different fund…" onPick={(f) => { setRegimeCompare(f); setRegimeCompareOpen(false) }} />
              </div>
            </div>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className={`w-full text-sm ${regimeCompare ? 'min-w-[420px]' : ''}`}>
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-faint">
                  <th className="px-2 py-1.5 text-left">Regime</th>
                  <th className="px-2 py-1.5 text-right">Fund return</th>
                  {regimeCompare && <th className="px-2 py-1.5 text-right max-w-[120px] truncate">{shortName(regimeCompare)}</th>}
                </tr>
              </thead>
              <tbody>
                {a.regimes.map((r) => {
                  const ri = regimeInfo(r.name)
                  return (
                  <tr key={r.name} className="border-b border-line last:border-0">
                    <td className="px-2 py-1.5 group cursor-pointer" onClick={(e) => { const el = (e.currentTarget as HTMLElement).querySelector('[data-desc]'); if (el) el.classList.toggle('hidden') }}>
                      <span className={ri?.market === 'down' ? 'text-rose-600 dark:text-rose-400' : ri?.market === 'up' ? 'text-emerald-600 dark:text-emerald-400' : ri?.market === 'mixed' ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}>{r.name}</span>
                      {ri && <span className="block text-xs text-faint">{ri.range}{ri.desc && <span className="ml-1 opacity-50">ⓘ</span>}</span>}
                      {ri?.desc && <span data-desc className="hidden block text-xs text-faint/80 mt-0.5 leading-snug">{ri.desc}</span>}
                    </td>
                    {r.active ? (() => {
                      const compRegime = regimeCompare?.analytics?.regimes?.find(x => x.name === r.name)
                      const compRet = compRegime?.active ? compRegime.ret : null
                      const fundRet = r.ret ?? 0
                      // For down markets, less negative is better; for up markets, more positive is better. In both cases, higher number wins
                      const fundWins = compRet != null && fundRet > compRet
                      const compWins = compRet != null && compRet > fundRet
                      const winBg = 'rounded-md bg-emerald-50 dark:bg-emerald-900/30 px-1.5'
                      return (
                      <>
                        <td className={`px-2 py-1.5 text-right font-semibold ${fundRet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          <span className={fundWins ? winBg : ''}>{pct(r.ret)}</span>
                        </td>
                        {regimeCompare && (
                          <td className={`px-2 py-1.5 text-right font-semibold ${compRet == null ? 'text-muted' : compRet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            <span className={compWins ? winBg : ''}>{compRet != null ? pct(compRet) : '—'}</span>
                          </td>
                        )}
                      </>
                      )
                    })() : (
                      <td colSpan={regimeCompare ? 2 : 1} className="px-2 py-1.5 text-right text-xs text-faint">fund not active</td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Worst fall & recovery - nested in regime context */}
          {dd && (() => {
            const regime = matchRegime(dd.peakDate, dd.troughDate)
            // Category median max drawdown
            const catDrawdowns = funds
              .filter(f => f.category === fund.category)
              .map(f => f.metrics['3Y']?.maxDrawdown)
              .filter((v): v is number => typeof v === 'number' && !isNaN(v))
              .sort((a, b) => a - b)
            const catMedianDD = catDrawdowns.length >= 3
              ? catDrawdowns[Math.floor(catDrawdowns.length / 2)]
              : null
            // Top peer (rank 1 in category, excluding this fund)
            const topPeer = funds
              .filter(f => f.category === fund.category && f.code !== fund.code)
              .sort((a, b) => (a.metrics['3Y']?.catRank ?? 999) - (b.metrics['3Y']?.catRank ?? 999))[0]
            const peerDD = topPeer?.metrics['3Y']?.maxDrawdown
            const peerName = topPeer ? (topPeer.name.length > 25 ? topPeer.name.slice(0, 24) + '\u2026' : topPeer.name) : null
            return (
            <div className="mt-4 border-t border-line pt-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                Worst historical fall & recovery
                <InfoTip width={280} label="About worst fall">
                  The deepest peak-to-trough drop in the fund's full history (not just the selected range), and how long it took to climb back. Category and peer comparisons use the 3-year max drawdown metric.
                </InfoTip>
              </div>

              {/* Row 1: Fall depth + reason */}
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-xl font-extrabold text-rose-600 dark:text-rose-400">{pct(dd.depthPct)}</span>
                <span className="text-sm text-muted">
                  {fmtDate(dd.peakDate)} to {fmtDate(dd.troughDate)}
                  {regime && <span className="ml-1 text-faint">(during {regime})</span>}
                </span>
              </div>

              {/* Row 2: Recovery */}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-medium text-faint uppercase tracking-wide">Recovery:</span>
                {dd.recovered ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-sm font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {humanDuration(dd.recoveryDays as number)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-sm font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    Not yet ({humanDuration(dd.daysSinceTrough)} and counting)
                  </span>
                )}
              </div>

              {/* Row 3: Comparison context */}
              {(catMedianDD != null || peerDD != null) && (
                <div className="mt-2.5 rounded-lg border border-line bg-surface2/30 px-3 py-2">
                  <div className="text-xs font-medium text-faint uppercase tracking-wide mb-1.5">How does this compare?</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    {catMedianDD != null && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-semibold text-rose-600 dark:text-rose-400">{pct(catMedianDD)}</span>
                        <span className="text-faint">category median max drawdown</span>
                      </div>
                    )}
                    {peerDD != null && peerName && (
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-semibold text-rose-600 dark:text-rose-400">{pct(peerDD)}</span>
                        <span className="text-faint">top peer ({peerName})</span>
                      </div>
                    )}
                  </div>
                  {catMedianDD != null && dd.depthPct > catMedianDD && (
                    <div className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      The full-history fall shown is smaller than the category’s 3-year median drawdown. The periods differ.
                    </div>
                  )}
                  {catMedianDD != null && dd.depthPct <= catMedianDD && catMedianDD < 0 && dd.depthPct / catMedianDD > 1.2 && (
                    <div className="mt-1.5 text-xs text-rose-600 dark:text-rose-400 font-medium">
                      The full-history fall shown exceeds 1.2 times the category’s 3-year median drawdown. The periods differ.
                    </div>
                  )}
                  {catMedianDD != null && dd.depthPct <= catMedianDD && !(catMedianDD < 0 && dd.depthPct / catMedianDD > 1.2) && (
                    <div className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                      The full-history fall shown is at least as large as the category’s 3-year median drawdown. The periods differ.
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })()}
        </div>
      )}

      {/* Fallback: show worst fall standalone if no regime data */}
      {dd && !(a?.regimes && a.regimes.some((r) => r.active)) && (
        <div className="mt-4 card p-4">
          <h4 className="flex items-center gap-1.5 font-semibold text-fg">
            Worst historical fall & recovery
            <InfoTip width={260} label="About worst fall">
              The deepest peak-to-trough drop in the fund's full history, and how long it took to climb back.
            </InfoTip>
          </h4>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-faint">Deepest fall</div>
              <span className="text-xl font-extrabold text-rose-600 dark:text-rose-400">{pct(dd.depthPct)}</span>
              <div className="text-xs text-faint">{fmtDate(dd.peakDate)} to {fmtDate(dd.troughDate)}</div>
            </div>
            <div>
              <div className="text-xs text-faint">Recovery</div>
              {dd.recovered ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-base font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  {humanDuration(dd.recoveryDays as number)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-0.5 text-base font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  Not yet ({humanDuration(dd.daysSinceTrough)})
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        Based on this fund's actual history. See{' '}
        <a href="#/methodology" className="text-brand-600 hover:underline">Methodology</a> for formulas and caveats.
      </p>
    </div>
  )
}

function clampSip(v: number): number {
  if (isNaN(v) || v < SIP_MIN) return SIP_MIN
  if (v > SIP_MAX) return SIP_MAX
  return Math.round(v)
}
