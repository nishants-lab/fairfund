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

function fmtExitLoad(raw: string): string {
  // Strip redundant "Exit load of" prefix since the label already says "Exit load"
  return raw.replace(/^exit\s*load\s*(of\s*)?/i, '').replace(/^,\s*/, '')
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
            {aum.changePct != null && aum.prevDate && (
              <span className={`font-medium ${aum.changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {aum.changePct >= 0 ? '+' : ''}{aum.changePct.toFixed(1)}% ({monthLabel(aum.prevDate)} – {monthLabel(aum.asOf)})
              </span>
            )}
            <InfoTip label="Assets Under Management" width={220}>
              Total fund size as of {aum.asOf}.
              {aum.previous != null && ` Was ${fmtAum(aum.previous)} in ${aum.prevDate}.`}
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
        {inv?.exit_load && (
          <div className="flex items-baseline gap-1">
            <span className="text-faint">Exit load</span>
            <span className="font-semibold text-fg">{fmtExitLoad(inv.exit_load)}</span>
          </div>
        )}
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
