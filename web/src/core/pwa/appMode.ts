/** Whether the page runs as an installed app, with no browser around it. */
export function isInstalledApp(): boolean {
  const standaloneFlag = (navigator as Navigator & { standalone?: boolean })
    .standalone
  return (
    standaloneFlag === true ||
    ['standalone', 'fullscreen'].some(
      (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches,
    )
  )
}

/**
 * Stops iOS from zooming the page with a pinch, which it allows whatever the
 * viewport says. Returns the function that puts it back.
 */
export function lockGestures(target: Document = document): () => void {
  const stop = (event: Event): void => event.preventDefault()
  const events = ['gesturestart', 'gesturechange', 'gestureend']
  for (const name of events) target.addEventListener(name, stop)
  return () => {
    for (const name of events) target.removeEventListener(name, stop)
  }
}

/**
 * Keeps the screen on. The browser drops the lock when the page is hidden, so
 * it is asked for again when the page comes back. Does nothing where the
 * browser has no wake lock. Returns the function that lets the screen sleep.
 */
export function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null
  let stopped = false

  const request = async (): Promise<void> => {
    if (stopped || !navigator.wakeLock) return
    try {
      lock = await navigator.wakeLock.request('screen')
    } catch {
      // Refused, for example on low battery. The next visit asks again.
    }
  }
  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void request()
  }

  void request()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisible)
    void lock?.release()
  }
}
