import { msSinceInput } from '@src/core/activity'

/** How long nobody touches the screen before a waiting update takes over. */
export const UPDATE_IDLE_MS = 60_000
/** How often the page looks for a newer version, on top of each launch. */
const CHECK_INTERVAL_MS = 30 * 60_000
/** How often the page asks whether a found update can take over. */
const APPLY_POLL_MS = 15_000

/** Input that means someone has started using the page, unlike a hover. */
const ENGAGE_EVENTS = ['pointerdown', 'keydown'] as const

/**
 * Whether a waiting version should take over now. It reloads the page, so it
 * waits until nobody is in the middle of a session: either nobody has used the
 * page since it loaded, such as a visitor who just opened it, or the screen has
 * been idle for {@link UPDATE_IDLE_MS}.
 */
export function shouldApplyUpdate(
  hasWaiting: boolean,
  idleMs: number,
  engaged: boolean,
): boolean {
  return hasWaiting && (!engaged || idleMs >= UPDATE_IDLE_MS)
}

/**
 * Registers the service worker that keeps the installed app available offline.
 * Call it only in the installed app. It does nothing in development, without a
 * secure context, or where the browser has no service workers. A new version
 * installs in the background and takes over with a reload, at once if nobody
 * has used the page yet, or else once the screen has been idle for
 * {@link UPDATE_IDLE_MS}.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return

  let engaged = false
  const engage = (): void => {
    engaged = true
    for (const type of ENGAGE_EVENTS) {
      window.removeEventListener(type, engage, true)
    }
  }
  for (const type of ENGAGE_EVENTS) {
    window.addEventListener(type, engage, true)
  }

  const container = navigator.serviceWorker
  // The first install also changes the controller, and needs no reload.
  const hadController = container.controller !== null
  container.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload()
  })

  container
    .register('./sw.js')
    .then((registration) => {
      const apply = (): void => {
        if (
          shouldApplyUpdate(!!registration.waiting, msSinceInput(), engaged)
        ) {
          registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
        }
      }
      // Apply as soon as a new version finishes installing, so a visitor who
      // just opened the page gets it before they start, not on a later visit.
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') apply()
        })
      })
      apply()

      const check = (): void => void registration.update().catch(() => {})
      setInterval(check, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(apply, APPLY_POLL_MS)
    })
    .catch((error: unknown) => {
      console.warn('[pwa] the service worker did not register', error)
    })
}

/**
 * Removes the service worker and its stored copy of the app, for a page open in
 * a browser tab, which should always load the latest version. A tab the old
 * worker served reloads once, to load fresh. The worker is shared with the
 * installed app on the same device, which sets it up again on its next launch.
 */
export async function removeServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return

  const registrations = await navigator.serviceWorker.getRegistrations()
  if (registrations.length === 0) return
  await Promise.all(registrations.map((r) => r.unregister()))
  if ('caches' in window) {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((name) => name.startsWith('workbox-'))
        .map((name) => caches.delete(name)),
    )
  }
  if (navigator.serviceWorker.controller) window.location.reload()
}
