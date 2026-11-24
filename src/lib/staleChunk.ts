/** After a deploy, a page opened earlier still points at the previous build's code files, which the new
 * build has replaced, so opening another page fails with a 404 on its chunk. Reloading picks up the new
 * build. A reload is tried at most once a minute per tab, so a real outage cannot loop. */
const KEY = 'ff-stale-chunk-reload'
const WINDOW_MS = 60_000

export function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i.test(msg)
}

/** Reload once for a new deploy. False when a reload was already tried in the last minute (or storage is
 * unavailable), so the caller shows the error instead. */
export function reloadForNewDeploy(now = Date.now(), store: Pick<Storage, 'getItem' | 'setItem'> | null = safeSession(),
  reload: () => void = () => location.reload()): boolean {
  if (!store) return false
  try {
    const last = Number(store.getItem(KEY) || 0)
    if (now - last < WINDOW_MS) return false
    store.setItem(KEY, String(now))
  } catch { return false }
  reload()
  return true
}

/** Wraps a dynamic import: a stale chunk reloads the page (the promise then never settles, so nothing
 * renders a half-broken page in the moment before the reload); any other failure is passed on. */
export function withChunkReload<T>(load: () => Promise<T>, onStale: () => boolean = () => reloadForNewDeploy()): () => Promise<T> {
  return () => load().catch((err: unknown) => {
    if (isStaleChunkError(err) && onStale()) return new Promise<T>(() => {})
    throw err
  })
}

function safeSession(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

type WorkerHost = Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>

/** A returning visitor's tab starts from the service worker's stored copy of the previous build. The new
 * build's worker installs in the background and takes over the tab, but the app on screen is still the
 * old one, so a link to a page added in this release shows "Page not found". Reload once when a new
 * worker takes over a tab that already had one. On a first visit no worker is in control yet, so
 * installing the first worker does not reload. */
export function reloadOnNewWorker(sw: WorkerHost | undefined = safeWorker(), reload: () => unknown = () => reloadForNewDeploy()): boolean {
  if (!sw || !sw.controller) return false
  let done = false
  sw.addEventListener('controllerchange', () => { if (done) return; done = true; reload() })
  return true
}

function safeWorker(): WorkerHost | undefined {
  try { return typeof navigator === 'undefined' ? undefined : navigator.serviceWorker } catch { return undefined }
}
