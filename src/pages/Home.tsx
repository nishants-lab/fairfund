import { useMemo, useRef, useState, useEffect } from 'react'
import { makeEdition, validConsistency, CONSISTENCY_EXPLANATION, type Edition } from '../lib/edition'
import type { Fund } from '../types'
import { Link, useNavigate } from 'react-router-dom'
import SearchBox from '../components/SearchBox'
import InfoTip from '../components/InfoTip'
import { categoryOrder, data, funds } from '../lib/data'
import { getCategoryColor } from '../lib/categoryColors'
import { fundSlug, pct } from '../lib/format'
import { fmtNavDate } from '../lib/navFreshness'
import { usePageMeta } from '../lib/usePageMeta'

const windows = ['1Y', '3Y', '5Y'] as const
type Window = (typeof windows)[number]
const boardCategories = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS', 'Value/Contra', 'Multi Cap', 'Index-MidCap']
  .filter((key) => data.categories[key]?.fundCount > 0)
const categoryKeys = categoryOrder.filter((key) => data.categories[key]?.fundCount > 0)
const editions = [
  { title: 'See how the period changes the result.', detail: 'Switch between 1-, 3- and 5-year annualised returns to explore the funds in a category.' },
  { title: 'How has a fund compared with its peers?', detail: 'Open a fund report to examine its available history and category comparison.' },
  { title: 'Take a closer look at a fund you own.', detail: 'Start with a search, then review its returns, risk and available holdings.' },
  { title: 'Choose a category. Find your starting point.', detail: 'Browse covered funds, then select the dates that matter on their reports.' },
]

function Arrow() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="h-4 w-4 shrink-0"><path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

/** The sorted examples are snapshot returns, not same-date portfolio recommendations. */
function WindowBoard({ initialCategory }: { initialCategory: string }) {
  const [category, setCategory] = useState(initialCategory)
  const [window, setWindow] = useState<Window>('3Y')
  const tabs = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  useEffect(() => {
    const container = tabs.current
    const active = container?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (container && active) container.scrollLeft = active.offsetLeft - container.clientWidth / 2 + active.offsetWidth / 2
  }, [category])
  const leaders = useMemo(() => funds
    .filter((f) => f.category === category && Number.isFinite(f.metrics[window]?.cagr))
    .sort((a, b) => (b.metrics[window]?.cagr ?? -Infinity) - (a.metrics[window]?.cagr ?? -Infinity))
    .slice(0, 5), [category, window])

  return <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" aria-label="Fund return explorer">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">Explore the data</p>
        <h2 className="mt-1 text-base font-semibold text-fg">{data.categories[category]?.display ?? category} · Annualised return</h2>
      </div>
      <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Return period">
        {windows.map((value) => <button key={value} type="button" aria-pressed={window === value} onClick={() => setWindow(value)}
          className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${window === value ? 'bg-brand-600 text-white' : 'text-muted hover:bg-surface2 hover:text-fg'}`}>{value}</button>)}
      </div>
    </div>
    <div ref={tabs} className="relative flex gap-1.5 overflow-x-auto border-b border-line px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Board category">
      {boardCategories.map((key) => <button type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key)}
        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${category === key ? 'bg-fg text-canvas' : 'bg-surface2 text-muted hover:text-fg'}`}>{data.categories[key]?.display ?? key}</button>)}
    </div>
    <ol className="divide-y divide-line/70" aria-live="polite" aria-label={`${category} ${window} annualised returns`}>
      {leaders.map((fund, i) => <li key={fund.code}>
        <button type="button" onClick={() => navigate(`/fund/${fund.code}/${fundSlug(fund.name)}`)} className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface2/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:px-5">
          <span className="w-5 shrink-0 font-display text-lg italic text-faint">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300">{fund.name}</span>
          <span className="shrink-0 font-display text-lg font-semibold tabular-nums text-fg">{pct(fund.metrics[window]?.cagr)}</span>
        </button>
      </li>)}
    </ol>
    <p className="border-t border-line bg-surface2/40 px-4 py-3 text-xs leading-relaxed text-muted sm:px-5">Highest {window} annualised returns · {fmtNavDate(data.anchor)}. Fund periods can differ.</p>
  </div>
}

function CategoryIndex() {
  const categories = categoryKeys.map((key) => ({ key, ...data.categories[key] }))
  const topThree = new Set([...categories].filter((c) => c.medianCagr5Y != null)
    .sort((a, b) => (b.medianCagr5Y ?? -Infinity) - (a.medianCagr5Y ?? -Infinity))
    .slice(0, 3).map((c) => c.key))
  return <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="categories-title">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">The category index</p>
        <h2 id="categories-title" className="mt-2 text-3xl font-semibold text-fg">{categoryKeys.length} categories to explore.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Category median returns · 5Y analysis through {fmtNavDate(data.anchor)}. Fund periods can differ.</p>
      </div>
      <Link to="/explore" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">Explore all funds <Arrow /></Link>
    </div>
    <div className="mt-7 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      {categories.map((c) => {
        const color = getCategoryColor(c.key)
        return <Link key={c.key} to={`/explore?cat=${encodeURIComponent(c.key)}`}
          className="group flex min-h-[76px] items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 transition-colors hover:border-brand-300 hover:bg-surface2/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 dark:hover:border-brand-500">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color.bg} border ${color.border}`} aria-hidden="true" />
              <span className="font-semibold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300">{c.display ?? c.key}</span>
              {topThree.has(c.key) && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">5Y median: top 3</span>}
            </div>
            <p className="mt-1 pl-4 text-xs text-muted">{c.fundCount} funds</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-xl font-semibold tabular-nums text-fg">{c.medianCagr5Y == null ? '—' : `${c.medianCagr5Y.toFixed(1)}%`}</p>
            <p className="text-[11px] text-muted">median 5Y</p>
          </div>
        </Link>
      })}
    </div>
  </section>
}

function Spotlight({ fund }: { fund: Fund }) {
  const m = fund.metrics['3Y']!
  const consistency = validConsistency(fund)
  const color = getCategoryColor(fund.category)
  const values = [
    { label: '3Y annualised return', value: pct(m.cagr) },
    { label: '3Y largest fall', value: Number.isFinite(m.maxDrawdown) ? pct(m.maxDrawdown) : 'Unavailable' },
  ]
  return <article className="min-w-0 rounded-2xl border border-line bg-surface p-5 sm:p-7" aria-label="Fund spotlight" data-fund-code={fund.code}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${color.bg} ${color.text}`}>{fund.categoryDisplay}</span>
      <span className="text-xs font-medium text-muted">Fund spotlight</span>
    </div>
    <Link to={`/fund/${fund.code}/${fundSlug(fund.name)}`} className="mt-4 block focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
      <h3 className="text-2xl font-semibold leading-tight text-fg hover:text-brand-700 dark:hover:text-brand-300 sm:text-3xl">{fund.name}</h3>
    </Link>
    <p className="mt-2 text-xs text-muted">{fund.amc}</p>
    <dl className="mt-6 grid grid-cols-2 gap-5 border-y border-line py-5">
      {values.map(v => <div key={v.label}><dt className="text-xs text-muted">{v.label}</dt><dd className="mt-1 font-display text-3xl font-semibold tabular-nums text-fg">{v.value}</dd></div>)}
    </dl>
    {consistency && <div className="mt-5">
      <p className="text-sm leading-relaxed text-muted">Beat the category median in <strong className="font-semibold text-fg">{Math.round(consistency.pct)}%</strong> of measured 3-year periods.{' '}
        <InfoTip label="About spotlight consistency" width={280}>Based on {consistency.n} measured periods. {CONSISTENCY_EXPLANATION}</InfoTip>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface2" aria-hidden="true"><div className="h-full rounded-full bg-brand-500" style={{width: `${consistency.pct}%`}} /></div>
      {consistency.limited && <p className="mt-2 text-xs text-muted">Limited history.</p>}
    </div>}
    <p className="mt-4 text-xs leading-relaxed text-muted">Featured for exploration, not a recommendation. Returns through {fmtNavDate(data.anchor)}.</p>
    <Link to={`/fund/${fund.code}/${fundSlug(fund.name)}`} className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">Read the fund report <Arrow /></Link>
  </article>
}

function EditionContent({ edition }: { edition: Edition }) {
  return <>
    <div className="mx-auto grid max-w-6xl gap-4 px-4 pb-10 sm:px-6 lg:grid-cols-[1.04fr_0.96fr]">
      {edition.spotlight && <Spotlight fund={edition.spotlight} />}
      <div className="grid content-start divide-y divide-line rounded-2xl border border-line bg-surface px-5 sm:px-7" aria-label="Research facts">
        {edition.facts.map(fact => <article key={fact.label} className="py-5">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-brand-700 dark:text-brand-300">{fact.label}</h3>
            <InfoTip label={`About ${fact.label.toLowerCase()}`} width={280}>{fact.explanation}</InfoTip>
          </div>
          <Link to={fact.to} className="group mt-1 block rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
            <p className="font-display text-3xl font-semibold text-fg group-hover:text-brand-700 dark:group-hover:text-brand-300">{fact.value}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{fact.text}</p>
          </Link>
          {fact.note && <p className="mt-2 text-xs leading-relaxed text-muted">{fact.note}</p>}
        </article>)}
      </div>
    </div>
  </>
}

function CategoryLeaders({ leaders }: { leaders: Fund[] }) {
  if (!leaders.length) return null
  return <section className="border-b border-line bg-surface2/40" aria-labelledby="leaders-title">
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <h2 id="leaders-title" className="text-3xl font-semibold text-fg">Explore category leaders</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Top-ranked in their category · 3Y analysis through {fmtNavDate(data.anchor)}. Fund periods can differ.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {leaders.map(f => {
          const m = f.metrics['3Y']!
          const color = getCategoryColor(f.category)
          return <Link key={f.code} to={`/fund/${f.code}/${fundSlug(f.name)}`} className="rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${color.bg} ${color.text}`}>{f.categoryDisplay}</span><span className="text-xs text-muted">#{m.catRank} of {m.catSize}</span></div>
            <h3 className="mt-3 text-lg font-semibold leading-snug text-fg">{f.name}</h3>
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">3Y annualised return <span className="float-right font-display text-xl font-semibold text-fg">{pct(m.cagr)}</span></p>
          </Link>
        })}
      </div>
    </div>
  </section>
}

export default function Home() {
  usePageMeta('Indian Mutual Fund Research', 'Research Indian mutual funds, compare funds within their categories and review the holdings in your portfolio.')
  const [edition, setEdition] = useState(() => Math.floor(Math.random() * editions.length))
  const [category, setCategory] = useState(() => boardCategories[Math.floor(Math.random() * boardCategories.length)] ?? 'Flexi Cap')
  const [research, setResearch] = useState(() => makeEdition(Math.floor(Math.random() * 2 ** 31), data))
  const selected = editions[edition]
  const rotate = () => {
    setResearch(current => makeEdition(Math.floor(Math.random() * 2 ** 31), data, current.spotlight?.code))
    setEdition((current) => (current + 1 + Math.floor(Math.random() * (editions.length - 1))) % editions.length)
    setCategory(boardCategories[Math.floor(Math.random() * boardCategories.length)] ?? 'Flexi Cap')
  }
  return <div className="overflow-x-hidden">
    <section className="border-b border-line bg-wash" aria-labelledby="home-title">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-12 pt-10 sm:px-6 sm:pt-14 lg:grid-cols-[1.04fr_0.96fr] lg:items-center lg:gap-14 lg:pb-16">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">FairFund · Indian mutual fund research</p>
          <h1 id="home-title" className="mt-4 max-w-xl font-display text-[clamp(2.5rem,5vw,4.3rem)] font-semibold leading-[1.06] tracking-tight text-fg">Research and compare Indian mutual funds.</h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted sm:text-lg">Look up a fund to review its returns, risk and holdings. Compare it with funds in the same category over a period you choose.</p>
          <div className="relative z-30 mt-7 max-w-xl">
            <label htmlFor="home-fund-search" className="mb-2 block text-sm font-semibold text-fg">Search mutual funds</label>
            <SearchBox inputId="home-fund-search" label="Search mutual funds" large placeholder="Fund name, AMC or category" />
          </div>
          <p className="mt-3 text-xs text-muted">{data.totalFunds.toLocaleString('en-IN')} funds in {categoryKeys.length} categories · analysis through <time dateTime={data.anchor}>{fmtNavDate(data.anchor)}</time></p>
        </div>
        <div className="min-w-0"><WindowBoard key={category} initialCategory={category} /></div>
      </div>
    </section>
    <section className="border-b border-line bg-surface" aria-labelledby="edition-title">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6 sm:py-10">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">Another angle</p>
          <h2 id="edition-title" className="mt-2 font-display text-2xl font-semibold text-fg sm:text-3xl">{selected.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{selected.detail}</p>
        </div>
        <button type="button" onClick={rotate} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fg transition-colors hover:border-brand-300 hover:bg-surface2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">Another view <Arrow /></button>
      </div>
      <EditionContent edition={research} />
    </section>
    <CategoryLeaders leaders={research.leaders} />
    <CategoryIndex />
    <section className="border-t border-line bg-surface2/50" aria-label="More research tools">
      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-10 sm:px-6 md:grid-cols-2 md:gap-8">
        <Link to="/compare" className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">Compare</p>
          <h2 className="mt-2 flex items-center justify-between gap-3 font-display text-2xl font-semibold text-fg">Funds side by side <Arrow /></h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">Choose funds and dates, compare returns and drawdowns, and check disclosed holdings overlap.</p>
          <span className="mt-3 inline-flex text-sm font-semibold text-brand-700 dark:text-brand-300">Start a comparison</span>
        </Link>
        <Link to="/my/portfolio" className="group rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">Your holdings</p>
          <h2 className="mt-2 flex items-center justify-between gap-3 font-display text-2xl font-semibold text-fg">Review your portfolio <Arrow /></h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">Import a CAMS statement to examine allocation and overlap where fund data is available.</p>
          <span className="mt-3 inline-flex text-sm font-semibold text-brand-700 dark:text-brand-300">Open portfolio review</span>
        </Link>
        <p className="text-xs text-muted md:col-span-2">Statements are processed in your browser. Coverage and matching can be incomplete.</p>
      </div>
    </section>
    <section className="border-t border-line" aria-label="About the data">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6">
        <p className="max-w-2xl text-sm leading-relaxed text-muted">Returns, rankings and holdings can use different reporting dates. Check the dates when comparing funds.</p>
        <Link to="/methodology" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">How the research is calculated <Arrow /></Link>
      </div>
    </section>
  </div>
}
