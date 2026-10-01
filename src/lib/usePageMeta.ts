/**
 * Dynamic page title and meta description.
 * Updates document.title and the meta description tag on every route change.
 * Since this is a client-rendered SPA (HashRouter), this is the only way
 * to get per-page titles in browser tabs and bookmarks.
 */
import { useEffect } from 'react'
import fundsData from '../data/funds.json'

const BASE_TITLE = 'FairFund'
const FUND_COUNT = (fundsData as { totalFunds: number }).totalFunds
const DEFAULT_DESC = `Research ${FUND_COUNT} Indian mutual funds using performance history and published portfolio disclosures.`

export function usePageMeta(title?: string, description?: string) {
  useEffect(() => {
    // Title
    document.title = title ? `${title} | ${BASE_TITLE}` : `${BASE_TITLE} | Indian Mutual Fund Research`

    // Meta description
    const meta = document.querySelector('meta[name="description"]')
    if (meta) {
      meta.setAttribute('content', description ?? DEFAULT_DESC)
    }
  }, [title, description])
}
