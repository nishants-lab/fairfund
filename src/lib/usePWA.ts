import { useState, useEffect } from 'react'

/** Tracks the `beforeinstallprompt` event so we can show a custom install banner. */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isInstalled, setIsInstalled] = useState(false)

  useEffect(() => {
    // Already running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true)
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // Detect when the app gets installed
    window.addEventListener('appinstalled', () => {
      setDeferredPrompt(null)
      setIsInstalled(true)
    })

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function install() {
    if (!deferredPrompt) return false
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setDeferredPrompt(null)
    return outcome === 'accepted'
  }

  return { canInstall: !!deferredPrompt, isInstalled, install }
}
