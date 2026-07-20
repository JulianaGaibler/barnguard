import type { Component } from 'svelte'
import { writable, type Readable } from 'svelte/store'
import type { Theme } from '@src/core/theme'
import type { GameRecord } from '@src/core/game-log/gameLogClient'
import type { LanguageCode, Messages } from '@src/i18n'

/**
 * One language a display supports: its BCP-47-ish code, an operator-facing
 * label for the language-toggle UI, and the full merged `Messages` bundle for
 * that language (typically composed by spreading `@src/i18n/coreLocales.de` or
 * `.en` and adding the display's own sections on top). Displays can also
 * introduce languages the core has never shipped — the label + messages are
 * fully owned here.
 */
export interface LocaleBundle {
  language: LanguageCode
  label: string
  messages: Messages
}

/**
 * Context handed to a display's label renderer. Panels pass the live locale and
 * the current tape width so the renderer stays store-free.
 */
export interface LabelRenderContext {
  messages: Messages
  tapeWidthMm?: number | null
}

/**
 * Options for the attendant printer-panel preview. Toggling the high-score pill
 * lets the operator inspect the layout for both cases without waiting for a
 * real game.
 */
export interface PreviewLabelContext extends LabelRenderContext {
  highScore: boolean
}

/**
 * A "display" is one event's variant of the kiosk: theme + game viewport +
 * label renderer. Each display module exports a `DisplayManifest` and is
 * registered in `displayRegistry.ts` under a stable id. `main.ts` resolves the
 * manifest from the `?display=` URL parameter, applies the theme, sets the
 * active-display store, and hands the manifest to `App.svelte`.
 */
export interface DisplayManifest {
  /** Stable id, matches the URL parameter and the server `display` tag. */
  id: string
  /** Human-readable name for logs and attendant UI. */
  name: string
  theme: Theme
  /**
   * Languages this display ships. Must contain at least one entry. Attendant
   * UI's language toggle cycles this list — single-locale displays end up with
   * the toggle hidden.
   */
  locales: LocaleBundle[]
  /** Language selected at boot. Must be one of the `locales` language codes. */
  defaultLanguage: LanguageCode
  /**
   * The Svelte component rendered in the main viewport. Owns the game canvas
   * and any display-specific overlays (confirm dialogs, game-over card,
   * pause).
   */
  root: Component
  /**
   * Render a game record's label to a JPEG blob for printing. Called by the
   * attendant "Games" panel when the operator asks for a reprint.
   */
  renderLabelForRecord(
    record: GameRecord,
    ctx: LabelRenderContext,
  ): Promise<Blob>
  /**
   * Render the attendant printer-panel preview. Uses whatever demo values the
   * display considers representative.
   */
  renderPreviewLabel(ctx: PreviewLabelContext): Promise<Blob>
  /**
   * Format a game-log record for the attendant "Games" panel's list. The
   * envelope fields (score, duration, timestamp) are rendered by the panel
   * itself; this callback owns the display-specific summary column plus the
   * high-score marker (if any).
   */
  formatGameRecord(record: GameRecord): {
    /** Short label rendered before the score (e.g. state code, level id). */
    label: string
    /** `null` = no star; `'overall'` = ★; `'category'` = ☆. */
    highScore: 'overall' | 'category' | null
    /** Metadata attached to the reprint job's `JobMeta`. */
    reprintMeta: {
      stateId?: string
      score?: number
      highScore: boolean
    }
  }
  /**
   * Optional Svelte component slotted into the attendant BoothMenu, below the
   * cover-screen controls. Renders whatever preview of the current selection
   * the display finds meaningful. Omit if there's nothing to show.
   */
  selectionPreview?: Component
}

const displayStore = writable<DisplayManifest | null>(null)

/**
 * The active display. `null` before `setActiveDisplay` runs; consumers should
 * gate on it (or accept that they render after boot, when it's populated).
 */
export const activeDisplay: Readable<DisplayManifest | null> = {
  subscribe: displayStore.subscribe,
}

export function setActiveDisplay(m: DisplayManifest): void {
  displayStore.set(m)
}
