# FairFund — Comprehensive QA Plan

Goal: **zero broken customer experience.** No blank metrics, no "Loading…" that
never resolves, no wrong labels, no empty overlap/charts — even if the live NAV
API (mfapi.in) is slow, down, or CORS-blocked.

QA runs against a LOCAL production build (`npm run build` + `npm run preview`)
before anything is pushed to prod. Results are written to `QA-RESULTS.md`.

## Test environment
- Build: `npm run build` (must succeed, 0 TS errors)
- Serve: `npm run preview` (serves the real production bundle + self-hosted NAV)
- Two network conditions tested for every NAV-dependent check:
  1. **API UP** — normal
  2. **API DOWN** — mfapi.in requests blocked/aborted (simulates outage/CORS)

## A. Data integrity (static, Python harness — `scripts/qa_data.py`)
A1. funds.json parses; `totalFunds` matches `funds.length`.
A2. Every fund has: code, name, fullName, amc, category, categoryDisplay,
    riskLevel, categorySize, metrics{}, holdings[], holdingsMeta{}.
A3. Every `category` has a display + risk mapping (no raw enum leaks in UI).
A4. Every fund appears in `categoryOrder`'s known set.
A5. Metrics sanity: CAGR in [-50, 100], Sharpe in [-5, 10], maxDrawdown in
    [-100, 0], volatility in [0, 100]. Flag NaN/null/out-of-range.
A6. catRank within [1, categorySize]; ranks unique per (category, window).
A7. Holdings: pct in [0, 100]; top-15 sum <= 100.5; coverage is a known value.
A8. Holdings coverage labels are all in the allowed set (no unknown strings).
A9. Self-hosted NAV: every fund code has a `public/nav/{code}.json`; it parses;
    d.length == v.length; dates ISO & ascending; latest date recent.
A10. No duplicate fund codes.

## B. Build & bundle
B1. `npm run build` exits 0.
B2. dist/ contains index.html + assets + nav/ copied from public.
B3. No source references to removed tokens (e.g. `text-base` color token).

## C. Functional UI (Playwright — `scripts/qa_ui.mjs`), API UP and API DOWN
For a representative sample (>=8 funds spanning every category, incl. feeders,
unresolved, small/large categories):

C1. Home loads; hero + search render.
C2. Explore: each category tab renders a non-empty table; metric columns show
    numbers (from stored data) — NEVER all "—".
C3. Explore: sorting by each column reorders rows; no crash.
C4. Fund detail (stock_level fund): metric cards show numbers under BOTH API
    states; holdings table renders rows with % under both states.
C5. Fund detail (feeder_foreign / feeder_domestic): shows the honest label +
    underlying name; NO 100% single-row table; no crash.
C6. Fund detail (unresolved): shows "Holdings not available"; metrics still show.
C7. Compare (2 same-category funds): metric table shows numbers under both API
    states; "Growth of ₹100" chart renders >=2 points under API UP, and shows a
    graceful message (not infinite "Loading…") under API DOWN.
C8. Compare: holdings overlap shows pairwise % and a shared-holdings table when
    both funds have stock-level holdings (NON-EMPTY).
C9. Compare with a feeder fund: overlap explains the feeder is excluded; no crash.
C10. Compare cross-category: shows the cross-category warning.
C11. Planner page: loads, computes, no crash.
C12. Methodology page: loads; all sections present.
C13. Theme toggle: light/dark switch works; no contrast/blank issues.
C14. Mobile viewport (390px): Compare table scrolls horizontally; no overflow
     off-screen; fund detail readable.
C15. Console: no uncaught exceptions / React errors on any page (CORS network
     errors under API DOWN are tolerated, app errors are NOT).

## D. Resilience (the core mandate)
D1. With mfapi.in fully blocked, EVERY page still shows metrics (from stored
    data + self-hosted NAV). No infinite spinners.
D2. Live-first: with API UP, NAV comes from live; with API DOWN, falls back to
    self-hosted within the timeout (<= ~5s), page still works.
D3. No metric cell shows "…" permanently.

## E. Labels & correctness
E1. No fund shows another fund's holdings (validated by name match in data QA).
E2. Feeder labels name the correct underlying.
E3. Category display names are human-readable (no `Index-Other` raw strings).
E4. Risk badges present and correct per category.

## Exit criteria
- All A, B, D checks pass.
- All C checks pass under BOTH API states (CORS-only console noise allowed).
- E checks pass.
- Any failure is fixed and the full suite re-run GREEN before `git push`.
