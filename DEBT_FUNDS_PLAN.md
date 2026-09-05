# Introducing Liquid & Money Market Funds to FairFund

Status: DRAFT for review (branch `feat/debt-funds-liquid-mm`)
Scope: onboard ~67 Liquid + Money Market (Direct-Growth) schemes as first-class
funds with pages, NAV history and category ranking, WITHOUT letting the
equity-only analytics produce misleading output for them.

## 1. Design principle

FairFund is an equity engine: it grades funds on stock-picking skill (holdings
X-ray, manager record, market-regime behaviour, drawdown/recovery, up/down
capture, peer alpha). Liquid and money-market funds earn accrual on short-dated
paper; they have near-zero drawdown and no stock-level holdings. The right model
is **asset-class awareness**: keep the shared machinery (NAV, CAGR, category
ranking, search, compare) and GATE every equity-only feature behind an
`isDebt` check so debt funds show a smaller, honest surface instead of empty or
nonsensical equity widgets.

Concretely: one flag, `isDebt` (derived from category), threaded from the
pipeline into `funds.json` and read by the UI. Config already exposes
`DEBT_CATEGORIES`, `is_debt_category()`, `risk_level_for()`.

## 2. Config (DONE in this draft — pipeline/config.py)

- Added `"Liquid Fund"`, `"Money Market Fund"` to `ELIGIBLE_AMFI_CATEGORIES`.
- Added mappings -> internal categories `"Liquid"`, `"Money Market"`.
- Added `DEBT_CATEGORIES`, `RISK_BY_CATEGORY` (Liquid = "Low to Moderate",
  Money Market = "Moderate"), `is_debt_category()`, `risk_level_for()`.
- Note: `EXCLUDE_NAME_KEYWORDS` already blocks overnight/gilt/bond/debt by name;
  liquid & money-market names do not contain those tokens, so they now pass.

## 3. Pipeline changes still required

### 3a. discover_new_funds.py
- `riskLevel` is HARDCODED to `"High"` (two sites: ~L248 and ~L512). Replace
  with `risk_level_for(cat)`.
- Add `"isDebt": is_debt_category(cat)` to both `fund_entry` dicts.
- For debt funds set `holdingsMeta.coverage = "not_applicable"` (not `"pending"`)
  so the onboarding holdings fetch never runs for them.
- `MIN_NAV_POINTS = 750` (~3y): older liquid funds pass; new-AMC (Groww/Jio,
  <3y) liquid funds get skipped, same rule as equity. Acceptable for v1.

### 3b. onboard_new_funds.py
- Skip Groww slug resolution + stock-holdings fetch when `isDebt` (or when
  coverage == "not_applicable"). Debt holdings are CPs/T-bills/repos, not stocks;
  the validator would fail or store instrument rows the UI cannot use.

### 3c. build_analytics.py
- Category-relative metrics (CAGR, Sharpe, Sortino, vol, maxDD, Calmar, alpha vs
  category median) are category-agnostic MATH and will run fine — liquid funds
  simply cluster tightly. KEEP for within-category ranking.
- SKIP for debt: per-regime alpha, up/down capture, batting average, rank
  trajectory skill-confidence, mean-reversion — all equity-market constructs.
  Gate on `is_debt_category(cat)` so these analytics keys are omitted for debt
  funds (the UI already treats missing analytics as "no section").

### 3d. compute_rankings.py
- Works as-is: ranks within category, sets categorySize. Liquid ranks vs Liquid,
  Money Market vs Money Market. Requires the whole cohort onboarded together so
  category medians are meaningful (n >= ~10 each; we have 41 + 28).

### 3e. fetch_managers.py / build_manager_signals.py
- Skip debt funds. Manager "skill" signal is equity stock-picking; meaningless
  for a liquid fund and would pollute manager aggregates.

### 3f. NAV daily job (update_nav_daily.py / sync_nav_files.py)
- Derives codes from funds.json -> once entries exist, daily NAV writes itself.
  All 67 codes verified present in AMFI NAVAll with current NAV.

### 3g. Seeding the existing cohort
- Discovery only ADDS on its monthly run and needs >=3y history + passes filters.
  To ship now, run a one-off seed (discover in --seed mode or a small script)
  to add the 67 entries + NAV files + metrics, committed to funds.json.

## 4. Frontend touchpoints (each analysed)

Legend: KEEP = works unchanged · GATE = hide/replace when isDebt · COPY = wording.

### 4a. src/types.ts
- Add `isDebt?: boolean` to the Fund type. (GATE source of truth.)

### 4b. src/lib/data.ts — categoryOrder / fundsByCategory / search
- `categoryOrder` array: append "Liquid", "Money Market" (ordering: after equity,
  as a "Cash / Debt" group). KEEP mechanics.
- Search, fundsByCategory, categoryMetricStats: category-agnostic, KEEP.

### 4c. src/lib/categoryColors.ts (getCategoryColor)
- Add color entries for "Liquid" and "Money Market" (e.g. slate/teal) so the
  pill is not an undefined-fallback grey. REQUIRED or pills look broken.

### 4d. src/components/RiskBadge.tsx
- Must render "Low to Moderate" / "Moderate". Confirm the badge has color
  mappings for these bands (equity only ever used Moderately High / High). ADD
  band colors or it falls through to a default.

### 4e. src/pages/FundDetail.tsx (biggest surface)
- Header pill + RiskBadge: KEEP (fed by category + riskLevel).
- NAV chart: KEEP. Drawdown chart mode: GATE (a liquid fund's drawdown is ~0;
  chart is meaningless) — hide the "Drawdown" toggle when isDebt.
- Benchmark peer overlay (category leader): KEEP but low value; acceptable.
- Metric cards (Sharpe/Sortino/Calmar/MaxDD/Alpha/CatRank): KEEP CatRank + CAGR;
  the risk-adjusted ratios are technically valid but near-meaningless at ~0 vol.
  Decision needed: show a reduced card set for debt (CAGR, Category Rank,
  Expense-ratio placeholder, 1Y/3Y/5Y return) vs full equity card set. RECOMMEND
  reduced set.
- ForwardAnalytics block: GATE entirely when isDebt (regimes, capture, skill,
  rank trajectory, worst-fall/recovery all equity constructs).
- HoldingsTable / SectorBreakdown: GATE — no stock holdings for debt.
- ManagementCard: GATE — no manager skill signal.
- VerdictCard: GATE or replace — verdict prose is built from equity pillars
  ("beat peers", "cushions falls"); needs a debt-specific short verdict or hide.
- "Top peers in <category>": KEEP (ranks within Liquid / Money Market).

### 4f. src/pages/Explore.tsx
- Category sections render generically; new categories appear automatically once
  in categoryOrder. The Alpha / batting / maxDrawdown columns will show ~0 for
  debt — acceptable but consider a note, or a debt-aware column set. COPY/verify.

### 4g. src/pages/Home.tsx
- "No. 1 in each major category" + "Browse by category" pull from categoryOrder;
  new cards appear automatically. Verify the category-count copy still reads
  well. Consider grouping Liquid/Money Market under a "Cash" header. COPY.

### 4h. src/pages/Portfolio.tsx + src/lib/portfolio.ts
- These funds move from "Other holdings (not covered)" INTO covered holdings once
  they are in funds.json. The 1-Day Change card copy ("Across equity funds with
  published NAV. Debt and other holdings are not included") becomes WRONG — debt
  is now covered. COPY fix required. Also the covered/uncovered split logic keys
  off presence in funds.json, so it updates automatically.

### 4i. src/components/Compare.tsx / CompareChart / HoldingsOverlap
- Comparing two debt funds: holdings-overlap has no stock data -> already handles
  "no usable holdings" gracefully (shows honest message). KEEP. Comparing a debt
  vs equity fund: overlap = 0, drawdown compare misleading. Acceptable; verify
  no crash.

### 4j. src/lib/verdict.ts
- Verdict scoring blends equity pillars; for debt it would produce a low/edge
  score. GATE: return a simple debt verdict (e.g. "Cash-equivalent: judge on
  expense ratio and consistency, not alpha") or suppress the conviction score.

### 4k. Methodology.tsx
- Add a short paragraph explaining that debt (liquid/money-market) funds are
  shown for NAV + return + within-category ranking only, and why equity signals
  are hidden. COPY.

## 5. Data gaps (honest)

- No expense ratio, YTM, modified duration, or credit-quality in our pipeline.
  Those are the fields that actually differentiate liquid funds. v1 ships without
  them (return + rank only); a v2 would need a new data source.
- Category medians for the risk-adjusted ratios are near-degenerate at ~0 vol,
  so Sharpe/Sortino for debt are noisy. Reduced card set mitigates.

## 6. Rollout

1. Land config + pipeline gates + UI gates behind `isDebt`.
2. One-off seed of the 67 funds (NAV + metrics + ranking), commit to funds.json.
3. `check_fund_matching.mjs` + tsc + build must stay green.
4. Verify a Liquid and a Money Market fund page render the reduced surface with
   no empty equity widgets; verify Portfolio recategorises them as covered.

## 7. Open decisions for reviewers

- Q1: Reduced metric-card set for debt vs full equity set? (RECOMMEND reduced.)
- Q2: Group Liquid + Money Market under a "Cash / Debt" header on Home/Explore,
  or list flat with equity categories?
- Q3: Ship v1 without expense-ratio/YTM, or block until a debt data source is
  added? (RECOMMEND ship v1 as NAV+rank, label clearly.)
- Q4: Include Overnight funds too (currently name-excluded) in the same release,
  or keep to Liquid + Money Market first?
