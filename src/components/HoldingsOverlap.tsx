import { useMemo, useState, type ReactNode } from 'react'
import type { Fund } from '../types'
import { computeOverlap, type OverlapResult } from '../lib/overlap'

// Must match the Compare page's series palette (supports up to 5 funds).
const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']

function shortName(f: Fund): string {
  // first 2-3 words for compact headers
  return f.name.split(' ').slice(0, 3).join(' ')
}

// One-word label for column headers / dumbbell legend (drops generic suffixes).
function oneWord(f: Fund): string {
  let n = f.name
  for (const w of [' Fund', ' - Direct', ' Plan', ' Growth', ' Large Cap', ' Large', ' Cap', 'Index']) {
    n = n.split(w)[0]
  }
  return (n.trim() || f.name).split(' ')[0]
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function overlapTone(pct: number): string {
  if (pct >= 50) return 'text-rose-600 dark:text-rose-400'
  if (pct >= 25) return 'text-amber-600 dark:text-amber-400'
  return 'text-emerald-600 dark:text-emerald-400'
}

function overlapVerdict(pct: number): string {
  if (pct >= 50) return 'High overlap - these funds largely duplicate each other.'
  if (pct >= 25) return 'Moderate overlap - meaningful shared exposure.'
  if (pct > 0) return 'Low overlap - mostly complementary holdings.'
  return 'No shared stock-level holdings.'
}

// ---------------------------------------------------------------------------
// Weight grid (3+ funds): rows = shared holdings, columns = funds.
// Cell shade encodes weight; text contrast is chosen from the composited chip
// colour so pale cells always get dark text (works in light + dark themes).
// ---------------------------------------------------------------------------
function WeightGrid({ funds, overlap }: { funds: Fund[]; overlap: OverlapResult }) {
  const [expanded, setExpanded] = useState(false)
  const idx = funds.map((_, i) => i).filter((i) => overlap.hasData[i])
  const shared = overlap.shared
  const MAX = 12
  const shown = expanded ? shared : shared.slice(0, MAX)

  let wmax = 0
  shown.forEach((s) => idx.forEach((i) => { const w = s.weights[i]; if (w && w > wmax) wmax = w }))
  if (wmax <= 0) wmax = 1

  const cols = `minmax(72px,132px) repeat(${idx.length}, minmax(46px, 1fr))`

  function chip(w: number | null, colHex: string, key: string) {
    if (w === null || w <= 0) {
      return (
        <div
          key={key}
          className="flex h-[34px] items-center justify-center rounded-lg"
          style={{ background: 'repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 4px,#e2e8f0 4px,#e2e8f0 8px)' }}
        />
      )
    }
    const [r, g, b] = hexToRgb(colHex)
    const a = 0.16 + 0.84 * (w / wmax)
    // Composite over white so the chip is a solid light-based colour in any theme.
    const R = Math.round(255 * (1 - a) + r * a)
    const G = Math.round(255 * (1 - a) + g * a)
    const B = Math.round(255 * (1 - a) + b * a)
    const txt = a >= 0.52 ? '#ffffff' : '#0f172a'
    const val = w < 0.05 ? '<0.1' : w.toFixed(1)
    return (
      <div
        key={key}
        className="flex h-[34px] items-center justify-center rounded-lg text-xs font-bold tabular-nums"
        style={{ background: `rgb(${R},${G},${B})`, color: txt }}
      >
        {val}
      </div>
    )
  }

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-fg">Shared holdings weight map</h4>
        <span className="text-xs text-faint">shade = weight · striped = not held</span>
      </div>
      <div className="grid items-stretch gap-1.5" style={{ gridTemplateColumns: cols }}>
        <div />
        {idx.map((i) => (
          <div key={`h-${funds[i].code}`} className="flex flex-col items-center gap-1 pb-0.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[i] }} />
            <span
              className="max-w-full truncate text-center text-[10.5px] font-bold text-muted"
              title={funds[i].name}
            >
              {oneWord(funds[i])}
            </span>
          </div>
        ))}
        {shown.map((s) => (
          <FragmentRow key={s.name}>
            <div className="flex items-center truncate pr-2 text-[12.5px] text-fg" title={s.name}>
              {s.name}
            </div>
            {idx.map((i) => chip(s.weights[i], COLORS[i], `${s.name}-${i}`))}
          </FragmentRow>
        ))}
      </div>
      {shared.length > MAX && (
        <button
          className="mt-3 text-[13px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show fewer' : `Show all ${shared.length} shared holdings`}
        </button>
      )}
    </div>
  )
}

// Grid children must be siblings (no wrapper element), so we just render a
// fragment. React keys live on the caller.
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Dumbbell (2 funds): "how much you double up" headline + per-stock dumbbell
// showing who bets bigger on each shared holding.
// ---------------------------------------------------------------------------
function Dumbbell({ funds, overlap }: { funds: Fund[]; overlap: OverlapResult }) {
  const idx = funds.map((_, i) => i).filter((i) => overlap.hasData[i])
  const [a, b] = idx
  const ov = overlap.pairOverlap[a][b]
  const nA = funds[a].holdings?.length ?? 0
  const nB = funds[b].holdings?.length ?? 0
  const sharedCount = overlap.shared.length
  const shown = overlap.shared.slice(0, 14)

  let maxW = 0
  shown.forEach((s) => { maxW = Math.max(maxW, s.weights[a] || 0, s.weights[b] || 0) })
  const niceMax = Math.max(2, Math.ceil(maxW / 2) * 2)
  const step = niceMax <= 6 ? 1 : niceMax <= 12 ? 2 : Math.ceil(niceMax / 6)
  const ticks: number[] = []
  for (let t = 0; t <= niceMax; t += step) ticks.push(t)

  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center justify-end gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[a] }} />
          <span className="text-muted">{oneWord(funds[a])}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[b] }} />
          <span className="text-muted">{oneWord(funds[b])}</span>
        </span>
      </div>

      {/* Doubling-up headline */}
      <div className="text-xs font-bold uppercase tracking-wide text-faint">How much you are doubling up</div>
      <div className="mt-1 flex items-center gap-4">
        <div className={`text-4xl font-extrabold leading-none ${overlapTone(ov)}`}>{ov.toFixed(1)}%</div>
        <div className="min-w-0 flex-1">
          <div className="flex h-7 overflow-hidden rounded-lg border border-line">
            <div
              className="flex items-center justify-center text-xs font-semibold text-white"
              style={{ width: `${ov}%`, backgroundColor: '#6366f1' }}
            >
              {ov >= 18 ? 'shared' : ''}
            </div>
            <div
              className="flex flex-1 items-center justify-center text-xs font-medium text-faint"
              style={{ background: 'repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 5px,#e5e9f0 5px,#e5e9f0 10px)' }}
            >
              distinct bets
            </div>
          </div>
          <div className="mt-1 flex justify-between text-xs text-faint"><span>0%</span><span>100% of portfolio</span></div>
        </div>
      </div>
      <p className="mt-2 text-[13px] text-muted">
        ₹{ov.toFixed(1)} of every ₹100 is invested in the same {sharedCount} stocks. {oneWord(funds[a])} holds {nA} stocks, {oneWord(funds[b])} holds {nB}.
      </p>

      {/* Who bets bigger */}
      <div className="mt-4 text-xs font-bold uppercase tracking-wide text-faint">Shared holdings: who bets bigger</div>
      <div className="mt-2 flex">
        <div className="w-[110px] shrink-0" />
        <div className="relative flex-1">
          {/* axis ticks */}
          <div className="relative mb-1 h-4">
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute -translate-x-1/2 text-xs text-faint"
                style={{ left: `${(t / niceMax) * 100}%` }}
              >
                {t}%
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="relative">
        {shown.map((s) => {
          const wa = s.weights[a] ?? 0
          const wb = s.weights[b] ?? 0
          const xa = (wa / niceMax) * 100
          const xb = (wb / niceMax) * 100
          const leftP = Math.min(xa, xb)
          const rightP = Math.max(xa, xb)
          const label = `${wa.toFixed(1)} vs ${wb.toFixed(1)}`
          const flip = rightP > 70
          return (
            <div key={s.name} className="flex items-center" style={{ height: 34 }}>
              <div className="w-[110px] shrink-0 truncate pr-2 text-right text-[12.5px] text-fg" title={s.name}>
                {s.name}
              </div>
              <div className="relative flex-1" style={{ height: 34 }}>
                {/* connecting line */}
                <div
                  className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded"
                  style={{ left: `${leftP}%`, width: `${rightP - leftP}%`, backgroundColor: '#cbd5e1' }}
                />
                {/* dots */}
                <span
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                  style={{ left: `${xa}%`, backgroundColor: COLORS[a] }}
                />
                <span
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                  style={{ left: `${xb}%`, backgroundColor: COLORS[b] }}
                />
                {/* value label */}
                <span
                  className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs text-faint"
                  style={
                    flip
                      ? { left: `calc(${leftP}% - 8px)`, transform: 'translate(-100%, -50%)' }
                      : { left: `calc(${rightP}% + 8px)`, transform: 'translateY(-50%)' }
                  }
                >
                  {label}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-faint">
        Each stock both funds hold; two dots close together means matched conviction, a long line means one fund leans harder.
        {sharedCount > shown.length && ` Showing top ${shown.length} of ${sharedCount} shared names by weight.`}
      </p>
    </div>
  )
}

export default function HoldingsOverlap({ funds, loading, loadTick }: { funds: Fund[]; loading?: boolean; loadTick?: number }) {
  const overlap = useMemo(() => computeOverlap(funds), [funds, loadTick])
  const usableCount = overlap.hasData.filter(Boolean).length

  if (funds.length < 2) return null

  // Funds without usable holdings (feeders / unresolved) - call out honestly.
  const noData = funds.filter((_, i) => !overlap.hasData[i])

  return (
    <div className="mt-6 card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-bold text-fg">Portfolio overlap</h3>
        <span className="text-xs text-faint">Based on latest disclosed holdings</span>
      </div>
      <p className="mb-3 text-xs text-muted">
        Overlap = sum of the smaller weight on each shared holding. 0% means no common stocks; high
        overlap means you’re buying similar exposure twice (less diversification than it looks).
      </p>

      {!loading && noData.length > 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {noData.map((f) => f.name).join(', ')} {noData.length === 1 ? 'does' : 'do'} not disclose
          stock-level holdings (likely overseas feeder funds), so {noData.length === 1 ? 'it is' : 'they are'}{' '}
          excluded from the overlap math.
        </p>
      )}

      {loading ? (
        <div className="rounded-xl bg-surface2 p-4 text-center text-sm text-muted animate-pulse">
          Computing portfolio overlap…
        </div>
      ) : usableCount < 2 ? (
        <div className="rounded-xl bg-surface2 p-4 text-center text-sm text-muted">
          Need at least two funds with stock-level holdings to compute overlap.
        </div>
      ) : (
        <>
          {/* New headline visual: dumbbell for 2 funds, weight grid for 3+ */}
          {overlap.shared.length > 0 && (
            usableCount === 2
              ? <Dumbbell funds={funds} overlap={overlap} />
              : <WeightGrid funds={funds} overlap={overlap} />
          )}

          {/* Pairwise overlap cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {funds.map((a, i) =>
              funds.slice(i + 1).map((b, jOffset) => {
                const j = i + 1 + jOffset
                if (!overlap.hasData[i] || !overlap.hasData[j]) return null
                const ov = overlap.pairOverlap[i][j]
                return (
                  <div key={`${a.code}-${b.code}`} className="rounded-xl border border-line bg-surface2/40 p-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                      <span className="truncate">{shortName(a)}</span>
                      <span className="text-faint">×</span>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[j] }} />
                      <span className="truncate">{shortName(b)}</span>
                    </div>
                    <div className={`mt-1 text-2xl font-extrabold ${overlapTone(ov)}`}>{ov.toFixed(1)}%</div>
                    <div className="text-xs text-faint">{overlapVerdict(ov)}</div>
                  </div>
                )
              }),
            )}
          </div>

          {/* Shared holdings table */}
          {overlap.shared.length > 0 ? (
            <div className="mt-4 overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm" style={{ minWidth: 320 + funds.length * 90 }}>
                <thead>
                  <tr className="border-b border-line bg-surface2 text-xs uppercase tracking-wide text-faint">
                    <th className="px-3 py-2 text-left">Shared holding</th>
                    {funds.map((f, i) =>
                      overlap.hasData[i] ? (
                        <th key={f.code} className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                            <span className="max-w-[80px] truncate">{shortName(f)}</span>
                          </div>
                        </th>
                      ) : null,
                    )}
                  </tr>
                </thead>
                <tbody>
                  {overlap.shared.slice(0, 20).map((s) => (
                    <tr key={s.name} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium text-fg">{s.name}</div>
                        {s.sector && <div className="text-xs text-faint">{s.sector}</div>}
                      </td>
                      {funds.map((f, i) =>
                        overlap.hasData[i] ? (
                          <td key={f.code} className="px-3 py-2 text-right tabular-nums">
                            {s.weights[i] !== null ? (
                              <span className="font-semibold text-fg">{(s.weights[i] as number).toFixed(2)}%</span>
                            ) : (
                              <span className="text-faint">—</span>
                            )}
                          </td>
                        ) : null,
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-surface2 p-4 text-center text-sm text-muted">
              These funds share no common holdings in their latest disclosures - fully complementary.
            </div>
          )}
          {overlap.shared.length > 20 && (
            <p className="mt-2 text-xs text-faint">Showing the 20 largest shared positions of {overlap.shared.length}.</p>
          )}
        </>
      )}
    </div>
  )
}
