/**
 * Dynamic page title and meta description.
 * Updates document.title and the meta description tag on every route change.
 * Since this is a client-rendered SPA (HashRouter), this is the only way
 * to get per-page titles in browser tabs and bookmarks.
 */
import { useEffect } from 'react'

const BASE_TITLE = 'FairFund'
const DEFAULT_DESC =
  'Independent mutual fund research for India. Backward-tested analysis across 838 equity funds.'

export function usePageMeta(title?: string, description?: string) {
  useEffect(() => {
    // Title
    document.title = title ? `${title} | ${BASE_TITLE}` : `${BASE_TITLE} - Forward-looking MF Research for India`

    // Meta description
    const meta = document.querySelector('meta[name="description"]')
    if (meta) {
      meta.setAttribute('content', description ?? DEFAULT_DESC)
    }
  }, [title, description])
}
