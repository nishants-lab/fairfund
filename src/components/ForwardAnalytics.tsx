import { useMemo, useState } from 'react'
import type { Fund, NavPoint } from '../types'
import { pct, signedPct, num, inr } from '../lib/format'
import { rollingReturnsDistribution, deepestDrawdown, outcomeCone } from '../lib/forward'
import { fmtDate, fmtMonth } from '../lib/metrics'
import { funds, data } from '../lib/data'
import { bandSpectrum } from '../lib/spectrum'
import Sparkline from './Sparkline'
import InfoTip from './InfoTip'
import Spectrum from './Spectrum'

const DIR_STYLE: Record<string, { txt: string; tone: string; arrow: string }> = {
  climbing: { txt: 'Climbing', tone: 'text-emerald-600 dark:text-emerald-400', arrow: '↑' },
  fading: { txt: 'Fading', tone: 'text-rose-600 dark:text-rose-400', arrow: '↓' },
  steady: { txt: 'Steady', tone: 'text-muted', arrow: '→' },
}

// Fixed market regimes (mirrors REGIMES in scripts/build_analytics.py).
const REGIME_INFO: Record<string, { range: string; desc: string }> = {
  'COVID crash': { range: 'Feb-Mar 2020', desc: 'The fastest crash in history when COVID hit. A pure stress test of downside protection.' },
  'COVID recovery': { range: 'Mar 2020 - Oct 2021', desc: 'The liquidity-fuelled V-shaped rebound and bull run.' },
  '2022 correction': { range: 'Oct 2021 - Jun 2022', desc: 'Rate hikes and foreign outflows dragged markets down.' },
  '2022-24 bull run': { range: 'Jun 2022 - Sep 2024', desc: 'A strong, broad-based bull led by mid and small caps.' },
  'Recent (since Sep 2024)': { range: 'Sep 2024 - May 2026', desc: 'The latest phase, including the late-2024/2025 correction, right up to today.' },
}

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
      skill: same.filter((f) => f.analytics?.alpha?.confidence != null).slice(0, 2),
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

  // Category context for the skill/consistency spectrums (median + best peer).
  const catSignals = useMemo(() => {
    const same = funds.filter((f) => f.category === fund.category)
    const conf = same.map((f) => f.analytics?.alpha?.confidence).filter((v): v is number => v != null)
    const bat = same.map((f) => f.analytics?.battingAverage?.pct).filter((v): v is number => v != null)
    const med = (xs: number[]) => {
      if (!xs.length) return null
      const s = [...xs].sort((a, b) => a - b)
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
    }
    return {
      skill: conf.length >= 3 ? { median: med(conf), best: Math.max(...conf) } : undefined,
      consistency: bat.length >= 3 ? { median: med(bat), best: Math.max(...bat) } : undefined,
    }
  }, [fund.category])

  const hasAny =
    a && (a.rankTrajectory || a.battingAverage || a.capture || a.alpha || a.meanReversion || a.regimes?.length)
  const navAvailable = nav.length > 30

  if (!hasAny && !navAvailable) return null

  return (
    <div className="mt-6">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-base font-bold text-fg">Forward-looking signals</h3>
        <span className="rounded-full bg-surface2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">beta</span>
      </div>
      <p className="mb-4 text-xs text-muted">
        Beyond past returns: how consistent, skilled and sustainable this fund looks, framed as
        evidence and probability, never a guarantee.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Rank trajectory (#3 clarity) */}
        {a?.rankTrajectory && (
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 font-semibold text-fg">
                Rank trajectory
                <InfoTip width={280}>
                  <strong>This is a RANK chart, not a returns chart.</strong> The line is the fund's
                  position within its category over time, as a percentile (100 = top of category,
                  0 = bottom). It is recomputed on a rolling 3-year-return basis, one step per month.
                  <br /><br />↑ <span className="text-emerald-600 dark:text-emerald-400">Climbing</span>: rank improved more than 5 points lately.
                  <br />↓ <span className="text-rose-600 dark:text-rose-400">Fading</span>: it slipped more than 5 points.
                  <br />→ Steady: roughly holding position.
                </InfoTip>
              </h4>
              <span className={`text-sm font-bold ${DIR_STYLE[a.rankTrajectory.direction].tone}`}>
                {DIR_STYLE[a.rankTrajectory.direction].arrow} {DIR_STYLE[a.rankTrajectory.direction].txt}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">
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
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0.5 w-4 rounded bg-brand-600" /> This fund
              </span>
              {formPeer && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'repeating-linear-gradient(90deg,#94a3b8 0 3px,transparent 3px 6px)' }} />
                  {formPeer.analytics?.rankTrajectory?.currentRank === 1 ? 'Category #1' : 'Top peer'}: {shortName(formPeer)}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">
              By 3-year return, was #{a.rankTrajectory.priorRank}/{a.rankTrajectory.priorPeers}, now #
              {a.rankTrajectory.currentRank}/{a.rankTrajectory.currentPeers} in its category (a higher line is a better rank).
              {' '}This is a return-rank lens; the headline "Rank #" at the top uses our risk-adjusted composite score, so the two can differ.
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
                <strong>How often this fund has been a top-half performer, not a one-hit wonder.</strong>
                <br /><br />We look at every rolling 3-year window in its history and count the share
                where it beat the median fund in its category. {a.battingAverage.pct}% means it finished
                in the better half in {a.battingAverage.pct} of every 100 such windows.
                <br /><br />Higher means more repeatable skill, less luck. We use 3-year windows because
                short windows are mostly noise.
              </InfoTip>
            </h4>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-2xl font-extrabold ${a.battingAverage.pct >= 65 ? 'text-emerald-600 dark:text-emerald-400' : a.battingAverage.pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}`}>{a.battingAverage.pct}%</span>
              <span className="text-xs text-faint">of 3Y windows beat the category median</span>
            </div>
            <Spectrum
              model={bandSpectrum({
                value: a.battingAverage.pct,
                lowMid: 50,
                midHigh: 65,
                leftLabel: 'Inconsistent',
                rightLabel: 'Very consistent',
                cat: catSignals.consistency,
              })}
            />
            <p className="mt-2 text-xs text-muted">
              Across {a.battingAverage.n} rolling 3-year windows.
              {' '}({a.battingAverage.pct >= 65 ? 'Strong' : a.battingAverage.pct >= 50 ? 'Middling' : 'Weak'}: beat peers in {a.battingAverage.pct}% of windows.)
            </p>
            {a.battingAverage.limited && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Limited evidence: only {a.battingAverage.n} three-year windows of history so far
                (we like to see at least 24).
              </p>
            )}
          </div>
        )}

        {/* Skill vs luck (#12 reframe when luck-heavy) */}
        {a?.alpha && (
          <div className="card p-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-fg">
              Skill vs luck
              <InfoTip width={290}>
                <strong>Is the fund's edge over its peers real, or could it be chance?</strong>
                <br /><br />We take each month's return, subtract the category-median fund's return,
                and run a one-sided t-test on whether that excess is reliably positive. The % is our
                confidence it is genuine skill.
                <br /><br />We set a high bar: below 95% confidence we say it could be luck. Below 36
                months of data we do not judge at all.
              </InfoTip>
            </h4>
            {a.alpha.insufficient || a.alpha.confidence == null ? (
              <p className="mt-1 text-sm text-muted">Not enough data to assess skill ({a.alpha.n} months).</p>
            ) : (
              <>
                {/* When the read leans LUCK, lead with the honest framing instead
                    of "X% confident it's skill" which reads odd at low values (#12). */}
                {a.alpha.confidence < 50 ? (
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">{Math.round(100 - a.alpha.confidence)}%</span>
                    <span className="text-xs text-faint">chance its edge is just luck</span>
                  </div>
                ) : (
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-2xl font-extrabold ${a.alpha.confidence >= 90 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {Math.round(a.alpha.confidence)}%
                    </span>
                    <span className="text-xs text-faint">confident it's skill, not chance</span>
                  </div>
                )}
                <Spectrum
                  model={bandSpectrum({
                    value: a.alpha.confidence,
                    lowMid: 70,
                    midHigh: 90,
                    leftLabel: 'Likely luck',
                    rightLabel: 'Likely skill',
                    cat: catSignals.skill,
                  })}
                />
                <p className="mt-2 text-xs text-muted">
                  {a.alpha.confidence >= 90
                    ? 'High confidence this edge is genuine skill.'
                    : a.alpha.confidence >= 70
                      ? 'Moderate confidence: leans skill, but not conclusive.'
                      : a.alpha.confidence >= 50
                        ? 'Weak evidence: the edge is unproven.'
                        : 'The evidence leans toward luck, not a durable edge.'}{' '}
                  Based on {a.alpha.n} monthly excess returns. (We call it skill only above 90%.)
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
              <InfoTip width={290}>
                <strong>How much of the category's moves this fund rides, up and down.</strong>
                <br /><br /><strong>Up-capture {a.capture.up ?? '—'}%:</strong> in months its category
                rose, it captured {a.capture.up ?? '—'}% of that gain.
                <br /><strong>Down-capture {a.capture.down ?? '—'}%:</strong> in months the category
                fell, it took {a.capture.down ?? '—'}% of that fall.
                <br /><br />90% up / 70% down is the sweet spot: keeps most of the upside but cushions
                the downside. Over 100% down-capture means it falls harder than peers.
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
              Captured {a.capture.up ?? '—'}% of its category's gains and {a.capture.down ?? '—'}% of its losses.
              {' '}Up-capture: higher is better. Down-capture: lower is better (below 100% means it falls less than peers).
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
              <InfoTip width={290}>
                <strong>Is the fund's recent year unusually strong (or weak) versus its own normal?</strong>
                <br /><br />This compares the fund only to itself. We take its last-1-year return and
                measure how far it sits from its own typical 1-year return, in standard deviations (a
                z-score). 0 = normal, +1/-1 = notably hot/cold, beyond ±2 is extreme.
                <br /><br />This fund: recent 1Y {signedPct(a.meanReversion.recent1Y)} vs its usual{' '}
                {signedPct(a.meanReversion.norm1Y)} (z = {num(a.meanReversion.z)}). Hot streaks tend to
                cool off, so it is a caution against chasing, not a prediction.
              </InfoTip>
            </h4>
            <div className="mt-1">
              {a.meanReversion.state === 'hot' && <span className="text-lg font-bold text-amber-600 dark:text-amber-400">🔥 Running hot</span>}
              {a.meanReversion.state === 'cold' && <span className="text-lg font-bold text-sky-600 dark:text-sky-400">❄️ Running cold</span>}
              {a.meanReversion.state === 'normal' && <span className="text-lg font-bold text-muted">In line with its norm</span>}
            </div>
            <Spectrum
              value={Math.max(0, Math.min(1, (a.meanReversion.z + 3) / 6))}
              leftLabel="❄️ Cold"
              rightLabel="🔥 Hot"
              gradient="emerald-amber-rose"
              markerLabel={`z = ${num(a.meanReversion.z)}`}
            />
            <p className="mt-2 text-xs text-muted">
              Recent 1Y {signedPct(a.meanReversion.recent1Y)} vs its typical {signedPct(a.meanReversion.norm1Y)}{' '}
              (z = {num(a.meanReversion.z)}, {zWords(a.meanReversion.z)}).
              {a.meanReversion.state === 'hot' && ' Far above norm; be cautious chasing it, returns tend to revert.'}
              {a.meanReversion.state === 'cold' && ' Below its norm; not a guarantee, but mean-reversion can cut both ways.'}
              {a.meanReversion.state === 'normal' && ' Neither stretched nor depressed vs its own history.'}
            </p>
          </div>
        )}
      </div>

      {/* ---- "If you stay invested" outcomes (horizon + SIP/lumpsum driven) ---- */}
      {(rollDist || cone) && (
        <div className="mt-6">
          <h3 className="text-base font-bold text-fg">If you stay invested for…</h3>
          <p className="mt-1 text-xs text-muted">
            Pick a holding period and how you invest. The cards below show what this fund actually
            delivered over every such stretch in its history, and a simulated range for the period ahead.
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
                  <Stat label="Worst" value={pct(rollDist.min)} sub={`${fmtMonth(rollDist.minStart)}→${fmtMonth(rollDist.minEnd)}`} tone="text-rose-600 dark:text-rose-400" />
                  <Stat label="Median" value={pct(rollDist.median)} sub="per year" />
                  <Stat label="Best" value={pct(rollDist.max)} sub={`${fmtMonth(rollDist.maxStart)}→${fmtMonth(rollDist.maxEnd)}`} tone="text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="mt-2 text-xs text-muted">
                  Annualized return for any {horizon}-year stretch in its history, across {rollDist.n}{' '}
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
                    percentiles. It assumes the future resembles the past: a model, not a promise.
                  </InfoTip>
                </h4>
                <p className="mt-1 text-xs text-muted">
                  {cone.mode === 'sip'
                    ? `Investing ${inr(clampSip(sipAmount))}/mo (${inr(cone.invested)} total over ${horizon}y) could become:`
                    : `Where ${inr(cone.invested)} invested today could land:`}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Stat label="Pessimistic" value={inr(cone.endP10)} sub={`${cone.p10.toFixed(2)}× · 10th %ile`} tone="text-rose-600 dark:text-rose-400" />
                  <Stat label="Median" value={inr(cone.endP50)} sub={`${cone.p50.toFixed(2)}× · 50th %ile`} />
                  <Stat label="Optimistic" value={inr(cone.endP90)} sub={`${cone.p90.toFixed(2)}× · 90th %ile`} tone="text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="mt-2 text-xs text-faint">
                  {cone.sims.toLocaleString('en-IN')} simulations (block bootstrap of {cone.history} monthly
                  returns, fixed seed). "×" is the multiple of money invested. Assumes the future
                  resembles the past, which it may not. Not a guarantee.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Worst fall & recovery (#7 peak→trough dates) */}
      {dd && (
        <div className="mt-4 card p-4">
          <h4 className="flex items-center gap-1.5 font-semibold text-fg">
            Worst fall & recovery
            <InfoTip width={260} label="About worst fall">
              The deepest peak-to-trough drop in the fund's full history, and how long it took to
              climb back to that prior peak. A shorter recovery means quicker to make investors whole.
            </InfoTip>
          </h4>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-rose-600 dark:text-rose-400">{pct(dd.depthPct)}</span>
            <span className="text-xs text-faint">deepest drawdown</span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Fell from its peak on {fmtDate(dd.peakDate)} to the trough on {fmtDate(dd.troughDate)}.{' '}
            {dd.recovered
              ? `Recovered to that prior peak in ${humanDuration(dd.recoveryDays as number)}.`
              : `Still recovering after ${humanDuration(dd.daysSinceTrough)}.`}
          </p>
        </div>
      )}

      {/* Regime performance */}
      {a?.regimes && a.regimes.some((r) => r.active) && (
        <div className="mt-4 card p-4">
          <h4 className="flex items-center gap-1.5 font-semibold text-fg">
            How it behaved in each market regime
            <InfoTip width={290}>
              We split the last ~6 years into five distinct market phases, from the COVID crash right
              up to today (May 2026), and show how the fund did in each, plus how that compared to its
              category. "vs category" is the fund's return minus the category-median fund's return in
              that phase. A positive, green number means it beat its peers in that phase.
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
                          <InfoTip width={250} label={`About ${r.name}`}>
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
        These are probabilistic, data-backed signals, not advice or guarantees. See{' '}
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
