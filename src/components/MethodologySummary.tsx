import { useState } from 'react'
import { ask, getLlmConfig } from '../lib/llm'

const PRESET_SUMMARY = `In plain English: most websites rank a fund using whatever time period makes it look best. We don't. We check every fund over the exact same dates, only compare it to similar funds (small-cap vs small-cap, never small-cap vs large-cap), and measure whether the manager genuinely did better than the average fund of its type. We also let you test any fund over any time window you like. The goal is simple: show you the real picture, not a flattering one.`

export default function MethodologySummary() {
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  async function generate() {
    setLoading(true)
    setExpanded(true)
    const hasKey = !!getLlmConfig()
    if (!hasKey) {
      // Use the curated plain-English summary instantly
      setSummary(PRESET_SUMMARY)
      setLoading(false)
      return
    }
    const { text } = await ask(
      'Explain FairFund’s methodology to a complete beginner in 4-5 simple sentences. No jargon. Make it reassuring and clear why it’s more trustworthy than typical fund websites.',
    )
    setSummary(text)
    setLoading(false)
  }

  return (
    <div className="card overflow-hidden border-l-4 border-l-accent">
      <button
        onClick={() => (summary ? setExpanded((e) => !e) : generate())}
        className="flex w-full items-center justify-between gap-3 p-5 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-xl">
            ✨
          </div>
          <div>
            <div className="font-bold text-fg">Explain this simply</div>
            <div className="text-sm text-muted">
              Get a plain-English summary - no finance background needed.
            </div>
          </div>
        </div>
        <svg
          className={`h-5 w-5 shrink-0 text-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-line px-5 pb-5 pt-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2 w-2 animate-bounce rounded-full bg-faint [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-faint [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-faint" />
              <span className="ml-1">Summarizing…</span>
            </div>
          ) : (
            <p className="leading-relaxed text-muted">{summary}</p>
          )}
          {!getLlmConfig() && summary && (
            <p className="mt-3 text-xs text-faint">
              This is our built-in summary. Add your own AI key in the chat (💬 bottom-right) for a
              personalised explanation.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
