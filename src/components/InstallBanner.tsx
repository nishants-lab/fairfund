import { useState } from 'react'
import { useInstallPrompt } from '../lib/usePWA'

/** Slim banner at the bottom of the screen prompting PWA install. */
export default function InstallBanner() {
  const { canInstall, install } = useInstallPrompt()
  const [dismissed, setDismissed] = useState(false)

  if (!canInstall || dismissed) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 border-t border-line bg-surface/95 backdrop-blur-sm safe-bottom">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <p className="text-sm text-fg">
          <span className="font-semibold">Install FairFund</span>
          <span className="text-muted"> for quick access and offline use</span>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setDismissed(true)}
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-fg transition-colors"
          >
            Later
          </button>
          <button
            onClick={install}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
          >
            Install
          </button>
        </div>
      </div>
    </div>
  )
}
