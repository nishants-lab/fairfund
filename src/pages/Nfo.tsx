import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { usePageMeta } from '../lib/usePageMeta'
import { funds, getFund } from '../lib/data'
import { fundSlug } from '../lib/format'
import { fmtDate } from '../lib/metrics'
import { getCategoryColor } from '../lib/categoryColors'
import ShareButton from '../components/ShareButton'
import {
  categoryContext, groupNfos, nfoData, sameIndexFunds, todayIst, yearsSince,
  type Nfo, type NfoStatus,
} from '../lib/nfo'

// New fund offers in the categories FairFund covers, each shown next to what
// already exists: the funds tracking the same index, or the size of the category.

const SECTIONS: { key: NfoStatus; title: string; blurb: string }[] = [
  { key: 'offer', title: 'Offer opened, not trading yet', blurb: 'The offer period has started and units are not yet allotted. AMFI does not always publish the closing date; the scheme\'s offer document has it.' },
  { key: 'upcoming', title: 'Opening soon', blurb: 'Listed by AMFI with an opening date ahead.' },
  { key: 'closed', title: 'Offer closed', blurb: 'The closing date AMFI lists has passed; units are not yet allotted.' },
  { key: 'trading', title: 'Recently started trading', blurb: 'AMFI now publishes a daily NAV for these schemes.' },
]

const catSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

function Fact({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className="truncate text-sm text-fg" title={value}>{value}</dd>
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
              <li key={f.code} className="flex items-baseline justify-between gap-3 text-sm">
                <Link to={`/fund/${f.code}/${fundSlug(f.name)}`} className="min-w-0 truncate text-brand-600 hover:underline dark:text-brand-400">{f.name}</Link>
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
  const when =
    status === 'upcoming' ? `Opens ${fmtDate(n.launchDate)}`
      : status === 'trading' && n.nav ? `NAV ₹${n.nav.value.toFixed(4)} on ${fmtDate(n.nav.date)}`
        : n.closeDate ? `${fmtDate(n.launchDate)} to ${fmtDate(n.closeDate)}`
          : `Opened ${fmtDate(n.launchDate)}`
  return (
    <article className="card p-4" data-testid="nfo-card" data-code={n.code}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-fg">{n.name}</h3>
          <div className="text-xs text-faint">{n.amc}</div>
        </div>
        <span className={`pill shrink-0 ${color.bg} ${color.text}`}>{listed?.categoryDisplay ?? n.category.replace('-', ' - ')}</span>
      </div>
      <div className="mt-2 text-sm font-medium text-fg" data-testid="nfo-when">{when}</div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
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
        Source: AMFI scheme master and daily NAV file, updated each weekday ({fmtDate(nfoData.generatedAt)}). Benchmark, manager and exit load come from the scheme's
        Groww page, used only when its AMFI code matches. Check the scheme information document before investing.
      </p>
    </div>
  )
}
