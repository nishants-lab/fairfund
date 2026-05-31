import { data } from '../lib/data'
import MethodologySummary from '../components/MethodologySummary'

export default function Methodology() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">How FairFund works</h1>
      <p className="mt-2 text-muted">
        Most fund screeners rank funds in a way that quietly flatters them. FairFund is built to
        avoid that. This page is the full method, in plain terms, for all {data.totalFunds} active
        equity funds we cover. No black box, no arbitrary weights.
      </p>

      <div className="mt-5">
        <MethodologySummary />
      </div>

      <Section title="What FairFund gives you that others don't">
        <ul className="ml-5 list-disc space-y-1.5">
          <li><strong>A fair, like-for-like ranking</strong> using identical time windows and within-category comparison (most sites rank on inception-to-date returns, which favours younger funds).</li>
          <li><strong>Analysis over any date range you pick</strong>, recomputed live in your browser from daily NAV.</li>
          <li><strong>Forward-looking, probability-based signals</strong> (consistency, skill-vs-luck, downside capture, momentum, a modeled outcome range) on top of the backward metrics.</li>
          <li><strong>An overall conviction verdict</strong> that fuses the backward and forward evidence into one transparent read, with the drivers spelled out.</li>
          <li><strong>Holdings and overlap</strong> so you can see what a fund actually owns and whether two funds duplicate each other.</li>
          <li><strong>Management quality</strong> judged by the managers' track record across their <em>other</em> funds.</li>
        </ul>
      </Section>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 1: The fair ranking (backward-tested)</h2>

      <Section title="The problem with most rankings">
        <p>
          Popular sites rank funds by their returns since <em>their own</em> inception. But funds
          launch at different times. A fund that started at a market bottom (say, March 2020) shows
          spectacular returns and small drawdowns, not because it is well-managed, but because its
          measurement window skips the bad years. Comparing a fund measured over 2020-2026 against
          one measured over 2015-2026 is apples to oranges.
        </p>
      </Section>

      <Section title="Fix 1: Identical time windows">
        <p>
          We measure <strong>every fund over the exact same calendar dates</strong>: trailing 1-year,
          3-year, and 5-year windows ending {data.anchor}. A fund must have complete data for a window
          to be ranked in it. Same start, same end, same market conditions, for everyone.
        </p>
      </Section>

      <Section title="Fix 2: Within-category ranking only">
        <p>
          We never rank a small-cap fund against a large-cap fund. Small-caps <em>should</em> return
          more because they carry more risk; ranking them together just tells you which asset class
          was hot, not which fund was well-managed. You choose the risk level that suits you, and we
          find the best fund inside it.
        </p>
      </Section>

      <Section title="Fix 3: Peer-relative alpha (the skill test)">
        <p>
          A key number on every fund page is <strong>alpha vs peers</strong>: how much the fund beat
          (or trailed) the <em>median fund in its own category</em>, per year, over the same window.
          A mid-cap returning 22% sounds great, but if the median mid-cap returned 25%, it actually
          underperformed. Alpha catches that. Positive alpha is real outperformance, not just riding
          a rising tide.
        </p>
      </Section>

      <Section title="Fix 4: Authoritative universe (no silent misses)">
        <p>
          Which funds to include matters as much as how we rank them. Earlier versions guessed each
          fund's category from keywords in its name, which silently dropped any fund whose name did
          not match a hard-coded list. We now build the universe from <strong>AMFI's own published
          scheme category</strong> for every fund, validated against the official taxonomy. If AMFI
          classifies it as an equity, index, or overseas-equity fund and it is an active Direct-Growth
          plan, it is in.
        </p>
      </Section>

      <Section title="The composite score">
        <p>
          Each fund's within-category score is the <strong>geometric mean of its percentile ranks</strong>
          across Sharpe, Sortino, Calmar, drawdown protection, alpha, and CAGR. The geometric mean (not
          a simple average) means a fund cannot hide a terrible weakness behind one strong number. There
          are <strong>no arbitrary weights</strong> like "momentum = 30%": every metric contributes
          equally through its rank.
        </p>
      </Section>

      <Section title="The metrics, briefly">
        <ul className="ml-5 list-disc space-y-1.5">
          <li><strong>CAGR</strong>: annualized (per-year) return. "Absolute return" is the cumulative point-to-point return over the whole window.</li>
          <li><strong>Alpha vs peers</strong>: excess CAGR over the category median.</li>
          <li><strong>Sharpe / Sortino</strong>: return per unit of total / downside risk. Above 1 is strong.</li>
          <li><strong>Calmar</strong>: return relative to the worst drawdown.</li>
          <li><strong>Max drawdown</strong>: the worst peak-to-trough fall in the window (always a loss; shallower is better).</li>
          <li><strong>Volatility</strong>: annualized standard deviation of daily returns. On fund pages we plot it on a spectrum against the category, with the median and the steadiest peer marked.</li>
        </ul>
        <p className="mt-2 text-sm text-faint">
          On each fund page, the risk-adjusted ratios and volatility are shown as a <strong>spectrum</strong>:
          the bar spans the category's real range, the "good" line (1.0 for ratios) sits at the centre,
          and markers show this fund, the category median and the category best, so a number always has
          peer context.
        </p>
      </Section>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 2: Forward-looking signals</h2>
      <p className="mt-2 text-muted leading-relaxed">
        Trailing returns are a rear-view mirror. These signals, all computed from the same daily NAV,
        estimate how repeatable and sustainable a fund's edge looks. Every one is framed as evidence,
        confidence, or probability, never a guarantee.
      </p>

      <Section title="Consistency (batting average)">
        <p>
          The share of rolling 36-month windows (stepped monthly) in which the fund's annualized return
          beat its category median. 72% means it finished in the better half in 72 of every 100 such
          windows. We flag "Limited evidence" below 24 windows. Higher means more repeatable skill, less
          luck.
        </p>
      </Section>

      <Section title="Skill vs luck">
        <p>
          A one-sided t-test on the fund's monthly excess returns over its category median:
          t = mean(excess) / (std(excess) / &radic;n), converted to a confidence %. We only call it
          skill above <strong>90%</strong>; when the read is weak we say so plainly (for example "70%
          chance its edge is just luck") rather than dress up a low number. Needs at least 36 monthly
          periods. Caveat: the test assumes excess returns are roughly independent; autocorrelation can
          overstate confidence.
        </p>
      </Section>

      <Section title="Rank trajectory">
        <p>
          The fund's within-category <strong>rank</strong> (as a percentile, 100 = top) recomputed on a
          rolling 3-year-return basis, one step per month. The chart is a rank chart, not a returns
          chart. "Climbing / Fading / Steady" if its percentile moved more than ±5 points versus the
          prior window. It can differ from the headline composite rank because this lens is raw return,
          while the headline is risk-adjusted.
        </p>
      </Section>

      <Section title="Up / down capture">
        <p>
          Over months the category rose, the fund's cumulative return divided by the category's
          (up-capture); the same over down months (down-capture). Below 100 on down-capture means better
          downside protection. Roughly 90% up / 70% down is the textbook sweet spot.
        </p>
      </Section>

      <Section title="Running hot or cold (mean reversion)">
        <p>
          The z-score of the fund's most recent 1-year return against its own history of rolling 1-year
          returns. Above +1 is "hot" (reversion risk after a strong run), below -1 is "cold". It compares
          the fund only to itself, and is a caution against chasing, not a prediction.
        </p>
      </Section>

      <Section title="What holds actually returned, and a modeled range">
        <p>
          For your chosen horizon (1/3/5/10 years) we show the spread of annualized returns an investor
          would have earned entering at any historical month and holding that long (worst, median, best,
          and the % of windows that lost money), with the dates of the worst and best windows.
        </p>
        <p className="mt-2">
          We then run a <strong>block-bootstrap Monte-Carlo</strong>: 10,000 simulations that re-shuffle
          the fund's monthly returns in 6-month blocks (a fixed random seed makes it reproducible) and
          report the 10th / 50th / 90th-percentile outcome. You can model a <strong>one-time lumpsum</strong>
          or a <strong>monthly SIP</strong> (₹5,000 to ₹3,00,000/month). It requires at least 36 months
          and explicitly assumes the future resembles the past, which it may not.
        </p>
      </Section>

      <Section title="Worst fall and recovery">
        <p>
          The deepest peak-to-trough drawdown across the fund's full history, the dates of that peak and
          trough, and how long it took to climb back to the prior peak (or "still recovering"). A shorter
          recovery means investors were made whole faster.
        </p>
      </Section>

      <Section title="Regime performance">
        <p>
          The fund's return and peer-relative alpha in five fixed historical phases: the COVID crash
          (Feb-Mar 2020), the recovery to Oct 2021, the 2022 correction, the 2022-24 bull run, and the
          recent phase since Sep 2024. It reveals character: who protects in crashes and who leads in
          bull runs. A fixed classification, not a prediction of future regimes.
        </p>
      </Section>

      <Section title="Where the signals are computed">
        <p>
          Cross-fund signals (consistency, skill, capture, rank trajectory, regimes) are precomputed at
          build time from self-hosted NAV. The holds-distribution, recovery, and modeled cone are computed
          live in your browser from the same NAV. Nothing depends on a third-party API at view time, so
          these still work if the live NAV feed is down.
        </p>
      </Section>

      <h2 className="mt-10 text-xl font-bold text-fg">Part 3: Management, holdings, and the verdict</h2>

      <Section title="Management quality">
        <p>
          A forward-looking read on the people running the money: their <strong>tenure</strong> on the
          fund and, more importantly, their <strong>track record across the other funds they manage</strong>.
          If a manager has beaten peers across several different funds, that is evidence of repeatable
          skill, not one lucky fund. We compute the median peer-relative alpha across those funds, the
          share that beat their category, and the share in their category's top 25%, then label it
          Strong / Solid / Mixed. Too few funds to judge fairly is labelled "Limited evidence".
        </p>
      </Section>

      <Section title="Portfolio holdings and overlap">
        <p>
          Each fund page shows its latest disclosed top holdings and weights; the Compare page computes
          holdings overlap, so you can spot when two funds you hold are really buying the same stocks.
          Holdings come from the most recent monthly disclosure. For funds-of-funds we use look-through
          where the disclosure supports it. Some overseas feeders invest into a single foreign fund and
          do not disclose stock-level holdings; we label those "not available" rather than show misleading
          data. Where we cannot confidently match a fund to its portfolio, we withhold holdings rather
          than risk showing the wrong fund's stocks.
        </p>
      </Section>

      <Section title="The overall verdict">
        <p>
          Each fund page ends with an <strong>overall conviction score (0-100)</strong> and label. It is a
          transparent, rule-based blend: within-category rank, peer-relative alpha and Sharpe (the
          backward pillars) plus consistency, skill confidence, downside capture and management quality
          (the forward pillars), with a momentum caution if the fund is running hot. The card lists exactly
          what worked for it and what to watch, and the same score drives the "overall verdict" row when you
          compare funds. It is a weighted reading of evidence, not advice.
        </p>
      </Section>

      <Section title="Honest limitations">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>All of this is <strong>backward-derived</strong>. Past alpha and past skill do not guarantee future results.</li>
          <li>The 3-year window spans a strong bull market, so most funds look good there. The 5-year window (which includes 2022's correction) is a tougher test.</li>
          <li>We benchmark against the <strong>peer median</strong>, not the official index, because index-fund history in India is often too short for a clean 5-year comparison.</li>
          <li>Funds that closed or merged are not in our active set (survivorship bias, common to all such analyses).</li>
          <li>We do not model forward catalysts: valuations, manager changes, or fund flows.</li>
          <li>The skill t-test assumes independent monthly excess returns; the modeled cone assumes the past return distribution repeats. Both are simplifications.</li>
        </ul>
      </Section>

      <Section title="Data source and freshness">
        <p>
          The fund universe and category come from AMFI's published classification. Metrics are computed
          from daily NAV published by AMFI (via the public mfapi.in endpoint), covering all active equity
          Direct-Growth plans. NAV charts are fetched live. Holdings are from the latest monthly disclosure.
          Base analysis snapshot: <strong>{data.anchor}</strong>.
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
