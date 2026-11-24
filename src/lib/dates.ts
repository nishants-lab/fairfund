/** Month names for every date the app shows.
 *  Browsers format en-IN September as 'Sept' (ICU), while the pre-built pages and
 *  share images print 'Sep'. One fixed table keeps every page on '30 Sep 2026'. */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const valid = (d: Date) => !Number.isNaN(d.getTime())

/** 'Sep' for a local Date. */
export function monthAbbr(d: Date): string {
  return valid(d) ? MONTHS[d.getMonth()] : 'Invalid Date'
}

/** '30 Sep 2026' for a local Date. */
export function dayMonthYear(d: Date): string {
  return valid(d) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'Invalid Date'
}

/** 'Sep 2026' for a local Date; 'Sep 26' with short = true. */
export function monthYear(d: Date, short = false): string {
  if (!valid(d)) return 'Invalid Date'
  return `${MONTHS[d.getMonth()]} ${short ? String(d.getFullYear()).slice(-2) : d.getFullYear()}`
}
