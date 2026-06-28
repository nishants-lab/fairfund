# FairFund Data Integrity Audit Report

**Date:** 2026-06-28  
**Auditor:** Fund-QA (automated sub-agent)  
**Scope:** 838 existing funds + 127 new fund candidates from `discover_new_funds.py`

---

## Executive Summary

### Verdict: ⚠️ NOT SAFE TO ADD — Needs Significant Review

The `discover_new_funds.py` script identifies 127 candidates, but **the vast majority should NOT be added**. The script has a filtering bug that allows non-Growth plan variants (IDCW, Dividend, Payout, Reinvestment, Bonus) to pass through. Only **~10 candidates are genuinely new unique equity funds** worth considering.

**Key findings:**
- 🔴 **~92 of 127 candidates are plan variants** (Dividend/IDCW/Payout/Reinvestment/Bonus) of funds already in the dataset
- 🔴 **22 are debt/bond funds** miscategorized as equity index funds
- 🔴 **14 are closed-ended series funds** (locked-in ELSS schemes)
- 🟡 **4 internal duplicate groups** among the 127 candidates (Groww Largecap ×4, Groww Value ×4, etc.)
- 🟡 **13 existing funds are Bonus plan variants** (Nippon India series) — pre-existing data quality issue
- 🟡 **1 true duplicate** in existing dataset (Nippon India Mid Cap Fund: codes 118668 and 118666)
- 🟢 **156 orphan NAV files** exist with no corresponding fund entry (leftover from removed funds?)

---

## Section 1: Classification of 127 New Fund Candidates

| Category | Count | Action |
|----------|-------|--------|
| Dividend/Payout/IDCW plans (not Growth) | 27 | ❌ REJECT |
| Reinvestment plans (not Growth) | 6 | ❌ REJECT |
| Bonus options | 2 | ❌ REJECT |
| Series/Closed-ended ELSS funds | 14 | ❌ REJECT |
| Debt/Gilt/Bond funds miscategorized | 22 | ❌ REJECT |
| Plan variants of existing funds (duplicate base) | 15 | ❌ REJECT |
| Internal duplicates (same fund, multiple codes) | 14 | ❌ REJECT (keep 1 of each) |
| International/FoF (already in dataset) | 4 | ❌ REJECT |
| International/FoF (genuinely new) | 2 | ⚠️ REVIEW |
| Genuine equity index funds (new) | 18 | ✅ CONSIDER |
| Genuine active equity funds (new) | ~10 | ✅ CONSIDER |

### Breakdown:

#### ❌ REJECT — Dividend/Payout/IDCW Plans (27 funds)
These are non-Growth options of funds already tracked. FairFund should only track Growth plans.
- Kotak ELSS Tax Saver Fund - Payout of Income Distribution
- Kotak Flexicap Fund - Payout of Income Distribution
- Kotak Large Cap Fund - Payout of Income Distribution
- Kotak-Small Cap Fund - Payout of Income Distribution
- 360 ONE QUANT FUND DIRECT INCOME DISTRIBUTION CUM...
- TATA Focused Fund Direct Plan - Payout of Income D...
- PGIM India ELSS Tax Saver Fund - Direct Plan - Dividend
- PGIM India Flexi Cap Fund - Direct Plan - Dividend
- PGIM India Large Cap Fund - Direct Plan - Dividend
- PGIM India Midcap Fund - Direct Plan - Dividend
- Taurus ELSS Tax Saver Fund - Payout
- Taurus Flexi Cap Fund - Payout
- Taurus Large Cap Fund - Payout
- Taurus Mid Cap Fund - Payout
- Taurus Ethical Fund - Payout
- Taurus Infrastructure Fund - Payout
- 360 ONE Focused Fund - Dividend
- Kotak Focused Fund - Income Distribution
- Kotak US Equity Fund - Dividend option
- Kotak World Gold Fund - Dividend Option
- TATA Digital India Fund - Payout
- TATA India Consumer Fund - Payout & Reinvestment
- TATA Quant Equity Fund - Payout
- TATA Resources & Energy Fund - Payout
- TATA SmallCap Fund - Payout
- Sundaram Dividend Yield Fund (already exists as code 149700)

#### ❌ REJECT — Reinvestment Plans (6 funds)
- TATA Flexi Cap Fund Direct Plan - Reinvestment
- TATA Focused Fund Direct Plan - Reinvestment
- Kotak Pioneer Fund - Reinvestment
- TATA Digital India Fund - Reinvestment
- TATA Quant Fund - Reinvestment
- TATA Small Cap Fund - Reinvestment

#### ❌ REJECT — Bonus Options (2 funds)
- PGIM India Large Cap Fund - Direct Plan - Bonus
- Taurus Ethical Fund - Direct Plan - Bonus Option

#### ❌ REJECT — Closed-Ended Series Funds (14 funds)
These are locked-in tax-saving schemes that have matured or are closed to new investment:
- BANK OF INDIA Mid Cap Tax Fund Series 1, 2
- SBI Long Term Advantage Fund - Series III, IV, V, VI
- Sundaram Long Term Tax Advantage Fund Series I, II, III, IV
- Sundaram Long Term Micro Cap Tax Advantage Fund Series (×4)
- UTI Long Term Advantage Fund Series III, IV, V, VI

#### ❌ REJECT — Debt/Bond Funds Miscategorized (22 funds)
These are debt index funds incorrectly mapped to equity categories by the AMFI category mapper:
- Bandhan US Treasury Bond 0-1 year specific Debt...
- Aditya Birla Sun Life Crisil IBX 50:50 Gilt Plus SDL...
- Aditya Birla Sun Life Crisil IBX 60:40 SDL + AAA PSU...
- Aditya Birla Sun Life Crisil IBX Gilt (Apr 2029, Apr 2026)
- Axis CRISIL IBX 50:50 Gilt Plus SDL June 2028
- Axis Nifty SDL September 2026 Debt Index Fund
- BANDHAN CRISIL IBX 90:10 SDL PLUS GILT (×4 vintages)
- DSP CRISIL-IBX 50:50 Gilt Plus SDL April 2033
- Edelweiss CRISIL IBX (×3 variants)
- Edelweiss NIFTY PSU Bond Plus SDL
- Kotak Nifty SDL Plus AAA PSU Bond Jul 2028
- Mirae Asset CRISIL IBX Gilt Index April 2033
- Nippon India Nifty AAA PSU Bond Plus SDL Sep 202...
- SBI CRISIL IBX Gilt Index April 2029
- TATA CRISIL-IBX GILT INDEX APRIL 2026
- UTI NIFTY SDL Plus AAA PSU Bond Apr 2026

#### ✅ CONSIDER — Genuine Equity Index Funds (18 funds)
Legitimate new equity index funds not yet in the dataset:
- **HDFC BSE Sensex Index Fund** - Direct Plan (3317 pts) ← likely genuine new
- **HDFC Nifty 50 Index Fund** - Direct Plan (3317 pts) ← likely genuine new
- **ICICI Prudential BSE Sensex Index Fund** (1963 pts)
- **ICICI Prudential Nifty 50 Index Fund** (3316 pts)
- **Tata S&P BSE Sensex Index Fund** (3316 pts)
- **Tata Nifty 50 Index Fund** (3316 pts)
- **Edelweiss NIFTY Large Midcap 250 Index Fund** (1124 pts) ← already exists as 149343!
- **Motilal Oswal BSE Enhanced Value Index Fund** (941 pts)
- **Motilal Oswal BSE Low Volatility Index Fund** (1043 pts)
- **Motilal Oswal BSE Quality Index Fund** (941 pts)
- **Motilal Oswal Nifty 200 Momentum 30 Index Fund** (1071 pts)
- **Motilal Oswal Nifty 500 Index Fund** (1673 pts)
- **Motilal Oswal Nifty Bank Index Fund** (1673 pts)
- **Motilal Oswal Nifty Midcap 150 Index Fund** (1673 pts)
- **Motilal Oswal Nifty Smallcap 250 Index Fund** (1673 pts)
- **Sundaram Nifty 100 Equal Weight Fund** (1102 pts)
- **Kotak Nifty Next 50 Index Fund** - Payo... (1298 pts) ← already exists as 148745! (this is Payout variant)
- **Taurus Nifty 50 Index Fund** (3317 pts) ← already exists as 118881! (this is Payout variant)

**Net genuine new equity index funds: ~12-14**

#### ✅ CONSIDER — Genuine Active Equity Funds (~10 funds)
After removing all plan variants and duplicates:
- **ICICI Prudential India Opportunities Fund** (Sectoral/Thematic, 1832 pts)
- **ICICI Prudential Manufacturing Fund** (Sectoral/Thematic, 1895 pts)
- **ICICI Prudential Pharma Healthcare and Diagnostics** (Sectoral/Thematic, 1953 pts)
- **ICICI Prudential Long Term Wealth Enhancement Fund** (ELSS, 1963 pts)
- **TATA Banking & Financial Services Fund** (Sectoral/Thematic, 2584 pts) — 1 entry only
- **Tata Quant Fund - Direct Plan - Growth** (Sectoral/Thematic, 1271 pts)
- **Groww ELSS Tax Saver Fund** (ELSS, 2089 pts) — already exists as 141808!
- **Navi ELSS Tax Saver Fund** (ELSS, 2532 pts) — different from Navi ELSS Nifty 50 Index
- **HDFC Long Term Advantage Plan** (ELSS, 2225 pts) — closed scheme, may not be investable
- **Aditya Birla Sun Life Commodity Equities Fund** (Sectoral/Thematic, 2602 pts)

---

## Section 2: Health Check — Existing 838 Funds

### ✅ No Duplicate Codes
All 838 fund codes are unique.

### ⚠️ 1 Exact Duplicate Name
| Code | Name | Category | 1Y CAGR |
|------|------|----------|---------|
| 118668 | Nippon India Mid Cap Fund | Mid Cap | 9.56% |
| 118666 | Nippon India Mid Cap Fund | Mid Cap | 1.56% |

**Analysis:** Code 118668 is the Growth option; code 118666 appears to be the Dividend/IDCW option with significantly lower returns (1.56% vs 9.56%). **Code 118666 should be removed.**

### ⚠️ 13 Bonus Plan Variants in Dataset
The following funds are Bonus options that should ideally only have Growth plans tracked:
| Code | Name |
|------|------|
| 118742 | Nippon India Index Fund - Nifty 50 - Bonus |
| 118785 | Nippon India Index Fund - BSE Sensex - Bonus |
| 118675 | Nippon India Vision Large & Mid Cap Fund - Bonus |
| 118633 | Nippon India Large Cap Fund - Bonus |
| 118665 | Nippon India Mid Cap Fund - Bonus |
| 118651 | Nippon India Multi Cap Fund - Bonus |
| 118758 | Nippon India Pharma Fund - Bonus |
| 130861 | Nippon India Japan Equity Fund - Bonus |
| 118762 | Nippon India Power & Infra Fund - Bonus |
| 118770 | Nippon India Quant Fund - Bonus |
| 118588 | Nippon India Banking & Financial Services Fund - Bonus |
| 118722 | Nippon India Consumption Fund - Bonus |
| 118777 | Nippon India Small Cap Fund - Bonus |

**Impact:** These Bonus options have different NAV trajectories than Growth and shouldn't be compared in the same category rankings. However, removal could break existing URLs/bookmarks.

### ✅ No Funds with All-Null Metrics
All 838 funds have at least one non-null metric in at least one horizon.

### ✅ All Funds Have NAV Files
Every fund code in funds.json has a corresponding NAV file in `public/nav/`.

### ⚠️ 156 Orphan NAV Files
156 NAV files exist in `public/nav/` with no corresponding entry in funds.json. These are likely leftover from previously removed funds or unsuccessful additions. Not harmful but wastes disk/CDN space.

### NAV Data Point Distribution
- Min: 79 points (excluding _manifest.json)
- Max: 4,982 points  
- Median: 1,054 points
- Files with <100 points: 15 (all orphans, none are active funds)
- Files with <500 points: 235
- Files with ≥1000 points: 520

---

## Section 3: Script Bug Analysis

### Bug 1: IDCW/Dividend Plans Passing Filter
**Location:** `pipeline/discover_new_funds.py`, line 82

```python
if "growth" not in name_lower and "idcw" in name_lower:
    continue
```

**Problem:** The condition only skips if "growth" is NOT present AND "idcw" IS present. But many AMFI scheme names include both "Direct Plan" and "Dividend"/"Payout" without the word "idcw". Funds like "Kotak ELSS Tax Saver Fund-Payout of Income Distribution..." pass through because they don't contain "idcw".

**Fix needed:** Also filter out names containing:
- "payout of income"
- "income distribution"
- "dividend option"
- "reinvestment of income"
- "bonus option"
- "bonus"

### Bug 2: Debt Index Funds Passing Category Filter
The `map_amfi_category()` function maps anything with "index" in the AMFI category to `"Index-Other"`, including **debt index funds** (Gilt Index, SDL Index, PSU Bond Index). These are NOT equity funds.

**Fix needed:** Add negative filters for fund names containing: "gilt", "sdl", "bond", "debt", "treasury", "aaa psu", "ibx".

### Bug 3: Series/Closed-Ended Funds Not Filtered
Closed-ended tax saver funds with "Series I/II/III/..." in the name pass through. These are not relevant for new investors.

**Fix needed:** Skip funds with `re.search(r'series [ivx\d]+', name_lower)`.

### Bug 4: No Duplicate Detection Against Existing Dataset
The script only checks if the AMFI code already exists. It doesn't check if the same base fund under a different plan option is already tracked.

---

## Section 4: Recommendations

### Immediate Actions
1. **Do NOT run `discover_new_funds.py` without fixes** — it would add 127 mostly-bad entries
2. **Remove code 118666** (Nippon India Mid Cap Fund duplicate — it's the IDCW variant)
3. **Consider removing 13 Bonus variants** or flagging them in the UI

### Script Fixes Needed (before next run)
1. Add comprehensive plan-type filter (reject Dividend/Payout/Reinvestment/Bonus/IDCW)
2. Add debt keyword filter in name-level check  
3. Add series/closed-ended filter
4. Add fuzzy duplicate check against existing fund names
5. Consider raising `MIN_NAV_POINTS` from 750 to 1000

### Safe-to-Add Funds (after script fixes)
If the script is fixed, approximately **22-25 funds** would be worth adding:
- ~12-14 genuine equity index funds (Motilal Oswal factor funds, HDFC/ICICI/Tata broad market index funds)
- ~7-10 genuine active equity funds (ICICI sectoral funds, Tata Banking/Quant, ABSL Commodity Equities)

### Cleanup
- Delete 156 orphan NAV files to save ~15MB of CDN bandwidth
- Audit the 13 Nippon India Bonus entries for accuracy

---

## Appendix: Full List of 127 Candidates with Disposition

<details>
<summary>Click to expand full list</summary>

### Dividend Yield (1 candidate)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1 | Sundaram Dividend Yield Fund (Formerly Known as Pr... | 1,102 | ❌ Already exists (code 149700) |

### ELSS (19 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1 | Groww ELSS Tax Saver Fund | 2,089 | ❌ Already exists (code 141808) |
| 2 | HDFC Long Term Advantage Plan - Growth | 2,225 | ⚠️ Closed scheme |
| 3 | Kotak ELSS Tax Saver Fund - Payout | 3,316 | ❌ Payout variant |
| 4 | Navi ELSS Tax Saver Fund - Growth | 2,532 | ⚠️ Review (different from 151471?) |
| 5 | PGIM India ELSS Tax Saver Fund - Dividend | 2,595 | ❌ Dividend variant |
| 6 | Taurus ELSS Tax Saver Fund - Payout | 3,317 | ❌ Payout variant |
| 7 | BANK OF INDIA Mid Cap Tax Fund Series 1 | 2,050 | ❌ Closed-ended series |
| 8 | BANK OF INDIA Midcap Tax Fund Series 2 | 1,886 | ❌ Closed-ended series |
| 9 | ICICI Prudential Long Term Wealth Enhancement Fund | 1,963 | ✅ Genuine new |
| 10-14 | SBI Long Term Advantage Fund Series III-VI | ~1,950 | ❌ Closed-ended series |
| 15-18 | Sundaram Long Term Micro Cap Tax Advantage Series | ~2,250 | ❌ Closed-ended series |
| 19 | Sundaram Long Term Tax Advantage Fund Series I-IV | ~2,200 | ❌ Closed-ended series |
| 20-23 | UTI Long Term Advantage Fund Series III-VI | ~1,100 | ❌ Closed-ended series |

### Flexi Cap (5 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1 | Kotak Flexicap Fund - Payout | 3,304 | ❌ Payout variant |
| 2 | PGIM India Flexi Cap Fund - Dividend | 2,784 | ❌ Dividend variant |
| 3 | TATA Flexi Cap Fund - Payout | 1,719 | ❌ Payout variant |
| 4 | TATA Flexi Cap Fund - Reinvestment | 1,916 | ❌ Reinvestment variant |
| 5 | Taurus Flexi Cap Fund - Payout | 3,318 | ❌ Payout variant |

### Focused (4 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1 | 360 ONE Focused Fund - Dividend | 2,868 | ❌ Dividend variant |
| 2 | Kotak Focused Fund - Income Distribution | 1,705 | ❌ IDCW variant |
| 3 | TATA Focused Fund - Payout | 1,616 | ❌ Payout variant |
| 4 | TATA Focused Fund - Reinvestment | 1,616 | ❌ Reinvestment variant |

### Large Cap (8 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1-4 | Groww Largecap Fund (×4 variants) | ~2,500 | ❌ Duplicate of 119133 |
| 5 | Kotak Large Cap Fund - Payout | 3,312 | ❌ Payout variant |
| 6 | PGIM India Large Cap Fund - Bonus | 836 | ❌ Bonus variant |
| 7 | PGIM India Large Cap Fund - Dividend | 2,537 | ❌ Dividend variant |
| 8 | Taurus Large Cap Fund - Payout | 3,317 | ❌ Payout variant |

### Mid Cap (4 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1 | BANK OF INDIA Large & Mid Cap Fund - Bonus | 3,080 | ❌ Bonus variant (existing 119350) |
| 2 | PGIM India Midcap Fund - Dividend | 3,088 | ❌ Dividend variant |
| 3 | Taurus Mid Cap Fund - Payout | 3,317 | ❌ Payout variant |

### Small Cap (3 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1 | Kotak-Small Cap Fund - Payout | 3,316 | ❌ Payout variant |
| 2 | TATA Small Cap Fund - Reinvestment | 1,876 | ❌ Reinvestment variant |
| 3 | TATA SmallCap Fund - Payout | 1,719 | ❌ Payout variant |

### Sectoral/Thematic (27 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1 | 360 ONE QUANT FUND - IDCW | 1,126 | ❌ IDCW variant |
| 2 | ABSL Commodity Equities Fund | 2,602 | ✅ Genuine new |
| 3 | ABSL International Equity Fund | 2,599 | ❌ Duplicate of 119517 |
| 4 | ICICI Prudential India Opportunities Fund | 1,832 | ✅ Genuine new |
| 5 | ICICI Prudential Manufacturing Fund | 1,895 | ✅ Genuine new |
| 6 | ICICI Prudential Pharma Healthcare and Diagnostics | 1,953 | ✅ Genuine new |
| 7 | Kotak ESG Exclusionary Strategy Fund | 1,358 | ❌ Duplicate of 148606 |
| 8 | Kotak Infrastructure & Economic Reform Fund | 2,806 | ❌ Duplicate of 133801 |
| 9 | Kotak Pioneer Fund - Reinvestment | 1,634 | ❌ Reinvestment variant |
| 10-11 | TATA Banking & Financial Services Fund (×2) | 2,584 | ✅ 1 genuine new |
| 12-13 | TATA Digital India Fund - Payout & Reinvestment | 2,583 | ❌ Variants (existing 135800) |
| 14-15 | TATA India Consumer Fund - Payout & Reinvestment | 2,584 | ❌ Variants (existing 135805) |
| 16-17 | TATA India Pharma Fund (×2 spellings) | 2,584 | ❌ Variants (existing 135810) |
| 18-19 | TATA Quant Fund (Payout + Reinvestment) | 1,271 | ❌ Variants |
| 20 | Tata Quant Fund - Growth | 1,271 | ✅ Genuine new |
| 21-22 | TATA Resources & Energy Fund (×2) | 2,584 | ❌ Variants (existing 135813) |
| 23 | Taurus Banking & Financial Services Fund | 3,317 | ❌ Duplicate of 118868 |
| 24 | Taurus Ethical Fund - Payout | 3,318 | ❌ Payout variant |
| 25 | Taurus Ethical Fund - Bonus | 3,221 | ❌ Bonus variant |
| 26 | Taurus Infrastructure Fund - Payout | 3,317 | ❌ Payout variant |

### Value/Contra (4 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1-4 | Groww Value Fund (×4 variants) | ~2,400 | ❌ Duplicates of 135341 |

### International (9 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1 | Bandhan US Treasury Bond 0-1 year | 758 | ❌ Debt fund |
| 2 | Kotak Global Emerging Market | 3,196 | ❌ Duplicate of 119779 |
| 3 | Kotak International REIT | 1,196 | ❌ Duplicate of 148646 |
| 4 | Kotak US Equity Fund - Dividend | 1,174 | ❌ Dividend variant |
| 5 | Kotak US Equity Fund - Growth | 1,174 | ✅ Genuine new |
| 6 | Kotak World Gold Fund - Dividend | 1,201 | ❌ Dividend variant |
| 7 | Kotak World Gold Fund - Growth | 1,201 | ✅ Genuine new |
| 8 | PGIM India Emerging Markets FoF | 1,696 | ❌ Duplicate of 138456 |
| 9 | PGIM India Global Equity FoF | 1,696 | ❌ Duplicate of 138528 |

### Index-Other (24 candidates)
| # | Name | Points | Verdict |
|---|------|--------|---------|
| 1-22 | Debt index funds (Gilt/SDL/Bond/IBX) | ~850 | ❌ Debt, not equity |
| 23 | Edelweiss NIFTY Large Midcap 250 | 1,124 | ❌ Duplicate of 149343 |
| 24 | HDFC BSE Sensex Index Fund | 3,317 | ✅ Genuine new |
| 25 | HDFC Nifty 50 Index Fund | 3,317 | ✅ Genuine new |
| 26 | ICICI Prudential BSE Sensex Index Fund | 1,963 | ✅ Genuine new |
| 27 | ICICI Prudential Nifty 50 Index Fund | 3,316 | ✅ Genuine new |
| 28 | Kotak Nifty Next 50 Index Fund - Payout | 1,298 | ❌ Payout variant of 148745 |
| 29-33 | Motilal Oswal factor/broad index funds (×5) | ~1,200 | ✅ Genuine new |
| 34 | Sundaram Nifty 100 Equal Weight | 1,102 | ✅ Genuine new |
| 35 | Tata S&P BSE Sensex Index Fund | 3,316 | ✅ Genuine new |
| 36 | Tata Nifty 50 Index Fund | 3,316 | ✅ Genuine new |
| 37 | Taurus Nifty 50 Index Fund - Payout | 3,317 | ❌ Payout variant of 118881 |

</details>

---

## Section 5: Final Safe-to-Add List

After all filtering, these **~22 funds** are genuinely new and worth adding:

### Equity Index Funds (12)
1. HDFC BSE Sensex Index Fund (3,317 pts)
2. HDFC Nifty 50 Index Fund (3,317 pts)
3. ICICI Prudential BSE Sensex Index Fund (1,963 pts)
4. ICICI Prudential Nifty 50 Index Fund (3,316 pts)
5. Motilal Oswal BSE Enhanced Value Index Fund (941 pts)
6. Motilal Oswal BSE Low Volatility Index Fund (1,043 pts)
7. Motilal Oswal BSE Quality Index Fund (941 pts)
8. Motilal Oswal Nifty 200 Momentum 30 Index Fund (1,071 pts)
9. Motilal Oswal Nifty 500 Index Fund (1,673 pts)
10. Motilal Oswal Nifty Bank Index Fund (1,673 pts)
11. Motilal Oswal Nifty Midcap 150 Index Fund (1,673 pts)
12. Motilal Oswal Nifty Smallcap 250 Index Fund (1,673 pts)

### Active Equity Funds (8)
13. ICICI Prudential India Opportunities Fund (1,832 pts)
14. ICICI Prudential Manufacturing Fund (1,895 pts)
15. ICICI Prudential Pharma Healthcare and Diagnostics (1,953 pts)
16. ICICI Prudential Long Term Wealth Enhancement Fund (1,963 pts)
17. TATA Banking & Financial Services Fund (2,584 pts)
18. Tata Quant Fund - Growth (1,271 pts)
19. Aditya Birla Sun Life Commodity Equities Fund (2,602 pts)
20. Sundaram Nifty 100 Equal Weight Fund (1,102 pts)

### International (2)
21. Kotak US Equity Fund - Growth (1,174 pts)
22. Kotak World Gold Fund - Growth (1,201 pts)

### Borderline / Needs Manual Review (3)
- Navi ELSS Tax Saver Fund (is this different from existing Navi ELSS Nifty 50 Index?)
- Tata S&P BSE Sensex Index Fund (3,316 pts) — may overlap with Tata Nifty 50
- HDFC Long Term Advantage Plan (closed ELSS scheme?)

---

*End of audit report.*
