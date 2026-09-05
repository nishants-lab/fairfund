/**
 * Compact metadata bar: AUM, expense ratio, and investment info.
 */
import type { Fund } from '../types'
import InfoTip from './InfoTip'

function fmtAum(cr: number): string {
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(1)}L Cr`
  if (cr >= 1000) return `₹${(cr / 1000).toFixed(1)}K Cr`
  return `₹${cr.toFixed(0)} Cr`
}

function monthLabel(iso: string): string {
  const m = parseInt(iso.slice(5, 7), 10)
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] ?? ''
}

function fmtLockIn(lock: { years?: number | null; months?: number | null; days?: number | null }): string | null {
  const parts: string[] = []
  if (lock.years) parts.push(`${lock.years}Y`)
  if (lock.months) parts.push(`${lock.months}M`)
  if (lock.days) parts.push(`${lock.days}D`)
  return parts.length > 0 ? parts.join(' ') : null
}

function fmtPct(n: number): string {
  return parseFloat(n.toFixed(4)).toString()
}

/**
 * Parse a free-text exit-load string into a compact headline plus the full
 * detail for a tooltip. Handles graded liquid loads (many tiers), partial-
 * redemption ("in excess of X% of the investment") clauses, and simple
 * single-rate loads. Keeps the headline short enough for mobile.
 */
function parseExitLoad(raw: string): { headline: string; detail: string | null } {
  const text = raw.trim()
  if (/^(nil|none|no\s*exit\s*load|not\s*applicable|na|n\/a|0%?)\.?$/i.test(text)) {
    return { headline: 'Nil', detail: null }
  }
  // Drop "X% of the investment/units" thresholds so they aren't read as the rate
  const cleaned = text.replace(/\d+(?:\.\d+)?\s*%\s*of\s*the\s*(investment|units)/gi, ' ')
  const pcts = [...cleaned.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => parseFloat(m[1]))
  const wins = [...text.matchAll(/(\d+)\s*(day|month|year)s?/gi)].map((m) => {
    const n = parseInt(m[1], 10)
    const unit = m[2].toLowerCase()
    const days = unit === 'year' ? n * 365 : unit === 'month' ? n * 30 : n
    return { n, unit, days }
  })
  let window: string | null = null
  if (wins.length) {
    const mx = wins.reduce((a, b) => (b.days > a.days ? b : a))
    window = `\u2264${mx.n} ${mx.unit}${mx.n > 1 ? 's' : ''}`
  }
  if (!pcts.length) {
    const first = text.replace(/^exit\s*load\s*(of\s*)?/i, '').split(/,\s|;\s/)[0].trim()
    return { headline: first.length > 40 ? first.slice(0, 38) + '\u2026' : first, detail: text }
  }
  const max = Math.max(...pcts)
  const distinct = new Set(pcts.map((p) => p.toFixed(4)))
  const rate = distinct.size > 1 ? `up to ${fmtPct(max)}%` : `${fmtPct(max)}%`
  const headline = window ? `${rate} \u00b7 ${window}` : rate
  const detail = distinct.size > 1 || text.length > headline.length + 6 ? text : null
  return { headline, detail }
}

export default function FundMeta({ fund }: { fund: Fund }) {
  const aum = fund.aum
  const er = typeof fund.expenseRatio === "string" ? parseFloat(fund.expenseRatio) : fund.expenseRatio
  const inv = fund.investInfo

  if (!aum && er == null && !inv) return null

  const lockIn = inv?.lock_in ? fmtLockIn(inv.lock_in) : null
  const closed = inv?.available_for_investment === false

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-xs">
        {aum && (
          <div className="flex items-baseline gap-1">
            <span className="text-faint">AUM</span>
            <span className="font-semibold text-fg">{fmtAum(aum.current)}</span>
            {aum.changePct != null && aum.prevDate && aum.asOf && (
              <span className={`font-medium ${aum.changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {aum.changePct >= 0 ? '+' : ''}{aum.changePct.toFixed(1)}% ({monthLabel(aum.prevDate)} – {monthLabel(aum.asOf)})
              </span>
            )}
            <InfoTip label="Assets Under Management" width={220}>
              {aum.asOf ? `Total fund size as of ${aum.asOf}.` : 'Total fund size (latest available; disclosure date not published).'}
              {aum.asOf && aum.previous != null && ` Was ${fmtAum(aum.previous)} in ${aum.prevDate}.`}
              {' '}Very large AUM can limit agility in small/mid-cap strategies.
            </InfoTip>
          </div>
        )}
        {er != null && (
          <div className="flex items-baseline gap-1">
            <span className="text-faint">Expense</span>
            <span className="font-semibold text-fg">{er.toFixed(2)}%</span>
          </div>
        )}
        {inv?.exit_load && (() => {
          const { headline, detail } = parseExitLoad(inv.exit_load)
          return (
            <div className="flex items-baseline gap-1">
              <span className="text-faint">Exit load</span>
              <span className="font-semibold text-fg whitespace-nowrap">{headline}</span>
              {detail && (
                <InfoTip label="Exit load" width={300}>{detail}</InfoTip>
              )}
            </div>
          )
        })()}
        {lockIn && (
          <div className="flex items-baseline gap-1">
            <span className="text-faint">Lock-in</span>
            <span className="font-semibold text-fg">{lockIn}</span>
          </div>
        )}
        {inv?.min_sip != null && inv.sip_allowed !== false && !closed && (
          <div className="flex items-baseline gap-1">
            <span className="text-faint">Min SIP</span>
            <span className="font-semibold text-fg">₹{inv.min_sip.toLocaleString('en-IN')}</span>
          </div>
        )}
        {inv?.min_lumpsum != null && inv.lumpsum_allowed !== false && !closed && (
          <div className="flex items-baseline gap-1">
            <span className="text-faint">Min lumpsum</span>
            <span className="font-semibold text-fg">₹{inv.min_lumpsum.toLocaleString('en-IN')}</span>
          </div>
        )}
      </div>

      {(closed || inv?.sip_allowed === false || inv?.lumpsum_allowed === false) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {closed && (
            <span className="rounded bg-red-50 px-2 py-0.5 font-semibold text-red-600 dark:bg-red-900/20 dark:text-red-400">
              Closed for investment
            </span>
          )}
          {!closed && inv?.sip_allowed === false && (
            <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              SIP not available
            </span>
          )}
          {!closed && inv?.lumpsum_allowed === false && (
            <span className="rounded bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              Lumpsum not available
            </span>
          )}
        </div>
      )}
    </div>
  )
}
