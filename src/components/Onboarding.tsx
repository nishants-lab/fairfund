import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const SEEN_KEY = 'ff-onboarded'

interface Step {
  emoji: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    emoji: '👋',
    title: 'Welcome to FairFund',
    body: 'A smarter, forward-looking way to research Indian mutual funds. We do the heavy number-crunching - backward-tested and probability-based - so you can make confident decisions. No finance degree needed.',
  },
  {
    emoji: '⚖️',
    title: 'We compare funds fairly',
    body: 'Other sites can make a fund look great by picking a flattering time period. We check every fund over the same timeframes and show whether the manager truly beat similar funds - not just got lucky with a good year.',
  },
  {
    emoji: '🗓️',
    title: 'Analyse any time period',
    body: 'Want to see how a fund did in the last 6 months, or between two specific dates? Drag a slider or pick dates, and every number updates instantly. That flexibility is our superpower.',
  },
  {
    emoji: '🎯',
    title: 'Start with your goal',
    body: 'Tell us what you’re saving for and how much you can invest. We’ll show whether your target is realistic and point you to funds that fit. Ready?',
  },
]

export default function Onboarding() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    const seen = localStorage.getItem(SEEN_KEY)
    if (!seen) {
      // small delay so it doesn't flash on first paint
      const t = setTimeout(() => setOpen(true), 400)
      return () => clearTimeout(t)
    }
  }, [])

  function finish(dest?: string) {
    localStorage.setItem(SEEN_KEY, '1')
    setOpen(false)
    if (dest) navigate(dest)
  }

  if (!open) return null

  const s = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => finish()}
      />
      {/* Card */}
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-surface shadow-2xl">
        {/* Progress bar */}
        <div className="flex gap-1.5 px-6 pt-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-brand-500' : 'bg-surface2'
              }`}
            />
          ))}
        </div>

        <div className="px-6 pb-6 pt-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-4xl dark:bg-brand-900/30">
            {s.emoji}
          </div>
          <h2 className="mt-5 text-xl font-extrabold text-fg">{s.title}</h2>
          <p className="mt-2 text-muted">{s.body}</p>

          <div className="mt-7 flex items-center justify-between gap-3">
            <button
              onClick={() => finish()}
              className="text-sm font-medium text-faint hover:text-muted"
            >
              Skip
            </button>

            <div className="flex items-center gap-2">
              {step > 0 && (
                <button onClick={() => setStep((s) => s - 1)} className="btn-ghost px-4 py-2 text-sm">
                  Back
                </button>
              )}
              {isLast ? (
                <div className="flex gap-2">
                  <button onClick={() => finish('/explore')} className="btn-ghost px-4 py-2 text-sm">
                    Browse funds
                  </button>
                  <button onClick={() => finish('/planner')} className="btn-primary px-4 py-2 text-sm">
                    Plan my goal →
                  </button>
                </div>
              ) : (
                <button onClick={() => setStep((s) => s + 1)} className="btn-primary px-5 py-2 text-sm">
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Allow re-opening onboarding from a help link. */
export function resetOnboarding() {
  localStorage.removeItem(SEEN_KEY)
  window.location.reload()
}
