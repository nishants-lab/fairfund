/**
 * /my/portfolio - CAMS upload + portfolio analysis.
 * Upload → parse in browser → show analysis. No server round-trip.
 */
import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { parseCAMSText, parseCAMSPdf, MATCHER_VERSION } from '../lib/camsParser'
import { usePortfolio, savePortfolio, clearPortfolio, analyzePortfolio, type PortfolioAnalysis, type ParsedPortfolio } from '../lib/portfolio'
import { getCategoryColor } from '../lib/categoryColors'
import { pct, signedPct, fundSlug } from '../lib/format'

// ---- Upload component ----

function UploadPanel({ onParsed }: { onParsed: (p: ParsedPortfolio) => void }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [parsing, setParsing] = useState(false)
  const fileRef = useRef<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File, pwd?: string) => {
    setError('')
    setParsing(true)

    try {
      if (file.name.endsWith('.pdf')) {
        const result = await parseCAMSPdf(file, pwd)
        if (result.needsPassword) {
          fileRef.current = file
          setNeedsPassword(true)
          setParsing(false)
          return
        }
        if (result.error) { setError(result.error); setParsing(false); return }
        if (result.portfolio) {
          if (result.portfolio.transactions.length === 0) {
            setError('No transactions found. Make sure this is a CAMS CAS (Consolidated Account Statement).')
            setParsing(false)
            return
          }
          onParsed(result.portfolio)
        }
      } else {
        // Text/CSV
        const text = await file.text()
        const portfolio = parseCAMSText(text)
        if (portfolio.transactions.length === 0) {
          setError('No transactions found. Make sure this is a CAMS statement in text or PDF format.')
          setParsing(false)
          return
        }
        onParsed(portfolio)
      }
    } catch (err) {
      setError(`Failed to parse: ${err}`)
    }
    setParsing(false)
  }, [onParsed])

  const handlePasswordSubmit = useCallback(async () => {
    if (fileRef.current && password) {
      setNeedsPassword(false)
      await handleFile(fileRef.current, password)
    }
  }, [password, handleFile])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <div className="space-y-4">
      {/* Password prompt for encrypted PDFs */}
      {needsPassword && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 dark:border-amber-700 dark:bg-amber-900/20">
          <p className="font-semibold text-fg">This PDF is password-protected</p>
          <p className="mt-1 text-sm text-muted">CAMS statements typically use your PAN number as the password.</p>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
              placeholder="Enter PDF password (e.g. PAN number)"
              className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-brand-500 focus:outline-none"
              autoFocus
            />
            <button
              onClick={handlePasswordSubmit}
              disabled={!password}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              Unlock
            </button>
          </div>
        </div>
      )}

      {/* Drop zone */}
      {!needsPassword && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition ${
            dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-line bg-surface hover:border-brand-300'
          }`}
        >
          <input ref={inputRef} type="file" accept=".pdf,.txt,.csv" onChange={onSelect} className="hidden" />
          {parsing ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
              <p className="text-sm text-muted">Parsing your statement...</p>
            </div>
          ) : (
            <>
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 dark:bg-brand-900/20">
                <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-500" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="font-semibold text-fg">Drop your CAMS statement here</p>
              <p className="mt-1 text-sm text-muted">PDF or text format. Everything is read and saved right here in your browser. Nothing is ever uploaded to a server.</p>
              <p className="mt-3 text-xs text-faint">Supports password-protected PDFs (PAN as password)</p>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      <p className="text-center text-xs text-faint">
        How to get your CAMS statement: visit{' '}
        <a href="https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement" target="_blank" rel="noopener" className="underline">
          camsonline.com
        </a>{' '}
        and request a CAS (Consolidated Account Statement) in detailed format.
      </p>
    </div>
  )
}

// ---- Analysis view ----

// Format a yyyy-mm-dd NAV date as e.g. "1 Sep"
function fmtNavDate(d: string): string {
  if (!d) return ''
  const parts = d.split('-')
  if (parts.length !== 3) return d
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const mi = parseInt(parts[1], 10) - 1
  return `${parseInt(parts[2], 10)} ${months[mi] ?? parts[1]}`
}

type HoldingSortKey = 'name' | 'weight' | 'value' | 'gainPct' | 'xirr' | 'fund3y' | 'dayChangePct' | 'drift' | 'verdict'
type HoldingSort = { k: HoldingSortKey; dir: 1 | -1 }

/** Format INR value in lakhs: 2219073 -> "22.2L" */
function fmtL(v: number): string {
  return `${(v / 100000).toFixed(1)}L`
}

function SortTh({ label, k, sort, onSort, align = 'right' }: {
  label: string
  k: HoldingSortKey
  sort: HoldingSort
  onSort: (s: HoldingSort) => void
  align?: 'left' | 'right'
}) {
  const active = sort.k === k
  return (
    <th className={`px-2.5 py-2 ${align === 'left' ? 'text-left' : 'text-right'}`}>
      <button
        onClick={() => onSort({ k, dir: active ? (sort.dir === 1 ? -1 : 1) : (k === 'name' ? 1 : -1) })}
        className={`inline-flex items-center gap-0.5 uppercase tracking-wide whitespace-nowrap transition ${active ? 'font-semibold text-fg' : 'hover:text-fg'}`}
        title={`Sort by ${label}`}
      >
        {label}
        <span className={`text-[9px] ${active ? '' : 'invisible'}`}>{active && sort.dir === 1 ? '\u25b2' : '\u25bc'}</span>
      </button>
    </th>
  )
}

function AnalysisView({ analysis, portfolio }: { analysis: PortfolioAnalysis; portfolio: ParsedPortfolio }) {
  const diag = portfolio.diagnostics
  const [openStock, setOpenStock] = useState<number | null>(null)
  // A scheme is only "dropped" if we built fewer blocks than there are ISINs.
  // Fully-redeemed (closed) funds are parsed as zero-balance blocks, not dropped.
  const dropped = diag ? Math.max(0, diag.isinCount - diag.schemesParsed) : 0
  const showWarn = !!diag && (dropped > 0 || diag.missingValueFunds.length > 0)
  // Cross-check our total against the statement's own Portfolio Summary total.
  const stated = diag?.statedTotalValue ?? null
  const gapPct = stated && stated > 0 ? (Math.abs(analysis.totalValue - stated) / stated) * 100 : null
  const valueMismatch = gapPct !== null && gapPct > 2
  const inr = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  // Holdings table: sortable rows with rank trajectory + verdict
  const [sort, setSort] = useState<HoldingSort>({ k: 'weight', dir: -1 })
  const rankByCode = new Map(analysis.reshuffleScore.map(r => [r.code, r]))
  const VERDICT_RANK: Record<string, number> = { Strong: 4, Solid: 3, Mixed: 2 }
  const holdingRows = analysis.holdings.filter(h => h.covered).map(h => {
    const rank = rankByCode.get(h.code)
    return {
      h,
      name: h.name.toLowerCase(),
      weight: h.weight,
      value: h.currentValue,
      gainPct: h.gainPct,
      xirr: h.personalCagr,
      fund3y: h.fund?.metrics['3Y']?.cagr ?? null,
      dayChangePct: h.prevNav > 0 ? h.dayChangePct : null,
      rankAtPurchase: rank?.rankAtPurchase ?? null,
      rankNow: rank?.rankNow ?? null,
      drift: rank?.drift ?? null,
      verdict: h.fund?.management?.signal ?? null,
    }
  })
  type Row = typeof holdingRows[number]
  const sortVal = (r: Row, k: HoldingSortKey): number | string | null => {
    if (k === 'name') return r.name
    if (k === 'verdict') return r.verdict ? (VERDICT_RANK[r.verdict] ?? 1) : null
    return r[k]
  }
  const sortedRows = [...holdingRows].sort((a, b) => {
    const av = sortVal(a, sort.k)
    const bv = sortVal(b, sort.k)
    if (av == null && bv == null) return 0
    if (av == null) return 1 // nulls always last
    if (bv == null) return -1
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sort.dir
    return ((av as number) - (bv as number)) * sort.dir
  })
  return (
    <div className="space-y-8">
      {/* Parse warning: only for genuinely dropped or unreadable schemes */}
      {showWarn && diag && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          <div className="font-semibold text-amber-800 dark:text-amber-300">Some holdings may be incomplete</div>
          <ul className="mt-1 space-y-0.5 text-amber-700 dark:text-amber-400">
            {dropped > 0 && (
              <li>Read {diag.activeHoldings} active {diag.activeHoldings === 1 ? 'holding' : 'holdings'}, but {dropped} {dropped === 1 ? 'scheme' : 'schemes'} in your statement could not be read and {dropped === 1 ? 'is' : 'are'} not shown below.</li>
            )}
            {diag.missingValueFunds.length > 0 && (
              <li>No current value could be read for: {diag.missingValueFunds.join(', ')}. Portfolio weights may be slightly understated.</li>
            )}
          </ul>
        </div>
      )}

      {/* Statement reconciliation: only surface a mismatch (actionable); a match needs no banner */}
      {valueMismatch && stated && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          We calculated ₹{inr(analysis.totalValue)} but your statement shows ₹{inr(stated)}. Some holdings may not have parsed correctly.
        </div>
      )}

      {/* Yesterday's move */}
      {analysis.navAsOf && (
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-medium uppercase text-faint">1-day change</div>
            <div className="text-xs text-muted">{fmtNavDate(analysis.navPrevAsOf)} to {fmtNavDate(analysis.navAsOf)}</div>
          </div>
          <div className={`mt-1 text-2xl font-bold ${analysis.dayChangeValue >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {analysis.dayChangeValue >= 0 ? '+' : '-'}₹{fmtL(Math.abs(analysis.dayChangeValue))}
            <span className="ml-2 text-lg">{analysis.dayChangePct >= 0 ? '+' : ''}{analysis.dayChangePct.toFixed(2)}%</span>
          </div>
          <div className="mt-0.5 text-xs text-muted">Across funds we track with published NAV. Holdings outside our coverage are not included in this figure.</div>
        </div>
      )}

      {/* Header stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs font-medium uppercase text-faint">Portfolio value</div>
          <div className="mt-1 text-xl font-bold text-fg">₹{(analysis.totalValue / 100000).toFixed(1)}L</div>
          <div className="text-xs text-muted">{analysis.holdings.length} funds</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs font-medium uppercase text-faint">Total gain</div>
          <div className={`mt-1 text-xl font-bold ${analysis.totalGain >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {analysis.totalGain >= 0 ? '+' : ''}₹{(Math.abs(analysis.totalGain) / 100000).toFixed(1)}L
          </div>
          <div className="text-xs text-muted">{analysis.totalGainPct >= 0 ? '+' : ''}{analysis.totalGainPct.toFixed(1)}%</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs font-medium uppercase text-faint">Invested</div>
          <div className="mt-1 text-xl font-bold text-fg">₹{(analysis.totalInvested / 100000).toFixed(1)}L</div>
          <div className="text-xs text-muted">{portfolio.fundCodes.length} schemes</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs font-medium uppercase text-faint">Statement</div>
          <div className="mt-1 text-sm font-bold text-fg">{portfolio.investorName || 'Investor'}</div>
          <div className="text-xs text-muted">{portfolio.pan || 'PAN not found'}</div>
        </div>
      </div>

      {/* Closed positions: neutral note, not a warning */}
      {diag && diag.closedPositions > 0 && (
        <p className="-mt-4 text-xs text-muted">
          Showing {diag.activeHoldings} active {diag.activeHoldings === 1 ? 'holding' : 'holdings'}. {diag.closedPositions} fully redeemed {diag.closedPositions === 1 ? 'position' : 'positions'} in your statement {diag.closedPositions === 1 ? 'is' : 'are'} not shown.
        </p>
      )}

      {/* Holdings table */}
      <section>
        <h3 className="text-lg font-semibold text-fg">Your holdings</h3>
        <p className="mt-1 text-sm text-muted">Click a column to sort. XIRR is your annualized return from your own SIP history; Fund 3Y CAGR is the fund's own trailing return.</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface2 text-[11px] uppercase text-faint">
              <tr>
                <SortTh label="Fund" k="name" sort={sort} onSort={setSort} align="left" />
                <SortTh label="Weight" k="weight" sort={sort} onSort={setSort} />
                <SortTh label="Value" k="value" sort={sort} onSort={setSort} />
                <SortTh label="Abs Gain%" k="gainPct" sort={sort} onSort={setSort} />
                <SortTh label="XIRR" k="xirr" sort={sort} onSort={setSort} />
                <SortTh label="Fund 3Y CAGR" k="fund3y" sort={sort} onSort={setSort} />
                <SortTh label="1D" k="dayChangePct" sort={sort} onSort={setSort} />
                <SortTh label="Rank" k="drift" sort={sort} onSort={setSort} />
                <SortTh label="Verdict" k="verdict" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sortedRows.map(r => (
                <tr key={r.h.code} className="hover:bg-surface2/50">
                  <td className="px-3 py-2.5">
                    <Link to={r.h.fund ? `/fund/${r.h.code}/${fundSlug(r.h.name)}` : '#'} className="font-medium text-fg hover:text-brand-600">
                      {r.h.name}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`pill text-xs ${getCategoryColor(r.h.category).bg} ${getCategoryColor(r.h.category).text}`}>
                        {r.h.categoryDisplay}
                      </span>
                    </div>
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums font-semibold text-fg whitespace-nowrap">{r.weight.toFixed(1)}%</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-muted whitespace-nowrap">₹{fmtL(r.value)}</td>
                  <td className={`px-2.5 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap ${r.gainPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {r.gainPct >= 0 ? '+' : ''}{r.gainPct.toFixed(1)}%
                  </td>
                  <td className={`px-2.5 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap ${r.xirr == null ? 'text-faint' : r.xirr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {r.xirr == null ? '—' : `${r.xirr >= 0 ? '+' : ''}${r.xirr.toFixed(1)}%`}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-muted whitespace-nowrap">
                    {r.fund3y != null ? `${r.fund3y >= 0 ? '+' : ''}${r.fund3y.toFixed(1)}%` : <span className="text-faint">—</span>}
                  </td>
                  <td className={`px-2.5 py-2.5 text-right tabular-nums text-xs font-medium whitespace-nowrap ${r.dayChangePct == null ? 'text-faint' : r.dayChangePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {r.dayChangePct == null ? 'n/a' : `${r.dayChangePct >= 0 ? '+' : ''}${r.dayChangePct.toFixed(2)}%`}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {r.rankAtPurchase != null && r.rankNow != null ? (
                      <span className={`text-xs font-semibold ${
                        (r.drift ?? 0) < 0 ? 'text-emerald-600 dark:text-emerald-400' :
                        (r.drift ?? 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted'
                      }`}>#{r.rankAtPurchase}→#{r.rankNow}</span>
                    ) : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {r.verdict ? (
                      <span className={`text-xs font-semibold ${
                        r.verdict === 'Strong' ? 'text-emerald-600' :
                        r.verdict === 'Solid' ? 'text-brand-600' :
                        r.verdict === 'Mixed' ? 'text-amber-600' : 'text-muted'
                      }`}>{r.verdict}</span>
                    ) : <span className="text-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Other holdings — not covered by FairFund (hybrid, gilt, arbitrage, etc.) */}
      {analysis.holdings.some(h => !h.covered) && (
        <section>
          <h3 className="text-lg font-semibold text-fg">Other holdings</h3>
          <p className="mt-1 text-sm text-muted">
            Not covered by FairFund's analysis (hybrid, gilt, arbitrage, and similar). Counted in your portfolio value, but not ranked or signalled.
          </p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface2 text-xs uppercase text-faint">
                <tr>
                  <th className="px-4 py-2 text-left">Fund</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {analysis.holdings.filter(h => !h.covered).map(h => (
                  <tr key={h.name} className="hover:bg-surface2/50">
                    <td className="px-4 py-3 font-medium text-fg">{h.name}</td>
                    <td className="px-3 py-3 text-right font-semibold text-fg">{h.weight.toFixed(1)}%</td>
                    <td className="px-3 py-3 text-right text-muted">₹{fmtL(h.currentValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Reshuffle Score — only funds whose category rank actually moved */}
      {analysis.reshuffleScore.some(r => r.drift !== null && r.drift !== 0) && (
        <section>
          <h3 className="text-lg font-semibold text-fg">Rank drift since purchase</h3>
          <p className="mt-1 text-sm text-muted">Funds whose standing among peers has shifted since you bought in. 3Y CAGR shown for context.</p>
          <div className="mt-3 space-y-2">
            {analysis.reshuffleScore.filter(r => r.drift !== null && r.drift !== 0).map(r => (
              <div key={r.code} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
                <Link to={`/fund/${r.code}/${fundSlug(r.name)}`} className="min-w-0 flex-1 truncate font-medium text-fg hover:text-brand-600">
                  {r.name}
                </Link>
                {r.cagr != null && (
                  <span className="hidden sm:inline whitespace-nowrap text-xs text-muted">3Y CAGR {r.cagr >= 0 ? '+' : ''}{r.cagr.toFixed(1)}%</span>
                )}
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted">#{r.rankAtPurchase}</span>
                  <span className="text-faint">to</span>
                  <span className={`font-bold ${
                    r.drift! > 3 ? 'text-red-600 dark:text-red-400' :
                    r.drift! < -3 ? 'text-emerald-600 dark:text-emerald-400' : 'text-fg'
                  }`}>#{r.rankNow}</span>
                  <span className={`text-xs font-semibold ${
                    r.drift! > 3 ? 'text-red-600 dark:text-red-400' :
                    r.drift! < -3 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'
                  }`}>
                    ({r.drift! > 0 ? '+' : ''}{r.drift})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sector concentration */}
      {analysis.sectorConcentration.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-fg">Sector concentration</h3>
          <p className="mt-1 text-sm text-muted">True exposure across all your funds combined.</p>
          <div className="mt-3 space-y-1.5">
            {analysis.sectorConcentration.slice(0, 10).map(s => (
              <div key={s.sector} className="flex items-center gap-3">
                <span className="w-32 truncate text-sm text-fg">{s.sector}</span>
                <div className="flex-1">
                  <div className="h-5 overflow-hidden rounded-full bg-surface2">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${Math.min(s.weight * 2, 100)}%` }}
                    />
                  </div>
                </div>
                <span className="w-12 text-right text-sm font-semibold text-fg">{s.weight.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Stock concentration */}
      {analysis.stockConcentration.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-fg">Top stock exposure</h3>
          <p className="mt-1 text-sm text-muted">Stocks held across multiple funds, portfolio-weighted. Tap a row to see which of your funds hold it.</p>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface2 text-xs uppercase text-faint">
                <tr>
                  <th className="px-4 py-2 text-left">Stock</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2 text-right">In # funds</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {analysis.stockConcentration.slice(0, 15).map((s, i) => {
                  const open = openStock === i
                  return (
                    <Fragment key={i}>
                      <tr
                        className="cursor-pointer hover:bg-surface2/50"
                        onClick={() => setOpenStock(open ? null : i)}
                      >
                        <td className="px-4 py-2 text-fg">
                          <span className="mr-1.5 inline-block w-2 text-faint">{open ? '▾' : '▸'}</span>
                          {s.name}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${s.weight > 5 ? 'text-amber-600 dark:text-amber-400' : 'text-fg'}`}>
                          {s.weight.toFixed(1)}%
                        </td>
                        <td className={`px-3 py-2 text-right ${s.fundCount >= 3 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-muted'}`}>
                          {s.fundCount}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-surface2/40">
                          <td colSpan={3} className="px-4 py-2">
                            <div className="space-y-1">
                              {s.holders.map(hld => (
                                <div key={hld.code} className="flex items-center justify-between gap-3 text-xs">
                                  <span className="min-w-0 truncate text-muted">{hld.name}</span>
                                  <span className="whitespace-nowrap font-medium text-fg">{hld.weight.toFixed(2)}% of portfolio</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  )
}

// ---- Main page ----

export default function Portfolio() {
  usePageMeta('Portfolio Analysis', 'Upload your CAMS statement for a deep portfolio analysis.')
  const portfolio = usePortfolio()
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [showDebug, setShowDebug] = useState(false)

  useEffect(() => {
    if (!portfolio) { setAnalysis(null); return }
    setLoading(true)
    analyzePortfolio(portfolio).then(a => { setAnalysis(a); setLoading(false) })
  }, [portfolio])

  const handleParsed = useCallback((p: ParsedPortfolio) => {
    savePortfolio(p)
  }, [])

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/my" className="text-sm text-muted hover:text-fg">My FairFund</Link>
            <span className="text-faint">/</span>
            <h1 className="text-2xl font-bold text-fg">Portfolio</h1>
          </div>
          <p className="mt-1 text-sm text-muted">
            {portfolio ? 'Saved in this browser, so you can check back any day to see how you did. Open FairFund on another device, or clear your browser data, and you will need to upload again.' : 'Upload your CAMS statement to see your portfolio through FairFund\'s lens.'}
          </p>
        </div>
        {portfolio && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDebug(d => !d)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              {showDebug ? 'Hide' : 'Debug'} parse
            </button>
            <button
              onClick={() => { clearPortfolio(); setAnalysis(null) }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-red-300 hover:text-red-600"
            >
              Clear data
            </button>
          </div>
        )}
      </div>

      <div className="mt-6">
        {!portfolio && <UploadPanel onParsed={handleParsed} />}

        {portfolio && portfolio.matcherVersion !== MATCHER_VERSION && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-900/20">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Fund matching has improved since this analysis was saved</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">Some funds may be mislabeled. Clear and re-upload your CAMS statement to refresh.</p>
            </div>
            <button
              onClick={() => { clearPortfolio(); setAnalysis(null) }}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Clear & re-upload
            </button>
          </div>
        )}

        {portfolio && showDebug && <DebugPanel portfolio={portfolio} />}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
              <span className="text-sm text-muted">Analyzing your portfolio...</span>
            </div>
          </div>
        )}

        {portfolio && analysis && <AnalysisView analysis={analysis} portfolio={portfolio} />}
      </div>
    </div>
  )
}

// ---- Debug panel: shows exactly what the parser extracted ----

function DebugPanel({ portfolio }: { portfolio: ParsedPortfolio }) {
  const summaries = portfolio.fundSummaries ?? []
  const [copied, setCopied] = useState(false)

  function buildCopyText(): string {
    const d = portfolio.diagnostics
    const lines: string[] = []
    lines.push('FairFund portfolio parse debug')
    lines.push(`Uploaded: ${portfolio.uploadedAt}`)
    lines.push(`Fund blocks: ${summaries.length} · Transactions: ${portfolio.transactions.length}`)
    if (d) {
      lines.push(
        `Diagnostics: isinCount=${d.isinCount ?? '-'} schemesParsed=${d.schemesParsed ?? '-'} ` +
        `activeHoldings=${d.activeHoldings ?? '-'} closedPositions=${d.closedPositions ?? '-'} ` +
        `statedTotalValue=${d.statedTotalValue ?? '-'} missingValueFunds=${(d.missingValueFunds ?? []).join('|') || '-'}`
      )
    }
    const activeMV = summaries.filter((s) => s.closingUnits > 0.001).reduce((a, s) => a + (s.marketValue || 0), 0)
    const activeCost = summaries.filter((s) => s.closingUnits > 0.001).reduce((a, s) => a + (s.totalCost || 0), 0)
    lines.push(`Sum active market value=${Math.round(activeMV)} · Sum active cost=${Math.round(activeCost)}`)
    lines.push('')
    lines.push(['fundName', 'matchedCode', 'closingUnits', 'totalCost', 'camsNav', 'marketValue', 'unitsxNAV', 'checkGap%'].join('\t'))
    for (const s of summaries) {
      const calc = s.closingUnits * s.latestNav
      const gap = s.marketValue ? ((calc - s.marketValue) / s.marketValue) * 100 : 0
      lines.push(
        [
          s.fundName,
          s.fundCode > 0 ? s.fundCode : 'NO_MATCH',
          s.closingUnits,
          s.totalCost,
          s.latestNav,
          s.marketValue,
          Math.round(calc),
          gap.toFixed(1),
        ].join('\t')
      )
    }
    return lines.join('\n')
  }

  async function copyTable() {
    const text = buildCopyText()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-900/10">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-amber-700 dark:text-amber-400">Parse debug: fund summaries from CAMS</h3>
        <button
          onClick={copyTable}
          className="shrink-0 rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-900/30"
        >
          {copied ? 'Copied' : 'Copy full table'}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {summaries.length} fund blocks found · {portfolio.transactions.length} transactions.
        These are the Closing Unit Balance values read directly from your statement.
        Use <strong>Copy full table</strong> to grab everything (incl. a units×NAV cross-check) as tab-separated text.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-xs">
          <thead className="bg-surface2 uppercase text-faint">
            <tr>
              <th className="px-3 py-2 text-left">Fund name (from PDF)</th>
              <th className="px-2 py-2 text-right">Matched code</th>
              <th className="px-2 py-2 text-right">Closing units</th>
              <th className="px-2 py-2 text-right">Total cost</th>
              <th className="px-2 py-2 text-right">CAMS NAV</th>
              <th className="px-2 py-2 text-right">Market value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {summaries.map((s, i) => (
              <tr key={i} className={s.closingUnits <= 0.001 ? 'opacity-40' : ''}>
                <td className="px-3 py-2 text-fg">{s.fundName}</td>
                <td className={`px-2 py-2 text-right font-mono ${s.fundCode > 0 ? 'text-fg' : 'text-red-500'}`}>
                  {s.fundCode > 0 ? s.fundCode : 'NO MATCH'}
                </td>
                <td className="px-2 py-2 text-right font-mono">{s.closingUnits.toLocaleString()}</td>
                <td className="px-2 py-2 text-right font-mono">{s.totalCost.toLocaleString()}</td>
                <td className="px-2 py-2 text-right font-mono">{s.latestNav || '-'}</td>
                <td className="px-2 py-2 text-right font-mono">{s.marketValue.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-faint">
        Faded rows = zero balance (redeemed, correctly excluded). Red code = fund not matched to FairFund database.
      </p>
    </div>
  )
}
