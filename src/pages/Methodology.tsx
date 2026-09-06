import { data } from "../lib/data"
import { usePageMeta } from "../lib/usePageMeta"

export default function Methodology() {
  usePageMeta(
    "How FairFund Works",
    "How FairFund ranks mutual funds: identical time windows, within-category comparison, peer-relative alpha, forward-looking signals, and regime stress testing."
  )
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold text-fg">How FairFund works</h1>
      <p className="mt-2 max-w-prose text-muted leading-relaxed">
        Most fund screeners rank funds in a way that quietly flatters them. FairFund is built to
        avoid that. This page explains the full method, in plain terms, for the {data.totalFunds} active
        funds we cover.
      </p>

      {/* TL;DR box */}
      <div className="mt-5 card border-l-4 border-l-accent p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-lg">📋</div>
          <div className="font-bold text-fg">The short version</div>
        </div>
        <p className="text-muted leading-relaxed text-sm">
          We check every fund over the exact same dates, only compare it to similar funds (small-cap vs
          small-cap, never small-cap vs large-cap), and measure whether the manager genuinely did better
          than the average fund of its type. On top of that, we stress-test each fund across 10 real market
          regimes (crashes, rallies, wars) and compute forward-looking probability signals. The goal: show
          you the data-backed picture, not a flattering one.
        </p>
      </div>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 1: The fair ranking</h2>

      <Section title="The problem with most rankings">
        <p>
          Popular sites rank funds by their returns since <em>their own</em> inception. But funds
          launch at different times. A fund that started at a market bottom (March 2020) shows
          spectacular returns not because it is well-managed, but because its measurement window
          skips the bad years. Comparing a fund measured over 2020-2026 against one measured over
          2015-2026 is apples to oranges.
        </p>
      </Section>

      <Section title="Fix 1: Identical time windows">
        <p>
          We measure <strong>every fund over the exact same calendar dates</strong>: trailing 1-year,
          3-year, and 5-year windows. A fund must have complete data for a window to be ranked in it.
          Same start, same end, same market conditions, for everyone.
        </p>
      </Section>

      <Section title="Fix 2: Within-category ranking only">
        <p>
          We never rank a small-cap fund against a large-cap fund. Small-caps <em>should</em> return
          more because they carry more risk; ranking them together just tells you which asset class
          was hot, not which fund was well-managed. You choose the risk level; we find the best fund
          inside it.
        </p>
      </Section>

      <Section title="Fix 3: Peer-relative alpha">
        <p>
          A key number on every fund page: how much the fund beat (or trailed) the <em>median fund
          in its own category</em>, per year, over the same window. A mid-cap returning 22% sounds
          great, but if the median mid-cap returned 25%, it actually underperformed. Positive alpha
          is real outperformance, not just riding a rising tide.
        </p>
      </Section>

      <Section title="Fix 4: Authoritative universe">
        <p>
          Which funds to include matters as much as how we rank them. We build the universe from
          <strong> AMFI's published scheme category</strong> for every fund, validated against
          the official taxonomy. If AMFI classifies it as an equity or eligible debt scheme (liquid, money market) and it is an active Direct-Growth
          plan, it is in. No silent misses.
        </p>
        <p className="mt-2">
          <strong>Liquid, money market and arbitrage funds</strong> are scored using a separate,
          category-appropriate model. Equity signals (Sharpe, alpha, drawdown, forward analytics) are
          hidden because they are not meaningful for cash-equivalent or fully-hedged portfolios. Instead,
          we rank within the SEBI sub-category peer set on three factors: expense ratio (45%),
          return-vs-peers (35%), and AUM as a stability proxy (20%). Arbitrage uses equal 40/40/20
          weights. The rank label always names the peer set so nothing looks cross-comparable (a liquid
          fund is never ranked against a gilt fund).
        </p>
      </Section>

      <Section title="The composite score">
        <p>
          For equity funds, each fund's within-category score is the <strong>geometric mean of its percentile
          ranks</strong> across Sharpe, Sortino, Calmar, drawdown protection, alpha, and CAGR. The geometric mean
          (not a simple average) means a fund cannot hide a terrible weakness behind one strong number. There
          are <strong>no arbitrary weights</strong>: every metric contributes equally through its rank.
        </p>
        <p className="mt-2">
          For <strong>Tier 1 debt and arbitrage funds</strong> (liquid, overnight, money market, ultra-short
          duration), the equity composite would be noise. A separate cost-and-return model ranks each fund
          within its own SEBI sub-category: <strong>expense ratio (45%)</strong>,{' '}
          <strong>return-vs-category-median (35%)</strong>, and <strong>AUM (20%)</strong>. Rate-sensitive
          and credit-sensitive categories (gilt, credit risk, long/medium duration, dynamic bond) are not
          scored at all. Duration and YTM drive their returns and we do not have that data; we surface what
          we have and point to the AMC factsheet.
        </p>
      </Section>

      <Section title="The metrics">
        <ul className="ml-5 list-disc space-y-1.5">
          <li><strong>CAGR</strong>: annualized return. Absolute return is the cumulative point-to-point return.</li>
          <li><strong>Alpha vs peers</strong>: excess CAGR over the category median.</li>
          <li><strong>Sharpe / Sortino</strong>: return per unit of total / downside risk. Above 1 is strong.</li>
          <li><strong>Calmar</strong>: return relative to the worst drawdown.</li>
          <li><strong>Max drawdown</strong>: the worst peak-to-trough fall (shallower is better).</li>
          <li><strong>Volatility</strong>: annualized standard deviation of daily returns.</li>
        </ul>
        <p className="mt-2 text-sm text-faint">
          On each fund page, ratios and volatility are shown on a <strong>spectrum bar</strong> spanning
          the category's real range, with markers for this fund, the median, and the best peer.
        </p>
      </Section>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 2: Forward-looking signals</h2>
      <p className="mt-2 max-w-prose text-muted leading-relaxed">
        Trailing returns are a rear-view mirror. These signals estimate how repeatable and sustainable
        a fund's edge looks. Every signal is based on actual history, confidence, or probability.
      </p>

      <Section title="Consistency (batting average)">
        <p>
          The share of rolling 36-month windows in which the fund beat its category median.
          72% means it outperformed in 72 of every 100 such windows. Higher = more repeatable skill.
        </p>
      </Section>

      <Section title="Skill vs luck">
        <p>
          A one-sided t-test on the fund's monthly excess returns over its category median,
          converted to a confidence %. We only call it skill above <strong>90%</strong>. Below that,
          we say so plainly (e.g., "70% chance its edge is luck"). Needs at least 36 months of data.
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
          (up-capture); same for down months (down-capture). Below 100% on down-capture = better
          downside protection.
        </p>
      </Section>

      <Section title="Running hot or cold">
        <p>
          The z-score of the fund's most recent 1-year return against its own rolling 1-year history.
          Above +1 = "hot" (reversion risk), below -1 = "cold". A caution against chasing, not a prediction.
        </p>
      </Section>

      <Section title="Regime stress test (10 market phases)">
        <p>
          How did the fund perform during real market events? We define 10 fixed regimes and show
          each fund's return during each:
        </p>
        <ul className="ml-5 mt-2 list-disc space-y-1 text-sm">
          <li><span className="text-rose-600 dark:text-rose-400">COVID crash</span> (Feb-Mar 2020)</li>
          <li><span className="text-emerald-600 dark:text-emerald-400">COVID recovery</span> (Apr 2020 - Oct 2021)</li>
          <li><span className="text-rose-600 dark:text-rose-400">2022 correction</span> (Jan-Jun 2022)</li>
          <li><span className="text-emerald-600 dark:text-emerald-400">2022-24 bull run</span> (Jul 2022 - Sep 2024)</li>
          <li><span className="text-rose-600 dark:text-rose-400">2024-25 correction</span> (Oct 2024 - Mar 2025)</li>
          <li><span className="text-rose-600 dark:text-rose-400">Liberation Day tariff shock</span> (Apr 2025)</li>
          <li><span className="text-emerald-600 dark:text-emerald-400">Tariff-pause recovery</span> (May 2025)</li>
          <li><span className="text-emerald-600 dark:text-emerald-400">H2 2025 rally</span> (Jun-Nov 2025)</li>
          <li><span className="text-rose-600 dark:text-rose-400">US-Iran war</span> (Feb-Mar 2026)</li>
          <li><span className="text-emerald-600 dark:text-emerald-400">Post-war recovery</span> (Apr-Jun 2026)</li>
        </ul>
        <p className="mt-2">
          You can compare any fund against another using the "+ Compare" picker. The better performer
          in each regime is highlighted green. This reveals character: who protects in crashes and who
          leads in rallies.
        </p>
      </Section>

      <Section title="Worst fall and recovery">
        <p>
          The deepest peak-to-trough drawdown across the fund's full history, recovery time, and
          comparison against the category median. If the fund fell significantly more than peers (more
          than 1.2x the median drawdown), it is flagged as weak downside protection.
        </p>
      </Section>

      <Section title="Modeled outcome range">
        <p>
          A block-bootstrap Monte Carlo simulation (10,000 runs, 6-month blocks) models the range of
          possible outcomes for a lumpsum or SIP investment over 1-10 years. Reports the 10th, 50th,
          and 90th percentile. Assumes the future resembles the past, which it may not.
        </p>
      </Section>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 3: Management, holdings, and verdict</h2>

      <Section title="Management quality">
        <p>
          We assess the people running the money by their <strong>track record across the other funds
          they manage</strong>. If a manager beats peers across several different funds, that is evidence
          of repeatable skill. We compute median peer-relative alpha, win rate, and top-quartile rate
          across their portfolio.
        </p>
      </Section>

      <Section title="Portfolio holdings and overlap">
        <p>
          Each fund page shows its latest disclosed top holdings. The Compare page computes holdings
          overlap so you can spot when two funds you hold are buying the same stocks. For fund-of-funds,
          we use look-through where disclosure supports it.
        </p>
      </Section>

      <Section title="The overall verdict">
        <p>
          Each fund page ends with a <strong>conviction score (0-100)</strong> and label. It is a
          rule-based blend: within-category rank, alpha, and Sharpe (backward pillars) plus consistency,
          skill confidence, downside capture and management quality (forward pillars), with a momentum
          caution if the fund is running hot. The card lists what worked and what to watch.
          It is a weighted reading of the data, not a recommendation.
        </p>
      </Section>

      <Section title="Known limitations">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>All of this is <strong>backward-derived</strong>. Past alpha does not guarantee future results.</li>
          <li>We benchmark against the <strong>peer median</strong>, not the official index, because index-fund history in India is often too short for a clean 5-year comparison.</li>
          <li>Funds that closed or merged are not in our active set (survivorship bias).</li>
          <li>We do not model forward catalysts: valuations, manager changes, or fund flows.</li>
          <li>The skill t-test assumes independent monthly excess returns; the modeled cone assumes the past distribution repeats. Both are simplifications.</li>
        </ul>
      </Section>

      <Section title="Data source and freshness">
        <p>
          Fund universe and categories from AMFI's published classification. Metrics computed from
          daily NAV published by AMFI (via mfapi.in). NAV charts fetched live. Holdings from the latest
          monthly disclosure. Forward analytics (regime returns, skill, capture ratios) recomputed from
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