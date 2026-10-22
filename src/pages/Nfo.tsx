import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { funds, getFund } from '../lib/data'
import { fundSlug } from '../lib/format'
import { fmtDate } from '../lib/metrics'
import { getCategoryColor } from '../lib/categoryColors'
import ShareButton from '../components/ShareButton'
import {
  availableFrom, categoryContext, groupNfos, nfoData, sameIndexFunds, SHOW_DAYS_AFTER_CLOSE, todayIst, visibleUntil, yearsSince,
  type Nfo, type NfoStatus,
} from '../lib/nfo'

// New fund offers in the categories FairFund covers, each shown next to what
// already exists: the funds tracking the same index, or the size of the category.

const DAYS = nfoData.showDaysAfterClose ?? SHOW_DAYS_AFTER_CLOSE

const SECTIONS: { key: NfoStatus; title: string; blurb: string }[] = [
  { key: 'offer', title: 'Offer opened, not trading yet', blurb: 'The offer period has started and units are not yet allotted. Where no closing date is shown, FairFund could not confirm one; the scheme\'s offer document has it.' },
  { key: 'upcoming', title: 'Opening soon', blurb: 'Listed by AMFI with an opening date ahead.' },
  { key: 'closed', title: 'Offer closed', blurb: `The offer has closed and units are not yet allotted. Each stays on this list for ${DAYS} days after it closes.` },
  { key: 'trading', title: 'Recently started trading', blurb: `AMFI now publishes a daily NAV for these schemes. Each stays on this list for ${DAYS} days after its offer closed, or after its first NAV when no closing date was published.` },
]

const catSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

function Fact({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="line-clamp-3 break-words text-sm text-fg" title={value}>{value}</dd>
    </div>
  )
}

function Existing({ n, today }: { n: Nfo; today: string }) {
  const same = sameIndexFunds(n, funds)
  if (same.length) {
    const shown = same.slice(0, 5)
    return (
      <div className="mt-3 rounded-lg bg-surface2/60 px-3 py-2.5" data-testid="nfo-same-index">
        <div className="text-xs font-semibold text-muted">
          {same.length} {same.length === 1 ? 'fund' : 'funds'} on FairFund already {same.length === 1 ? 'tracks' : 'track'} this index
        </div>
        <ul className="mt-1.5 space-y-1">
          {shown.map((f) => {
            const yrs = yearsSince(f.inceptionDate ?? f.launchDate, today)
            return (
              <li key={f.code} className="flex flex-col gap-x-3 text-sm sm:flex-row sm:items-baseline sm:justify-between">
                <Link to={`/fund/${f.code}/${fundSlug(f.name)}`} className="min-w-0 break-words text-brand-600 hover:underline dark:text-brand-400">{f.name}</Link>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {yrs !== null ? `${yrs >= 1 ? Math.floor(yrs) + ' yr' : '<1 yr'} record` : ''}
                  {typeof f.expenseRatio === 'number' ? ` · TER ${f.expenseRatio.toFixed(2)}%` : ''}
                </span>
              </li>
            )
          })}
        </ul>
        {same.length > shown.length && <div className="mt-1 text-xs text-faint">and {same.length - shown.length} more</div>}
      </div>
    )
  }
  const ctx = categoryContext(n, funds)
  if (ctx) {
    return (
      <div className="mt-3 rounded-lg bg-surface2/60 px-3 py-2.5 text-sm text-muted" data-testid="nfo-category">
        FairFund covers {ctx.count} {ctx.display} funds; {ctx.withThreeYears} have a 3-year record.{' '}
        <Link to={`/category/${catSlug(ctx.category)}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-400">See the category</Link>
      </div>
    )
  }
  if (n.details?.benchmark) {
    return <div className="mt-3 text-xs text-faint" data-testid="nfo-new-index">No fund on FairFund tracks this index yet.</div>
  }
  return null
}

function NfoCard({ n, today, status }: { n: Nfo; today: string; status: NfoStatus }) {
  const color = getCategoryColor(n.category)
  const listed = getFund(n.code)
  const d = n.details ?? {}
  const closes = n.closeDate ? fmtDate(n.closeDate) : null
  const when =
    status === 'upcoming' ? `Opens ${fmtDate(n.launchDate)}${closes ? `, closes ${closes}` : ''}`
      : status === 'offer' ? (closes ? `Open ${fmtDate(n.launchDate)} to ${closes}` : `Opened ${fmtDate(n.launchDate)}`)
        : closes ? `Offer closed ${closes} (opened ${fmtDate(n.launchDate)})` : `Opened ${fmtDate(n.launchDate)}`
  const avail = availableFrom(n)
  const availText = avail
    ? (avail.expected ? `Units expected to be available from ${fmtDate(avail.date)}` : `Open for investment since ${fmtDate(avail.date)} (first NAV)`)
    : status === 'closed' ? 'Not trading yet. No date for units to be available has been published.'
      : null
  const until = status === 'closed' || status === 'trading' ? visibleUntil(n, DAYS) : null
  return (
    <article className="card p-4" data-testid="nfo-card" data-code={n.code}>
      <div className="flex flex-col-reverse items-start gap-1.5 sm:flex-row sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-fg">{n.name}</h3>
          <div className="text-xs text-faint">{n.amc}</div>
        </div>
        <span className={`pill shrink-0 ${color.bg} ${color.text}`}>{listed?.categoryDisplay ?? n.category.replace('-', ' - ')}</span>
      </div>
      <div className="mt-2 text-sm font-medium text-fg" data-testid="nfo-when">{when}</div>
      {availText && <div className="mt-0.5 text-sm text-fg" data-testid="nfo-available">{availText}</div>}
      {status === 'trading' && n.nav && (
        <div className="mt-0.5 text-xs tabular-nums text-muted" data-testid="nfo-nav">NAV ₹{n.nav.value.toFixed(4)} on {fmtDate(n.nav.date)}</div>
      )}
      {until && <div className="mt-0.5 text-xs text-faint" data-testid="nfo-until">On this list until {fmtDate(until)}</div>}
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Benchmark" value={d.benchmark} />
        <Fact label="Manager" value={d.manager} />
        <Fact label="Exit load" value={d.exitLoad} />
        <Fact label="Minimum" value={n.minAmount ? rupees(n.minAmount) + (d.minSip ? ` · SIP ${rupees(d.minSip)}` : '') : null} />
        {d.lockInYears ? <Fact label="Lock-in" value={`${d.lockInYears} years`} /> : null}
      </dl>
      <Existing n={n} today={today} />
      {listed && (
        <Link to={`/fund/${n.code}/${fundSlug(listed.name)}`} className="mt-3 inline-block text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
          Open its FairFund page
        </Link>
      )}
    </article>
  )
}

export default function NfoPage() {
  usePageMeta('New fund offers', 'New fund offers in the categories FairFund covers, with the funds that already track the same index.')
  const today = todayIst()
  const groups = useMemo(() => groupNfos(nfoData.nfos, today), [today])
  const total = nfoData.nfos.length
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">New fund offers</h1>
        <ShareButton title="New fund offers" text="New fund offers in FairFund's categories, next to the funds that already track the same index" className="mt-0.5 shrink-0" />
      </div>
      <p className="mt-1 text-sm text-muted">
        Offers opening in the next {nfoData.window.lookaheadDays} days or opened in the last {nfoData.window.lookbackDays}, in the categories FairFund covers (Direct plan, growth option).
        Each is shown with the funds that already exist, because a new fund has no performance record of its own.
      </p>
      <div className="mt-3 rounded-lg border border-line bg-surface2/40 px-3 py-2 text-xs text-muted">
        A new fund starts at a round NAV, usually ₹10. A low NAV is not cheaper than a high one: ₹1,000 buys the same value of the portfolio either way.
        This list is information, not a recommendation to invest.
      </div>
      {total === 0 && <p className="mt-6 text-sm text-muted" data-testid="nfo-empty">No new fund offers in FairFund's categories right now.</p>}
      {SECTIONS.map((s) => groups[s.key].length > 0 && (
        <section key={s.key} className="mt-7" data-testid={`nfo-section-${s.key}`}>
          <h2 className="text-lg font-semibold text-fg">{s.title} <span className="text-sm font-normal text-faint">({groups[s.key].length})</span></h2>
          <p className="mt-0.5 text-xs text-faint">{s.blurb}</p>
          <div className="mt-3 space-y-3">
            {groups[s.key].map((n) => <NfoCard key={n.code} n={n} today={today} status={s.key} />)}
          </div>
        </section>
      ))}
      <p className="mt-8 text-xs text-faint">
        Source: AMFI scheme master and daily NAV file, updated each weekday ({fmtDate(nfoData.generatedAt)}). Benchmark, manager, exit load and the expected date units
        are available come from the scheme's Groww page, used only when its AMFI code matches. Closing dates AMFI leaves blank come from ICICIdirect and Morningstar,
        used only when the opening date, fund house and name agree. Check the scheme information document before investing.
      </p>
    </div>
  )
}
