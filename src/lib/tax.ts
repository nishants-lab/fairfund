/**
 * Capital-gains tax treatment for Indian mutual funds, current as of the
 * Union Budget 2024 changes (effective 23 July 2024) and the FY2025-26
 * "specified mutual fund" definition. Pure, presentational classification -
 * NOT tax advice. Rates shown exclude surcharge and cess.
 *
 * Three buckets:
 *  - equity : equity-oriented schemes (>=65% Indian listed equity), incl.
 *             arbitrage. STCG 20% (<12m), LTCG 12.5% over Rs.1.25L (>=12m). ELSS
 *             sits here too but its 3yr lock-in makes every exit long-term, so
 *             the STCG row is suppressed for it (see the equity branch).
 *  - debt   : "specified" debt funds (liquid, money market, target-maturity
 *             bond index). Entire gain at slab rate, any holding period.
 *  - other  : international/overseas and gold/silver funds. STCG at slab (<24m),
 *             LTCG 12.5% no indexation (>=24m).
 */
import type { Fund } from '../types'

export type TaxClass = 'equity' | 'debt' | 'other'

// Target-maturity / bond index funds sit inside "Index-*" categories by AMFI
// taxonomy but are taxed as debt. Detect by name.
const DEBT_INDEX =
  /\bIBX\b|Gilt|G-?Sec|\bSDL\b|Target Maturity|Constant Maturity|Bharat Bond|Banking\s*&?\s*PSU Debt/i
const GOLD_SILVER = /\bGold\b|\bSilver\b|Precious Metal/i

export function taxClass(f: Fund): TaxClass {
  if (f.isDebt) return 'debt' // Liquid, Money Market
  if (DEBT_INDEX.test(f.name)) return 'debt'
  if (f.category === 'International') return 'other'
  if (GOLD_SILVER.test(f.name)) return 'other'
  return 'equity' // all domestic equity, incl. arbitrage and ELSS
}

export interface TaxRow {
  label: string
  value: string
  hint: string
}

export interface TaxInfo {
  cls: TaxClass
  heading: string
  rows: TaxRow[]
  note: string
  extras: string[] // e.g. ELSS lock-in / 80C
}

export function taxInfo(f: Fund): TaxInfo {
  const cls = taxClass(f)
  const isELSS = f.category === 'ELSS'
  const extras: string[] = []
  if (isELSS) {
    extras.push('Lock-in of 3 years - each SIP installment is locked separately from its own date.')
    extras.push('Eligible for a deduction of up to Rs.1.5 lakh under Section 80C (old tax regime only).')
  }

  if (cls === 'debt') {
    return {
      cls,
      heading: 'Taxed as a debt fund',
      rows: [
        {
          label: 'Any holding period (units bought on/after 1 Apr 2023)',
          value: 'Your slab rate',
          hint: 'The whole gain is added to your income and taxed at your income-tax slab rate, no matter how long you hold.',
        },
      ],
      note: 'This is a debt-oriented fund. For units bought on or after 1 April 2023 the entire gain is taxed at your slab rate, with no long-term concession and no indexation. Units bought before that date still follow the old rules (20% with indexation once held over 3 years).',
      extras,
    }
  }

  if (cls === 'other') {
    return {
      cls,
      heading: 'Taxed as a non-equity fund',
      rows: [
        {
          label: 'Short-term (held under 24 months)',
          value: 'Your slab rate',
          hint: 'Gain is added to your income and taxed at your income-tax slab.',
        },
        {
          label: 'Long-term (held 24 months or more)',
          value: '12.5%',
          hint: 'Flat 12.5% with no indexation benefit.',
        },
      ],
      note: 'Not treated as an equity fund for Indian tax because of its overseas or non-equity exposure.',
      extras,
    }
  }

  // equity
  const stcgRow: TaxRow = {
    label: 'Short-term (held under 12 months)',
    value: '20%',
    hint: 'Flat 20% on the gain (Section 111A).',
  }
  const ltcgRow: TaxRow = {
    label: 'Long-term (held 12 months or more)',
    value: '12.5%',
    hint: 'On gains above Rs.1.25 lakh per financial year, across all your equity funds and shares (Section 112A).',
  }
  // ELSS has a mandatory 3-year lock-in, so no unit can ever be redeemed inside
  // 12 months. Every exit is long-term by definition; showing a short-term row
  // would be misleading, so we drop it for ELSS.
  const rows: TaxRow[] = isELSS ? [ltcgRow] : [stcgRow, ltcgRow]
  return {
    cls,
    heading: 'Taxed as an equity fund',
    rows,
    note: isELSS
      ? 'Equity-oriented scheme. The mandatory 3-year lock-in means every redemption is long-term, so gains are always taxed at 12.5% above the Rs.1.25 lakh annual exemption (Section 112A).'
      : f.isArbitrage
      ? 'Arbitrage funds are equity-oriented for tax despite their low, cash-like risk, which is what makes them tax-efficient versus a liquid fund.'
      : 'Equity-oriented scheme (at least 65% in Indian listed equity).',
    extras,
  }
}
