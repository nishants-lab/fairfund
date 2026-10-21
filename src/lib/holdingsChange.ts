/**
 * Whether a holdings table can show a month-on-month change column.
 *
 * `change` is null for a stock that was not in the previous snapshot, which the
 * table labels "New". With no previous snapshot at all (a new fund, or a fund
 * whose history was reset because it had been read from another fund's page)
 * every holding is null, and labelling them all "New" would say the whole
 * portfolio was bought this month. The column needs at least one real number.
 */
export function hasMonthOnMonth(holdings: { change?: number | null }[]): boolean {
  return holdings.some((h) => typeof h.change === 'number' && Number.isFinite(h.change))
}
