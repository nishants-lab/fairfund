# FairFund — QA Results

Run date: 2026-05-31
Build: production (`npm run build`) served via `npm run preview` (localhost:4173)
Browser: Chromium (Playwright), desktop 1280×900 + mobile 390px

## Summary

| Suite | Result |
|-------|--------|
| Metrics evaluation (`scripts/qa_metrics.mjs`) | **18/18 PASS** |
| A. Data integrity (`scripts/qa_data.py`) | **21/21 PASS** |
| B. Build & bundle | **PASS** (tsc 0 errors, 869 modules, dist + nav/ emitted) |
| Desktop UI (`qa_ui.mjs`, API-UP + API-DOWN) | **68/68 PASS** |
| Mobile (`qa_mobile.mjs`, 390×844, API-UP + API-DOWN) | **39/39 PASS** |

## Metrics evaluation harness (added 2026-05-31 — value correctness, not just rendering)

`scripts/qa_metrics.mjs` transpiles `src/lib/metrics.ts` (via esbuild, no new deps)
and verifies the COMPUTED VALUES of the pure-math engine - the gap that existed
when drawdown/best/worst date-ranges were added (UI tests only checked rendering):
- **Known-answer synthetic cases:** monotonic riser → 0 drawdown; a clean 30% drop
  → -30% drawdown with peak-date ≤ trough-date; doubling over 1y → CAGR ≈ 100%;
  best-month ≥ worst-month; tiny slice → null.
- **Invariants across 120 real funds:** drawdown ≤ 0; peak date ≤ trough date; all
  drawdown/month window dates within the slice; best ≥ worst; volatility ≥ 0;
  all ratios finite.

## "Renders, but renders wrong" class — expanded UI/mobile QA (added 2026-05-31)

A semantic-color bug (negative drawdown shown green; negative ratios black/amber)
prompted broadening QA beyond any single defect to the whole class:
- **Semantic colors:** drawdown is never green; negative Sharpe/Sortino/Calmar are
  red (checked by computed color, forcing negatives with a short YTD range).
- **No broken value artifacts** (`NaN`, `undefined`, `Invalid Date`, `[object Object]`,
  `₹NaN`, `NaN%`, unrendered `${...}`) scanned on every page, desktop and mobile.
- **Date sub-lines** (`Mon YYYY → Mon YYYY`) render on FundDetail and Compare.
- **Volatility** shows a category-median comparison line.
- **Compare with 5 funds:** all 5 columns render, chart draws 5 lines, overlap
  populates, no broken artifacts.
- **Sticky columns (mobile + desktop):** the metric column stays pinned to the left
  edge after horizontal scroll (verified by scrolling and re-measuring); the
  fund-name header row is sticky on vertical scroll - name + parameter stay in view
  with 5 funds and many rows. No horizontal PAGE scroll on mobile.

## Compare now supports up to 5 funds (was 3)

5 distinct series colors; sticky metric column + sticky header; Max Drawdown / Best /
Worst Month rows carry compact period sub-lines; consistent semantic value colors.

## Mobile QA harness (added 2026-05-31)

Desktop and mobile are the same URLs but a different product on a 390px screen.
A dedicated harness (`scripts/qa_mobile.mjs`) runs every page at an iPhone-13
viewport under both API-UP and API-DOWN and asserts small-screen invariants that
desktop tests cannot catch:

- **No unexpected horizontal page scroll** on Home, Explore, FundDetail, Compare,
  Compare-5, Planner, Methodology (the exact class of bug that previously slipped
  through - the un-scrollable Compare table that scrolled the whole page). When it
  fails it reports the offending elements. The detector was self-tested by injecting
  a deliberately 900px-wide block and confirming it fires.
- Compare table scrolls **inside its own wrapper**, not the page.
- Mobile nav present with tap targets ≥ 32px tall.
- Search dropdown fits within the viewport width and scrolls.
- Onboarding modal fits within the viewport.
- No text rendered under 10px; no uncaught app errors.

## v3 forward-looking analytics QA (added 2026-05-30)

The forward-looking signals feature added 8 data checks and 8 UI checks (the
latter run under both API-UP and API-DOWN).

**Data (`qa_data.py` A11–A18):** analytics block present on all 838 funds;
`capture`/`alpha`/`regimes` present for every fund; rank-trajectory direction in
{climbing, fading, steady} with 0–100 sparkline points; batting % in 0–100;
capture/alpha/mean-reversion values finite and in sane bands (NaN/Inf would break
`JSON.parse`); mean-reversion state in {hot, cold, normal}; exactly the 5 fixed
regimes per fund. All PASS.

**UI (`qa_ui.mjs`):** the "Forward-looking signals" section renders on Fund
Detail with the trajectory sparkline (inline SVG), consistency + skill + running-
hot cards, the block-bootstrap outcome cone, and the regime table; the horizon
selector (1/3/5/10Y) recomputes the modeled outcome range; honesty framing ("not
a guarantee") is present; Explore shows the Consistency column; Compare shows the
Consistency/Form/Skill-confidence/Down-capture/Momentum rows; Methodology
documents the v3 signals. All render correctly with MFAPI blocked, because the
build-time signals come from `funds.json` and the client-side signals (outcome
cone, rolling distribution, drawdown) compute from self-hosted NAV.

**Bug found and fixed during this QA:** the first-visit onboarding modal overlay
(`fixed inset-0 z-50`) intercepted the horizon-button click in a fresh browser
context. The QA now seeds `localStorage['ff-onboarded']='1'` so interaction tests
run as a returning visitor — an app-behavior-faithful fix, not a workaround of a
real defect.

## Bugs found and fixed during QA

1. **Compare URL not re-syncing (real bug).** The Compare page read `?codes=`
   only on first mount, so navigating to a new compare link (or the "Compare"
   button on a fund page) kept the old funds. This caused the cross-category
   warning and (intermittently) the overlap/3rd-fund issues. **Fixed:** effect
   now reacts to the `codes` param.

2. **Holdings included non-stock line items (real bug).** "Net Payables" / cash
   appeared as holdings (sometimes negative %). **Fixed:** build filters cash/
   payables/TREPS/repo and any non-positive weights.

3. **catRank exceeded categorySize (real bug).** Rank denominators used the 3Y
   category size for all windows; 1Y has more funds. **Fixed:** per-window
   `catSize` stored and shown.

4. **All metrics blank when MFAPI down (the reported outage).** Pages computed
   every metric from a live MFAPI call. **Fixed (two layers):**
   - Self-hosted NAV in `public/nav/{code}.json` (same origin, no CORS).
   - `nav.ts` is live-first with a 4s timeout, then falls back to self-hosted.
   - Compare/Fund Detail also fall back to stored fixed-window metrics so the
     page is never blank.

5. **Feeder labels (correctness).** Feeders now show an honest label naming the
   underlying ETF (domestic) or overseas fund — never a misleading 100% row or
   another fund's stocks.

## Resilience verification (core mandate)

With `api.mfapi.in` **fully blocked** (simulating outage / CORS), every page was
re-tested:
- Explore: category tables show metrics ✔
- Fund Detail: metric cards + holdings show ✔
- Compare: metric table, Growth-of-₹100 chart, and holdings overlap all render ✔
- No infinite "Loading…" spinners ✔
- No uncaught app errors (network/CORS console noise tolerated) ✔

## Data coverage (transparency)

- Universe: 838 ranked funds (authoritative AMFI categories).
- Self-hosted NAV: 993 funds (28.7 MB, per-fund avg ~30 KB).
- Holdings: 706/838 (84%) with real stock-level holdings; remainder are
  honestly labeled (overseas feeders, domestic-ETF feeders, or undisclosed).
- Management quality: 747/838 (89%) with manager data + cross-fund track record;
  signals — 146 Strong, 195 Solid, 288 Mixed, 118 Limited evidence, 91 No data.

## Management quality (forward-looking parameter)

Added per fund: manager name(s), tenure on the fund, education/experience, and a
cross-fund track-record signal (median peer-relative alpha + category beat-rate
across the OTHER funds each manager runs). Surfaced on Fund Detail (full card)
and Compare (tenure + signal rows). Honest about thin samples ("Limited
evidence" when a manager runs <3 funds in our universe). Documented in
Methodology with a past-performance caveat.

## Daily freshness

- `.github/workflows/update-nav.yml` runs on weekday evenings, pulls AMFI's
  consolidated NAVAll.txt, appends each market day's NAV to the self-hosted
  files, and commits → triggers redeploy. Verified locally: appended 43 stale
  funds, 887 already current, idempotent on re-run.

## Holdings-history capture (added 2026-05-31 — Option A)

Groww exposes only a fund's *latest* portfolio snapshot, so the "what did the
manager add/exit and was it smart" feature needs us to accumulate snapshots
ourselves. New pipeline:

- `scripts/capture_holdings_snapshot.py` captures each fund's current portfolio
  into `public/holdings-history/{code}.json`, keyed by the real `portfolioDate`.
  Idempotent (same month → skipped), resumable, threaded. Filters non-stock line
  items (cash, net payables, repo, T-bills, futures/options) and de-duplicates
  Groww's occasional double-listings so weight sums are clean.
- `.github/workflows/capture-holdings.yml` runs mid-month (8th/12th/16th/20th)
  and commits new snapshots → the dataset grows month over month. The slug map is
  committed so CI doesn't re-resolve 800+ funds each run.
- First capture: **839 funds, 839 snapshots** (weight sums 35.9–108.3%, median
  97.7% after cleaning). Change-analysis ships once funds have ≥2 snapshots
  (i.e. after the next monthly capture).
- Data QA extended: **A19** (every snapshot keyed by its portfolioDate, known
  coverage, holdings present, pct 0–100, sum sane) and **A20** (manifest matches
  files). Both PASS.

Two real data bugs were caught and fixed during this QA (exactly why the harness
exists): negative-% cash lines, and Groww double-listing stocks (which doubled
some weight sums to ~180%). Both are now filtered/deduped at capture time.

## Exit criteria: MET. Cleared for prod.
