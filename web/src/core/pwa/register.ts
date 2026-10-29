import { writable, type Readable } from 'svelte/store'
import { msSinceInput } from '@src/core/activity'

/** How long nobody touches the screen before a waiting update takes over. */
export const UPDATE_IDLE_MS = 60_000
/** How often the page looks for a newer version, on top of each launch. */
const CHECK_INTERVAL_MS = 30 * 60_000
/** How often the page asks whether a found update can take over. */
const APPLY_POLL_MS = 15_000

/**
 * Where the installed app is with its updates, for the screen to show.
 *
 * - `off`: no service worker, as in a browser tab or in development.
 * - `checking`: asking the server for a newer version.
 * - `current`: the last check found nothing newer.
 * - `offline`: the last check could not reach the server.
 * - `downloading`: a newer version is being stored for offline use.
 * - `ready`: it is stored, and takes over once nobody is using the screen.
 * - `applying`: it is taking over, and the page is about to reload.
 */
export type UpdateStatus =
  | 'off'
  | 'checking'
  | 'current'
  | 'offline'
  | 'downloading'
  | 'ready'
  | 'applying'

export interface UpdateState {
  status: UpdateStatus
  /** When the server last answered a check, in epoch ms. */
  checkedAt: number | null
}

const state = writable<UpdateState>({ status: 'off', checkedAt: null })

/** The installed app's update state. */
export const appUpdate: Readable<UpdateState> = { subscribe: state.subscribe }

function setStatus(status: UpdateStatus, checked = false): void {
  state.update((now) => ({
    status,
    checkedAt: checked ? Date.now() : now.checkedAt,
  }))
}

let registered: ServiceWorkerRegistration | null = null

/**
 * Asks the server for a newer version now, rather than at the next launch or
 * half hour. Does nothing without a service worker.
 */
export function checkForUpdate(): void {
  const registration = registered
  if (!registration) return
  // A version already downloading or waiting is newer than any check finds.
  if (registration.installing || registration.waiting) return
  setStatus('checking')
  registration
    .update()
    .then(() => {
      if (!registration.installing && !registration.waiting) {
        setStatus('current', true)
      }
    })
    .catch(() => setStatus('offline'))
}

/**
 * Lets a downloaded version take over at once, whoever is using the screen. The
 * page reloads into it.
 */
export function applyUpdate(): void {
  const waiting = registered?.waiting
  if (!waiting) return
  setStatus('applying')
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

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
  setStatus('checking')

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
      registered = registration
      const apply = (): void => {
        if (
          shouldApplyUpdate(!!registration.waiting, msSinceInput(), engaged)
        ) {
          applyUpdate()
        }
      }
      // Apply as soon as a new version finishes installing, so a visitor who
      // just opened the page gets it before they start, not on a later visit.
      const follow = (worker: ServiceWorker): void => {
        setStatus('downloading', true)
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') {
            // The first install has nothing to wait for, and takes over alone.
            setStatus(registration.waiting ? 'ready' : 'current')
            apply()
          } else if (worker.state === 'redundant' && !registration.waiting) {
            // The download failed, as on a connection that dropped. The old
            // version carries on, and the next check tries again.
            setStatus('offline')
          }
        })
      }
      registration.addEventListener('updatefound', () => {
        if (registration.installing) follow(registration.installing)
      })
      if (registration.installing) follow(registration.installing)
      if (registration.waiting) setStatus('ready')
      // Registering may still be checking in the background, so a check of
      // its own is what says whether this version is the latest.
      else if (!registration.installing) checkForUpdate()
      apply()

      const check = (): void => checkForUpdate()
      setInterval(check, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(apply, APPLY_POLL_MS)
    })
    .catch((error: unknown) => {
      console.warn('[pwa] the service worker did not register', error)
      setStatus('off')
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
