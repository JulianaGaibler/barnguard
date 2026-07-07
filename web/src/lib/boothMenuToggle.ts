import { get, writable } from 'svelte/store'
import { placeNextTo } from './window/spawn'

export type BoothMenuSide = 'left' | 'right'

export interface BoothMenuState {
  /** Whether the menu is currently open. */
  open: boolean
  /**
   * Which corner it opens against. Persists across close/re-open until the
   * operator taps the OTHER corner.
   */
  side: BoothMenuSide
}

/**
 * Global booth-menu visibility. Component code subscribes with `$store`; the
 * menu component itself, plus the game rules window (which knows to close if
 * the booth menu closes it via `hide()`).
 */
export const boothMenuState = writable<BoothMenuState>({
  open: false,
  side: 'right',
})

export const openBoothMenu = (side: BoothMenuSide): void =>
  boothMenuState.set({ open: true, side })

export const closeBoothMenu = (): void =>
  boothMenuState.update((prev) => ({ ...prev, open: false }))

export const toggleBoothMenu = (side: BoothMenuSide): void =>
  boothMenuState.update((prev) =>
    prev.open && prev.side === side
      ? { ...prev, open: false }
      : { open: true, side },
  )

// -----------------------------------------------------------------------------
// Overlay visibility; driven by the booth menu, consumed by whoever owns
// the actual surface (GameScreen for the game rules window, GameScreen
// via `debug.setHudVisible` for the debug HUD).
// -----------------------------------------------------------------------------

/** Whether the stargazer debug HUD should be visible. */
export const debugHudVisible = writable(false)
export const setDebugHudVisible = (v: boolean): void => debugHudVisible.set(v)
export const toggleDebugHud = (): void =>
  debugHudVisible.update((prev) => !prev)

/** Whether the attendant printer panel should be visible. */
export const printerPanelVisible = writable(false)
export const togglePrinterPanel = (): void =>
  printerPanelVisible.update((prev) => {
    // On open, seed the printer panel adjacent to the booth menu so the two
    // windows don't stack in the same corner on first spawn. `placeNextTo`
    // no-ops if the printer panel already has a saved position (operator
    // dragged it somewhere they prefer), so once relocated, it stays put.
    if (!prev) {
      placeNextTo(
        'barnguard-window-booth-menu',
        'barnguard-window-printer-panel',
        { childWidth: 320 },
      )
    }
    return !prev
  })

// -----------------------------------------------------------------------------
// DOM fullscreen; driven by the booth menu. The store MIRRORS the
// browser's `document.fullscreenElement` state via the `fullscreenchange`
// event; component code reads the store, callers use the helpers below
// (which MUST be triggered inside a user gesture; a click handler is
// fine, an effect isn't).
// -----------------------------------------------------------------------------

export const isFullscreen = writable(false)

export const enterFullscreen = (): void => {
  const el = document.documentElement
  if (!el.requestFullscreen) return
  void el.requestFullscreen().catch((err) => {
    console.warn('[booth] requestFullscreen rejected:', err)
  })
}

export const exitFullscreen = (): void => {
  if (!document.fullscreenElement || !document.exitFullscreen) return
  void document.exitFullscreen().catch((err) => {
    console.warn('[booth] exitFullscreen rejected:', err)
  })
}

export const toggleFullscreen = (): void => {
  if (document.fullscreenElement) exitFullscreen()
  else enterFullscreen()
}

// -----------------------------------------------------------------------------
// Corner-tap gesture
// -----------------------------------------------------------------------------

/**
 * Size (CSS px) of each corner hitbox. Same 96px hint area the old admin panel
 * used, so long-time operators keep the same target zone.
 */
const CORNER_SIZE = 96
/** Max delay between the two taps of a double-tap (ms). */
const DOUBLE_TAP_MAX_MS = 350
/** Max drift between the two taps of a double-tap (CSS px). */
const DOUBLE_TAP_MAX_DRIFT = 40

interface PendingTap {
  side: BoothMenuSide
  at: number
  x: number
  y: number
}

function detectCorner(x: number, y: number): BoothMenuSide | null {
  if (y > CORNER_SIZE) return null
  if (x <= CORNER_SIZE) return 'left'
  if (x >= window.innerWidth - CORNER_SIZE) return 'right'
  return null
}

/**
 * Wire up:
 *
 * - Double-tap in top-left corner → open menu on the LEFT
 * - Double-tap in top-right corner → open menu on the RIGHT
 * - `Ctrl + Shift + D` → toggle right-anchored (dev backdoor for
 *   connected-keyboard debugging; matches the old admin shortcut)
 */
export const initBoothMenuToggle = (): (() => void) => {
  let pending: PendingTap | null = null

  const onPointerDown = (e: PointerEvent): void => {
    // Ignore taps that land inside the currently-open menu; the menu
    // overlaps its corner region, so an operator tapping the menu's own
    // buttons would otherwise count as a corner gesture.
    if (get(boothMenuState).open) {
      const target = e.target
      if (
        target instanceof Element &&
        target.closest('[data-draggable-window="barnguard-window-booth-menu"]')
      ) {
        pending = null
        return
      }
    }
    const side = detectCorner(e.clientX, e.clientY)
    if (side === null) {
      // Tap outside any corner; clear a pending first-tap so a stray
      // in-canvas tap doesn't count toward the double-tap sequence.
      pending = null
      return
    }
    const now = performance.now()
    if (
      pending &&
      pending.side === side &&
      now - pending.at <= DOUBLE_TAP_MAX_MS &&
      Math.abs(e.clientX - pending.x) <= DOUBLE_TAP_MAX_DRIFT &&
      Math.abs(e.clientY - pending.y) <= DOUBLE_TAP_MAX_DRIFT
    ) {
      pending = null
      toggleBoothMenu(side)
      return
    }
    pending = { side, at: now, x: e.clientX, y: e.clientY }
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      toggleBoothMenu('right')
    }
  }

  // Mirror the browser's fullscreen state into the store; covers both
  // menu-triggered toggles and outside changes (F11, Esc, browser UI).
  const onFullscreenChange = (): void => {
    isFullscreen.set(document.fullscreenElement !== null)
  }
  // Seed once on init in case the app booted already fullscreen.
  isFullscreen.set(document.fullscreenElement !== null)

  window.addEventListener('pointerdown', onPointerDown, { capture: true })
  window.addEventListener('keydown', onKeyDown)
  document.addEventListener('fullscreenchange', onFullscreenChange)

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    window.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
  }
}
