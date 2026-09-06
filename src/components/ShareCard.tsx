import { forwardRef } from 'react'
import type { Fund, Horizon } from '../types'
import { buildVerdict } from '../lib/verdict'
import { buildDebtVerdict } from '../lib/debtVerdict'
import { funds as ALL_FUNDS } from '../lib/data'

/**
 * A self-contained, fixed-size branded card rasterised to a PNG for the Share
 * button's clipboard-image feature. It is styled entirely with hardcoded inline
 * colours (NOT the app's theme CSS variables) so the exported image looks the
 * same in light or dark mode and does not depend on Tailwind's runtime classes
 * resolving during html-to-image capture. Rendered off-screen; never seen live.
 */

const BRAND = '#2563eb'
const GREEN = '#10b981'
const INK = '#0f172a'
const MUTE = '#64748b'
const FAINT = '#94a3b8'
const LINE = '#e2e8f0'

const TONE_COLOR: Record<string, string> = {
  good: GREEN,
  warn: '#d97706',
  bad: '#e11d48',
  neutral: MUTE,
}

interface ShareCardData {
  score: number | null
  label: string
  tone: string
  oneLiner: string
  rank: string | null
  cagr: string | null
  cagrLabel: string
  extra: string | null
  extraLabel: string
}

function cardData(fund: Fund): ShareCardData {
  const baselineHorizon: Horizon = fund.metrics['3Y'] ? '3Y' : fund.metrics['5Y'] ? '5Y' : '1Y'
  const m = fund.metrics[baselineHorizon]

  // Debt / arbitrage funds: tiered verdict.
  if (fund.isDebt || fund.isArbitrage) {
    const v = buildDebtVerdict(fund, ALL_FUNDS)
    return {
      score: v.scored && v.score != null ? v.score : null,
      label: v.label ?? (v.scored ? 'Scored' : 'Data-limited'),
      tone: v.tone,
      oneLiner: v.oneLiner,
      rank: v.rankLabel ?? null,
      cagr: m?.cagr != null ? `${m.cagr.toFixed(1)}%` : null,
      cagrLabel: `${baselineHorizon} return`,
      extra: fund.expenseRatio != null ? `${fund.expenseRatio.toFixed(2)}%` : null,
      extraLabel: 'Expense',
    }
  }

  // Young funds with no full backward window: honest since-inception read.
  const hasWindow = fund.metrics['3Y'] ?? fund.metrics['5Y'] ?? fund.metrics['1Y']
  if (!hasWindow) {
    const si = fund.si
    return {
      score: null,
      label: 'Too new to score',
      tone: 'neutral',
      oneLiner:
        'This fund is younger than the ~1 year of history FairFund needs to judge peer rank, risk-adjusted return and consistency. Here is the honest read so far.',
      rank: null,
      cagr: si?.cagr != null ? `${si.cagr.toFixed(1)}%` : si?.totalReturn != null ? `${si.totalReturn.toFixed(1)}%` : null,
      cagrLabel: si?.cagr != null ? 'Since launch (annualised)' : 'Since launch',
      extra: fund.expenseRatio != null ? `${fund.expenseRatio.toFixed(2)}%` : null,
      extraLabel: 'Expense',
    }
  }

  // Equity: full conviction verdict.
  const v = buildVerdict(fund)
  return {
    score: v.score,
    label: v.label,
    tone: v.tone,
    oneLiner: v.oneLiner,
    rank: m?.catRank != null && m?.catSize != null ? `#${m.catRank} of ${m.catSize}` : null,
    cagr: m?.cagr != null ? `${m.cagr.toFixed(1)}%` : null,
    cagrLabel: `${baselineHorizon} CAGR`,
    extra: m?.alpha != null ? `${m.alpha >= 0 ? '+' : ''}${m.alpha.toFixed(1)}%` : null,
    extraLabel: 'Alpha vs peers',
  }
}

const stat = (value: string | null, label: string) =>
  value == null ? null : (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 21, fontWeight: 800, color: INK, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: FAINT, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
        {label}
      </div>
    </div>
  )

const ShareCard = forwardRef<HTMLDivElement, { fund: Fund; qr?: string | null }>(function ShareCard({ fund, qr }, ref) {
  const d = cardData(fund)
  const toneColor = TONE_COLOR[d.tone] ?? MUTE
  const stats = [stat(d.rank, 'Category rank'), stat(d.cagr, d.cagrLabel), stat(d.extra, d.extraLabel)].filter(Boolean)

  return (
    <div
      ref={ref}
      style={{
        width: 640,
        boxSizing: 'border-box',
        background: '#ffffff',
        fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
        color: INK,
        borderTop: `6px solid ${toneColor}`,
        padding: '32px 36px 28px',
      }}
    >
      {/* Brand row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 26 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: BRAND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg viewBox="0 0 32 32" width="22" height="22">
            <rect x="6" y="18" width="5" height="8" rx="1.5" fill="#fff" />
            <rect x="13.5" y="13" width="5" height="13" rx="1.5" fill="#fff" />
            <rect x="21" y="7" width="5" height="19" rx="1.5" fill={GREEN} />
            <rect x="4" y="26.5" width="24" height="2" rx="1" fill="#fff" opacity=".9" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1 }}>
            Fair<span style={{ color: BRAND }}>Fund</span>
          </div>
          <div style={{ fontSize: 10, color: FAINT, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600, marginTop: 2 }}>
            Forward-looking MF Research
          </div>
        </div>
      </div>

      {/* Fund identity + score */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.01em' }}>{fund.name}</div>
          <div style={{ fontSize: 13, color: MUTE, marginTop: 6 }}>
            {fund.amc} &middot; {fund.categoryDisplay} &middot; Direct &middot; Growth
          </div>
        </div>
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          {d.score != null ? (
            <>
              <div style={{ fontSize: 46, fontWeight: 800, color: toneColor, lineHeight: 1 }}>
                {d.score}
                <span style={{ fontSize: 18, color: FAINT, fontWeight: 700 }}>/100</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: toneColor, marginTop: 2 }}>{d.label}</div>
            </>
          ) : (
            <div style={{ fontSize: 15, fontWeight: 800, color: toneColor, maxWidth: 150, lineHeight: 1.3 }}>{d.label}</div>
          )}
        </div>
      </div>

      {/* One-liner */}
      <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.5, marginTop: 18 }}>{d.oneLiner}</div>

      {/* Stat row */}
      {stats.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginTop: 22, paddingTop: 20, borderTop: `1px solid ${LINE}` }}>{stats}</div>
      )}

      {/* Footer: QR to the exact fund deep link (so a pasted image is always
          actionable - scan to land on this fund), plus the standing disclaimer. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 22 }}>
        {qr && (
          <div style={{ flexShrink: 0, textAlign: 'center' }}>
            <img src={qr} width={72} height={72} style={{ display: 'block', borderRadius: 6 }} alt="" />
            <div style={{ fontSize: 9, color: FAINT, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>
              Scan to open
            </div>
          </div>
        )}
        <div style={{ fontSize: 11, color: FAINT, fontWeight: 600, lineHeight: 1.5 }}>
          See the full analysis on FairFund &middot; forward-looking mutual-fund research.
          <br />A weighted reading of the data, not investment advice.
        </div>
      </div>
    </div>
  )
})

export default ShareCard
