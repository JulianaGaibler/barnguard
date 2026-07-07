import { derived, writable, type Readable } from 'svelte/store'
import { DEFAULT_LANGUAGE, type Language, type Messages } from './types'
import { de } from './de'
import { en } from './en'

const MESSAGES: Record<Language, Messages> = { de, en }

/**
 * The active UI language. In-memory only — reloads reset to the default. The
 * booth typically runs a long-lived session so this rarely resets in practice;
 * an attendant can flip it via BoothMenu or the corner language toggle.
 */
export const locale = writable<Language>(DEFAULT_LANGUAGE)

/** Switch the active language. */
export const setLocale = (next: Language): void => {
  locale.set(next)
}

/**
 * The active message tree. Components read localized strings from this store,
 * e.g. `$t.game.startButton` — never inline text.
 */
export const t: Readable<Messages> = derived(
  locale,
  ($locale) => MESSAGES[$locale],
)

export { DEFAULT_LANGUAGE } from './types'
export type { Language, Messages } from './types'
