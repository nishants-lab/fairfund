/**
 * Portfolio types, localStorage persistence, and analysis helpers.
 * Local-first: no Supabase dependency. Auth sync layers on later.
 */
import { useState, useEffect } from 'react'
import { getFund, fetchFundDetail, mergeFundDetail } from './data'
import { getUniverseFund, universeCategoryLabel } from './matcherUniverse'
import type { Fund, Holding } from '../types'

// ---- Types ----

export interface Transaction {
  fundCode: number
  fundName: string       // original name from CAMS (for display)
  date: string           // ISO yyyy-mm-dd
  type: 'purchase' | 'redeem' | 'sip' | 'switch_in' | 'switch_out' | 'dividend'
  units: number
  amount: number         // INR
  nav: number
}

export interface FundSummary {
  fundCode: number
  fundName: string
  closingUnits: number   // from CAMS Closing Unit Balance
  totalCost: number      // from CAMS Total Cost Value
  latestNav: number      // from CAMS 'NAV on' line
  marketValue: number    // from CAMS 'Market Value on' line
}

export interface ParsedPortfolio {
  id: string             // unique ID per upload
  uploadedAt: string     // ISO datetime
  matcherVersion?: number // version of the fund-matching logic used at parse time
  investorName: string
  pan: string            // masked (last 4 only)
  transactions: Transaction[]
  fundSummaries: FundSummary[]  // source of truth for current holdings
  fundCodes: number[]    // unique codes found
  diagnostics?: ParseDiagnostics
}

export interface ParseDiagnostics {
  isinCount: number          // ISIN markers (schemes) found in the raw statement
  schemesParsed: number      // fund blocks we successfully built (active + closed)
  activeHoldings: number     // blocks with a non-zero closing balance
  closedPositions: number    // parsed blocks fully redeemed (zero balance)
  missingValueFunds: string[] // active holdings where no value could be read
  statedTotalValue: number | null // CAS Portfolio Summary total market value, if found
}

export interface PortfolioHolding {
  code: number
  name: string
  category: string
  categoryDisplay: string
  units: number
  invested: number       // total amount invested (net of redemptions)
  currentValue: number   // units * latest NAV
  latestNav: number
  gain: number           // currentValue - invested
  gainPct: number        // gain / invested * 100
  weight: number         // % of total portfolio
  fund?: Fund            // linked FairFund data (for signals)
  covered: boolean       // true if matched to a FairFund equity fund
  prevNav: number        // previous NAV (for day-over-day), 0 if unknown
  dayChangeValue: number // value change vs previous NAV day
  dayChangePct: number   // NAV % change vs previous day
  personalCagr: number | null // your money-weighted annualized return (XIRR) from CAMS history, null if not computable
}

export interface ConcentrationItem {
  name: string
  weight: number         // % of total portfolio
  sector?: string | null
  fundCount: number      // how many funds hold this
  holders: { name: string; code: number; weight: number }[] // per-fund contribution to this stock's portfolio weight
}

export interface PortfolioAnalysis {
  holdings: PortfolioHolding[]
  totalInvested: number
  totalValue: number
  totalGain: number
  totalGainPct: number
  sectorConcentration: { sector: string; weight: number }[]
  stockConcentration: ConcentrationItem[]
  managerAlerts: { fundName: string; code: number; alert: string }[]
  reshuffleScore: { code: number; name: string; rankAtPurchase: number | null; rankNow: number | null; drift: number | null; cagr: number | null }[]
  dayChangeValue: number   // portfolio value change vs previous NAV day
  dayChangePct: number     // portfolio % change vs previous NAV day
  navAsOf: string          // date of latest NAV used (yyyy-mm-dd), '' if none
  navPrevAsOf: string      // date of previous NAV used, '' if none
  dayCoveredValue: number  // value of holdings that had a 2-point NAV history
}

// ---- localStorage ----

const STORAGE_KEY = 'fairfund_portfolio'

function readPortfolio(): ParsedPortfolio | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ParsedPortfolio
  } catch {
    return null
  }
}

function writePortfolio(p: ParsedPortfolio): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  window.dispatchEvent(new CustomEvent('portfolio-change'))
}

export function clearPortfolio(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new CustomEvent('portfolio-change'))
}

export function savePortfolio(p: ParsedPortfolio): void {
  writePortfolio(p)
}

export function getPortfolio(): ParsedPortfolio | null {
  return readPortfolio()
}

export function usePortfolio(): ParsedPortfolio | null {
  const [p, setP] = useState(readPortfolio)
  useEffect(() => {
    const handler = () => setP(readPortfolio())
    window.addEventListener('portfolio-change', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('portfolio-change', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])
  return p
}

// ---- Money-weighted return (XIRR) ----
//
// Your personal annualized return, accounting for the timing of every SIP /
// lump-sum. Absolute gain % can't be compared across holdings bought at
// different times; XIRR can. Cashflows: money invested is negative, money
// received (redemptions, and the current value as a terminal inflow) positive.

interface CashFlow { when: number; amount: number } // when = epoch ms

function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null
  if (!flows.some(f => f.amount < 0) || !flows.some(f => f.amount > 0)) return null
  const sorted = [...flows].sort((a, b) => a.when - b.when)
  const t0 = sorted[0].when
  const YEAR = 365 * 24 * 3600 * 1000
  const yearsOf = (w: number) => (w - t0) / YEAR
  const npv = (r: number) => sorted.reduce((acc, f) => acc + f.amount / Math.pow(1 + r, yearsOf(f.when)), 0)

  // Bisection over a wide, safe bracket (robust; no divergence).
  let lo = -0.9999, hi = 100
  let flo = npv(lo)
  const fhi = npv(hi)
  if ((flo < 0) === (fhi < 0)) return null // no sign change -> no root in range
  let mid = 0
  for (let i = 0; i < 200; i++) {
    mid = (lo + hi) / 2
    const fmid = npv(mid)
    if (Math.abs(fmid) < 1e-7) break
    if ((flo < 0) === (fmid < 0)) { lo = mid; flo = fmid } else { hi = mid }
  }
  if (!isFinite(mid)) return null
  return mid * 100
}

// ---- Analysis ----

export async function analyzePortfolio(portfolio: ParsedPortfolio): Promise<PortfolioAnalysis> {
  // 1. Use fund summaries (Closing Unit Balance) as source of truth
  //    Falls back to transaction netting only if no summaries available
  const summaries = portfolio.fundSummaries ?? []
  const hasSummaries = summaries.length > 0

  const holdings: PortfolioHolding[] = []
  const detailPromises: Promise<void>[] = []

  if (hasSummaries) {
    // Merge multiple folios of the same fund (sum units, cost, market value)
    const byCode = new Map<number, FundSummary>()
    for (const s of summaries) {
      if (s.closingUnits <= 0.001) continue // fully redeemed, skip
      const key = s.fundCode > 0 ? s.fundCode : -(byCode.size + 1) // unmatched funds stay separate
      const existing = byCode.get(key)
      if (existing) {
        existing.closingUnits += s.closingUnits
        existing.totalCost += s.totalCost
        existing.marketValue += s.marketValue
        if (s.latestNav > 0) existing.latestNav = s.latestNav
      } else {
        byCode.set(key, { ...s })
      }
    }

    for (const s of byCode.values()) {
      const fund = getFund(s.fundCode)
      if (fund) {
        detailPromises.push(
          fetchFundDetail(s.fundCode).then(d => { mergeFundDetail(fund, d) })
        )
      }
      const uni = fund ? undefined : getUniverseFund(s.fundCode)
      holdings.push({
        code: s.fundCode,
        name: fund?.name ?? uni?.name ?? s.fundName,
        category: fund?.category ?? (uni ? universeCategoryLabel(uni.amfiCategory) : 'Unknown'),
        categoryDisplay: fund?.categoryDisplay ?? (uni ? universeCategoryLabel(uni.amfiCategory) : 'Unknown'),
        units: s.closingUnits,
        invested: s.totalCost,
        currentValue: s.marketValue || s.closingUnits * s.latestNav,
        latestNav: s.latestNav,
        gain: 0,
        gainPct: 0,
        weight: 0,
        fund,
        covered: !!fund,
        prevNav: 0,
        dayChangeValue: 0,
        dayChangePct: 0,
        personalCagr: null,
      })
    }
  } else {
    // Fallback: net transactions
    const unitMap = new Map<number, { units: number; invested: number; name: string }>()
    for (const tx of portfolio.transactions) {
      const entry = unitMap.get(tx.fundCode) ?? { units: 0, invested: 0, name: tx.fundName }
      if (tx.type === 'purchase' || tx.type === 'sip' || tx.type === 'switch_in') {
        entry.units += tx.units
        entry.invested += tx.amount
      } else if (tx.type === 'redeem' || tx.type === 'switch_out') {
        entry.units -= tx.units
        entry.invested -= tx.amount
      }
      unitMap.set(tx.fundCode, entry)
    }
    for (const [code, entry] of unitMap) {
      if (entry.units <= 0.001) continue
      const fund = getFund(code)
      if (fund) {
        detailPromises.push(
          fetchFundDetail(code).then(d => { mergeFundDetail(fund, d) })
        )
      }
      const uni = fund ? undefined : getUniverseFund(code)
      holdings.push({
        code,
        name: fund?.name ?? uni?.name ?? entry.name,
        category: fund?.category ?? (uni ? universeCategoryLabel(uni.amfiCategory) : 'Unknown'),
        categoryDisplay: fund?.categoryDisplay ?? (uni ? universeCategoryLabel(uni.amfiCategory) : 'Unknown'),
        units: entry.units,
        invested: Math.max(entry.invested, 0),
        currentValue: 0,
        latestNav: 0,
        gain: 0,
        gainPct: 0,
        weight: 0,
        fund,
        covered: !!fund,
        prevNav: 0,
        dayChangeValue: 0,
        dayChangePct: 0,
        personalCagr: null,
      })
    }
  }

  await Promise.all(detailPromises)

  // Personal money-weighted return (XIRR) per holding, from your CAMS history.
  const txByCode = new Map<number, Transaction[]>()
  for (const tx of portfolio.transactions) {
    const list = txByCode.get(tx.fundCode)
    if (list) list.push(tx)
    else txByCode.set(tx.fundCode, [tx])
  }
  const nowMs = Date.now()
  for (const h of holdings) {
    const txs = txByCode.get(h.code)
    if (!txs || txs.length === 0 || h.currentValue <= 0) continue
    const flows: CashFlow[] = []
    for (const tx of txs) {
      const when = new Date(tx.date).getTime()
      if (isNaN(when) || tx.amount <= 0) continue
      const isInflow = tx.type === 'redeem' || tx.type === 'switch_out' || tx.type === 'dividend'
      flows.push({ when, amount: isInflow ? tx.amount : -tx.amount })
    }
    flows.push({ when: nowMs, amount: h.currentValue })
    h.personalCagr = xirr(flows)
  }

  // 2. Current value stays anchored to the CAMS-stated market value (the source
  //    of truth, and what matches the statement). Our self-hosted NAV history is
  //    used only to derive the most recent 1-day move, scaled onto that value.
  //    We deliberately do NOT recompute value as units x ourNAV: our NAV can lag
  //    the statement date and may differ by plan, which distorts the total.
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'
  const b = base.endsWith('/') ? base : base + '/'
  let navAsOf = ''
  let navPrevAsOf = ''
  await Promise.all(holdings.map(async (h) => {
    try {
      const res = await fetch(`${b}nav/${h.code}.json?v=${Date.now()}`)
      if (res.ok) {
        const j = await res.json() as { d: string[]; v: number[] }
        if (j.v && j.v.length >= 2) {
          const n = j.v.length
          const navLatest = j.v[n - 1]
          const navPrev = j.v[n - 2]
          if (navPrev > 0 && navLatest > 0) {
            h.prevNav = navPrev
            const r = (navLatest - navPrev) / navPrev // 1-day return fraction
            h.dayChangePct = r * 100
            const valuePrev = h.currentValue / (1 + r)
            h.dayChangeValue = h.currentValue - valuePrev
            if (j.d && j.d.length >= 2) {
              if (!navAsOf || j.d[n - 1] > navAsOf) navAsOf = j.d[n - 1]
              if (!navPrevAsOf || j.d[n - 2] > navPrevAsOf) navPrevAsOf = j.d[n - 2]
            }
          }
        }
      }
    } catch { /* fund may not have NAV file */ }
  }))

  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0)
  const totalInvested = holdings.reduce((s, h) => s + h.invested, 0)
  // Day-over-day: only holdings with a real previous NAV point contribute
  const dayChangeValue = holdings.reduce((s, h) => s + h.dayChangeValue, 0)
  const dayCoveredValue = holdings.reduce((s, h) => s + (h.prevNav > 0 ? h.currentValue : 0), 0)
  const dayPrevValue = holdings.reduce((s, h) => s + (h.prevNav > 0 ? (h.currentValue - h.dayChangeValue) : 0), 0)
  const dayChangePct = dayPrevValue > 0 ? (dayChangeValue / dayPrevValue) * 100 : 0

  for (const h of holdings) {
    h.gain = h.currentValue - h.invested
    h.gainPct = h.invested > 0 ? (h.gain / h.invested) * 100 : 0
    h.weight = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0
  }

  holdings.sort((a, b) => b.weight - a.weight)

  // 4. Sector concentration (aggregate across all funds' underlying holdings)
  const sectorMap = new Map<string, number>()
  const stockMap = new Map<string, { weight: number; sector?: string | null; holders: Map<number, { name: string; weight: number }> }>()

  for (const h of holdings) {
    const fundHoldings = h.fund?.holdings
    if (!fundHoldings) continue
    for (const stock of fundHoldings) {
      const stockWeight = (stock.pct / 100) * h.weight // portfolio-weighted
      const sector = stock.sector ?? 'Other'
      sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + stockWeight)

      const key = (stock.key ?? stock.name).toLowerCase()
      const existing = stockMap.get(key)
      if (existing) {
        existing.weight += stockWeight
        const hh = existing.holders.get(h.code)
        if (hh) hh.weight += stockWeight
        else existing.holders.set(h.code, { name: h.name, weight: stockWeight })
      } else {
        stockMap.set(key, { weight: stockWeight, sector: stock.sector, holders: new Map([[h.code, { name: h.name, weight: stockWeight }]]) })
      }
    }
  }

  const sectorConcentration = [...sectorMap.entries()]
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight)

  const stockConcentration: ConcentrationItem[] = [...stockMap.entries()]
    .map(([key, v]) => ({
      name: key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      weight: v.weight,
      sector: v.sector,
      fundCount: v.holders.size,
      holders: [...v.holders.entries()].map(([code, hh]) => ({ name: hh.name, code, weight: hh.weight }))
        .sort((a, b) => b.weight - a.weight),
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 20)

  // 5. Manager alerts
  const managerAlerts: PortfolioAnalysis['managerAlerts'] = []
  for (const h of holdings) {
    const mgmt = h.fund?.management
    if (!mgmt?.available) continue
    if (mgmt.avgTenureYears != null && mgmt.avgTenureYears < 1) {
      managerAlerts.push({
        fundName: h.name,
        code: h.code,
        alert: `Manager tenure ${mgmt.avgTenureYears.toFixed(1)} years (new appointment)`,
      })
    }
    if (mgmt.signal === 'Mixed' || mgmt.signal === 'Limited evidence') {
      managerAlerts.push({
        fundName: h.name,
        code: h.code,
        alert: `Manager signal: ${mgmt.signal}`,
      })
    }
  }

  // 6. Reshuffle score (rank drift since first purchase)
  const reshuffleScore: PortfolioAnalysis['reshuffleScore'] = []
  for (const h of holdings) {
    if (!h.covered) continue
    const trajectory = h.fund?.analytics?.rankTrajectory
    if (!trajectory) {
      reshuffleScore.push({ code: h.code, name: h.name, rankAtPurchase: null, rankNow: null, drift: null, cagr: h.fund?.metrics['3Y']?.cagr ?? null })
      continue
    }
    reshuffleScore.push({
      code: h.code,
      name: h.name,
      rankAtPurchase: trajectory.priorRank,
      rankNow: trajectory.currentRank,
      drift: trajectory.currentRank - trajectory.priorRank,
      cagr: h.fund?.metrics['3Y']?.cagr ?? null,
    })
  }

  return {
    holdings,
    totalInvested,
    totalValue,
    totalGain: totalValue - totalInvested,
    totalGainPct: totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
    sectorConcentration,
    stockConcentration,
    managerAlerts,
    reshuffleScore,
    dayChangeValue,
    dayChangePct,
    navAsOf,
    navPrevAsOf,
    dayCoveredValue,
  }
}
