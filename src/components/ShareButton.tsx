import { useState } from 'react'
import type { Fund } from '../types'
import { fundSlug } from '../lib/format'

interface Props {
  /** When given, shares a canonical link to this fund's detail page. */
  fund?: Fund
  /** Generic share: title/text/url for non-fund artifacts (analysis pages). */
  title?: string
  text?: string
  /** Defaults to the current in-app URL (already a hash route). */
  shareUrl?: string
  /** Button label; set to '' for an icon-only egress. */
  label?: string
  className?: string
}

// import.meta.env.BASE_URL is '/fairfund/' in prod and './' under local
// preview. Normalise so the hash link is well-formed in both.
function appBase() {
  const b = import.meta.env.BASE_URL
  return b === './' || b === '' ? '/' : b
}

export default function ShareButton({ fund, title, text, shareUrl, label = 'Share', className = '' }: Props) {
  const [copied, setCopied] = useState(false)

  let url: string
  let shareTitle: string
  let shareText: string

  if (fund) {
    // HashRouter link: bare deep links (no #) break routing and asset paths.
    url = `${window.location.origin}${appBase()}#/fund/${fund.code}/${fundSlug(fund.name)}`
    const rank = fund.metrics['3Y']?.catRank
    shareTitle = fund.name
    shareText = [
      fund.name,
      rank ? `Rank #${rank} in ${fund.categoryDisplay}` : fund.categoryDisplay,
      fund.metrics['3Y']?.cagr != null ? `3Y CAGR: ${fund.metrics['3Y'].cagr}%` : '',
      'via FairFund',
    ].filter(Boolean).join(' | ')
  } else {
    // Current URL is already a hash route (e.g. .../#/compare?codes=...).
    url = shareUrl ?? window.location.href
    shareTitle = title ?? 'FairFund'
    shareText = text ? `${text} | via FairFund` : `${shareTitle} | via FairFund`
  }

  async function handleShare() {
    // Use Web Share API if available (mobile)
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url })
        return
      } catch {
        // user cancelled or API failed - fall through to clipboard
      }
    }
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // last resort: select + copy
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleShare}
      className={`btn-ghost inline-flex items-center gap-1.5 ${className}`}
      title={fund ? 'Share this fund' : 'Share this view'}
      aria-label={fund ? 'Share this fund' : 'Share this view'}
    >
      {copied ? (
        <>
          <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {label !== '' && <span className="text-sm text-emerald-600">Copied!</span>}
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          {label !== '' && <span className="text-sm">{label}</span>}
        </>
      )}
    </button>
  )
}
