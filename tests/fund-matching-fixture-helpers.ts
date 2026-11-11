/**
 * Shared CAMS statement builders for the fund-matching suites. Pure text
 * fixtures: no fund identities live here.
 */
import assert from 'node:assert/strict'
import { parseCAMSText } from '../src/lib/camsParser'

export const AS_OF = '30-Sep-2026'

export interface BlockFixture {
  scheme: string
  isin?: string
  units?: number
  cost?: number
  nav?: number
  value?: number
  /** Raw transaction rows, written exactly as a statement prints them. */
  rows?: string[]
}

/**
 * Minimal but structurally faithful CAMS block: the header carries an ISIN (the
 * marker production relies on), followed by the balance / NAV / value lines.
 */
export function block(f: BlockFixture): string {
  const units = f.units ?? 100
  const nav = f.nav ?? 50
  return [
    `${f.scheme} - ISIN : ${f.isin ?? 'INF000000000'}`,
    'Opening Unit Balance: 0.000',
    ...(f.rows ?? []),
    `NAV on ${AS_OF}: INR ${nav.toFixed(4)}   Market Value on ${AS_OF}: INR ${(f.value ?? units * nav).toFixed(2)}`,
    `Closing Unit Balance: ${units.toFixed(3)}   Total Cost Value: ${(f.cost ?? units * nav * 0.8).toFixed(2)}`,
  ].join('\n')
}

export function statement(blocks: BlockFixture[]): string {
  return [
    'CONSOLIDATED ACCOUNT STATEMENT',
    'PAN : ABCDE1234F',
    'Folio No : 12345678 / 11   Test Investor',
    ...blocks.map(block),
  ].join('\n')
}

/** Resolve one statement scheme name through the production parser. */
export function resolve(scheme: string): number | null {
  const parsed = parseCAMSText(statement([{ scheme }]))
  assert.equal(parsed.fundSummaries.length, 1, `expected exactly one block for: ${scheme}`)
  const code = parsed.fundSummaries[0].fundCode
  return code > 0 ? code : null
}
