export type UsageEvent = 'comparison_completed' | 'portfolio_import_completed'

const ROUTES = ['/', '/explore', '/movers', '/compare', '/methodology', '/wishlist', '/signin', '/my', '/my/portfolio'] as const
export type UsageRoute = typeof ROUTES[number] | '/fund' | '/category'
export type UsageHit = Readonly<{ path: UsageRoute | UsageEvent; title: ''; referrer: ''; event: boolean }>

type UsageSink = (hit: UsageHit) => void
interface UsageEnvironment {
  enabled: () => boolean
  sink: () => UsageSink | undefined
  onReady: (flush: () => void) => void
}

export function usageRoute(pathname: string): UsageRoute | undefined {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/'
  if (ROUTES.includes(path as typeof ROUTES[number])) return path as UsageRoute
  if (/^\/fund\/[^/]+(?:\/[^/]+)?$/.test(path)) return '/fund'
  if (/^\/category\/[^/]+$/.test(path)) return '/category'
}

export function createUsageTracker(environment: UsageEnvironment) {
  const queue: UsageHit[] = []
  let lastNavigation: string | symbol | undefined
  const flush = () => {
    if (!environment.enabled()) { queue.length = 0; return }
    const sink = environment.sink()
    if (!sink) return
    while (queue.length) {
      // Telemetry must never interrupt navigation or a successful local import.
      try { sink(queue.shift()!) } catch { /* Drop failed telemetry without retrying completions. */ }
    }
  }
  environment.onReady(flush)
  const send = (path: UsageHit['path'], event: boolean) => {
    if (!environment.enabled()) { queue.length = 0; return }
    if (queue.length === 32) queue.shift()
    queue.push({ path, title: '', referrer: '', event })
    flush()
  }
  return {
    route(pathname: string, navigationKey: string | symbol) {
      if (lastNavigation === navigationKey) return
      lastNavigation = navigationKey
      const path = usageRoute(pathname)
      if (path) send(path, false)
    },
    event(event: UsageEvent) {
      if (event === 'comparison_completed' || event === 'portfolio_import_completed') send(event, true)
    },
  }
}

interface GoatCounter {
  url: (hit: UsageHit) => string | undefined
  filter: () => string | false
}
type UsageWindow = Window & { goatcounter?: GoatCounter; doNotTrack?: string }

export function usageEnabled(production: boolean, location: Pick<Location, 'hostname' | 'pathname' | 'protocol'>, ...doNotTrack: (string | null | undefined)[]): boolean {
  return production && location.protocol === 'https:' && location.hostname === 'nishants-lab.github.io'
    && (location.pathname === '/fairfund' || location.pathname.startsWith('/fairfund/'))
    && !doNotTrack.some(value => value === '1' || value === 'yes')
}

export function usageRequest(providerUrl: string, hit: UsageHit): string | undefined {
  const url = new URL(providerUrl)
  if (url.origin !== 'https://fairfund.goatcounter.com' || url.pathname !== '/count') return
  // count.js adds location.search as q even when path is overridden. Rebuild,
  // rather than delete known fields, so future provider fields cannot leak data.
  const bot = url.searchParams.get('b')
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  url.searchParams.set('p', hit.path)
  if (hit.event) url.searchParams.set('e', 'true')
  if (bot && /^\d{1,3}$/.test(bot)) url.searchParams.set('b', bot)
  return url.href
}

let browserTracker: ReturnType<typeof createUsageTracker> | undefined
function tracker() {
  if (typeof window === 'undefined') return
  const browser = window as UsageWindow
  browserTracker ??= createUsageTracker({
    enabled: () => usageEnabled(import.meta.env.PROD, window.location, navigator.doNotTrack, browser.doNotTrack),
    onReady: flush => document.querySelector('script[data-goatcounter]')?.addEventListener('load', flush, { once: true }),
    sink: () => {
      const provider = browser.goatcounter
      if (!provider?.url || !provider.filter) return
      return hit => {
        if (provider.filter()) return
        const rawUrl = provider.url(hit)
        const url = rawUrl && usageRequest(rawUrl, hit)
        if (url) void fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {})
      }
    },
  })
  return browserTracker
}

export function trackUsageRoute(pathname: string, navigationKey: string | symbol) {
  tracker()?.route(pathname, navigationKey)
}

export function trackUsageEvent(event: UsageEvent) {
  tracker()?.event(event)
}
