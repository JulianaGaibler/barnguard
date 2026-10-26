import { msSinceInput } from '@src/core/activity'

/** How long nobody touches the screen before a waiting update takes over. */
export const UPDATE_IDLE_MS = 60_000
/** How often the page looks for a newer version, on top of each launch. */
const CHECK_INTERVAL_MS = 30 * 60_000
/** How often the page asks whether a found update can take over. */
const APPLY_POLL_MS = 15_000

/**
 * Whether a waiting version should take over now. It reloads the page, so it
 * waits until nobody is in the middle of a session.
 */
export function shouldApplyUpdate(
  hasWaiting: boolean,
  idleMs: number,
): boolean {
  return hasWaiting && idleMs >= UPDATE_IDLE_MS
}

/**
 * Registers the service worker that keeps the app available offline. It does
 * nothing in development, without a secure context, or where the browser has no
 * service workers. A new version installs in the background and takes over,
 * with a reload, once the screen has been idle for {@link UPDATE_IDLE_MS}.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return

  const container = navigator.serviceWorker
  // The first install also changes the controller, and needs no reload.
  const hadController = container.controller !== null
  container.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload()
  })

  container
    .register('./sw.js')
    .then((registration) => {
      const check = (): void => void registration.update().catch(() => {})
      setInterval(check, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(() => {
        if (shouldApplyUpdate(!!registration.waiting, msSinceInput())) {
          registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
        }
      }, APPLY_POLL_MS)
    })
    .catch((error: unknown) => {
      console.warn('[pwa] the service worker did not register', error)
    })
}
