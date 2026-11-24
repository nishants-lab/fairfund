import { Link } from 'react-router-dom'
import summary from '../data/holdings_summary.json'
import { crore, croreShort, monthLabel, monthName } from '../lib/holdingsReport'
import { displayStockName } from '../lib/stockNames'

interface Pick { key: string; name: string; net: number; added: number; cut: number; new: number; exited: number }
interface Summary {
  lead: string | null
  coverage?: { funds: number; of: number; complete: boolean }
  totals?: { net: number; funds: number; houses: number }
  buys?: Pick[]
  sells?: Pick[]
  trend?: [string, number, boolean][]
}

/** Home page band: this month's estimated fund buying, from holdings_summary.json. */
export default function FundBuyingBand() {
  const s = summary as unknown as Summary
  if (!s.lead || !s.totals || !s.buys?.length) return null
  const trend = s.trend ?? []
  const max = Math.max(1, ...trend.map(t => Math.abs(t[1])))
  const row = (p: Pick, sell: boolean) => (
    <li key={p.key} className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0 truncate">{displayStockName(p.key, p.name)}</span>
      <span className={`shrink-0 font-semibold tabular-nums ${sell ? 'text-rose-300 dark:text-rose-400' : 'text-emerald-300 dark:text-emerald-400'}`}>{croreShort(p.net, true)}</span>
    </li>
  )
  return (
    <section className="band border-y border-line" aria-labelledby="fund-buying-title">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:gap-14">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-widest opacity-70">Fund buying · {monthLabel(s.lead)}</p>
          <h2 id="fund-buying-title" className="mt-3 font-display text-3xl font-semibold leading-tight sm:text-4xl">
            Funds bought an estimated <span className="whitespace-nowrap text-emerald-300 dark:text-emerald-400">{crore(s.totals.net)}</span> of shares in {monthName(s.lead)}.
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed opacity-80">What {s.totals.funds.toLocaleString('en-IN')} funds bought and sold, by stock, sector, category and fund house, from their monthly portfolios.</p>
          {trend.length > 1 && (
            <div className="mt-5 flex h-12 items-end gap-1.5" aria-hidden="true">
              {trend.map(([m, v, done]) => (
                <span key={m} className="flex w-7 flex-col items-center gap-1">
                  <span className={`w-full rounded-t-sm ${m === s.lead ? 'bg-emerald-300 dark:bg-emerald-400' : 'bg-[rgb(var(--band-fg)/0.3)]'} ${done ? '' : 'opacity-50'}`} style={{ height: `${Math.max(6, (Math.abs(v) / max) * 36)}px` }} />
                  <span className="text-[10px] leading-none opacity-60">{monthLabel(m, false).slice(0, 1)}</span>
                </span>
              ))}
            </div>
          )}
          <Link to="/fund-buying" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[rgb(var(--band-fg))] px-4 py-2 text-sm font-semibold text-[rgb(var(--band-bg))] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--band-fg))]">
            Read the {monthName(s.lead)} report <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="grid gap-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-60">Most bought</p>
            <ol className="mt-1 divide-y divide-[rgb(var(--band-fg)/0.15)]">{s.buys.map(p => row(p, false))}</ol>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-60">Most sold</p>
            <ol className="mt-1 divide-y divide-[rgb(var(--band-fg)/0.15)]">{(s.sells ?? []).map(p => row(p, true))}</ol>
          </div>
        </div>
      </div>
    </section>
  )
}
