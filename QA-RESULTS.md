# FairFund — QA Results

Run date: 2026-05-30
Build: production (`npm run build`) served via `npm run preview` (localhost:4173)
Browser: Chromium (Playwright), desktop 1280×900 + mobile 390px

## Summary

| Suite | Result |
|-------|--------|
| A. Data integrity (`scripts/qa_data.py`) | **10/10 PASS** |
| B. Build & bundle | **PASS** (tsc 0 errors, dist + nav/ emitted) |
| C+D+E. Functional UI, API-UP (`qa_ui.mjs`) | **15/15 PASS** |
| C+D+E. Functional UI, API-DOWN | **14/14 PASS** |
| **Total automated UI** | **29/29 PASS** |

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

## Daily freshness

- `.github/workflows/update-nav.yml` runs on weekday evenings, pulls AMFI's
  consolidated NAVAll.txt, appends each market day's NAV to the self-hosted
  files, and commits → triggers redeploy. Verified locally: appended 43 stale
  funds, 887 already current, idempotent on re-run.

## Exit criteria: MET. Cleared for prod.
