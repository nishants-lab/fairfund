import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const SEEN_KEY = 'ff-onboarded'

interface Step {
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    title: 'Find a mutual fund',
    body: 'Search by fund name, AMC or category. Open a fund to review its performance history and available portfolio disclosures.',
  },
  {
    title: 'Compare with similar funds',
    body: 'Add funds to a side-by-side comparison. Review their returns and risk, and check how much their disclosed holdings overlap.',
  },
  {
    title: 'Choose a date range',
    body: 'Select dates to recalculate returns and risk from available NAV data. Category ranks and portfolio disclosures use their own reporting periods.',
  },
  {
    title: 'Review your portfolio',
    body: 'Import a CAMS statement to see your fund allocation and available holdings overlap. The statement is processed in your browser. Fund coverage and matching can be incomplete.',
  },
]

export default function Onboarding() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    // Only open when explicitly triggered via resetOnboarding (sets a flag)
    const trigger = sessionStorage.getItem('ff-show-tour')
    if (trigger) {
      const t = setTimeout(() => {
        sessionStorage.removeItem('ff-show-tour')
        setOpen(true)
      }, 200)
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
          <p className="text-sm text-muted">Step {step + 1} of {STEPS.length}</p>
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
                  <button onClick={() => finish('/methodology')} className="btn-ghost px-4 py-2 text-sm">
                    How it works
                  </button>
                  <button onClick={() => finish('/explore')} className="btn-primary px-4 py-2 text-sm">
                    Explore funds
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
  sessionStorage.setItem('ff-show-tour', '1')
  window.location.reload()
}
