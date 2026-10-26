/**
 * Operator-driven "cover screen" state, owned entirely by the enterprise
 * display.
 *
 * A branded full-viewport takeover the attendant can flip on to hide the game
 * (break, tech pause, event lulls). Two headline modes: a localized preset
 * ("back soon") and a free-text field. The store lives entirely in memory,
 * reloads reset to `off`, matching the locale + other attendant toggles.
 */

import { writable } from 'svelte/store'

/**
 * Cover-screen headline modes:
 *
 * - `brand`: {@link BRAND_HEADLINE} (default).
 * - `backSoon`: casual "we'll be right back" copy for breaks / event lulls.
 * - `custom`: operator-authored free text.
 */
export type CoverMode = 'brand' | 'backSoon' | 'custom'

export interface CoverState {
  visible: boolean
  mode: CoverMode
  /**
   * Free-text headline for the `custom` mode. Preserved across mode flips so an
   * operator switching briefly to a preset doesn't lose what they typed. Empty
   * (or whitespace-only) `custom` falls back to the brand preset at render
   * time.
   */
  customText: string
}

/** The booth's branded tagline, shown behind the off-duty card in `brand` mode. */
export const BRAND_HEADLINE =
  'Mehr Kontrolle über Datenflüsse und digitale Arbeit'

const INITIAL: CoverState = {
  visible: false,
  mode: 'brand',
  customText: '',
}

export const coverScreen = writable<CoverState>(INITIAL)

export function setCoverVisible(visible: boolean): void {
  coverScreen.update((s) => ({ ...s, visible }))
}

export function setCoverMode(mode: CoverMode): void {
  coverScreen.update((s) => ({ ...s, mode }))
}

export function setCoverText(text: string): void {
  coverScreen.update((s) => ({ ...s, customText: text }))
}
