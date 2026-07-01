/**
 * Compact metadata bar: AUM and expense ratio (when available).
 * Placed just below the fund header.
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

export default function FundMeta({ fund }: { fund: Fund }) {
  const aum = fund.aum
  const er = fund.expenseRatio

  if (!aum && er == null) return null

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted">
      {aum && (
        <div className="flex items-center gap-1.5">
          <span className="text-faint">AUM:</span>
          <span className="font-semibold text-fg">{fmtAum(aum.current)}</span>
          {aum.changePct != null && aum.prevDate && (
            <span className={`text-xs font-medium ${aum.changePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
              {aum.changePct >= 0 ? '+' : ''}{aum.changePct.toFixed(1)}% ({monthLabel(aum.prevDate)} → {monthLabel(aum.asOf)})
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
        <div className="flex items-center gap-1.5">
          <span className="text-faint">Expense ratio:</span>
          <span className="font-semibold text-fg">{er.toFixed(2)}%</span>
          <InfoTip label="Total Expense Ratio (TER)" width={220}>
            Annual fee charged by the AMC. Lower is better, all else equal.
            This is the direct plan TER; regular plans are 0.5-1% higher.
          </InfoTip>
        </div>
      )}
    </div>
  )
}
