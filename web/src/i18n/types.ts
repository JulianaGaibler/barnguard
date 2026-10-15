/**
 * Locale infrastructure. Displays own what languages they ship and what their
 * default is. This file defines the type shape shared across displays
 * (`Messages`) plus the smaller `CoreMessages` slice that the core ships
 * defaults for. A display's manifest supplies a full `Messages` bundle per
 * language it supports. The `?display=` boot flow wires it to the `t` store
 * before any component reads a string.
 */

/**
 * Any BCP-47-ish tag. Concrete values come from the active display's `locales`
 * list.
 */
export type LanguageCode = string

/**
 * Shell strings the CORE ships default translations for (see
 * `@src/i18n/coreLocales`). A display can override or ignore any of these. Kept
 * separate from the display-owned message sections so it's obvious what a new
 * display MUST re-translate (`game`, `states`, …) versus what it can fall back
 * to core defaults for.
 */
export interface CoreMessages {
  app: {
    title: string
  }
  attendant: {
    pauseAriaLabel: string
    resumeAriaLabel: string
    languageToggleAriaLabel: string
  }
  keyboard: {
    /** Accessible name of the key that closes the keyboard. */
    close: string
    /** Accessible name of the enter key. */
    enter: string
    /** Accessible name of the space bar. */
    space: string
    /** Accessible name of the backspace key. */
    backspace: string
    /** Key that opens the page of digits and symbols. */
    symbols: string
    /** Key that returns from that page to the letters. */
    letters: string
  }
  print: {
    printButton: string
    printing: string
    printed: string
    printError: string
    retry: string
  }
}

/**
 * The runtime shape components read from the `$t` store. Core code sees only
 * the shell keys defined by `CoreMessages`. A display's own components import a
 * strongly-typed `t` from its i18n module (which casts this store) so they can
 * access whatever additional sections they define. Display bundles are still
 * assignable to `Messages` because they extend `CoreMessages`.
 */
export type Messages = CoreMessages
