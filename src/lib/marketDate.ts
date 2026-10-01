/**
 * Indian-market calendar date, used as the upper bound for every NAV date the
 * site ingests or displays.
 *
 * Why a dedicated helper: `new Date()` formatting depends on the browser's
 * timezone, so a user in Los Angeles would compute a "today" one day behind the
 * Indian market and hide a legitimately published NAV, while a user in Auckland
 * would compute one day ahead and let a forward-dated liquid-fund NAV through.
 * IST is UTC+05:30 year round (no DST), so the market date is a fixed shift of
 * the UTC instant, which makes it identical for every client.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a YYYY-MM-DD string that is also a real calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false
  const y = Number(value.slice(0, 4))
  const m = Number(value.slice(5, 7))
  const d = Number(value.slice(8, 10))
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(Date.UTC(y, m - 1, d))
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  )
}

/** Today's date in India (UTC+05:30) as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** True when `iso` is malformed or dated after the Indian market date. */
export function isFutureOrInvalidNavDate(iso: unknown, todayIso: string = istToday()): boolean {
  return !isIsoDate(iso) || iso > todayIso
}

/**
 * Drop NAV points whose date is malformed or dated beyond the Indian market
 * date. AMFI stamps some liquid-fund NAVs with the next business day, and those
 * points must never reach charts, returns or the headline "NAV as of" date.
 */
export function dropFutureNavPoints<T extends { date: string }>(
  points: T[],
  todayIso: string = istToday()
): T[] {
  return points.filter((p) => !isFutureOrInvalidNavDate(p.date, todayIso))
}
