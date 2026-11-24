import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import ShareButton from '../components/ShareButton'
import { fundSlug } from '../lib/format'
import { dayMonthYear } from '../lib/dates'
import {
  loadHoldingsReport, monthLabel, monthName, crore, croreShort, stockName, stockPage, checkGap,
  type HoldingsReport as Report, type MonthReport, type ListKey, type StockRow, type Group,
} from '../lib/holdingsReport'
import { MotionRoot, Reveal, CountUp, GrowBar, m, EASE, useReducedMotion, useInView } from '../components/report/motion'
import reportVideo from '../data/report_video.json'

const SITE_BASE = () => window.location.href.split('#')[0]
const up = 'text-emerald-700 dark:text-emerald-400'
const down = 'text-rose-700 dark:text-rose-400'
const tone = (n: number) => (n >= 0 ? up : down)

type View = 'rupees' | 'funds' | 'conviction' | 'new'
const VIEWS: { id: View; label: string; hint: string }[] = [
  { id: 'rupees', label: 'Rupees', hint: 'Estimated net buying or selling, in crore.' },
  { id: 'funds', label: 'Funds', hint: 'How many active funds raised or cut the stock, beyond what its price move explains.' },
  { id: 'conviction', label: 'Conviction', hint: 'Buying as a share of what funds already held. Stocks funds held at least ₹500 cr of, with 3 or more adding.' },
  { id: 'new', label: 'New & exits', hint: 'Active funds opening a new position, or closing one.' },
]
const LISTS: Record<View, [ListKey, ListKey]> = {
  rupees: ['buys', 'sells'],
  funds: ['widest', 'widestCut'],
  conviction: ['conviction', 'conviction'],
  new: ['newEntries', 'exits'],
}

function fundHref(r: Report, code: string) {
  const f = r.funds[code]
  return `/fund/${code}/${f ? fundSlug(f[0]) : ''}`
}

function StockLink({ m: mo, k, className = '' }: { m: MonthReport; k: string; className?: string }) {
  const page = stockPage(mo, k)
  const name = stockName(mo, k)
  return page
    ? <a href={`${SITE_BASE()}st/${page}/`} className={`hover:underline ${className}`}>{name}</a>
    : <span className={className}>{name}</span>
}

/* ---------------------------------------------------------------- header */

function Headline({ mo, report }: { mo: MonthReport; report: Report }) {
  const t = mo.totals
  const buying = t.net >= 0
  return (
    <header className="pt-2">
      <p className="eyebrow text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">Holdings report · {monthLabel(mo.month)}</p>
      <h1 className="mt-3 max-w-3xl font-display text-[2rem] font-semibold leading-[1.08] text-fg sm:text-5xl">
        Mutual funds {buying ? 'bought' : 'sold'} an estimated{' '}
        <CountUp value={Math.abs(t.net)} format={n => crore(n)} className={`whitespace-nowrap ${tone(t.net)}`} />{' '}
        of shares in {monthName(mo.month)}.
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
        From the portfolios of {t.funds.toLocaleString('en-IN')} equity and hybrid funds across {t.houses} fund houses.
        New money into them came to {crore(t.inflow)}, and they moved {crore(Math.abs(t.cashUsed))} {t.cashUsed >= 0 ? 'out of cash into shares' : 'from shares into cash'}.
      </p>
      {!mo.coverage.complete && (
        <p role="status" className="mt-4 max-w-2xl rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {mo.coverage.funds} of {mo.coverage.of} funds have disclosed their {monthName(mo.month)} portfolio so far. Figures will change as the rest report.
        </p>
      )}
      <p className="mt-3 text-xs text-faint">Estimates from monthly portfolio disclosures · {monthLabel(mo.from, false)} to {monthLabel(mo.month, false)} · updated {dayMonthYear(new Date(report.generatedAt + 'T00:00:00'))}</p>
    </header>
  )
}

const addedLine = (s: StockRow) => s.added && s.new === s.added ? `${s.added} funds bought it for the first time`
  : `${s.added} funds added${s.new ? `, ${s.new} of them for the first time` : ''}`
const cutLine = (s: StockRow) => s.cut && s.exited === s.cut ? `${s.cut} funds sold out of it`
  : `${s.cut} funds cut${s.exited ? `, ${s.exited} of them sold out` : ''}`

function Ledger({ mo }: { mo: MonthReport }) {
  const buy = mo.lists.buys[0], sell = mo.lists.sells[0], wide = mo.lists.widest[0]
  const sector = mo.sectors[0]
  const items = [
    buy && { cap: 'Most bought', k: buy, value: croreShort(mo.stocks[buy].net, true), tone: up,
      sub: addedLine(mo.stocks[buy]) },
    sell && { cap: 'Most sold', k: sell, value: croreShort(mo.stocks[sell].net, true), tone: down,
      sub: cutLine(mo.stocks[sell]) },
    wide && wide !== buy ? { cap: 'Most widely bought', k: wide, value: `${mo.stocks[wide].added} funds`, tone: 'text-fg',
      sub: `${croreShort(mo.stocks[wide].net, true)} · ${mo.stocks[wide].cut} cut` }
      : sector && { cap: 'Biggest sector move', k: null, label: sector[0], value: croreShort(sector[1], true), tone: tone(sector[1]), sub: 'net across the sector' },
  ].filter(Boolean) as { cap: string; k: string | null; label?: string; value: string; tone: string; sub: string }[]
  return (
    <Reveal className="mt-8 grid border-y border-line sm:grid-cols-3" delay={0.15}>
      {items.map((it, i) => (
        <div key={it.cap} className={`py-5 sm:px-6 ${i ? 'border-t border-line sm:border-l sm:border-t-0' : 'sm:pl-0'}`}>
          <p className="eyebrow text-[11px] font-semibold uppercase text-faint">{it.cap}</p>
          <p className="mt-1.5 text-lg font-semibold leading-snug text-fg">{it.k ? <StockLink m={mo} k={it.k} /> : it.label}</p>
          <p className={`mt-1 font-display text-3xl font-semibold tabular-nums ${it.tone}`}>{it.value}</p>
          <p className="mt-1 text-sm text-muted">{it.sub}</p>
        </div>
      ))}
    </Reveal>
  )
}

/* ---------------------------------------------------------------- trend */

function Trend({ report, month, onPick }: { report: Report; month: string; onPick: (m: string) => void }) {
  const reduce = useReducedMotion()
  const chart = useRef<HTMLDivElement>(null)
  const inView = useInView(chart, { once: true, amount: 0.3 })
  const pts = report.trend
  const max = Math.max(1, ...pts.map(p => Math.max(Math.abs(p.net), Math.abs(p.inflow + p.cashUsed))))
  return (
    <Reveal className="mt-12">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-2xl font-semibold text-fg">Month by month</h2>
        <p className="text-xs text-faint">₹ crore</p>
      </div>
      <p className="mt-1 text-sm text-muted">Estimated net buying of shares. The tick marks new money plus cash moved into shares, the check the estimate should land near.</p>
      <div ref={chart} className="mt-5 grid h-48 max-w-3xl grid-flow-col items-end gap-2 sm:gap-4" role="list">
        {pts.map((p, i) => {
          const h = Math.abs(p.net) / max
          const tick = Math.max(0, (p.inflow + p.cashUsed) / max)
          const selectable = !!report.months[p.month]
          const sel = p.month === month
          return (
            <button key={p.month} role="listitem" type="button" disabled={!selectable} onClick={() => selectable && onPick(p.month)}
              aria-label={`${monthLabel(p.month)}: ${crore(p.net, true)}${p.complete ? '' : ', still being disclosed'}`}
              aria-pressed={sel}
              className={`group relative flex h-full flex-col items-stretch justify-end rounded-lg px-0.5 ${selectable ? 'cursor-pointer' : 'cursor-default'}`}>
              <span className={`mb-1 text-center text-[11px] font-semibold tabular-nums ${sel ? 'text-fg' : 'text-faint'}`}>{croreShort(p.net).replace('₹', '').replace(' cr', '')}</span>
              <span className="relative block w-full" style={{ height: `${h * 78}%` }}>
                <m.span className={`absolute inset-0 rounded-t-md ${p.net >= 0 ? 'bg-emerald-600/80 dark:bg-emerald-500/70' : 'bg-rose-600/80'} ${sel ? '' : 'opacity-45 group-hover:opacity-70'} ${p.complete ? '' : 'bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(255_255_255/0.35)_4px_8px)]'}`}
                  style={{ transformOrigin: 'bottom' }}
                  initial={reduce ? false : { scaleY: 0 }} animate={{ scaleY: inView || reduce ? 1 : 0 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.7, ease: EASE, delay: 0.05 * i }} />
              </span>
              <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-0.5 bg-fg/70" style={{ bottom: `calc(${tick * 78}% + 1.75rem)` }} />
              <span className={`mt-2 text-center text-xs ${sel ? 'font-semibold text-fg' : 'text-muted'}`}>{monthLabel(p.month, false).split(' ')[0]}</span>
            </button>
          )
        })}
      </div>
    </Reveal>
  )
}

/* ---------------------------------------------------------------- rankings */

function Segmented<T extends string>({ value, options, onChange, id }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; id: string }) {
  return (
    <div role="tablist" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex shrink-0 gap-1 rounded-full border border-line bg-surface p-1">
        {options.map(o => (
          <button key={o.id} role="tab" aria-selected={value === o.id} type="button" onClick={() => onChange(o.id)}
            className={`relative whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${value === o.id ? 'text-white' : 'text-muted hover:text-fg'}`}>
            {value === o.id && <m.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-brand-700" transition={{ duration: 0.35, ease: EASE }} />}
            <span className="relative">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Breadth({ s }: { s: StockRow }) {
  const total = s.added + s.cut
  if (!total) return <span className="text-xs text-faint">no active moves</span>
  return (
    <span className="flex items-center gap-2 text-xs text-muted" title={`${s.added} funds added, ${s.cut} cut`}>
      <span className="flex h-1.5 w-16 overflow-hidden rounded-full bg-surface2" aria-hidden="true">
        <span className="h-full bg-emerald-600" style={{ width: `${(s.added / total) * 100}%` }} />
        <span className="h-full bg-rose-500" style={{ width: `${(s.cut / total) * 100}%` }} />
      </span>
      <span className="tabular-nums">{s.added} added · {s.cut} cut</span>
    </span>
  )
}

function StockDetail({ s, report }: { s: StockRow; report: Report }) {
  const line = (rows: [string, number][], label: string) => rows.length > 0 && (
    <div>
      <p className="eyebrow text-[11px] font-semibold uppercase text-faint">{label}</p>
      <ul className="mt-1 space-y-1">
        {rows.map(([code, v]) => (
          <li key={code} className="flex justify-between gap-3 text-sm">
            <Link to={fundHref(report, code)} className="min-w-0 truncate text-fg hover:underline">{report.funds[code]?.[0] ?? code}</Link>
            <span className={`shrink-0 tabular-nums ${tone(v)}`}>{croreShort(v, true)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className="grid gap-4 pb-4 pt-1 text-sm sm:grid-cols-3">
      <div className="space-y-1 text-muted">
        <p>Active funds <span className={`tabular-nums ${tone(s.active)}`}>{croreShort(s.active, true)}</span></p>
        <p>Index funds <span className={`tabular-nums ${tone(s.index)}`}>{croreShort(s.index, true)}</span></p>
        {s.addedPct != null && <p>{s.addedPct >= 0 ? 'Added' : 'Cut'} {Math.abs(s.addedPct).toFixed(1)}% of what funds held</p>}
        <p>{s.sector}</p>
      </div>
      {line(s.buyers, 'Biggest buyers')}
      {line(s.sellers, 'Biggest sellers')}
    </div>
  )
}

function Rankings({ mo, report }: { mo: MonthReport; report: Report }) {
  const [view, setView] = useState<View>('rupees')
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [open, setOpen] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const key = LISTS[view][view === 'conviction' ? 0 : side === 'buy' ? 0 : 1]
  const keys = mo.lists[key] ?? []
  const shown = keys.slice(0, more ? keys.length : 10)
  const metric = (s: StockRow) => view === 'funds' ? (side === 'buy' ? s.added : s.cut)
    : view === 'conviction' ? (s.addedPct ?? 0) : view === 'new' ? (side === 'buy' ? s.new : s.exited) : Math.abs(s.net)
  const max = Math.max(1, ...keys.map(k => metric(mo.stocks[k])))
  const label = (s: StockRow) => view === 'funds' ? `${side === 'buy' ? s.added : s.cut} funds`
    : view === 'conviction' ? `+${(s.addedPct ?? 0).toFixed(1)}%` : view === 'new' ? `${side === 'buy' ? s.new : s.exited} funds` : croreShort(s.net, true)
  const buying = view === 'conviction' || side === 'buy'
  useEffect(() => { setOpen(null); setMore(false) }, [view, side, mo.month])

  return (
    <Reveal className="mt-14" id="rankings">
      <h2 className="font-display text-2xl font-semibold text-fg">What they bought and sold</h2>
      <p className="mt-1 text-sm text-muted">{VIEWS.find(v => v.id === view)!.hint} Overseas stocks are listed apart, below.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented id="view" value={view} options={VIEWS} onChange={setView} />
        {view !== 'conviction' && (
          <Segmented id="side" value={side} onChange={setSide}
            options={[{ id: 'buy', label: view === 'new' ? 'New positions' : 'Bought' }, { id: 'sell', label: view === 'new' ? 'Exits' : 'Sold' }]} />
        )}
      </div>
      <ol className="mt-4 divide-y divide-line border-y border-line">
        {shown.map((k, i) => {
          const s = mo.stocks[k]
          const isOpen = open === k
          return (
            <li key={`${key}-${k}`}>
              <div className="flex items-center gap-3 py-3">
                <span className="w-6 shrink-0 text-right font-display text-lg italic text-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <StockLink m={mo} k={k} className="min-w-0 truncate font-semibold text-fg" />
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${view === 'rupees' ? tone(s.net) : buying ? up : down}`}>{label(s)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5"><GrowBar fraction={metric(s) / max} delay={i * 0.03} className={buying ? 'bg-emerald-600/45 dark:bg-emerald-500/50' : 'bg-rose-600/45 dark:bg-rose-500/50'} /></div>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <Breadth s={s} />
                    <button type="button" onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} the funds behind ${stockName(mo, k)}`}
                      className="-my-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-brand-700 hover:bg-surface2 dark:text-brand-300">
                      Funds
                      <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  </div>
                </div>
              </div>
              <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden pl-9">{isOpen && <StockDetail s={s} report={report} />}</div>
              </div>
            </li>
          )
        })}
      </ol>
      {keys.length > 10 && (
        <button type="button" onClick={() => setMore(v => !v)} className="btn-ghost mt-4">{more ? 'Show top 10' : `Show all ${keys.length}`}</button>
      )}
    </Reveal>
  )
}

/* ---------------------------------------------------------------- sectors, categories, houses */

/** Shorter sector names for phone-width rows; the full name stays in the title. */
const SECTOR_SHORT: Record<string, string> = {
  'Consumer Discretionary': 'Discretionary', 'Consumer Staples': 'Staples', 'Energy & Utilities': 'Energy, utilities',
}

function Sectors({ mo }: { mo: MonthReport }) {
  const rows = mo.sectors.filter(([s]) => !/^(unspecified|other)$/i.test(s))
  const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)))
  return (
    <Reveal className="mt-14">
      <h2 className="font-display text-2xl font-semibold text-fg">By sector</h2>
      <p className="mt-1 text-sm text-muted">Net buying across every stock in the sector.</p>
      <ul className="mt-4 space-y-2.5">
        {rows.map(([name, v], i) => (
          <li key={name} className="grid grid-cols-[7.75rem_1fr_1fr_5.25rem] items-center gap-x-1.5 text-sm sm:grid-cols-[11rem_1fr_1fr_6rem] sm:gap-x-2">
            <span className="truncate text-fg" title={name}>
              <span className="sm:hidden">{SECTOR_SHORT[name] ?? name}</span><span className="hidden sm:inline">{name}</span>
            </span>
            <span className="h-3">{v < 0 && <GrowBar origin="right" fraction={Math.abs(v) / max} delay={i * 0.03} className="bg-rose-600/75" />}</span>
            <span className="h-3 border-l border-line">{v >= 0 && <GrowBar fraction={v / max} delay={i * 0.03} className="bg-emerald-600/75" />}</span>
            <span className={`whitespace-nowrap text-right tabular-nums ${tone(v)}`}>{croreShort(v, true)}</span>
          </li>
        ))}
      </ul>
    </Reveal>
  )
}

function GroupLists({ mo, g }: { mo: MonthReport; g: Group }) {
  const col = (rows: [string, number, number][], title: string, verb: string) => (
    <div>
      <p className="eyebrow text-[11px] font-semibold uppercase text-faint">{title}</p>
      <ol className="mt-2 space-y-1.5">
        {rows.map(([k, v, n]) => (
          <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate"><StockLink m={mo} k={k} className="text-fg" /> <span className="text-xs text-faint">{n} {verb}</span></span>
            <span className={`shrink-0 tabular-nums ${tone(v)}`}>{croreShort(v, true)}</span>
          </li>
        ))}
        {!rows.length && <li className="text-sm text-faint">None</li>}
      </ol>
    </div>
  )
  return (
    <div className="mt-4 grid gap-6 sm:grid-cols-2">
      {col(g.buys, 'Bought', 'added')}
      {col(g.sells, 'Sold', 'cut')}
    </div>
  )
}

function Categories({ mo }: { mo: MonthReport }) {
  const cats = mo.categories.filter(c => c.funds >= 3)
  const [pick, setPick] = useState<string>(cats[0]?.name ?? '')
  const g = cats.find(c => c.name === pick) ?? cats[0]
  if (!g) return null
  return (
    <Reveal className="mt-14">
      <h2 className="font-display text-2xl font-semibold text-fg">By fund category</h2>
      <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {cats.map(c => (
          <button key={c.name} type="button" onClick={() => setPick(c.name)} aria-pressed={c.name === g.name}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm transition-colors ${c.name === g.name ? 'border-fg bg-fg text-canvas' : 'border-line text-muted hover:text-fg'}`}>
            {c.name}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">
        {g.funds} {g.name} funds {g.net >= 0 ? 'bought' : 'sold'} a net <span className={`font-semibold ${tone(g.net)}`}>{crore(Math.abs(g.net))}</span> of shares{g.inflow >= 0 ? `, with ${crore(g.inflow)} of new money coming in.` : `, while investors took out ${crore(Math.abs(g.inflow))}.`}
      </p>
      <GroupLists mo={mo} g={g} />
    </Reveal>
  )
}

function Houses({ mo }: { mo: MonthReport }) {
  const [all, setAll] = useState(false)
  const rows = mo.houses.slice(0, all ? mo.houses.length : 8)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Reveal className="mt-14">
      <h2 className="font-display text-2xl font-semibold text-fg">By fund house</h2>
      <p className="mt-1 text-sm text-muted">Largest moves first. Tap a fund house for its top stocks.</p>
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {rows.map(h => (
          <li key={h.name}>
            <button type="button" onClick={() => setOpen(open === h.name ? null : h.name)} aria-expanded={open === h.name}
              className="flex w-full items-center justify-between gap-3 py-3 text-left">
              <span className="min-w-0"><span className="font-semibold text-fg">{h.name}</span> <span className="text-xs text-faint">{h.funds} funds</span></span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="hidden text-xs text-muted sm:inline">top buy {h.buys[0] ? stockName(mo, h.buys[0][0]) : 'none'}</span>
                <span className={`text-sm font-semibold tabular-nums ${tone(h.net)}`}>{croreShort(h.net, true)}</span>
              </span>
            </button>
            {open === h.name && <div className="pb-4"><GroupLists mo={mo} g={h} /></div>}
          </li>
        ))}
      </ul>
      {mo.houses.length > 8 && <button type="button" onClick={() => setAll(v => !v)} className="btn-ghost mt-4">{all ? 'Show fewer' : `Show all ${mo.houses.length}`}</button>}
    </Reveal>
  )
}

function Overseas({ mo }: { mo: MonthReport }) {
  const b = mo.lists.overseasBuys.slice(0, 5), s = mo.lists.overseasSells.slice(0, 5)
  if (!b.length && !s.length) return null
  const row = (k: string) => {
    const st = mo.stocks[k]
    const n = st.buyers.length + st.sellers.length
    return (
      <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-fg">{stockName(mo, k).replace(/\s*Forgn\.?\s*Eq\.?/i, '')}</span>
        <span className="shrink-0 tabular-nums"><span className={tone(st.net)}>{croreShort(st.net, true)}</span>{n === 1 && <span className="ml-1 text-xs text-faint">1 fund</span>}</span>
      </li>
    )
  }
  return (
    <Reveal className="mt-14">
      <h2 className="font-display text-2xl font-semibold text-fg">Overseas stocks</h2>
      <p className="mt-1 text-sm text-muted">Indian funds net {mo.totals.overseasNet >= 0 ? 'bought' : 'sold'} {crore(Math.abs(mo.totals.overseasNet))} of foreign shares. A handful of funds make most of these moves.</p>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div><p className="eyebrow text-[11px] font-semibold uppercase text-faint">Bought</p><ol className="mt-2 space-y-1.5">{b.map(row)}</ol></div>
        <div><p className="eyebrow text-[11px] font-semibold uppercase text-faint">Sold</p><ol className="mt-2 space-y-1.5">{s.map(row)}</ol></div>
      </div>
    </Reveal>
  )
}

const MEDIA_BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'
// The GIF and summary card are written into dist/ by the build, so dev servers do not have them.
const HAS_BUILT_MEDIA = Boolean((import.meta as { env?: { PROD?: boolean } }).env?.PROD)

/** The month's video, GIF and summary card, for anyone posting about it. */
function ShareKit({ mo, isLead }: { mo: MonthReport; isLead: boolean }) {
  const video = reportVideo.month === mo.month ? reportVideo : null
  if (!video && !(isLead && HAS_BUILT_MEDIA)) return null
  const link = 'font-medium text-brand-700 underline decoration-brand-300 underline-offset-4 hover:decoration-2 dark:text-brand-300 dark:decoration-brand-700'
  return (
    <Reveal className="mt-14 grid gap-6 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-center" id="share">
      {video && (
        <video controls muted playsInline preload="none" poster={`${MEDIA_BASE}${video.poster}`}
          width={video.width} height={video.height}
          className="mx-auto aspect-[9/16] w-56 rounded-2xl bg-[#14171c] shadow-sm sm:w-full"
          aria-label={`Video: what mutual funds bought in ${monthLabel(mo.month)}`}>
          <source src={`${MEDIA_BASE}${video.video}`} type="video/mp4" />
        </video>
      )}
      <div className={video ? '' : 'sm:col-span-2'}>
        <h2 className="font-display text-xl font-semibold text-fg">{video ? `${monthName(mo.month)} in ${video.seconds} seconds` : 'Share this month'}</h2>
        <p className="mt-2 text-sm text-muted">
          {video ? 'The month in one short vertical video: the headline, most bought, most sold, sectors and new stakes.' : 'A chart and a summary card of this month, for posts.'}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {video && <li><a href={`${MEDIA_BASE}${video.video}`} download={`fund-buying-${mo.month}.mp4`} className={link}>Download the video (MP4)</a></li>}
          {isLead && HAS_BUILT_MEDIA && <li><a href={`${MEDIA_BASE}media/fund-buying.gif`} download={`fund-buying-${mo.month}.gif`} className={link}>Download the animated chart (GIF)</a></li>}
          {isLead && HAS_BUILT_MEDIA && <li><a href={`${MEDIA_BASE}og/fund-buying.png`} download={`fund-buying-${mo.month}.png`} className={link}>Download the summary card (PNG)</a></li>}
        </ul>
      </div>
    </Reveal>
  )
}

function Method({ mo }: { mo: MonthReport }) {
  const t = mo.totals
  const gap = checkGap(t)
  return (
    <Reveal className="mt-14 rounded-2xl bg-surface2/70 p-5 text-sm leading-relaxed text-muted sm:p-7" id="method">
      <h2 className="font-display text-xl font-semibold text-fg">How these numbers are made</h2>
      <p className="mt-2">Funds publish what share of their portfolio each stock is and how big the fund is, every month. For each fund and stock, buying is the value held at the end of the month less the value at the start grown by the stock's price move. A stock's price move is read from the many funds that held it at both ends; for {crore(t.fallbackValue)} of holdings with too few such funds, the fund's own return stands in.</p>
      <dl className="mt-4 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 tabular-nums">
        <dt>Estimated net buying of shares</dt><dd className="text-right font-semibold text-fg">{crore(t.net, true)}</dd>
        <dt>New money into the same funds</dt><dd className="text-right">{crore(t.inflow, true)}</dd>
        <dt>Cash moved into shares</dt><dd className="text-right">{crore(t.cashUsed, true)}</dd>
        <dt>New money plus cash</dt><dd className="text-right">{crore(t.inflow + t.cashUsed, true)}</dd>
      </dl>
      {gap != null && (
        <p className="mt-3">{gap <= 0.25
          ? `The estimate is within ${Math.max(1, Math.round(gap * 100))}% of new money plus cash this month.`
          : `The estimate differs from new money plus cash by ${Math.round(gap * 100)}% this month, so read it with more care.`}</p>
      )}
      <p className="mt-3">The number of funds adding or cutting counts only active funds whose position moved by more than its price explains; index funds follow their index and count in rupees only. Arbitrage funds are left out, as they sell futures against the shares they buy. Overseas stocks are listed separately.</p>
      <p className="mt-3">These are estimates for research, not investment advice. <Link to="/methodology" className="font-medium text-brand-700 hover:underline dark:text-brand-300">Full methodology</Link></p>
    </Reveal>
  )
}

/* ---------------------------------------------------------------- page */

export default function HoldingsReport() {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState(false)
  const [params, setParams] = useSearchParams()
  useEffect(() => { loadHoldingsReport().then(setReport, () => setError(true)) }, [])
  const month = useMemo(() => {
    if (!report) return null
    const want = params.get('m')
    return want && report.months[want] ? want : report.lead
  }, [report, params])
  const mo = report && month ? report.months[month] : null
  const title = mo ? `What mutual funds bought in ${monthLabel(mo.month)}` : 'What mutual funds bought'
  usePageMeta(title, mo
    ? `Indian mutual funds bought an estimated ${crore(mo.totals.net)} of shares in ${monthLabel(mo.month)}. Most bought, most sold, by sector, category and fund house.`
    : 'Monthly estimate of what Indian mutual funds bought and sold, from their portfolio disclosures.')

  if (error) throw new Error('The holdings report did not load')
  if (!report || !mo) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10" aria-busy="true">
        <div className="skeleton h-4 w-48" />
        <div className="skeleton mt-4 h-24 w-full max-w-3xl" />
        <div className="skeleton mt-8 h-32 w-full" />
      </div>
    )
  }
  const months = Object.keys(report.months).sort().reverse()
  return (
    <MotionRoot>
      <article className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:pt-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <nav aria-label="Report month" className="no-scrollbar flex gap-1 overflow-x-auto">
            {months.map(m => (
              <button key={m} type="button" aria-pressed={m === month}
                onClick={() => setParams(m === report.lead ? {} : { m }, { replace: true })}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${m === month ? 'bg-fg text-canvas' : 'text-muted hover:text-fg'}`}>
                {monthLabel(m, false)}{report.months[m].coverage.complete ? '' : ' (partial)'}
              </button>
            ))}
          </nav>
          <ShareButton title={title} text={`${title}: estimated ${crore(mo.totals.net)} of shares, on FairFund`} className="shrink-0" label="" />
        </div>
        <Headline mo={mo} report={report} />
        <Ledger mo={mo} />
        <Trend report={report} month={mo.month} onPick={m => setParams(m === report.lead ? {} : { m }, { replace: true })} />
        <Rankings mo={mo} report={report} />
        <Sectors mo={mo} />
        <Categories mo={mo} />
        <Houses mo={mo} />
        <Overseas mo={mo} />
        <ShareKit mo={mo} isLead={mo.month === report.lead} />
        <Method mo={mo} />
      </article>
    </MotionRoot>
  )
}
