import { useState } from 'react'
import type { Fund } from '../types'

interface Props {
  fund: Fund
  className?: string
}

export default function ShareButton({ fund, className = '' }: Props) {
  const [copied, setCopied] = useState(false)

  const url = `${window.location.origin}${import.meta.env.BASE_URL}fund/${fund.code}`
  const rank = fund.metrics['3Y']?.catRank
  const text = [
    fund.name,
    rank ? `Rank #${rank} in ${fund.categoryDisplay}` : fund.categoryDisplay,
    fund.metrics['3Y']?.cagr != null ? `3Y CAGR: ${fund.metrics['3Y'].cagr}%` : '',
    'via FairFund',
  ].filter(Boolean).join(' | ')

  async function handleShare() {
    // Use Web Share API if available (mobile)
    if (navigator.share) {
      try {
        await navigator.share({ title: fund.name, text, url })
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
      title="Share this fund"
    >
      {copied ? (
        <>
          <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm text-emerald-600">Copied!</span>
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          <span className="text-sm">Share</span>
        </>
      )}
    </button>
  )
}
