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

      <Section title="Fix 4: Authoritative universe (no silent misses)">
        <p>
          Deciding <em>which</em> funds to include matters as much as how we rank them. Early versions
          guessed each fund’s category from keywords in its name — which silently dropped any fund whose
          name didn’t match a hard-coded list (we found ~200 equity funds missing, and ~140 debt/income
          funds wrongly included).
        </p>
        <p className="mt-2">
          We now build the universe from <strong>AMFI’s own published scheme category</strong> for every
          fund, validated against the official taxonomy. If AMFI classifies it as an equity, index, or
          overseas-equity fund and it’s an active Direct-Growth plan, it’s in — no name-guessing, no
          silent gaps.
        </p>
      </Section>

      <Section title="Forward-looking signals (v3)">
        <p>
          Most fund sites are a rear-view mirror — trailing returns and a single point-in-time rank.
          We added a layer of <strong>forward-looking, probabilistic signals</strong>, all computed
          from the same daily NAV. Every one is framed as evidence or confidence — never a guarantee.
        </p>
        <ul className="ml-5 mt-2 list-disc space-y-1.5">
          <li><strong>Form (rank trajectory)</strong> — the fund's within-category rank recomputed over rolling 3-year windows, stepped monthly. "Climbing/Fading/Steady" if its category percentile moved more than ±5 points vs the prior window.</li>
          <li><strong>Consistency (batting average)</strong> — the % of rolling 36-month windows (1-month steps) in which the fund's annualized return beat its category median. The category median each window uses only peers with full data for that window. We flag "Limited evidence" below 24 windows.</li>
          <li><strong>Skill vs luck</strong> — a one-sided t-test on the fund's monthly excess returns vs its category median: t = mean(excess) / (std(excess)/√n). We convert it to a confidence %; below 95% we say "Could be luck." Needs ≥36 monthly periods. Caveat: assumes excess returns are roughly independent — autocorrelation can overstate confidence.</li>
          <li><strong>Up / down capture</strong> — over months the category rose, the fund's cumulative return ÷ the category's (up-capture); same over down months (down-capture). Below 100 on down-capture = better downside protection.</li>
          <li><strong>Running hot / cold</strong> — the z-score of the fund's most recent 1-year return against the distribution of its own rolling 1-year returns. Above +1 = "hot" (reversion risk), below −1 = "cold." A probabilistic caution, not a certainty.</li>
          <li><strong>Range of outcomes</strong> — the spread of annualized returns an investor entering at any historical point and holding 1/3/5/10 years would have earned (min, median, max, % of windows negative).</li>
          <li><strong>Worst fall &amp; recovery</strong> — the deepest peak-to-trough drawdown and how long it took to climb back (or "still recovering").</li>
          <li><strong>Modeled outcome range</strong> — a block-bootstrap Monte-Carlo (6-month blocks, 10,000 runs, fixed random seed for reproducibility) over the fund's monthly returns, showing 10th/50th/90th-percentile growth of a fixed investment over your chosen horizon. Requires ≥36 months. Explicitly a model that assumes the future resembles the past — which it may not.</li>
          <li><strong>Regime performance</strong> — the fund's return and peer-relative alpha in fixed historical regimes (COVID crash Feb–Mar 2020; recovery to Oct 2021; 2022 correction; 2022–24 bull; recent since Sep 2024). A fixed classification, not a prediction of future regimes.</li>
        </ul>
        <p className="mt-2">
          Cross-fund signals (form, consistency, capture, skill, running-hot, regimes) are precomputed
          at build time from self-hosted NAV; the range-of-outcomes, recovery, and modeled-cone are
          computed live in your browser from the same NAV. Nothing depends on a third-party API at view
          time, so these work even if the live NAV feed is down. All are backward-derived estimates of
          forward behavior — <strong>not advice, not guarantees</strong>.
        </p>
      </Section>

      <Section title="Management quality (forward-looking)">
        <p>
          Past returns are backward-looking. To add a <strong>forward-looking</strong> lens, every
          fund page shows a <strong>Management quality</strong> read based on the people running the
          money — their <strong>tenure</strong> on the fund and, more importantly, their{' '}
          <strong>track record across the other funds they manage</strong>.
        </p>
        <p className="mt-2">
          The logic: if a manager has beaten peers across several <em>different</em> funds, that's
          evidence of repeatable skill — not just one lucky fund. We compute the median peer-relative
          alpha and the share of their funds that beat their category, then label it{' '}
          <strong>Strong / Solid / Mixed</strong>. When a manager runs too few funds to judge fairly,
          we say <strong>Limited evidence</strong> rather than pretend. It's deliberately one input
          among many — weigh it alongside the performance and risk metrics, not on its own.
        </p>
      </Section>

      <Section title="Portfolio holdings & overlap">
        <p>
          Each fund page shows its latest disclosed <strong>portfolio holdings</strong> (top positions
          and their weight), and the Compare page computes <strong>holdings overlap</strong> between
          funds — so you can spot when two funds you hold are really buying the same stocks (less
          diversification than it looks).
        </p>
        <p className="mt-2">
          Holdings come from the most recent monthly portfolio disclosure. For funds-of-funds we use
          look-through to the underlying stocks where the disclosure supports it. Some overseas feeder
          funds invest into a single foreign fund and don’t disclose stock-level holdings — we label
          those honestly as “not available” rather than show misleading data. Where we can’t confidently
          match a fund to its disclosed portfolio, we withhold holdings rather than risk showing the
          wrong fund’s stocks.
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
          The fund universe and category for every scheme come from AMFI’s published classification.
          Base metrics are computed from daily NAV data published by AMFI (via the public mfapi.in
          endpoint), covering all active equity Direct-Growth plans. NAV charts on fund pages are
          fetched live. Portfolio holdings are from the latest monthly disclosure. Base analysis
          snapshot: <strong>{data.anchor}</strong>.
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
