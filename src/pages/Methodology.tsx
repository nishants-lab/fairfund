import { data } from '../lib/data'
import MethodologySummary from '../components/MethodologySummary'

export default function Methodology() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Our Methodology</h1>
      <p className="mt-2 text-muted">
        Most fund screeners have a hidden flaw that makes their rankings misleading. We built FairFund
        to fix it. Here’s exactly how we analyze {data.totalFunds} active equity funds — no black box.
      </p>

      <div className="mt-5">
        <MethodologySummary />
      </div>

      <Section title="Analyze any time period (live)">
        <p>
          Beyond our fixed-window rankings, every fund page lets you compute all metrics over{' '}
          <strong>any date range you choose</strong> — the last 6 months, a specific calendar year, or
          a custom window you drag to. We fetch the fund’s full daily NAV history and recompute CAGR,
          Sharpe, drawdown, volatility and more <em>in your browser</em>, instantly. Want to see how a
          fund did between two specific dates, excluding a month that distorts the picture? You can.
          No other free Indian MF tool offers this.
        </p>
      </Section>

      <Section title="The problem with most fund rankings">
        <p>
          Popular sites rank funds by their returns since <em>their own</em> inception. But funds launch
          at different times. A fund that started at a market bottom (say, March 2020) will show
          spectacular returns and tiny drawdowns — not because it’s well-managed, but because its
          measurement window conveniently skips the bad years.
        </p>
        <p className="mt-2">
          Comparing a fund measured over 2020–2026 against one measured over 2015–2026 is comparing
          apples to oranges. Yet that’s exactly what most rankings do.
        </p>
      </Section>

      <Section title="Fix 1: Identical time windows">
        <p>
          We measure <strong>every fund over the exact same calendar dates</strong>: trailing 1-year,
          3-year, and 5-year windows ending {data.anchor}. A fund must have complete data for a window
          to be ranked in it. Same start, same end, same market conditions — for everyone.
        </p>
      </Section>

      <Section title="Fix 2: Within-category ranking only">
        <p>
          We never rank a small-cap fund against a large-cap fund. Small-caps <em>should</em> return
          more because they carry more risk — ranking them together just tells you which asset class
          was hot, not which fund was well-managed. You choose the risk level that suits you; we find
          the best fund inside it.
        </p>
      </Section>

      <Section title="Fix 3: Peer-relative alpha (the skill test)">
        <p>
          The headline number on every fund page is <strong>Alpha vs peers</strong> — how much the
          fund beat (or trailed) the <em>median fund in its own category</em>, per year, over the same
          window. This separates genuine manager skill from simply riding a rising tide.
        </p>
        <p className="mt-2">
          A mid-cap fund returning 22% sounds great — but if the median mid-cap fund returned 25%, it
          actually <em>underperformed</em>. Alpha catches that. Positive alpha = real outperformance.
        </p>
      </Section>

      <Section title="The metrics we use">
        <ul className="ml-5 list-disc space-y-1.5">
          <li><strong>CAGR</strong> — annualized return over the window.</li>
          <li><strong>Alpha vs peers</strong> — excess CAGR over the category median.</li>
          <li><strong>Sharpe ratio</strong> — return per unit of total risk (volatility).</li>
          <li><strong>Sortino ratio</strong> — like Sharpe, but only penalizes <em>downside</em> moves.</li>
          <li><strong>Max drawdown</strong> — the worst peak-to-trough fall in the window.</li>
          <li><strong>Calmar ratio</strong> — return relative to that worst drawdown.</li>
          <li><strong>Volatility</strong> — annualized standard deviation of daily returns.</li>
        </ul>
      </Section>

      <Section title="The composite score">
        <p>
          Each fund’s within-category score is the <strong>geometric mean of its percentile ranks</strong>
          across Sharpe, Sortino, Calmar, drawdown protection, alpha, and CAGR. We use the geometric
          mean (not a simple average) so a fund can’t hide a terrible weakness behind one strong number
          — being awful on any single dimension drags the whole score down.
        </p>
        <p className="mt-2">
          Crucially, there are <strong>no arbitrary weights</strong> like “momentum = 30%.” Every
          metric contributes equally through its rank, so we’re not secretly tilting the results toward
          our own opinions.
        </p>
      </Section>

      <Section title="Honest limitations">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>This is <strong>backward-looking</strong>. Past alpha doesn’t guarantee future alpha.</li>
          <li>The 3-year window spans a strong bull market, so most funds look good there. Trust the 5-year window (which includes 2022’s correction) more.</li>
          <li>We benchmark against the <strong>peer median</strong>, not the official index, because index-fund history in India is often too short for a clean 5-year comparison.</li>
          <li>Funds that closed or merged aren’t in our active set (survivorship bias — common to all such analyses).</li>
          <li>We don’t model forward catalysts — valuations, fund manager changes, or fund flows.</li>
        </ul>
      </Section>

      <Section title="Data source & freshness">
        <p>
          Base metrics are computed from daily NAV data published by AMFI (via the public mfapi.in
          endpoint), covering all active equity Direct-Growth plans. NAV charts on fund pages are
          fetched live. Base analysis snapshot: <strong>{data.anchor}</strong>.
        </p>
      </Section>

      <div className="mt-8 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        <strong>Not investment advice.</strong> FairFund is an educational research tool. We are not
        SEBI-registered investment advisers. Consult a qualified financial professional before making
        any investment decision.
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      <div className="mt-2 text-muted leading-relaxed">{children}</div>
    </section>
  )
}
