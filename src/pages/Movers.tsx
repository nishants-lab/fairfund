import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { funds } from '../lib/data'
import { fundSlug } from '../lib/format'
import { normalizeSearch } from '../lib/searchText'
import type { Fund } from '../types'
import ShareButton from '../components/ShareButton'
import { availableWindows, buildContext, loadMovers, loadStocks, monthLabel, type MoversData, type StocksData } from '../lib/moversData'
import { parseQuery, type ParseOutput } from '../lib/moversQuery'
import { THEMES, VIEW_LABEL } from '../lib/moversVocab'
import {
  VIEW_OF, freshState, paramsToState, stateToParams, structuredCloneState,
  type GroupBy, type Measure, type MoversState, type View, type Win,
} from '../lib/moversState'
import {
  MEASURE_LABEL, fmtCrore, fmtMeasure, fundRows, groupRows, groupValueLabel, sectorRows, stockRows, summarize, thresholdLabel, windowLabel,
  type FundRow, type GroupRow, type SectorRow, type StockAction, type StockRow,
} from '../lib/moversRows'

// Movers: what changed across the fund universe, read from monthly disclosures.
// One state object (lib/moversState) drives the tabs, the filters, the question box
// and the URL, so every view can be shared. Numbers come from lib/moversRows.

const VIEWS: View[] = ['flows', 'size', 'returns', 'rank', 'momentum', 'cost', 'managers', 'stocks', 'debt']
const BLURB: Record<View, string> = {
  flows: 'Estimated money put in or taken out by investors, with the market effect taken out.',
  size: 'Fund size (AUM) and how it changed, split into investor money and market movement.',
  returns: 'Annualised returns and risk measures over 1, 3 or 5 years.',
  rank: 'Funds climbing or slipping in their category ranking.',
  momentum: 'Recent 1-year return against the fund\'s own 3- or 5-year record.',
  cost: 'Expense ratios and how they changed.',
  managers: 'Fund managers who took over recently, and those who left.',
  stocks: 'Stocks funds bought, sold, added and exited, from monthly portfolios.',
  debt: 'Liquid, money market and arbitrage funds by size and cost.',
}
const MEASURES: Record<View, Measure[]> = {
  flows: ['flow'], size: ['aum', 'aumChange'],
  // alpha here is peer-relative, the same figure as the gap to the category median
  returns: ['cagr', 'vsCategory', 'sharpe', 'sortino', 'volatility', 'drawdown', 'score'],
  rank: ['rankMove', 'rankNow'], momentum: ['momentum'], cost: ['ter', 'terChange'], managers: ['mgrChanges', 'joined', 'left'],
  stocks: ['netBuyers', 'added', 'exited', 'valueChange'], debt: ['aum'],
}
const SIGN_LABELS: Partial<Record<Measure, [string, string]>> = {
  flow: ['Inflows', 'Outflows'], aumChange: ['Grew', 'Shrank'], vsCategory: ['Beat category', 'Lagged category'],
  alpha: ['Positive alpha', 'Negative alpha'], rankMove: ['Climbers', 'Fallers'], momentum: ['Heating up', 'Cooling'],
  terChange: ['Raised', 'Cut'],
}
const GROUPS: Record<'fund' | 'stocks' | 'debt', [GroupBy, string][]> = {
  fund: [['fund', 'Funds'], ['category', 'By category'], ['amc', 'By fund house'], ['type', 'Index vs active'], ['theme', 'By theme']],
  stocks: [['fund', 'Stocks'], ['sector', 'By sector']],
  debt: [['fund', 'Funds'], ['category', 'By category'], ['amc', 'By fund house']],
}
const EXAMPLES = [
  'which small cap fund had the highest inflow',
  'biggest outflows in the last 3 months',
  'inflows by fund house in % terms',
  'active vs passive inflows',
  'stocks small cap funds bought most',
  'mid caps that climbed in rank',
  'expense ratio hikes',
  'new fund managers in flexi caps',
]
const ACTION_LABEL: Record<StockAction, string> = {
  added: 'Added', raised: 'Bought more', held: 'Price move only', cut: 'Sold some', exited: 'Exited',
  up: 'Weight up (unadjusted)', down: 'Weight down (unadjusted)',
}
const ACTION_VERB: Record<MoversState['action'], string> = { any: 'changed', buy: 'bought', sell: 'sold', added: 'added', exited: 'exited' }
const MANAGER_WINDOWS: Win[] = [1, 3, 6, 12]
const CASH = ['Liquid', 'Money Market', 'Arbitrage']
const PAGE = 50

type Tone = 'pos' | 'neg' | 'mute' | undefined
interface Col<R> {
  key: string
  label: string
  title?: string
  /** Sorting by this column sets the state's measure (shareable); others sort locally. */
  measure?: Measure
  mode?: MoversState['mode']
  num?: (r: R) => number | null
  cell: (r: R) => ReactNode
  tone?: (r: R) => Tone
  left?: boolean
}

export default function Movers() {
  usePageMeta('Movers', 'Estimated net flows, fund size, returns, rank, costs, manager changes and portfolio moves across Indian mutual funds, with a plain-English question box.')
  const [params, setParams] = useSearchParams()
  const state = useMemo(() => paramsToState(params), [params])
  const [data, setData] = useState<MoversData | null>(null)
  const [stocks, setStocks] = useState<StocksData | null>(null)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState(() => params.get('q') ?? '')
  const [parsed, setParsed] = useState<ParseOutput | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [local, setLocal] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
  const [nameText, setNameText] = useState(state.names.join(' '))

  useEffect(() => { loadMovers().then(setData, () => setFailed(true)) }, [])
  useEffect(() => {
    if (state.view === 'stocks' && !stocks) loadStocks().then(setStocks, () => setFailed(true))
  }, [state.view, stocks])
  const ctx = useMemo(() => buildContext(funds, data), [data])
  const wins = useMemo(() => availableWindows(data), [data])

  // The URL's ?q= is the question on screen: a shared link, a reload, Back and Forward all
  // show the question that produced the view, and what it was understood as.
  const qParam = params.get('q')
  const parsedFor = useRef<string | null>(null)
  useEffect(() => {
    setText(qParam ?? '')
    if (!qParam) { parsedFor.current = null; setParsed(null); return }
    if (data && parsedFor.current !== qParam) { parsedFor.current = qParam; setParsed(parseQuery(qParam, ctx)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam, data])
  useEffect(() => { setShown(PAGE); setLocal(null) }, [params])
  const namesKey = state.names.join(' ')
  useEffect(() => { setNameText(t => (normalizeSearch(t) === namesKey ? t : namesKey)) }, [namesKey])

  function update(next: MoversState, q?: string) {
    const p = stateToParams(next)
    if (q) p.set('q', q)
    else setParsed(null)
    setParams(p)
  }
  function patch(over: Partial<MoversState>) {
    update({ ...structuredCloneState(state), ...over })
  }
  function ask(q: string) {
    const t = q.trim()
    if (!t || !data) return
    setText(t)
    const out = parseQuery(t, ctx, state)
    parsedFor.current = t
    setParsed(out)
    update(out.state, t)
  }
  function changeView(v: View) {
    const s = freshState(v)
    // Keep which funds are in view; drop what only meant something in the old view.
    for (const k of ['categories', 'notCategories', 'amcs', 'notAmcs', 'themes', 'notThemes', 'risk', 'names'] as const) s[k] = [...state[k]]
    s.type = state.type
    s.young = state.young
    const plain = (x: View) => x !== 'stocks' && x !== 'debt'
    if (plain(v) && plain(state.view)) s.groupBy = state.groupBy
    if (v === 'debt') { s.type = 'all'; s.categories = s.categories.filter(c => CASH.includes(c)) }
    update(s)
  }
  // The fund-name box applies to whatever is on screen when its pause ends, not when typing began.
  const latest = useRef(state)
  latest.current = state
  useEffect(() => {
    const t = setTimeout(() => {
      const cur = latest.current
      const words = normalizeSearch(nameText).split(' ').filter(Boolean)
      if (words.join(' ') !== cur.names.join(' ')) update({ ...structuredCloneState(cur), names: words })
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameText])

  const s = state
  const isStocks = s.view === 'stocks'
  const ref = data?.refMonth ?? null
  const winChoices: Win[] = s.view === 'managers' ? MANAGER_WINDOWS : isStocks ? wins.stockWindows : s.view === 'cost' ? wins.costWindows : wins.flowWindows
  const allWins: Win[] = s.view === 'managers' ? MANAGER_WINDOWS : isStocks ? [1, 3] : [1, 3, 6]
  const usesWindow = ['flows', 'size', 'cost', 'managers', 'stocks'].includes(s.view) && !s.month
  const usesHorizon = s.view === 'returns' || s.view === 'momentum'
  const winText = s.view === 'managers'
    ? (s.month ? monthLabel(s.month) : `last ${s.win === 12 ? '12 months' : s.win === 1 ? 'month' : `${s.win} months`}`)
    : windowLabel(ref, isStocks ? (s.win >= 3 ? 3 : 1) : s.win, s.month)

  const fRows = useMemo(() => (data && !isStocks ? fundRows(funds, data, s) : []), [data, s, isStocks])
  const gRows = useMemo(() => (s.groupBy !== 'fund' && !isStocks ? groupRows(fRows, s) : []), [fRows, s, isStocks])
  const sRows = useMemo(() => (data && stocks && isStocks ? stockRows(funds, data, stocks, s) : []), [data, stocks, s, isStocks])
  const secRows = useMemo(() => (isStocks && s.groupBy === 'sector' && !s.stock ? sectorRows(sRows, s) : []), [sRows, s, isStocks])
  const summary = summarize(fRows, s)
  const fundCount = fRows.filter(r => !r.missing).length
  const missing = usesWindow ? fRows.length - fundCount : 0
  const pctMode = s.mode === 'pct' && (s.measure === 'flow' || s.measure === 'aumChange')
  const measureLabel = s.view === 'debt' ? 'AUM' : MEASURE_LABEL[s.measure] + (pctMode ? ' (% of AUM)' : '')
  const loading = !data || (isStocks && !stocks)
  const shownCount = isStocks ? (s.stock ? (sRows[0]?.moves.length ?? 0) : s.groupBy === 'sector' ? secRows.length : sRows.length)
    : s.groupBy !== 'fund' ? gRows.length : fRows.length

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">Movers</h1>
        <ShareButton title="Movers" text="Fund flows, size, rank, costs, manager changes and portfolio moves on FairFund" className="mt-0.5 shrink-0" />
      </div>
      <p className="mt-1 text-sm text-muted">{BLURB[s.view]}</p>

      <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); ask(text) }} role="search">
        <label htmlFor="movers-q" className="sr-only">Ask a question about fund movers</label>
        <input id="movers-q" value={text} onChange={e => setText(e.target.value)} enterKeyHint="search"
          placeholder="Ask, e.g. which small cap fund had the highest inflow"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-brand-500 focus:outline-none" />
        <button type="submit" disabled={!data || !text.trim()}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50">Ask</button>
      </form>
      {!parsed && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Example questions">
          {EXAMPLES.map(q => (
            <button key={q} onClick={() => ask(q)} disabled={!data}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted transition hover:text-fg disabled:opacity-50">{q}</button>
          ))}
        </div>
      )}
      {parsed && <ParseNotes out={parsed} onClear={() => { setText(''); update(structuredCloneState(s)) }} />}

      <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-1">
        <div className="flex w-max gap-2" role="tablist" aria-label="Views">
          {VIEWS.map(v => (
            <button key={v} role="tab" aria-selected={s.view === v} onClick={() => changeView(v)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${
                s.view === v ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-muted hover:text-fg'}`}>
              {VIEW_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {MEASURES[s.view].length > 1 && (
          <Select label="Sort by" value={s.measure === 'alpha' ? 'vsCategory' : s.measure} onChange={v => patch({ measure: v as Measure, sign: 'any', order: defaultOrder(v as Measure) })}
            options={MEASURES[s.view].map(m => [m, MEASURE_LABEL[m]])} />
        )}
        {usesWindow && (
          <Seg label="Window">
            {allWins.map(w => {
              const ok = winChoices.includes(w)
              return (
                <SegBtn key={w} active={s.win === w} disabled={!ok} onClick={() => patch({ win: w })}
                  title={ok ? undefined : 'Fills in as monthly history builds'}>{`${w}M`}</SegBtn>
              )
            })}
          </Seg>
        )}
        {s.month && <Chip onRemove={() => patch({ month: null })}>Month: {monthLabel(s.month)}</Chip>}
        {(s.measure === 'flow' || s.measure === 'aumChange') && (
          <Seg label="Units">
            <SegBtn active={s.mode === 'abs'} onClick={() => patch({ mode: 'abs' })}>₹</SegBtn>
            <SegBtn active={s.mode === 'pct'} onClick={() => patch({ mode: 'pct' })}>% of AUM</SegBtn>
          </Seg>
        )}
        {usesHorizon && (
          <Seg label="Period">
            {(s.view === 'momentum' ? ['3Y', '5Y'] as const : ['1Y', '3Y', '5Y'] as const).map(h => (
              <SegBtn key={h} active={s.horizon === h} onClick={() => patch({ horizon: h })}>{s.view === 'momentum' ? `1Y vs ${h}` : h}</SegBtn>
            ))}
          </Seg>
        )}
        {SIGN_LABELS[s.measure] && s.groupBy === 'fund' && (
          <Seg label="Direction">
            <SegBtn active={s.sign === 'any'} onClick={() => patch({ sign: 'any' })}>All</SegBtn>
            <SegBtn active={s.sign === 'pos'} onClick={() => patch({ sign: 'pos', order: 'desc' })}>{SIGN_LABELS[s.measure]![0]}</SegBtn>
            <SegBtn active={s.sign === 'neg'} onClick={() => patch({ sign: 'neg', order: 'asc' })}>{SIGN_LABELS[s.measure]![1]}</SegBtn>
          </Seg>
        )}
        {isStocks && s.measure === 'netBuyers' && !s.stock && (
          <Seg label="Funds">
            <SegBtn active={s.action === 'any'} onClick={() => patch({ action: 'any', order: 'desc' })}>All</SegBtn>
            <SegBtn active={s.action === 'buy'} onClick={() => patch({ action: 'buy', order: 'desc' })}>Buying</SegBtn>
            <SegBtn active={s.action === 'sell'} onClick={() => patch({ action: 'sell', order: 'asc' })}>Selling</SegBtn>
          </Seg>
        )}
        {!s.stock && (
          <button onClick={() => patch({ order: s.order === 'desc' ? 'asc' : 'desc' })}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-muted transition hover:text-fg"
            aria-label={`Order: ${s.order === 'desc' ? 'highest first' : 'lowest first'}. Tap to flip.`}>
            {s.order === 'desc' ? 'Highest first ▼' : 'Lowest first ▲'}
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Select label="Show" value={s.groupBy} onChange={v => patch({ groupBy: v as GroupBy, stock: null, count: false })}
          options={GROUPS[isStocks ? 'stocks' : s.view === 'debt' ? 'debt' : 'fund']} />
        <Select label="Add category" value="" onChange={v => v && patch({ categories: [...new Set([...s.categories, v])] })}
          options={[['', 'Category'], ...ctx.categories.filter(c => s.view !== 'debt' || CASH.includes(c)).map(c => [c, c] as [string, string])]} />
        <Select label="Add fund house" value="" onChange={v => v && patch({ amcs: [...new Set([...s.amcs, v])] })}
          options={[['', 'Fund house'], ...ctx.amcs.map(a => [a, a] as [string, string])]} />
        {s.view !== 'debt' && (
          <Select label="Fund type" value={s.type} onChange={v => patch({ type: v as MoversState['type'] })}
            options={[['all', 'Index and active'], ['index', 'Index funds'], ['active', 'Active funds']]} />
        )}
        <Select label="Fund age" value={s.young} onChange={v => patch({ young: v as MoversState['young'] })}
          options={[['all', 'Any age'], ['only', 'New funds'], ['exclude', 'Established funds']]} />
        <input value={nameText} onChange={e => setNameText(e.target.value)} placeholder="Fund name" aria-label="Filter by fund name"
          className="min-w-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-faint sm:min-w-[120px] sm:max-w-[220px] sm:flex-1" />
      </div>

      <FilterChips s={s} data={data} onChange={next => update(next)} />

      {failed && <p className="mt-4 rounded-lg border border-line bg-surface2 p-4 text-sm text-muted">Movers data could not be loaded. Refresh the page to try again.</p>}
      {!failed && loading && <p className="mt-4 text-sm text-muted" data-testid="movers-loading">Loading {isStocks ? 'portfolio' : 'movers'} data</p>}

      {!loading && !failed && (
        <>
          <Answer s={s} parsed={parsed} fRows={fRows} gRows={gRows} sRows={sRows} count={fundCount} summary={summary} winText={winText} />
          <p className="mt-3 text-xs text-faint" data-testid="movers-summary">
            {isStocks
              ? s.stock ? `${plural(shownCount, 'fund')} ${ACTION_VERB[s.action]} this stock` : s.groupBy === 'sector' ? plural(secRows.length, 'sector') : plural(sRows.length, 'stock')
              : s.groupBy !== 'fund' ? `${plural(gRows.length, 'group')} from ${plural(fundCount, 'fund')}` : plural(fundCount, 'fund')}
            {!s.stock && <> · {measureLabel}, {s.order === 'desc' ? 'highest' : 'lowest'} first</>}
            {(usesWindow || s.month) && <> · {winText}</>}
            {usesHorizon && <> · {s.view === 'momentum' ? `1Y vs ${s.horizon}` : s.horizon}</>}
            {s.limit ? <> · top {s.limit}</> : null}
          </p>
          {missing > 0 && s.groupBy === 'fund' && (
            <p className="mt-1 text-xs text-muted" data-testid="movers-missing">
              {plural(missing, 'fund')} named here {missing === 1 ? 'has' : 'have'} no figure for this window.
              {winChoices.filter(w => w !== s.win).map(w => (
                <button key={w} onClick={() => patch({ win: w })} className="ml-2 underline underline-offset-2 hover:text-fg">Try {w} {w === 1 ? 'month' : 'months'}</button>
              ))}
            </p>
          )}
          {isStocks ? (
            s.stock ? <StockDetail row={sRows[0]} stock={s.stock} data={data!} action={s.action} onAll={() => patch({ action: 'any' })} onBack={() => patch({ stock: null, action: 'any' })} />
              : s.groupBy === 'sector' ? <SectorTable rows={limitRows(secRows, s)} onPick={sec => patch({ groupBy: 'fund', stockSectors: [sec] })} />
              : <StockTable rows={limitRows(sRows, s)} shown={shown} onMore={() => setShown(n => n + PAGE)} onPick={k => patch({ stock: k })} s={s} onSort={patch} />
          ) : s.groupBy !== 'fund' ? (
            <GroupTable rows={limitRows(gRows, s)} s={s} onPick={g => patch(drillInto(s, g))} />
          ) : (
            <FundTable rows={limitRows(fRows, s)} s={s} shown={shown} onMore={() => setShown(n => n + PAGE)}
              local={local} setLocal={setLocal} onSort={patch} highlight={!!parsed?.singular} />
          )}
          <Empty s={s} n={shownCount} winChoices={winChoices} onChange={patch} />
          <Footnote s={s} data={data!} />
        </>
      )}
    </div>
  )
}

function plural(n: number, word: string): string { return `${n} ${word}${n === 1 ? '' : 's'}` }
function defaultOrder(m: Measure): 'asc' | 'desc' {
  return m === 'volatility' || m === 'drawdown' || m === 'ter' || m === 'rankNow' ? 'asc' : 'desc'
}
function limitRows<T>(rows: T[], s: MoversState): T[] { return s.limit ? rows.slice(0, s.limit) : rows }

function drillInto(s: MoversState, g: GroupRow): Partial<MoversState> {
  const base: Partial<MoversState> = { groupBy: 'fund', count: false }
  if (s.groupBy === 'category') return { ...base, categories: [g.key] }
  if (s.groupBy === 'amc') return { ...base, amcs: [g.key] }
  if (s.groupBy === 'type') return { ...base, type: g.key === 'index' ? 'index' : 'active' }
  if (s.groupBy === 'theme') return { ...base, themes: [g.key] }
  return base
}

function ParseNotes({ out, onClear }: { out: ParseOutput; onClear: () => void }) {
  const msgs: ReactNode[] = []
  if (!out.understood) msgs.push('That question was not understood. Try naming a figure (inflows, returns, rank, costs, stocks) and a group of funds.')
  for (const n of out.notes) msgs.push(n)
  if (out.unknown.length) msgs.push(<>Not used: {out.unknown.map((w, i) => <b key={w} className="font-semibold">{i ? ', ' : ''}"{w}"</b>)}</>)
  if (out.corrected.length) msgs.push(<>Read {out.corrected.map(([a, b], i) => <span key={i}>{i ? ', ' : ''}"{a}" as "{b}"</span>)}</>)
  return (
    <div className="mt-2 rounded-lg border border-line bg-surface2 px-3 py-2 text-xs text-muted" aria-live="polite" data-testid="movers-notes">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          {msgs.length ? msgs.map((m, i) => <p key={i} className={out.advice && i === 0 ? 'font-medium text-fg' : ''}>{m}</p>)
            : <p>Understood. The filters below show how it was read; remove any that are wrong.</p>}
        </div>
        <button onClick={onClear} className="shrink-0 text-faint hover:text-fg" aria-label="Clear question">Clear</button>
      </div>
    </div>
  )
}

function FilterChips({ s, data, onChange }: { s: MoversState; data: MoversData | null; onChange: (n: MoversState) => void }) {
  const chips: { key: string; label: string; next: MoversState }[] = []
  const without = (f: (c: MoversState) => void) => { const c = structuredCloneState(s); f(c); return c }
  type ListKey = 'categories' | 'notCategories' | 'amcs' | 'notAmcs' | 'themes' | 'notThemes' | 'stockSectors' | 'risk'
  const list = (k: ListKey, label: (v: string) => string) => {
    for (const v of s[k]) chips.push({ key: k + v, label: label(v), next: without(c => { c[k] = c[k].filter(x => x !== v) }) })
  }
  list('categories', v => v)
  list('notCategories', v => `Not ${v}`)
  list('amcs', v => v)
  list('notAmcs', v => `Not ${v}`)
  list('themes', v => `Theme: ${THEMES[v]?.label ?? v}`)
  list('notThemes', v => `Not ${THEMES[v]?.label ?? v}`)
  list('stockSectors', v => `Sector: ${v}`)
  list('risk', v => `Risk: ${v}`)
  if (s.type !== 'all') chips.push({ key: 'type', label: s.type === 'index' ? 'Index funds' : 'Active funds', next: without(c => { c.type = 'all' }) })
  if (s.young !== 'all') chips.push({ key: 'young', label: s.young === 'only' ? 'New funds' : 'Established funds', next: without(c => { c.young = 'all' }) })
  s.thresholds.forEach((t, i) => chips.push({ key: 'th' + i, label: thresholdLabel(t), next: without(c => { c.thresholds.splice(i, 1) }) }))
  if (s.names.length) chips.push({ key: 'names', label: `Name: ${s.names.join(' ')}`, next: without(c => { c.names = [] }) })
  if (s.stock) {
    const name = data?.stocks.find(x => x[0] === s.stock)?.[1] ?? s.stock
    chips.push({ key: 'stock', label: `Stock: ${name}`, next: without(c => { c.stock = null }) })
  }
  if (s.limit) chips.push({ key: 'limit', label: `Top ${s.limit}`, next: without(c => { c.limit = null }) })
  if (s.count) chips.push({ key: 'count', label: 'Count', next: without(c => { c.count = false }) })
  if (s.agg !== 'none') chips.push({ key: 'agg', label: s.agg === 'total' ? 'Total' : 'Average', next: without(c => { c.agg = 'none' }) })
  if (!chips.length) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Active filters" data-testid="movers-chips">
      {chips.map(c => <Chip key={c.key} onRemove={() => onChange(c.next)}>{c.label}</Chip>)}
      {chips.length > 1 && (
        <button onClick={() => onChange({ ...freshState(s.view), measure: s.measure, order: s.order, mode: s.mode, win: s.win, horizon: s.horizon })}
          className="px-1 text-xs text-faint underline-offset-2 hover:text-fg hover:underline">Clear all</button>
      )}
    </div>
  )
}

function Answer({ s, parsed, fRows, gRows, sRows, count, summary, winText }: {
  s: MoversState; parsed: ParseOutput | null; fRows: FundRow[]; gRows: GroupRow[]; sRows: StockRow[]; count: number
  summary: ReturnType<typeof summarize>; winText: string
}) {
  if (!parsed) return null
  const when = ['flows', 'size', 'cost', 'stocks', 'managers'].includes(s.view) ? ` (${winText})` : s.view === 'returns' ? ` (${s.horizon})` : ''
  const label = MEASURE_LABEL[s.measure].toLowerCase()
  let line: ReactNode = null
  if (s.count && s.groupBy === 'fund' && s.view !== 'stocks') line = <><b>{count}</b> {count === 1 ? 'fund matches' : 'funds match'}{when}.</>
  else if (s.agg !== 'none' && s.groupBy === 'fund' && s.view !== 'stocks' && count) {
    const total = s.agg === 'total' && summary.summable
    const v = total ? summary.total : summary.average
    if (v != null) line = <>{total ? 'Total' : 'Average'} {label}: <b>{fmtMeasure(s.measure, v, s.mode)}</b> across {count} funds{when}.</>
  } else if (parsed.singular || s.limit === 1) {
    if (s.view === 'stocks' && sRows[0]) line = <><b>{sRows[0].name}</b>: {sRows[0].buyers} funds bought, {sRows[0].sellers} sold{when}.</>
    else if (s.groupBy !== 'fund' && gRows[0]) line = <><b>{gRows[0].label}</b>: {fmtMeasure(s.measure, gRows[0].value, s.mode)}{when}.</>
    else if (fRows[0] && !fRows[0].missing) line = <><b>{fRows[0].fund.name}</b>: {label} {fmtMeasure(s.measure, fRows[0].value, s.mode)}{when}.</>
  }
  if (!line) return null
  return <p className="mt-3 rounded-lg border border-brand-500/40 bg-brand-500/5 px-3 py-2 text-sm text-fg" data-testid="movers-answer">{line}</p>
}

function Empty({ s, n, winChoices, onChange }: { s: MoversState; n: number; winChoices: Win[]; onChange: (o: Partial<MoversState>) => void }) {
  if (n) return null
  const tips: ReactNode[] = []
  const link = 'underline underline-offset-2 hover:text-fg'
  if (['flows', 'size', 'cost', 'stocks'].includes(s.view) && !s.month)
    for (const w of winChoices.filter(x => x !== s.win)) tips.push(<button key={w} onClick={() => onChange({ win: w })} className={link}>Try {w} {w === 1 ? 'month' : 'months'}</button>)
  if (s.sign !== 'any') tips.push(<button key="sign" onClick={() => onChange({ sign: 'any' })} className={link}>Show both directions</button>)
  if (s.thresholds.length) tips.push(<button key="th" onClick={() => onChange({ thresholds: [] })} className={link}>Drop the number limits</button>)
  if (s.action !== 'any') tips.push(<button key="act" onClick={() => onChange({ action: 'any' })} className={link}>Show buying and selling</button>)
  return (
    <div className="mt-2 rounded-xl border border-line px-4 py-6 text-center text-sm text-muted" data-testid="movers-empty">
      <p>{s.view === 'managers' && s.measure === 'left'
        ? 'No departures logged for this selection yet. Departures are recorded from October 2026, as fund manager lists change.'
        : s.view === 'stocks' ? 'No portfolio changes for this selection. Funds that publish less than 90% of their portfolio are left out.'
        : 'Nothing matches this selection. Remove a filter above to widen it.'}</p>
      {tips.length > 0 && <p className="mt-2 flex flex-wrap justify-center gap-3 text-xs">{tips}</p>}
    </div>
  )
}

// ---- tables ------------------------------------------------------------------------
const NA = <span className="text-faint">n/a</span>
const signTone = (x: number | null): Tone => (x == null || x === 0 ? 'mute' : x > 0 ? 'pos' : 'neg')
const cr = (x: number | null, signed = false) => (x == null ? NA : fmtCrore(x, signed))
const pc = (x: number | null, d = 1) => (x == null ? NA : `${x.toFixed(d)}%`)
const sp = (x: number | null, d = 1, unit = ' pts') => (x == null ? NA : `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x).toFixed(d)}${unit}`)
const ratio = (x: number | null) => (x == null ? NA : x.toFixed(2))

function fundCols(s: MoversState): Col<FundRow>[] {
  const v = (r: FundRow) => r.vals
  const tag = s.month ? monthLabel(s.month) : `${s.win}M`
  switch (s.view) {
    case 'flows': return [
      { key: 'flow', label: `Net flow ${tag}`, title: 'Estimated net flow: investor money in minus money out', measure: 'flow', mode: 'abs', num: r => v(r).flow, cell: r => cr(v(r).flow, true), tone: r => signTone(v(r).flow) },
      { key: 'flowPct', label: '% of AUM', measure: 'flow', mode: 'pct', num: r => v(r).flowPct, cell: r => sp(v(r).flowPct, 2, '%'), tone: r => signTone(v(r).flowPct) },
      { key: 'market', label: 'Market effect', title: 'Change in AUM from the fund\'s own returns', num: r => v(r).market, cell: r => cr(v(r).market, true), tone: () => 'mute' },
      { key: 'aum', label: 'AUM', num: r => v(r).aum, cell: r => cr(v(r).aum) },
      { key: 'trend', label: 'Monthly flows', cell: r => <FlowBars data={r.flowSeries} /> },
    ]
    case 'size': return [
      { key: 'aum', label: 'AUM', measure: 'aum', num: r => v(r).aum, cell: r => cr(v(r).aum) },
      { key: 'chg', label: `Change ${tag}`, measure: 'aumChange', num: r => (s.mode === 'pct' ? v(r).aumChangePct : v(r).aumChange),
        cell: r => (s.mode === 'pct' ? sp(v(r).aumChangePct, 1, '%') : cr(v(r).aumChange, true)), tone: r => signTone(v(r).aumChange) },
      { key: 'flow', label: 'From net flow', num: r => v(r).flow, cell: r => cr(v(r).flow, true), tone: r => signTone(v(r).flow) },
      { key: 'market', label: 'From market', num: r => v(r).market, cell: r => cr(v(r).market, true), tone: () => 'mute' },
      { key: 'trend', label: 'AUM trend', cell: r => <Spark data={r.aumSeries} up={(v(r).aumChange ?? 0) >= 0} /> },
    ]
    case 'returns': return [
      { key: 'cagr', label: `Return ${s.horizon}`, measure: 'cagr', num: r => v(r).cagr, cell: r => pc(v(r).cagr) },
      { key: 'vs', label: 'vs category', title: 'Gap to the category median return, also called peer-relative alpha', measure: 'vsCategory', num: r => v(r).vsCategory, cell: r => sp(v(r).vsCategory), tone: r => signTone(v(r).vsCategory) },
      { key: 'sharpe', label: 'Sharpe', measure: 'sharpe', num: r => v(r).sharpe, cell: r => ratio(v(r).sharpe) },
      { key: 'sortino', label: 'Sortino', measure: 'sortino', num: r => v(r).sortino, cell: r => ratio(v(r).sortino) },
      { key: 'vol', label: 'Volatility', measure: 'volatility', num: r => v(r).volatility, cell: r => pc(v(r).volatility) },
      { key: 'dd', label: 'Max drawdown', measure: 'drawdown', num: r => v(r).drawdown, cell: r => (v(r).drawdown == null ? NA : `-${v(r).drawdown!.toFixed(1)}%`) },
      { key: 'score', label: 'Score', measure: 'score', num: r => v(r).score, cell: r => (v(r).score == null ? NA : `${v(r).score!.toFixed(0)}/100`) },
    ]
    case 'rank': return [
      { key: 'was', label: 'Was', num: r => v(r).rankPrior, cell: r => (v(r).rankPrior == null ? NA : `#${v(r).rankPrior}${v(r).peersPrior ? ` / ${v(r).peersPrior}` : ''}`), tone: () => 'mute' },
      { key: 'now', label: 'Now', measure: 'rankNow', num: r => v(r).rankNow, cell: r => (v(r).rankNow == null ? NA : `#${v(r).rankNow}${v(r).peersNow ? ` / ${v(r).peersNow}` : ''}`) },
      { key: 'move', label: 'Move', measure: 'rankMove', num: r => v(r).rankMove, cell: r => (v(r).rankMove == null ? NA : fmtMeasure('rankMove', v(r).rankMove!)), tone: r => signTone(v(r).rankMove) },
      { key: 'trend', label: 'Percentile trend', cell: r => <Spark data={r.fund.analytics?.rankTrajectory?.spark ?? []} up={(v(r).rankMove ?? 0) >= 0} /> },
    ]
    case 'momentum': return [
      { key: '1y', label: '1Y', num: r => v(r).cagr1Y, cell: r => pc(v(r).cagr1Y) },
      { key: 'long', label: s.horizon === '5Y' ? '5Y' : '3Y', num: r => v(r).cagrLong, cell: r => pc(v(r).cagrLong), tone: () => 'mute' },
      { key: 'gap', label: 'Gap', measure: 'momentum', num: r => v(r).momentum, cell: r => sp(v(r).momentum), tone: r => signTone(v(r).momentum) },
    ]
    case 'cost': return [
      { key: 'ter', label: 'Expense ratio', measure: 'ter', num: r => v(r).ter, cell: r => pc(v(r).ter, 2) },
      { key: 'chg', label: `Change ${tag}`, measure: 'terChange', num: r => v(r).terChange, cell: r => sp(v(r).terChange, 2),
        tone: r => (v(r).terChange == null || v(r).terChange === 0 ? 'mute' : v(r).terChange! > 0 ? 'neg' : 'pos') },
      { key: 'aum', label: 'AUM', num: r => v(r).aum, cell: r => cr(v(r).aum) },
    ]
    case 'managers': return [
      { key: 'chg', label: 'Changes', measure: 'mgrChanges', num: r => v(r).mgrChanges, cell: r => String(v(r).mgrChanges ?? 0) },
      { key: 'joined', label: 'Joined', measure: 'joined', num: r => v(r).joined, left: true, cell: r => <People list={r.joinedList} /> },
      { key: 'left', label: 'Left', measure: 'left', num: r => v(r).left, left: true, cell: r => <People list={r.leftList} /> },
      { key: 'vs', label: '1Y vs category', num: r => vs1Y(r.fund), cell: r => sp(vs1Y(r.fund)), tone: r => signTone(vs1Y(r.fund)) },
    ]
    case 'debt': return [
      { key: 'aum', label: 'AUM', num: r => v(r).aum, cell: r => cr(v(r).aum), tone: r => (v(r).aum == null ? undefined : v(r).aum! >= 1000 ? 'pos' : v(r).aum! < 100 ? 'neg' : undefined) },
      { key: 'ter', label: 'Expense ratio', num: r => v(r).ter, cell: r => pc(v(r).ter, 2), tone: r => (v(r).ter == null ? undefined : v(r).ter! <= 0.15 ? 'pos' : v(r).ter! >= 0.3 ? 'neg' : undefined) },
      { key: 'r1', label: '1Y return', num: r => r1Y(r.fund), cell: r => pc(r1Y(r.fund), 2) },
    ]
    default: return []
  }
}
function r1Y(f: Fund): number | null { const x = f.metrics?.['1Y']?.cagr; return typeof x === 'number' ? x : null }
function vs1Y(f: Fund): number | null {
  const m = f.metrics?.['1Y']
  return m && typeof m.cagr === 'number' && typeof m.catMedianCagr === 'number' ? Math.round((m.cagr - m.catMedianCagr) * 10) / 10 : null
}

function toneClass(t: Tone): string {
  return t === 'pos' ? 'font-semibold text-emerald-600 dark:text-emerald-400'
    : t === 'neg' ? 'font-semibold text-red-500 dark:text-red-400'
    : t === 'mute' ? 'text-muted' : 'text-fg'
}
const TD = 'px-3 py-2.5 text-right tabular-nums'
const TH = 'px-3 py-2.5 text-right font-medium'
const ROW = 'border-b border-line/60 last:border-0 hover:bg-surface2/60'
const HEAD_ROW = 'border-b border-line bg-surface2 text-xs text-muted'
const STICKY_TH = 'sticky left-0 z-10 bg-surface2 px-3 py-2.5 text-left font-medium'
const STICKY_TD = 'sticky left-0 z-10 max-w-[190px] bg-surface px-3 py-2.5 sm:max-w-none'

function SortHead<R>({ c, active, dir, onClick }: { c: Col<R>; active: boolean; dir: 'asc' | 'desc'; onClick?: () => void }) {
  return (
    <th className={`px-3 py-2.5 font-medium ${c.left ? 'text-left' : 'text-right'}`} title={c.title} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {onClick ? (
        <button onClick={onClick} className={`inline-flex items-center gap-1 whitespace-nowrap transition hover:text-fg ${active ? 'text-brand-600 dark:text-brand-400' : ''}`}>
          {c.label}<span className="text-[10px] leading-none">{active ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
      ) : <span className="whitespace-nowrap">{c.label}</span>}
    </th>
  )
}

function FundTable({ rows, s, shown, onMore, local, setLocal, onSort, highlight }: {
  rows: FundRow[]; s: MoversState; shown: number; onMore: () => void
  local: { key: string; dir: 'asc' | 'desc' } | null; setLocal: (l: { key: string; dir: 'asc' | 'desc' } | null) => void
  onSort: (o: Partial<MoversState>) => void; highlight: boolean
}) {
  const cols = fundCols(s)
  const sorted = useMemo(() => {
    const c = local ? cols.find(x => x.key === local.key) : undefined
    if (!local || !c?.num) return rows
    const mul = local.dir === 'asc' ? 1 : -1
    const get = c.num
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b)
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
      return (x - y) * mul
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, local])
  if (!rows.length) return null
  const isActive = (c: Col<FundRow>) => (local ? local.key === c.key
    : s.view === 'debt' ? c.key === 'aum' : !!c.measure && c.measure === (s.measure === 'alpha' ? 'vsCategory' : s.measure) && (c.mode == null || c.mode === s.mode))
  const click = (c: Col<FundRow>) => {
    if (!c.num) return undefined
    return () => {
      if (c.measure && VIEW_OF[c.measure] === s.view && s.view !== 'debt') {
        const same = c.measure === s.measure && (c.mode == null || c.mode === s.mode)
        onSort({ measure: c.measure, ...(c.mode ? { mode: c.mode } : {}), order: same ? (s.order === 'desc' ? 'asc' : 'desc') : defaultOrder(c.measure) })
      } else setLocal(local?.key === c.key ? (local.dir === 'desc' ? { key: c.key, dir: 'asc' } : null) : { key: c.key, dir: 'desc' })
    }
  }
  const dir = local ? local.dir : s.order
  return (
    <TableShell testId="movers-table" head={
      <tr className={HEAD_ROW}>
        <th className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">#</th>
        <th className={STICKY_TH}>Fund</th>
        {cols.map(c => <SortHead key={c.key} c={c} active={isActive(c)} dir={dir} onClick={click(c)} />)}
      </tr>
    } foot={sorted.length > shown ? <MoreButton left={sorted.length - shown} onClick={onMore} /> : null}>
      {sorted.slice(0, shown).map((r, i) => (
        <tr key={r.fund.code} className={`${ROW} ${highlight && i === 0 && !local ? 'bg-brand-500/5' : ''}`}>
          <td className="hidden px-3 py-2.5 text-faint sm:table-cell">{i + 1}</td>
          <td className={STICKY_TD}>
            <Link to={`/fund/${r.fund.code}/${fundSlug(r.fund.name)}`} className="font-medium text-fg hover:text-brand-600">{r.fund.name}</Link>
            <div className="text-xs text-faint">{r.fund.categoryDisplay || r.fund.category}{r.fund.isYoung ? ' · New fund' : ''}{r.missing ? ' · no figure for this window' : ''}</div>
          </td>
          {cols.map(c => <td key={c.key} className={`px-3 py-2.5 tabular-nums ${c.left ? 'text-left' : 'text-right'} ${toneClass(c.tone?.(r))}`}>{c.cell(r)}</td>)}
        </tr>
      ))}
    </TableShell>
  )
}

function GroupTable({ rows, s, onPick }: { rows: GroupRow[]; s: MoversState; onPick: (g: GroupRow) => void }) {
  if (!rows.length) return null
  const valueLabel = groupValueLabel(s)
  const split = SIGN_LABELS[s.measure]
  const groupName = s.groupBy === 'amc' ? 'Fund house' : s.groupBy === 'type' ? 'Type' : s.groupBy === 'theme' ? 'Theme' : 'Category'
  return (
    <TableShell testId="movers-table" head={
      <tr className={HEAD_ROW}>
        <th className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">#</th>
        <th className={STICKY_TH}>{groupName}</th>
        <th className={TH}>{valueLabel}</th>
        {!s.count && <th className={TH}>Funds</th>}
        {split && <th className={TH}>{split[0]} / {split[1]}</th>}
        <th className={TH}>Total AUM</th>
      </tr>
    }>
      {rows.map((g, i) => (
        <tr key={g.key} className={ROW}>
          <td className="hidden px-3 py-2.5 text-faint sm:table-cell">{i + 1}</td>
          <td className={STICKY_TD}>
            <button onClick={() => onPick(g)} className="text-left font-medium text-fg hover:text-brand-600">{g.label}</button>
            <div className="text-xs text-faint">See its funds</div>
          </td>
          <td className={`${TD} ${s.count ? 'text-fg' : toneClass(split ? signTone(g.value) : undefined)}`}>{s.count ? g.n : fmtMeasure(s.measure, g.value, s.mode)}</td>
          {!s.count && <td className={`${TD} text-muted`}>{g.n}</td>}
          {split && <td className={`${TD} text-muted`}>{g.pos} / {g.neg}</td>}
          <td className={`${TD} text-muted`}>{g.totalAum == null ? 'n/a' : fmtCrore(g.totalAum)}</td>
        </tr>
      ))}
    </TableShell>
  )
}

function StockTable({ rows, s, shown, onMore, onPick, onSort }: {
  rows: StockRow[]; s: MoversState; shown: number; onMore: () => void; onPick: (k: string) => void; onSort: (o: Partial<MoversState>) => void
}) {
  if (!rows.length) return null
  const head = (m: Measure | null, label: string, title?: string) => {
    const active = m === s.measure
    return (
      <th className={TH} title={title}>
        {m ? (
          <button onClick={() => onSort({ measure: m, action: 'any', order: active ? (s.order === 'desc' ? 'asc' : 'desc') : 'desc' })}
            className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-fg ${active ? 'text-brand-600 dark:text-brand-400' : ''}`}>
            {label}<span className="text-[10px] leading-none">{active ? (s.order === 'asc' ? '▲' : '▼') : '↕'}</span>
          </button>
        ) : <span className="whitespace-nowrap">{label}</span>}
      </th>
    )
  }
  return (
    <TableShell testId="movers-table" head={
      <tr className={HEAD_ROW}>
        <th className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">#</th>
        <th className={STICKY_TH}>Stock</th>
        {head(null, 'Bought', 'Funds that added it or bought more')}
        {head(null, 'Sold', 'Funds that sold some or exited')}
        {head('netBuyers', 'Net')}
        {head('added', 'New')}
        {head('exited', 'Exited')}
        {head(null, 'Price move', 'Estimated from the funds that held it at both ends')}
        {head('valueChange', 'Value held', 'Change in rupee value held by these funds, price moves included')}
      </tr>
    } foot={rows.length > shown ? <MoreButton left={rows.length - shown} onClick={onMore} /> : null}>
      {rows.slice(0, shown).map((r, i) => (
        <tr key={r.key} className={ROW}>
          <td className="hidden px-3 py-2.5 text-faint sm:table-cell">{i + 1}</td>
          <td className={STICKY_TD}>
            <button onClick={() => onPick(r.key)} className="text-left font-medium text-fg hover:text-brand-600">{r.name}</button>
            <div className="text-xs text-faint">{r.sector}</div>
          </td>
          <td className={`${TD} text-emerald-600 dark:text-emerald-400`}>{r.buyers}</td>
          <td className={`${TD} text-red-500 dark:text-red-400`}>{r.sellers}</td>
          <td className={`${TD} ${toneClass(signTone(r.netBuyers))}`}>{fmtMeasure('netBuyers', r.netBuyers)}</td>
          <td className={`${TD} text-muted`}>{r.added}</td>
          <td className={`${TD} text-muted`}>{r.exited}</td>
          <td className={`${TD} text-muted`}>{r.priceMove == null ? 'n/a' : `${r.priceMove > 0 ? '+' : ''}${r.priceMove.toFixed(1)}%`}</td>
          <td className={`${TD} text-muted`}>{fmtCrore(r.valueChange, true)}</td>
        </tr>
      ))}
    </TableShell>
  )
}

function SectorTable({ rows, onPick }: { rows: SectorRow[]; onPick: (sector: string) => void }) {
  if (!rows.length) return null
  return (
    <TableShell testId="movers-table" head={
      <tr className={HEAD_ROW}>
        <th className="hidden px-3 py-2.5 text-left font-medium sm:table-cell">#</th>
        <th className={STICKY_TH}>Sector</th>
        {['Stocks', 'Bought', 'Sold', 'Net', 'New', 'Exited', 'Value held'].map(h => <th key={h} className={TH}>{h}</th>)}
      </tr>
    }>
      {rows.map((g, i) => (
        <tr key={g.key} className={ROW}>
          <td className="hidden px-3 py-2.5 text-faint sm:table-cell">{i + 1}</td>
          <td className={STICKY_TD}>
            <button onClick={() => onPick(g.key)} className="text-left font-medium text-fg hover:text-brand-600">{g.label}</button>
          </td>
          <td className={`${TD} text-muted`}>{g.stocks}</td>
          <td className={`${TD} text-emerald-600 dark:text-emerald-400`}>{g.buyers}</td>
          <td className={`${TD} text-red-500 dark:text-red-400`}>{g.sellers}</td>
          <td className={`${TD} ${toneClass(signTone(g.netBuyers))}`}>{fmtMeasure('netBuyers', g.netBuyers)}</td>
          <td className={`${TD} text-muted`}>{g.added}</td>
          <td className={`${TD} text-muted`}>{g.exited}</td>
          <td className={`${TD} text-muted`}>{fmtCrore(g.valueChange, true)}</td>
        </tr>
      ))}
    </TableShell>
  )
}

function StockDetail({ row, stock, data, action, onAll, onBack }: {
  row: StockRow | undefined; stock: string; data: MoversData; action: MoversState['action']; onAll: () => void; onBack: () => void
}) {
  const name = row?.name ?? data.stocks.find(x => x[0] === stock)?.[1] ?? stock
  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <button onClick={onBack} className="text-sm text-brand-600 hover:underline">← All stocks</button>
        <h2 className="text-lg font-semibold text-fg">{name}</h2>
        {row && <span className="text-sm text-muted">{row.sector} · {row.buyers} bought, {row.sellers} sold{row.priceMove != null ? ` · price move about ${row.priceMove > 0 ? '+' : ''}${row.priceMove.toFixed(1)}%` : ''}</span>}
      </div>
      {row && action !== 'any' && row.moves.length < row.movers && (
        <p className="mb-2 text-xs text-muted">Showing the funds that {ACTION_VERB[action]} it.{' '}
          <button onClick={onAll} className="underline underline-offset-2 hover:text-fg">Show all {row.movers} funds that changed it</button>
        </p>
      )}
      {row && row.moves.length > 0 && (
        <TableShell testId="movers-table" head={
          <tr className={HEAD_ROW}>
            <th className={STICKY_TH}>Fund</th>
            <th className="px-3 py-2.5 text-left font-medium">What it did</th>
            <th className={TH}>Weight before</th>
            <th className={TH}>Weight after</th>
            <th className={TH} title="Change in the position beyond the stock's own price move">Position change</th>
            <th className={TH}>Value held</th>
          </tr>
        }>
          {row.moves.map(m => (
            <tr key={m.fund.code} className={ROW}>
              <td className={STICKY_TD}>
                <Link to={`/fund/${m.fund.code}/${fundSlug(m.fund.name)}`} className="font-medium text-fg hover:text-brand-600">{m.fund.name}</Link>
                <div className="text-xs text-faint">{m.fund.categoryDisplay || m.fund.category}</div>
              </td>
              <td className={`whitespace-nowrap px-3 py-2.5 ${toneClass(m.action === 'added' || m.action === 'raised' ? 'pos' : m.action === 'cut' || m.action === 'exited' ? 'neg' : 'mute')}`}>{ACTION_LABEL[m.action]}</td>
              <td className={`${TD} text-muted`}>{m.before == null ? 'none' : `${m.before.toFixed(2)}%`}</td>
              <td className={TD}>{m.after == null ? 'none' : `${m.after.toFixed(2)}%`}</td>
              <td className={`${TD} text-muted`}>{m.active == null ? 'n/a' : `${m.active > 0 ? '+' : ''}${m.active.toFixed(1)}%`}</td>
              <td className={`${TD} text-muted`}>{m.valueChange == null ? 'n/a' : fmtCrore(m.valueChange, true)}</td>
            </tr>
          ))}
        </TableShell>
      )}
    </div>
  )
}

function TableShell({ head, foot, children, testId }: { head: ReactNode; foot?: ReactNode; children?: ReactNode; testId?: string }) {
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface" data-testid={testId}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {foot}
    </div>
  )
}

function MoreButton({ left, onClick }: { left: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full border-t border-line bg-surface2/50 py-2.5 text-sm font-medium text-brand-600 hover:bg-surface2">
      Show {Math.min(left, PAGE)} more ({left} left)
    </button>
  )
}

function People({ list }: { list: [string, string][] }) {
  if (!list.length) return <span className="text-faint">none</span>
  return (
    <div className="space-y-0.5">
      {list.map(([n, d]) => <div key={n + d} className="whitespace-nowrap">{n} <span className="text-xs text-faint">{fmtDay(d)}</span></div>)}
    </div>
  )
}
function fmtDay(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Footnote({ s, data }: { s: MoversState; data: MoversData }) {
  const ref = monthLabel(data.refMonth)
  const text: Record<View, string> = {
    flows: `Estimated net flow is the change in AUM minus what the fund's own NAV movement explains: AUM at the end, less AUM at the start grown by the NAV return. What is left is investor money in or out; the rest is the market effect. A 3- or 6-month figure adds up its months, so money that arrived early in the window is not counted again for what it earned later. Dividends paid out, scheme mergers and money arriving mid-month make it an estimate rather than the fund house's reported figure. AUM is the month-end figure each fund discloses, latest ${ref}. A fund that skipped a month's disclosure has no figure for windows that need that month.`,
    size: `AUM is month-end assets under management, latest ${ref}. The change is split into estimated net flow (investor money) and market effect (the fund's own returns on what it already held).`,
    returns: 'Returns are annualised (CAGR) over the chosen period. "vs category" is the gap to the category median. Volatility, max drawdown, Sharpe and Sortino use daily NAVs over the same period. Past returns describe what happened; they do not predict what comes next.',
    rank: 'Rank is the fund\'s place in its category on the FairFund score, now against the earlier ranking. Funds that kept their place show a move of 0.',
    momentum: `Momentum compares the 1-year return with the fund's own ${s.horizon === '5Y' ? '5' : '3'}-year annualised return. A positive gap means it is running ahead of its own record, a negative one that it is cooling. A hot short-term number can reflect rich valuations as easily as lasting improvement.`,
    cost: 'Expense ratio is the direct plan TER, the yearly fee taken from the fund\'s assets. The change is in percentage points over the window, from monthly portfolio disclosures.',
    managers: 'Joins come from each fund\'s current manager list and the date each manager took charge. Departures are recorded when a name drops off a fund\'s list, checked about once a month from October 2026 onwards; exits before that are not known. A new fund lists all its managers as joined.',
    stocks: 'From monthly portfolio disclosures. A fund counts as buying when it added the stock or grew its position by 5% or more beyond the stock\'s own price move, and as selling when it cut as much or exited. The price move is estimated from the active funds that held the stock at both ends, since most do not trade a given stock in a month; when most holders trade together, as after an index change, the split can be off. Where no price estimate exists (fewer than five funds hold the stock, or the fund has no NAV for a month end), a weight change is shown as unadjusted and not counted as buying or selling. Portfolios listing less than 90% of assets are left out. Value held includes price moves.',
    debt: 'Liquid, money market and arbitrage funds by AUM. Their gross returns sit close together because of what they may hold, so the expense ratio is the main difference in what you keep. Green AUM is ₹1,000 Cr or more; green expense is 0.15% or below.',
  }
  return <p className="mt-3 text-xs text-faint" data-testid="movers-footnote">{text[s.view]}</p>
}

// ---- small pieces --------------------------------------------------------------------
function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (!data || data.length < 2) return NA
  const w = 62, h = 18, pad = 2
  const min = Math.min(...data), max = Math.max(...data)
  const rng = max - min || 1
  const x = (i: number) => pad + (i / (data.length - 1)) * (w - 2 * pad)
  const y = (v: number) => pad + (1 - (v - min) / rng) * (h - 2 * pad)
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const stroke = up ? '#059669' : '#ef4444'
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="ml-auto block" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1])} r={1.8} fill={stroke} />
    </svg>
  )
}

function FlowBars({ data }: { data: (number | null)[] }) {
  const vals = data.filter((v): v is number => v != null)
  if (!vals.length) return NA
  const w = 62, h = 20, n = data.length
  const max = Math.max(...vals.map(Math.abs)) || 1
  const bw = Math.max(2, (w - (n - 1)) / n)
  const mid = h / 2
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="ml-auto block" aria-hidden="true">
      <line x1={0} x2={w} y1={mid} y2={mid} stroke="currentColor" strokeOpacity={0.2} />
      {data.map((v, i) => {
        if (v == null) return null
        const bh = Math.max(1, (Math.abs(v) / max) * (mid - 1))
        return <rect key={i} x={i * (bw + 1)} y={v >= 0 ? mid - bh : mid} width={bw} height={bh} fill={v >= 0 ? '#059669' : '#ef4444'} rx={0.5} />
      })}
    </svg>
  )
}

function Chip({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface2 py-0.5 pl-2.5 pr-1 text-xs text-fg">
      {children}
      <button onClick={onRemove} className="rounded-full px-1.5 text-faint hover:bg-surface hover:text-fg" aria-label="Remove filter">×</button>
    </span>
  )
}

function Seg({ label, children }: { label: string; children: ReactNode }) {
  return <div className="inline-flex overflow-hidden rounded-full border border-line" role="group" aria-label={label}>{children}</div>
}
function SegBtn({ active, disabled, onClick, title, children }: { active: boolean; disabled?: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-pressed={active}
      className={`px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-brand-600 text-white' : 'bg-surface text-muted hover:text-fg'}`}>
      {children}
    </button>
  )
}
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}
      className="w-full min-w-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-fg sm:w-auto">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}
