# Phase D — Better fund matching + AUM-shift view (analysis, not shipped)

_Prepared 2026-09-05. Nothing here is pushed to prod; it is a prototype + findings for review._

## 1. The matching question, reframed

The open items were "match funds better with ET and use their enrichment data" and "why do 40 equity funds have no holdings". I probed the live sources before assuming a new data source was needed.

**Finding: the 40 unresolved equity funds are overwhelmingly Groww query-normalization failures, not data gaps.** Groww already carries these funds; our onboarding query string just failed to surface them.

The current onboarder builds one query and *appends* "Direct Growth", producing long strings like `ICICI Prudential Banking and Financial Services Fund Direct Growth`. Groww's search returns **zero results** for that. Drop "and"/"Fund"/the appended plan words and the same fund resolves to an **exact scheme_code match** (`120244 → icici-prudential-banking-and-financial-services-fund-direct-growth`).

### Measured recovery
Ran a multi-variant resolver (progressively simpler queries: base name → drop "Fund" → drop "and" → first-5 tokens → first-4 tokens; accept only an exact `scheme_code` match) against all 40:

| Outcome | Count | Notes |
|---|---|---|
| **Recovered — exact scheme_code match** | **34 / 40 (85%)** | Sundaram Flexicap, all Union/UTI/Edelweiss/ITI Focused, every Nifty/Next-50/IT index fund, all the Quant funds, HDFC Defence/Consumption, ICICI Banking & Financial, MNC funds, Quantum/ITI Value, etc. |
| Groww plan-code mismatch | 1 | Sundaram Multi Cap: AMFI code `149668`, but Groww lists it as `149669`. Name is a perfect match; only the code differs (a Direct/Regular plan-code skew). Recoverable with a name-verified fallback that is deliberately conservative about accepting a different code. |
| International / feeder funds | 5 | HSBC Global Emerging Markets, Nippon India Taiwan Equity, Invesco Global Equity Income, Mirae S&P 500 Top 50 FoF, Motilal Oswal Nasdaq 100 FoF. These are foreign feeders. Even when matched, **stock-level look-through is unavailable from any Indian public source** — the honest surface is "feeder into `<underlying>`". |

### Recommendation (priority order)
1. **Ship the multi-variant query strategy in `onboard_new_funds.py` / `fetch_holdings.py`.** This is the single highest-leverage fix: +34 funds get real stock-level holdings, TER, AUM and manager data with no new dependency. Low risk (still gated on exact `scheme_code`).
2. **Add a conservative plan-code fallback** for the 1 mismatch class: if the top name-overlap result is ≥ 0.9 and the only discrepancy is a small code skew, accept it but tag `coverage: "name_verified"` so it is auditable. Recovers Sundaram Multi Cap and similar.
3. **Leave the 5 international feeders on the honest "feeder into X" surface.** No source fixes this; do not pretend otherwise.

## 2. On ET Money specifically

I probed ET Money's likely public endpoints (`www.etmoney.com/api/...`, `api.etmoney.com/...`). They returned 404 / DNS failure — **ET Money does not expose a documented, headlessly-reachable JSON API** the way Groww's `st_query` + `scheme/search/{slug}` endpoints do. Its pages are app-shell / server-rendered behind their own routing.

**Verdict:** ET Money is not worth integrating right now. Its marginal value would be limited to the ~5-6 international/feeder funds Groww can't fully cover, and even ET Money cannot provide stock-level look-through for foreign feeders. The 85% win is entirely inside Groww via better queries. If ET Money enrichment (their risk ratings, portfolio turnover, ET-specific scores) is ever wanted, it would need a browser-driven scrape, not an API — a much larger lift for little coverage gain.

## 3. AUM-shift view (prototype built, not pushed)

New page `src/pages/AumShifts.tsx`, route `/aum-shifts`, nav link "AUM Shifts". Ranks funds by month-over-month change in fund size, filterable by **% change** or **₹ change**, direction (all / inflows / outflows), category, and name search.

- **718 funds** have a real month-over-month AUM pair. The period pill reads **Jun → Jul 2026** (703 funds; 15 on May → Jun).
- The `% change` and `₹ change` pills surface genuinely different funds, which is the point: small funds dominate the percentage view (Groww Multicap +30.3%, Nippon Nifty IT +30.2%), while large funds dominate the rupee view (Parag Parikh +₹5,041 Cr, HDFC Mid Cap +₹4,284 Cr).
- **Why Jul, not Aug (answered):** this is *not* a pipeline bug. Groww's live API still returns `portfolio_date: 2026-07-30`; August portfolios and AAUM are not yet published at source. SEBI's monthly disclosure lands ~10 days after month-end, so August data is due ~Sep 10. The view's period label is data-driven, so **it rolls forward to Jul → Aug automatically** once August lands — no code change needed.

## 4. AUM date correctness (shipped in Phase E, noted here for completeness)
- 718 funds now carry the real disclosure date (2026-07-31 / 2026-06-30) + month-over-month trend, synced from the detail files (single source of truth).
- 127 funds with no detail-file disclosure date now show the size with a null `asOf` ("latest available; disclosure date not published") instead of a false run-date stamp.
