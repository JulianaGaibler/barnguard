/**
 * Operator-driven "cover screen" state.
 *
 * A branded full-viewport takeover the attendant can flip on to hide the game
 * (break, tech pause, event lulls). Two headline modes: a localized preset
 * ("back soon") and a free-text field. The store lives entirely in memory —
 * reloads reset to `off`, matching the locale + other attendant toggles.
 */

import { writable } from 'svelte/store'

/**
 * Cover-screen headline modes:
 *
 * - `enterprise` — the Firefox-Enterprise marketing headline that matches the
 *   backdrop's visual identity (default).
 * - `backSoon` — casual "we'll be right back" copy for breaks / event lulls.
 * - `custom` — operator-authored free text.
 */
export type CoverMode = 'enterprise' | 'backSoon' | 'custom'

export interface CoverScreenState {
  visible: boolean
  mode: CoverMode
  /**
   * Free-text headline for the `custom` mode. Preserved across mode flips so an
   * operator switching briefly to a preset doesn't lose what they typed. Empty
   * (or whitespace-only) `custom` falls back to the enterprise preset at render
   * time.
   */
  customText: string
}

const INITIAL: CoverScreenState = {
  visible: false,
  mode: 'enterprise',
  customText: '',
}

export const coverScreen = writable<CoverScreenState>(INITIAL)

export function setCoverVisible(visible: boolean): void {
  coverScreen.update((s) => ({ ...s, visible }))
}

export function toggleCover(): void {
  coverScreen.update((s) => ({ ...s, visible: !s.visible }))
}

export function setCoverMode(mode: CoverMode): void {
  coverScreen.update((s) => ({ ...s, mode }))
}

export function setCoverText(text: string): void {
  coverScreen.update((s) => ({ ...s, customText: text }))
}
