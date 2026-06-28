# Data Source Findings (rebuild + holdings)

## Universe / categories (TRUST FIX)
- **Authoritative category source:** MFAPI per-fund `meta.scheme_category` (e.g. "Equity Scheme - Sectoral/ Thematic"). Available cheaply via `https://api.mfapi.in/mf/{code}/latest` (1 NAV point, full meta).
- Master list `https://api.mfapi.in/mf` = 37,613 schemes, names only (no category).
- Direct-Growth plans (name filter `direct`+`growth`): **5,071**.
- OLD name-keyword categorizer kept 1,026, dropped 4,045 → silent misses hid in the dropped set.
- **New approach:** classify by AMFI `scheme_category`, NOT by name keywords. Map AMFI sub-categories → our display buckets.

### AMFI equity scheme_category values seen so far
- "Equity Scheme - Large Cap Fund", "...Mid Cap Fund", "...Small Cap Fund",
  "...Large & Mid Cap Fund", "...Multi Cap Fund", "...Flexi Cap Fund",
  "...ELSS", "...Focused Fund", "...Value Fund", "...Contra Fund",
  "...Dividend Yield Fund", "...Sectoral/ Thematic"
- Index funds: "Other Scheme - Index Funds"
- FoFs: "Other Scheme - FoF Domestic", "Other Scheme - FoF Overseas"
  -> International funds are largely under FoF Overseas + some Sectoral/Thematic (Franklin Asian is Sectoral/Thematic, direct equity).
- (Full distribution to be produced by audit_universe.py after cache completes.)

## Holdings (NEW REQUIREMENT)
- **MFAPI has NO holdings.** NAV only.
- **Groww public API has holdings WITH look-through for many funds.**
  - Search/resolve slug: `https://groww.in/v1/api/search/v3/query/global/st_query?query=<name>` → returns `search_id` (slug) + `scheme_code` (matches MFAPI code).
  - Holdings: `https://groww.in/v1/api/data/mf/web/v2/scheme/search/{slug}` (header User-Agent required).
  - Holdings entry fields: `company_name`, `sector_name`, `instrument_name` (Equity / Forgn. Eq / Foreign MF / Mutual Fund / etc.), `corpus_per` (% of portfolio), `stock_search_id` (stable key for overlap), `portfolio_date`, `market_value`.
  - Also returns: `aum`, `expense_ratio`, `sub_category`, `fund_manager`, etc.

### FoF behavior on Groww (verified)
- Some FoFs disclose REAL underlying stocks (e.g. Franklin Asian Equity → Taiwan Semi 8.98%, Samsung 5.97% ... instrument_name "Forgn. Eq"). Look-through already done.
- Pure feeders show a SINGLE line into the underlying fund:
  - Franklin US Opp FoF → "Franklin India Feeder Franklin US Opportunities Fund" (Foreign MF, 97.9%)
  - Motilal NASDAQ 100 FoF → "Motilal Oswal NASDAQ 100 ETF-Growth" (Mutual Fund, 100%)
  - Edelweiss US Tech FoF → "JPMORGAN F-US TECHNOLOGY-I A" (Foreign MF, 97%)
- **Look-through strategy:**
  1. If holdings are already stock-level (Equity/Forgn. Eq) → use directly.
  2. If single line into a DOMESTIC Indian scheme (ETF/FoF) we also track → resolve recursively to that scheme's holdings.
  3. If single line into a FOREIGN fund → cannot get stock-level; flag honestly: "Feeder into <underlying>; stock-level look-through not available from public source." Still record the underlying so overlap logic treats it sensibly.

## Overlap (compare page)
- Match holdings across funds by `stock_search_id` (fallback: normalized company_name).
- Overlap % = sum of min(weight_a, weight_b) across shared names (standard portfolio-overlap / common-weight metric), shown for each pair + a shared-names table.
- Flag funds with no stock-level holdings (foreign feeders) so overlap isn't misleadingly 0.
