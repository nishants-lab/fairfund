import { data } from "../lib/data"
import { usePageMeta } from "../lib/usePageMeta"
import { REGIMES } from "../lib/regimes"

export default function Methodology() {
  usePageMeta(
    "How FairFund Works",
    "How FairFund calculates returns, compares funds within categories and handles data limitations."
  )
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold text-fg">How FairFund works</h1>
      <p className="mt-2 max-w-prose text-muted leading-relaxed">
        FairFund compares mutual funds within their categories using NAV history and published portfolio data.
        This page explains the calculations, ranking rules and data limitations for the {data.totalFunds} funds we cover.
      </p>

      {/* TL;DR box */}
      <div className="mt-5 card border-l-4 border-l-accent p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-lg">📋</div>
          <div className="font-bold text-fg">The short version</div>
        </div>
        <p className="text-muted leading-relaxed text-sm">
          Compare funds within their categories, review returns and risk over available history, and examine
          performance during {REGIMES.length} defined market phases. Rolling-history statistics, selected-range
          metrics and monthly disclosures use different reporting periods.
        </p>
      </div>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 1: The fair ranking</h2>

      <Section title="Why the period matters">
        <p>
          Returns measured over different periods include different market conditions. A since-launch return can
          therefore give a different picture from a trailing 3-year return. Check the dates and available history
          before comparing results.
        </p>
      </Section>

      <Section title="Available history and horizons">
        <p>
          Fixed 1-year, 3-year and 5-year rankings require full calendar-year history and identical observed start and end dates within each category and horizon. A shared observation up to seven calendar days before an anniversary or snapshot anchor accommodates non-trading dates. Funds missing these endpoints remain browsable without that ranking. Interior gaps may still exist in source history.
        </p>
      </Section>

      <Section title="Category comparisons">
        <p>
          Rankings compare funds within the same category. Categories can differ substantially in risk and investment
          strategy, so their ranks should be read separately.
        </p>
      </Section>

      <Section title="Return above or below the category median">
        <p>
          Peer-relative alpha describes a fund's return difference against its category comparison.
          Fixed-horizon figures and selected-range calculations can use different available observations and
          category baselines. These differences do not establish the cause of outperformance or a manager's ability.
        </p>
      </Section>

      <Section title="NAV source checks">
        <p>Consecutive NAV changes of 50% or more, invalid NAV values or out-of-order dates trigger source verification. Returns, rankings and NAV-based analytics are withheld for affected funds. Raw observations are retained without inferred rescaling. This conservative check can flag genuine corporate actions and does not establish that a source is wrong.</p>
      </Section>
      <Section title="Fund coverage">
        <p>
          Which funds to include matters as much as how we rank them. We build the universe from
          <strong> AMFI's published scheme category</strong> for every fund, validated against
          the official taxonomy. If AMFI classifies it as an equity or eligible debt scheme (liquid, money market) and it is an active Direct-Growth
          plan, it is eligible for coverage. Data availability can limit inclusion.
        </p>
        <p className="mt-2">
          <strong>Liquid, money market and arbitrage funds</strong> use separate peer-set scores based on cost,
          returns and AUM. Liquid and money market scores use 70% cost, 20% AUM and 10% return; arbitrage uses 45%, 20% and 35%. Rankings and fund-page summaries share these rules, using the same selected horizon for all peers. Missing cost or AUM receives neutral points. These weights are product choices, not proven optimal models.
        </p>
      </Section>

      <Section title="Ranking score">
        <p>
          The equity ranking score combines within-category percentile ranks for Sharpe, Sortino, Calmar,
          drawdown protection, peer-relative alpha and CAGR using a geometric mean. Each metric has equal weight.
          A low percentile in one metric reduces the combined score.
        </p>
        <p className="mt-2">
          This ranking score is separate from the weighted equity fund-page composite score described below.
          Debt and arbitrage funds use their own peer-set models. Some rate-sensitive and credit-sensitive categories
          are unscored because duration, yield-to-maturity and credit-quality data are unavailable.
        </p>
      </Section>

      <Section title="The metrics">
        <ul className="ml-5 list-disc space-y-1.5">
          <li><strong>CAGR</strong>: annualized return. Absolute return is the cumulative point-to-point return.</li>
          <li><strong>Alpha vs peers</strong>: return difference against the category comparison for the stated calculation.</li>
          <li><strong>Sharpe / Sortino</strong>: return per unit of total / downside risk. Sortino uses annualised return above the 7% target divided by annualised RMS shortfalls below the daily target, averaged over all daily observations. It is unavailable when downside deviation is zero.</li>
          <li><strong>Calmar</strong>: return relative to the worst drawdown.</li>
          <li><strong>Max drawdown</strong>: the worst peak-to-trough fall (shallower is better).</li>
          <li><strong>Volatility</strong>: annualized standard deviation of daily returns.</li>
        </ul>
        <p className="mt-2 text-sm text-faint">
          On each fund page, ratios and volatility are shown on a <strong>spectrum bar</strong> spanning
          the category's real range, with markers for this fund, the median, and the best peer.
        </p>
      </Section>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 2: Performance history and scenarios</h2>
      <p className="mt-2 max-w-prose text-muted leading-relaxed">
        These analyses describe past returns across different periods and market conditions. Simulations reuse
        past monthly returns to illustrate outcomes under a specified model.
      </p>

      <Section title="Consistency">
        <p>
          The share of measured rolling 36-month periods in which the fund beat its category median.
          Endpoints move forward one month at a time. The periods overlap, so the observations are related.
          A higher value means the fund beat its category median more often in this history.
          The current limited-history threshold is 24 rolling periods.
        </p>
      </Section>

      <Section title="Monthly excess-return test">
        <p>
          A one-sided t-test tests whether the fund's average monthly return above its category median is positive.
          It requires at least 36 paired monthly returns and non-zero variation in excess returns.
          The fund page shows the existing t-statistic and sample count. Raw p-values and observation dates are
          unavailable in the current dataset; we do not recover a p-value from the rounded score input.
        </p>
        <p className="mt-2">
          A p-value measures how unusual a test statistic at least this large would be if the true mean monthly
          excess return were zero, under the test's assumptions. It does not measure the probability of manager
          skill or future outperformance. The test assumes independent monthly observations and does not adjust
          for testing many funds.
        </p>
      </Section>

      <Section title="Rank trajectory">
        <p>
          The fund's within-category rank recomputed on a rolling 3-year basis, one step per month.
          "Climbing / Fading / Steady" based on whether its percentile moved more than ±5 points.
        </p>
      </Section>

      <Section title="Up / down capture">
        <p>
          In months the category rose, the fund's cumulative return divided by the category's
          (up-capture); same for down months (down-capture). Returns are compounded within each group.
          Below 100% down-capture indicates a smaller compounded loss over those down months.
        </p>
      </Section>

      <Section title="Recent return versus history">
        <p>
          The z-score compares the fund's most recent 1-year return with its own rolling 1-year history.
          Positive values indicate returns above the historical average; negative values indicate returns below it.
          Future returns may differ.
        </p>
      </Section>

      <Section title={`Regime stress test (${REGIMES.length} market phases)`}>
        <p>
          How did the fund perform during real market events? We define {REGIMES.length} fixed regimes and show
          each fund's return during each:
        </p>
        <ul className="ml-5 mt-2 list-disc space-y-1 text-sm">
          {REGIMES.map((r) => {
            const s = new Date(r.start), e = new Date(r.end)
            const mon = (d: Date) => d.toLocaleDateString("en-IN", { month: "short" })
            const range =
              s.getFullYear() === e.getFullYear()
                ? mon(s) === mon(e)
                  ? `${mon(s)} ${e.getFullYear()}`
                  : `${mon(s)}-${mon(e)} ${e.getFullYear()}`
                : `${mon(s)} ${s.getFullYear()} - ${mon(e)} ${e.getFullYear()}`
            const color =
              r.market === "down"
                ? "text-rose-600 dark:text-rose-400"
                : r.market === "up"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            return (
              <li key={r.name}>
                <span className={color}>{r.name}</span> ({range})
              </li>
            )
          })}
        </ul>
        <p className="mt-2">
          You can compare any fund against another using the "+ Compare" picker. The better performer
          in each regime is highlighted green. These comparisons describe results during the defined events.
        </p>
      </Section>

      <Section title="Worst fall and recovery">
        <p>
          The deepest peak-to-trough drawdown across the fund's full history, recovery time, and
          comparison against the category's 3-year median drawdown. The periods differ, so these figures are
          historical context rather than a matched-period comparison.
        </p>
      </Section>

      <Section title="Modeled outcome range">
        <p>
          A block-bootstrap Monte Carlo simulation (10,000 runs, 6-month blocks) models the range of
          possible outcomes for a lumpsum or SIP investment over 1-10 years. Reports the 10th, 50th,
          and 90th percentile. These are simulated outcomes under the stated assumptions. Actual returns can fall outside the displayed range.
        </p>
      </Section>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 3: Management, holdings, and verdict</h2>

      <Section title="Manager record">
        <p>
          We summarize the results of covered funds run by these managers, including return differences against
          each fund's category median. Other funds are used where coverage permits. Funds managed by the same
          team can share holdings and investment styles, so their results are related.
        </p>
      </Section>

      <Section title="Portfolio holdings and overlap">
        <p>
          Each fund page shows its latest disclosed top holdings. The Compare page computes holdings
          overlap so you can spot when two funds you hold are buying the same stocks. For fund-of-funds,
          we use look-through where disclosure supports it.
        </p>
      </Section>

      <Section title="Fund-page composite score">
        <p>
          The equity fund-page composite score (0-100) uses category rank (25%), peer-relative alpha (20.45%),
          Sharpe (13.64%), consistency (18.18%), downside capture (11.36%) and manager record (11.36%).
          Displayed weights are rounded; the calculation divides the original six weights
          (22, 18, 12, 16, 10 and 10) by their total of 88. Missing inputs and limited consistency history
          use neutral points. The monthly excess-return test is excluded from this score;
          its statistic is not a probability of manager skill.
        </p>
        <p className="mt-2">
          Reasons describe inputs that raised or lowered the score. The recent-return note is not scored.
          This is a summary of historical metrics, not an investment recommendation.
        </p>
      </Section>

      <Section title="Chart benchmarks: index, peer, and category median">
        <p>
          The NAV Growth chart overlays a dashed comparison line, rebased with your fund to a common
          start of 100 to compare relative growth. Available benchmarks depend on the fund and can be
          selected above the chart.
        </p>
        <ul className="ml-5 mt-2 list-disc space-y-1.5">
          <li>
            <strong>Benchmark index</strong> (broad-market equity: Large, Mid, Small, Large &amp; Mid,
            Flexi, Multi Cap and ELSS). We use a low-cost passive index fund (Direct-Growth)
            as a proxy for the category index: Nifty 100 for Large Cap, Nifty Midcap
            150 for Mid Cap, Nifty Smallcap 250 for Small Cap, Nifty LargeMidcap 250 for Large &amp; Mid,
            and Nifty 500 for Flexi, Multi Cap and ELSS. Multi Cap uses Nifty 500 as a deep-history
            broad-market stand-in because the exact Nifty 500 Multicap 50:25:25 index fund is still too
            new for a meaningful chart.
          </li>
          <li>
            <strong>Category median</strong> (cash-like categories: Liquid, Money Market, Arbitrage).
            These cluster too tightly for an index to add signal, so the line is the typical fund in the
            category: the median of every constituent fund's daily return, chained into one continuous
            growth curve. Young funds join the median the day they have data, and no single fund's price
            level distorts it. This is the default line for these categories; you can still switch to the
            category leader.
          </li>
          <li>
            <strong>Category leader / top peer</strong> (everything else, and always available as a base).
            The category's rank-1 fund by 3-year risk-adjusted rank, or the next best if this fund is
            itself the leader. Used for sectoral / thematic, international and index funds where a
            suitable index proxy is unavailable.
          </li>
        </ul>
      </Section>

      <Section title="Known limitations">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>All of this is <strong>backward-derived</strong>. Past alpha does not guarantee future results.</li>
          <li>Benchmark-index lines use a passive <strong>index-fund proxy</strong>, not the raw index, and only for broad-market equity categories with enough index-fund history; cash-like categories fall back to a category median and sectoral / international funds to the category leader.</li>
          <li>Funds that closed or merged are not in our active set (survivorship bias).</li>
          <li>We do not model forward catalysts: valuations, manager changes, or fund flows.</li>
          <li>The monthly t-test assumes independent observations and does not adjust for testing many funds. Simulations reuse the past return distribution, which may not represent future returns.</li>
        </ul>
      </Section>

      <Section title="Data source and freshness">
        <p>
          Fund universe and categories from AMFI's published classification. Metrics computed from
          daily NAV published by AMFI (via mfapi.in). NAV charts fetched live. Holdings from the latest
          monthly disclosure. Historical analytics (regime returns, monthly tests, capture ratios) recomputed from
          self-hosted NAV cache. The footer shows the actual latest NAV date.
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
      <h3 className="text-lg font-bold text-fg">{title}</h3>
      <div className="mt-2 max-w-prose text-muted leading-relaxed">{children}</div>
    </section>
  )
}