import { useState } from 'react'
import { getUniverseFund, universeFunds } from '../lib/matcherUniverse'
import { isIsoDate } from '../lib/marketDate'
import type { FundSummary, ParsedPortfolio } from '../lib/portfolio'

const inr = (value: number) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const planLabel = (name: string) => /\bdirect\b/i.test(name) ? 'Direct' : /\bregular\b/i.test(name) ? 'Regular' : 'Not explicit (parser assumes Regular)'

export function correctPortfolioScheme(portfolio: ParsedPortfolio, statementName: string, code: number): ParsedPortfolio {
  if (code !== 0 && !getUniverseFund(code)) throw new Error('Choose a scheme from the local fund list.')
  const siblings = portfolio.fundSummaries.filter(s => s.fundName === statementName)
  if (!siblings.length) throw new Error('Statement scheme was not found.')
  // The parser has no folio ID on transactions. Correct all identical names
  // together, and retain the existing XIRR gate for ambiguous unmatched folios.
  const ambiguous = siblings.filter(s => s.fundCode === 0).length > 1
  const fundSummaries = portfolio.fundSummaries.map(s => s.fundName === statementName
    ? { ...s, fundCode: code, ...(ambiguous ? { historyUnusable: true } : {}) } : s)
  const transactions = portfolio.transactions.map(t => t.fundName === statementName ? { ...t, fundCode: code } : t)
  return {
    ...portfolio, fundSummaries, transactions,
    fundCodes: [...new Set([...fundSummaries, ...transactions].map(s => s.fundCode).filter(c => c > 0))],
  }
}

function statementValue(s: FundSummary): number {
  const value = s.marketValue > 0 ? s.marketValue : s.closingUnits * s.latestNav
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function reviewPortfolioValues(portfolio: ParsedPortfolio) {
  const active = portfolio.fundSummaries.filter(s => s.closingUnits > 0.001)
  const total = active.reduce((sum, s) => sum + statementValue(s), 0)
  const stated = portfolio.diagnostics?.statedTotalValue ?? null
  const warnings: string[] = []
  const dropped = Math.max(0, (portfolio.diagnostics?.isinCount ?? 0) - portfolio.fundSummaries.length)
  if (dropped) warnings.push(`${dropped} statement scheme block(s) could not be read. Holdings may be missing.`)
  if (stated === null) warnings.push('Statement total was not read. Compare the parsed total with your original statement.')
  else if (Math.abs(total - stated) > Math.max(1, Math.abs(stated) * 0.02)) {
    warnings.push(`Material total mismatch: parsed ${inr(total)}, statement ${inr(stated)}. Difference ${inr(Math.abs(total - stated))}, above 2%.`)
  }
  if (!active.length) warnings.push('No active holdings were read. Check closing balances before saving.')
  const dates = new Set(active.map(s => s.marketValue > 0 ? s.marketValueDate : s.navDate).filter(isIsoDate))
  if (dates.size > 1) warnings.push('Holdings have different statement valuation dates. The total combines those dates.')
  return { total, stated, warnings }
}

export function reviewHoldingWarnings(s: FundSummary): string[] {
  const warnings: string[] = []
  const matched = getUniverseFund(s.fundCode)
  if (!matched) warnings.push('Unmatched: retained at statement value, without a verified fund identity.')
  if (matched && ((/\bdirect\b/i.test(s.fundName) && matched.planType !== 'direct') || (/\bregular\b/i.test(s.fundName) && matched.planType !== 'regular'))) {
    warnings.push('Plan mismatch: selected Direct/Regular plan differs from the statement label.')
  }
  if (matched && /\b(idcw|dividend|payout|reinvestment)\b/i.test(s.fundName) && matched.optionType.toLowerCase() === 'growth') {
    warnings.push('Option mismatch: the statement mentions distributions but the selected scheme is Growth. Leave unmatched unless you can verify it.')
  }
  if (s.closingUnits > 0.001) {
    if (!statementValue(s)) warnings.push('Missing statement valuation: this holding contributes zero to the parsed total.')
    const valueDate = s.marketValue > 0 ? s.marketValueDate : s.navDate
    if (!isIsoDate(valueDate)) warnings.push('Statement valuation date is missing. XIRR will be unavailable.')
    if (s.marketValue > 0 && s.latestNav > 0) {
      if (s.navDate !== s.marketValueDate) warnings.push('NAV and market value dates differ; units × NAV is not a same-date cross-check.')
      else if (Math.abs(s.closingUnits * s.latestNav - s.marketValue) > Math.max(1, s.marketValue * 0.02)) {
        warnings.push(`Material valuation mismatch: units × NAV ${inr(s.closingUnits * s.latestNav)} differs from statement value ${inr(s.marketValue)} by more than 2%.`)
      }
    }
  }
  if (s.historyUnusable || !Number.isFinite(s.openingUnits) || s.openingUnits == null || Math.abs(s.openingUnits) > 0.001) {
    warnings.push('Transaction history is incomplete or uncertain. XIRR will be unavailable for this fund.')
  }
  return warnings
}

function SchemeCorrection({ name, code, onChange }: { name: string; code: number; onChange: (code: number) => void }) {
  const [query, setQuery] = useState('')
  const [plan, setPlan] = useState('all')
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const results = terms.length ? universeFunds.filter(f => (plan === 'all' || f.planType === plan)
    && terms.every(t => `${f.name} ${f.code}`.toLowerCase().includes(t))).slice(0, 30) : []
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold text-brand-600">Correct scheme match</summary>
      <p className="mt-2 text-xs text-muted">Search the bundled fund list by name or AMFI code. This changes every statement block with this exact name, including closed folios. It does not change units, values or dates.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input aria-label={`Search scheme for ${name}`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Fund name or AMFI code" className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg" />
        <select aria-label={`Filter plan for ${name}`} value={plan} onChange={e => setPlan(e.target.value)} className="rounded-lg border border-line bg-bg px-2 py-2 text-sm text-fg">
          <option value="all">All plans</option><option value="direct">Direct</option><option value="regular">Regular</option>
        </select>
      </div>
      {terms.length > 0 && <p className="mt-2 text-xs text-muted">{results.length ? 'Up to 30 matches. Refine the search if needed.' : 'No local matches. Leave this scheme unmatched.'}</p>}
      <ul className="mt-2 max-h-64 overflow-y-auto space-y-1">
        {results.map(f => <li key={f.code}><button type="button" onClick={() => { onChange(f.code); setQuery('') }} className="w-full rounded-lg border border-line px-3 py-2 text-left text-sm text-fg hover:bg-surface2">
          {f.name} · {f.planType === 'direct' ? 'Direct' : 'Regular'} · {f.optionType} · AMFI {f.code}{code === f.code ? ' (selected)' : ''}
        </button></li>)}
      </ul>
      <button type="button" onClick={() => onChange(0)} className="mt-2 text-sm font-semibold text-brand-600">Leave unmatched</button>
    </details>
  )
}

export default function PortfolioImportReview({ portfolio, replacing, onConfirm, onCancel }: {
  portfolio: ParsedPortfolio
  replacing: boolean
  onConfirm: (portfolio: ParsedPortfolio) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(portfolio)
  const [acknowledged, setAcknowledged] = useState(false)
  const [corrected, setCorrected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const values = reviewPortfolioValues(draft)
  const groups = [...new Set(draft.fundSummaries.map(s => s.fundName))]
  function correct(name: string, code: number) {
    setDraft(current => correctPortfolioScheme(current, name, code))
    setCorrected(current => new Set([...current, name]))
    setAcknowledged(false)
    setError('')
  }
  return (
    <section aria-labelledby="import-review-heading" className="mb-6 space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-6">
      <h2 id="import-review-heading" className="text-xl font-bold text-fg">Review statement import</h2>
      <p className="text-sm text-muted">Nothing has been saved yet. {replacing ? 'Your saved portfolio stays unchanged until you confirm replacement. ' : ''}Statement contents stay in this browser.</p>
      <p className="text-sm text-muted">Automatic name matches are suggestions, not verified identities. Check each scheme, Direct/Regular plan and Growth/distribution option against your statement. Unmatched holdings remain in the total but may not have fund analytics.</p>
      <div className="rounded-lg bg-surface2 p-3 text-sm text-fg">
        <p>Parsed statement value: <strong>{inr(values.total)}</strong></p>
        <p>Statement summary total: <strong>{values.stated === null ? 'Not read' : inr(values.stated)}</strong></p>
        <p className="mt-1 text-xs text-muted">{draft.fundSummaries.length} scheme blocks · {draft.transactions.length} transactions. Values are from the statement, not live prices.</p>
      </div>
      {values.warnings.length > 0 && <div role="alert" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><ul className="list-disc pl-4">{values.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
      {groups.map((name, index) => {
        const blocks = draft.fundSummaries.filter(s => s.fundName === name)
        const summary = blocks[0]
        const matched = getUniverseFund(summary.fundCode)
        const warnings = [...new Set(blocks.flatMap(reviewHoldingWarnings))]
        return <article key={name} className="rounded-lg border border-line p-4">
          <h3 className="font-semibold text-fg">{index + 1}. {name}</h3>
          <p className="mt-1 text-xs text-muted">Statement plan: {planLabel(name)} · {blocks.length} block(s)</p>
          <p className="mt-2 text-sm text-fg">{corrected.has(name) ? 'Your selection' : 'Suggested match (needs review)'}: <strong>{matched ? `${matched.name} · ${matched.planType === 'direct' ? 'Direct' : 'Regular'} · ${matched.optionType} · AMFI ${matched.code}` : 'Unmatched'}</strong></p>
          <ul className="mt-2 space-y-1 text-xs text-muted">{blocks.map((s, i) => <li key={i}>
            Block {i + 1}: {s.closingUnits.toLocaleString('en-IN')} units · {inr(statementValue(s))} · valuation date {s.marketValue > 0 ? s.marketValueDate || 'Unknown' : s.navDate || 'Unknown'}{s.closingUnits <= 0.001 ? ' · Closed, excluded from holdings' : ''}
          </li>)}</ul>
          {warnings.length > 0 && <ul className="mt-2 list-disc pl-4 text-sm text-amber-800 dark:text-amber-300">{warnings.map(w => <li key={w}>{w}</li>)}</ul>}
          <SchemeCorrection name={name} code={summary.fundCode} onChange={code => correct(name, code)} />
        </article>
      })}
      <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} className="mt-1" />I have reviewed the suggested matches, plans, statement totals and warnings. I accept any remaining unmatched or uncertain holdings.</label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={!acknowledged || !groups.length} onClick={() => { try { onConfirm(draft) } catch { setError('Could not save in this browser. Your previous portfolio has not been replaced. Free browser storage and try again.') } }} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{replacing ? 'Confirm and replace saved portfolio' : 'Confirm and save portfolio'}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg">Cancel import</button>
      </div>
    </section>
  )
}
