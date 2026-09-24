import { useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { data, funds as allFunds, categoryOrder } from '../lib/data'
import { pct, signedPct, alphaColor, fundSlug } from '../lib/format'
import { getCategoryColor } from '../lib/categoryColors'
import { REGIMES } from '../lib/regimes'
import ShareButton from '../components/ShareButton'
import type { Fund } from '../types'

/* ---------- helpers ---------- */

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function p(arr: number[], pct: number): number {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length * pct)] ?? 0
}

function catSlugToKey(slug: string): string | undefined {
  // Try exact match first, then slug match
  if (data.categories[slug]) return slug
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return categoryOrder.find(c => norm(c) === slug)
}

function fmtCr(n: number): string {
  if (n >= 100000) return `\u20B9${(n / 100000).toFixed(1)}L Cr`
  if (n >= 1000) return `\u20B9${(n / 1000).toFixed(1)}K Cr`
  return `\u20B9${n.toFixed(0)} Cr`
}

type Horizon = '1Y' | '3Y' | '5Y'
const HORIZONS: Horizon[] = ['1Y', '3Y', '5Y']

/* ---------- components ---------- */

function StatChip({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${tone || 'text-fg'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  )
}

/* Mini horizontal bar for the distribution strip */
function DistStrip({ values, unit }: { values: number[]; unit: string }) {
  if (values.length < 3) return <span className="text-xs text-faint">Insufficient data</span>
  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const med = median(sorted)
  const q1 = p(sorted, 0.25)
  const q3 = p(sorted, 0.75)
  const range = max - min || 1
  const pctOf = (v: number) => ((v - min) / range) * 100
  return (
    <div className="space-y-1">
      <div className="relative h-6 w-full rounded bg-surface2">
        {/* IQR box */}
        <div
          className="absolute top-1 bottom-1 rounded bg-brand-200 dark:bg-brand-800"
          style={{ left: `${pctOf(q1)}%`, width: `${pctOf(q3) - pctOf(q1)}%` }}
        />
        {/* Median line */}
        <div
          className="absolute top-0 h-full w-0.5 bg-brand-600"
          style={{ left: `${pctOf(med)}%` }}
        />
        {/* Dots for each fund */}
        {sorted.map((v, i) => (
          <div
            key={i}
            className="absolute top-2.5 h-1 w-1 rounded-full bg-fg/40"
            style={{ left: `${pctOf(v)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-faint">
        <span>{min.toFixed(1)}{unit}</span>
        <span className="font-semibold text-muted">median {med.toFixed(1)}{unit}</span>
        <span>{max.toFixed(1)}{unit}</span>
      </div>
    </div>
  )
}

/* ---------- main page ---------- */

export default function CategoryDetail() {
  const { slug: rawKey } = useParams()
  const navigate = useNavigate()
  const catKey = catSlugToKey(rawKey ?? '')
  const catInfo = catKey ? data.categories[catKey] : undefined

  usePageMeta(
    catInfo ? `${catInfo.display} Funds` : 'Category not found',
    catInfo ? `${catInfo.fundCount} ${catInfo.display} mutual funds compared by risk-adjusted return, regime performance, consistency and cost. Evidence, not advice.` : undefined
  )

  const catFunds = useMemo(() =>
    catKey ? allFunds.filter(f => f.category === catKey) : [],
    [catKey]
  )

  // Return distributions per horizon
  const distributions = useMemo(() => {
    const result: Record<Horizon, { cagrs: number[]; alphas: number[]; sharpes: number[]; drawdowns: number[] }> = {
      '1Y': { cagrs: [], alphas: [], sharpes: [], drawdowns: [] },
      '3Y': { cagrs: [], alphas: [], sharpes: [], drawdowns: [] },
      '5Y': { cagrs: [], alphas: [], sharpes: [], drawdowns: [] },
    }
    for (const f of catFunds) {
      for (const h of HORIZONS) {
        const m = f.metrics[h]
        if (!m) continue
        if (m.cagr != null) result[h].cagrs.push(m.cagr)
        if (m.alpha != null) result[h].alphas.push(m.alpha)
        if (m.sharpe != null) result[h].sharpes.push(m.sharpe)
        if (m.maxDrawdown != null) result[h].drawdowns.push(m.maxDrawdown)
      }
    }
    return result
  }, [catFunds])

  // Regime stress table
  const regimeStats = useMemo(() => {
    return REGIMES.map(r => {
      const rets: number[] = []
      const alphas: number[] = []
      for (const f of catFunds) {
        const rp = f.analytics?.regimes?.find(x => x.name === r.name)
        if (!rp) continue
        if (rp.ret != null) rets.push(rp.ret)
        if (rp.alpha != null) alphas.push(rp.alpha)
      }
      return {
        name: r.name,
        start: r.start,
        end: r.end,
        market: r.market,
        medianRet: rets.length >= 3 ? median(rets) : null,
        medianAlpha: alphas.length >= 3 ? median(alphas) : null,
        fundCount: rets.length,
      }
    }).filter(r => r.fundCount >= 3)
  }, [catFunds])

  // Skill metrics
  const skillStats = useMemo(() => {
    const battingPcts = catFunds.map(f => f.analytics?.battingAverage?.pct).filter((v): v is number => v != null)
    const captures = catFunds.map(f => f.analytics?.capture).filter(c => c?.down != null)
    const alphaConfs = catFunds.map(f => f.analytics?.alpha?.confidence).filter((v): v is number => v != null)
    const highConf = alphaConfs.filter(c => c >= 90).length
    return {
      medianBatting: battingPcts.length >= 3 ? median(battingPcts) : null,
      battingAbove60: battingPcts.filter(p => p >= 60).length,
      battingTotal: battingPcts.length,
      medianUpCapture: captures.length >= 3 ? median(captures.map(c => c!.up!).filter((v): v is number => v != null)) : null,
      medianDownCapture: captures.length >= 3 ? median(captures.map(c => c!.down!).filter((v): v is number => v != null)) : null,
      highConfAlpha: highConf,
      alphaTotal: alphaConfs.length,
    }
  }, [catFunds])

  // Cost stats
  const costStats = useMemo(() => {
    const ers = catFunds
      .map(f => ({ name: f.name, code: f.code, er: typeof f.expenseRatio === 'number' ? f.expenseRatio : null }))
      .filter((x): x is { name: string; code: number; er: number } => x.er != null && x.er > 0)
      .sort((a, b) => a.er - b.er)
    return {
      cheapest: ers[0] ?? null,
      mostExpensive: ers[ers.length - 1] ?? null,
      medianER: ers.length >= 3 ? median(ers.map(e => e.er)) : null,
      count: ers.length,
    }
  }, [catFunds])

  // AUM stats
  const aumStats = useMemo(() => {
    const withAum = catFunds
      .filter(f => f.aum?.current != null && f.aum.current > 0)
      .sort((a, b) => (b.aum!.current) - (a.aum!.current))
    const total = withAum.reduce((s, f) => s + f.aum!.current, 0)
    const top5 = withAum.slice(0, 5)
    const top5Share = total > 0 ? (top5.reduce((s, f) => s + f.aum!.current, 0) / total) * 100 : 0
    return { total, top5, top5Share, count: withAum.length }
  }, [catFunds])

  // Window leaders: who is #1 on each horizon
  const windowLeaders = useMemo(() => {
    return HORIZONS.map(h => {
      const ranked = catFunds
        .filter(f => f.metrics[h]?.catRank != null)
        .sort((a, b) => (a.metrics[h]!.catRank) - (b.metrics[h]!.catRank))
      const leader = ranked[0]
      return { horizon: h, fund: leader ?? null, cagr: leader?.metrics[h]?.cagr ?? null }
    })
  }, [catFunds])

  // Top 10 by 3Y rank
  const top10 = useMemo(() => {
    return catFunds
      .filter(f => f.metrics['3Y']?.catRank != null)
      .sort((a, b) => (a.metrics['3Y']!.catRank) - (b.metrics['3Y']!.catRank))
      .slice(0, 10)
  }, [catFunds])

  // Hot/cold counts
  const hotCold = useMemo(() => {
    let hot = 0, cold = 0
    for (const f of catFunds) {
      const st = f.analytics?.meanReversion?.state
      if (st === 'hot') hot++
      else if (st === 'cold') cold++
    }
    return { hot, cold }
  }, [catFunds])

  if (!catKey || !catInfo) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-fg">Category not found</h1>
        <p className="mt-2 text-muted">Try browsing from <Link to="/explore" className="text-brand-600 hover:underline">Explore</Link>.</p>
      </div>
    )
  }

  const catColor = getCategoryColor(catKey)
  const isDebt = catKey === 'Liquid' || catKey === 'Money Market' || catKey === 'Arbitrage'

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <span className={`inline-block h-8 w-1.5 rounded-full ${catColor.bg}`} />
            <h1 className="text-3xl font-bold text-fg">{catInfo.display}</h1>
          </div>
          <p className="mt-2 text-sm text-muted">
            {catInfo.fundCount} funds &middot; {catInfo.riskLevel} risk &middot; Data as of{' '}
            {new Date(data.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <ShareButton title={`${catInfo.display} funds`} text={`${catInfo.fundCount} ${catInfo.display} mutual funds compared on FairFund`} className="mt-1 shrink-0" />
      </div>

      {/* Key numbers */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatChip label="Funds" value={String(catInfo.fundCount)} />
        <StatChip
          label="Median 3Y CAGR"
          value={distributions['3Y'].cagrs.length >= 3 ? `${median(distributions['3Y'].cagrs).toFixed(1)}%` : '\u2014'}
        />
        <StatChip
          label="Best-worst spread (3Y)"
          value={distributions['3Y'].cagrs.length >= 3
            ? `${(Math.max(...distributions['3Y'].cagrs) - Math.min(...distributions['3Y'].cagrs)).toFixed(1)} ppts`
            : '\u2014'}
          sub="Same 3 years, different outcomes"
        />
        <StatChip
          label="Median expense ratio"
          value={costStats.medianER != null ? `${costStats.medianER.toFixed(2)}%` : '\u2014'}
          sub={costStats.cheapest ? `Cheapest: ${costStats.cheapest.er.toFixed(2)}%` : undefined}
        />
      </div>

      {/* Return distribution strips */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold text-fg">Return distribution</h2>
        <p className="mt-1 text-sm text-muted">Every fund in the category, same window. Blue box = middle 50%. Line = median.</p>
        <div className="mt-4 space-y-5">
          {HORIZONS.map(h => (
            <div key={h}>
              <div className="mb-1 text-sm font-semibold text-fg">{h} CAGR</div>
              <DistStrip values={distributions[h].cagrs} unit="%" />
            </div>
          ))}
        </div>
      </section>

      {/* Window decides the winner */}
      <section className="mt-10">
        <h2 className="text-xl font-semibold text-fg">The window decides the winner</h2>
        <p className="mt-1 text-sm text-muted">Who ranks #1 depends on the period you measure.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {windowLeaders.map(w => (
            <div key={w.horizon} className="rounded-xl border border-line bg-surface p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-faint">{w.horizon} leader</div>
              {w.fund ? (
                <>
                  <button
                    onClick={() => navigate(`/fund/${w.fund!.code}/${fundSlug(w.fund!.name)}`)}
                    className="mt-1.5 text-left font-semibold text-fg hover:text-brand-700 dark:hover:text-brand-300"
                  >
                    {w.fund.name}
                  </button>
                  <div className="mt-1 text-sm text-muted">{w.cagr != null ? `${w.cagr.toFixed(1)}% CAGR` : ''}</div>
                </>
              ) : (
                <div className="mt-1.5 text-sm text-faint">Insufficient data</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Regime stress test */}
      {!isDebt && regimeStats.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-fg">Regime stress test</h2>
          <p className="mt-1 text-sm text-muted">How the median {catInfo.display} fund performed during each market regime.</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface2 text-xs uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 text-left font-medium">Regime</th>
                  <th className="px-4 py-2.5 text-left font-medium">Period</th>
                  <th className="px-4 py-2.5 text-center font-medium">Market</th>
                  <th className="px-4 py-2.5 text-right font-medium">Median return</th>
                  <th className="px-4 py-2.5 text-right font-medium">Median alpha</th>
                  <th className="px-4 py-2.5 text-right font-medium">Funds</th>
                </tr>
              </thead>
              <tbody>
                {regimeStats.map(r => {
                  const fmtMon = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
                  const mktColor = r.market === 'down' ? 'text-rose-500' : r.market === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                  return (
                    <tr key={r.name} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-fg">{r.name}</td>
                      <td className="px-4 py-2.5 text-muted">{fmtMon(r.start)} &ndash; {fmtMon(r.end)}</td>
                      <td className={`px-4 py-2.5 text-center text-xs font-semibold uppercase ${mktColor}`}>{r.market}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${r.medianRet != null && r.medianRet >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                        {r.medianRet != null ? `${r.medianRet >= 0 ? '+' : ''}${r.medianRet.toFixed(1)}%` : '\u2014'}
                      </td>
                      <td className={`px-4 py-2.5 text-right ${r.medianAlpha != null && r.medianAlpha >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>
                        {r.medianAlpha != null ? `${r.medianAlpha >= 0 ? '+' : ''}${r.medianAlpha.toFixed(1)}%` : '\u2014'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted">{r.fundCount}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Skill distribution */}
      {!isDebt && (skillStats.medianBatting != null || skillStats.highConfAlpha > 0) && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-fg">Skill vs luck</h2>
          <p className="mt-1 text-sm text-muted">How consistently funds in this category outperform their own median peer.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {skillStats.medianBatting != null && (
              <StatChip label="Median consistency" value={`${Math.round(skillStats.medianBatting)}%`} sub={`of rolling 3Y windows beat median`} />
            )}
            {skillStats.battingTotal > 0 && (
              <StatChip label="Consistent funds" value={`${skillStats.battingAbove60}`} sub={`of ${skillStats.battingTotal} beat median 60%+ of the time`} />
            )}
            {skillStats.medianDownCapture != null && (
              <StatChip label="Median down-capture" value={`${Math.round(skillStats.medianDownCapture)}%`} sub="of category's bad months absorbed" />
            )}
            {skillStats.alphaTotal > 0 && (
              <StatChip label="Statistically skilled" value={`${skillStats.highConfAlpha}`} sub={`of ${skillStats.alphaTotal} have ≥90% alpha confidence`} />
            )}
          </div>
        </section>
      )}

      {/* Hot / cold */}
      {!isDebt && (hotCold.hot > 0 || hotCold.cold > 0) && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-fg">Mean reversion signal</h2>
          <p className="mt-1 text-sm text-muted">Funds running well above or below their own long-run pace (1Y return vs historical norm).</p>
          <div className="mt-4 flex gap-4">
            {hotCold.hot > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/10">
                <span className="font-display text-2xl font-semibold text-amber-700 dark:text-amber-400">{hotCold.hot}</span>
                <span className="ml-2 text-sm text-muted">running hot</span>
              </div>
            )}
            {hotCold.cold > 0 && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-900/10">
                <span className="font-display text-2xl font-semibold text-blue-700 dark:text-blue-400">{hotCold.cold}</span>
                <span className="ml-2 text-sm text-muted">running cold</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* AUM landscape */}
      {aumStats.count > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-fg">Where the money is</h2>
          <p className="mt-1 text-sm text-muted">
            {fmtCr(aumStats.total)} across {aumStats.count} funds. Top 5 hold {aumStats.top5Share.toFixed(0)}% of category AUM.
          </p>
          <div className="mt-4 space-y-2">
            {aumStats.top5.map(f => {
              const share = aumStats.total > 0 ? (f.aum!.current / aumStats.total) * 100 : 0
              return (
                <button
                  key={f.code}
                  onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
                  className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left transition hover:border-brand-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-fg">{f.name}</div>
                    <div className="text-xs text-faint">{f.amc}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold text-fg">{fmtCr(f.aum!.current)}</div>
                    <div className="text-xs text-faint">{share.toFixed(0)}% of category</div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Top 10 standings */}
      <section className="mt-10">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-fg">Current standings (3Y)</h2>
            <p className="mt-1 text-sm text-muted">Top 10 by risk-adjusted composite score.</p>
          </div>
          <Link
            to={`/explore?cat=${encodeURIComponent(catKey)}`}
            className="shrink-0 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
          >
            See all {catInfo.fundCount}
          </Link>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface2 text-xs uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 text-left font-medium">#</th>
                <th className="px-4 py-2.5 text-left font-medium">Fund</th>
                <th className="px-4 py-2.5 text-right font-medium">CAGR</th>
                {!isDebt && <th className="px-4 py-2.5 text-right font-medium">Alpha</th>}
                {!isDebt && <th className="px-4 py-2.5 text-right font-medium">Sharpe</th>}
                {!isDebt && <th className="px-4 py-2.5 text-right font-medium">Max DD</th>}
              </tr>
            </thead>
            <tbody>
              {top10.map(f => {
                const m = f.metrics['3Y']!
                return (
                  <tr
                    key={f.code}
                    onClick={() => navigate(`/fund/${f.code}/${fundSlug(f.name)}`)}
                    className="cursor-pointer border-b border-line/60 last:border-0 transition hover:bg-brand-50/40 dark:hover:bg-brand-900/20"
                  >
                    <td className="px-4 py-2.5">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        m.catRank <= 3 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-surface2 text-muted'
                      }`}>{m.catRank}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-fg">{f.name}</div>
                      <div className="text-xs text-faint">{f.amc}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-fg">{pct(m.cagr)}</td>
                    {!isDebt && <td className={`px-4 py-2.5 text-right font-semibold ${alphaColor(m.alpha)}`}>{signedPct(m.alpha)}</td>}
                    {!isDebt && <td className="px-4 py-2.5 text-right text-muted">{m.sharpe?.toFixed(2) ?? '\u2014'}</td>}
                    {!isDebt && <td className="px-4 py-2.5 text-right text-rose-500">{pct(m.maxDrawdown)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Navigation to other categories */}
      <section className="mt-10 border-t border-line pt-8">
        <h2 className="text-lg font-semibold text-fg">Other categories</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {categoryOrder.filter(c => c !== catKey && data.categories[c]).map(c => {
            const cc = getCategoryColor(c)
            return (
              <Link
                key={c}
                to={`/category/${c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${cc.bg} ${cc.text} hover:opacity-80`}
              >
                {data.categories[c].display}
              </Link>
            )
          })}
        </div>
      </section>

      <p className="mt-8 text-xs text-faint">Data for research only, not investment advice. Past performance does not indicate future returns.</p>
    </div>
  )
}
