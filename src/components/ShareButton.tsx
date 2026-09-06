import { useRef, useState } from 'react'
import type { Fund } from '../types'
import { fundSlug } from '../lib/format'
import ShareCard from './ShareCard'

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

// Touch-first devices (phones/tablets) get the native share sheet; pointer
// devices (desktop) get the richer image-to-clipboard path.
function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
}

export default function ShareButton({ fund, title, text, shareUrl, label = 'Share', className = '' }: Props) {
  const [copied, setCopied] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

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
      fund.metrics['3Y']?.cagr != null ? `3Y CAGR: ${fund.metrics['3Y'].cagr.toFixed(1)}%` : '',
      'via FairFund',
    ].filter(Boolean).join(' | ')
  } else {
    // Current URL is already a hash route (e.g. .../#/compare?codes=...).
    url = shareUrl ?? window.location.href
    shareTitle = title ?? 'FairFund'
    shareText = text ? `${text} | via FairFund` : `${shareTitle} | via FairFund`
  }

  function flashCopied() {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Rasterise the off-screen ShareCard to a PNG blob. Returns null on any error
  // or when there is no card mounted (non-fund share).
  async function renderPng(): Promise<Blob | null> {
    const node = cardRef.current
    if (!node) return null
    try {
      const { toBlob } = await import('html-to-image')
      // skipFonts: the card uses a system font stack, so embedding web fonts is
      // pointless and can hang on cross-origin font CSS in some browsers.
      return await toBlob(node, { pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: true })
    } catch {
      return null
    }
  }

  // Text-only clipboard fallback (used when there is no card to snapshot, or
  // when image-to-clipboard is unsupported / fails).
  async function copyTextFallback() {
    try {
      await navigator.clipboard.writeText(url)
      flashCopied()
    } catch {
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      flashCopied()
    }
  }

  async function handleShare() {
    // ---- Touch devices: native share sheet, with the card image as a file
    // when the platform supports file sharing, else the deep link. ----
    if (fund && isTouchDevice() && navigator.share) {
      const png = await renderPng()
      const file = png ? new File([png], `${fundSlug(fund.name)}-fairfund.png`, { type: 'image/png' }) : null
      try {
        if (file && navigator.canShare?.({ files: [file] })) {
          await navigator.share({ title: shareTitle, text: shareText, files: [file] })
        } else {
          await navigator.share({ title: shareTitle, text: shareText, url })
        }
        return
      } catch {
        // user cancelled or failed - fall through to clipboard
      }
    }

    // ---- Desktop (or non-fund): copy the card image + link to the clipboard,
    // as a multi-type ClipboardItem so a paste yields the picture where images
    // are supported and the URL where only text is. ----
    if (fund && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const png = await renderPng()
      if (png) {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': png, 'text/plain': new Blob([url], { type: 'text/plain' }) }),
          ])
          flashCopied()
          return
        } catch {
          // image-clipboard blocked (permissions/browser) - fall through to text
        }
      }
    }

    // Non-fund share on a touch device: try the native sheet for the link.
    if (!fund && isTouchDevice() && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url })
        return
      } catch {
        // fall through
      }
    }

    await copyTextFallback()
  }

  return (
    <>
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

      {/* Off-screen share card, rasterised on demand. Kept mounted (not
          display:none) so html-to-image can measure and capture it. */}
      {fund && (
        <div aria-hidden="true" style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', opacity: 0 }}>
          <ShareCard ref={cardRef} fund={fund} />
        </div>
      )}
    </>
  )
}
