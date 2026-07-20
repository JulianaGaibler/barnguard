import { derived, writable, type Readable } from 'svelte/store'
import type { LanguageCode, Messages } from './types'

/**
 * Locales the active display has registered. Written once by `main.ts` right
 * after the manifest resolves; components read via the derived `t` store.
 * `null` before any registration means the app hasn't finished booting yet.
 */
const displayLocales = writable<Record<LanguageCode, Messages> | null>(null)

/**
 * Ordered list of {language, label} entries the language toggle iterates over.
 * Ordering follows the manifest's `locales` array. Empty until boot.
 */
export interface DisplayLanguage {
  language: LanguageCode
  label: string
}
export const supportedLanguages = writable<DisplayLanguage[]>([])

/**
 * The active UI language. In-memory only — reloads reset to the display's
 * default. The booth typically runs a long-lived session so this rarely resets
 * in practice; an attendant can flip it via BoothMenu or the corner language
 * toggle.
 */
export const locale = writable<LanguageCode>('')

/** Switch the active language. Caller should pick from `supportedLanguages`. */
export const setLocale = (next: LanguageCode): void => {
  locale.set(next)
}

/**
 * Publish the active display's locale bundles + set the initial language.
 * Called by `main.ts` after `applyTheme`. Idempotent; a hot-swap between
 * displays is allowed in principle (nothing today does it).
 */
export function registerDisplayLocales(
  bundles: { language: LanguageCode; label: string; messages: Messages }[],
  defaultLanguage: LanguageCode,
): void {
  const map: Record<LanguageCode, Messages> = {}
  const langs: DisplayLanguage[] = []
  for (const b of bundles) {
    map[b.language] = b.messages
    langs.push({ language: b.language, label: b.label })
  }
  displayLocales.set(map)
  supportedLanguages.set(langs)
  if (!(defaultLanguage in map)) {
    throw new Error(
      `registerDisplayLocales: defaultLanguage "${defaultLanguage}" is not among the provided bundles`,
    )
  }
  locale.set(defaultLanguage)
}

/**
 * The active message tree. Components read localized strings from this store,
 * e.g. `$t.game.startButton` — never inline text. Returns `null` before the
 * display has registered its locales; components should render conditionally on
 * boot but in practice `main.ts` finishes registration before mount.
 */
export const t: Readable<Messages> = derived(
  [locale, displayLocales],
  ([$locale, $map]) => {
    if (!$map) {
      throw new Error(
        'i18n t was read before a display registered its locales — boot order bug?',
      )
    }
    const bundle = $map[$locale]
    if (!bundle) {
      const known = Object.keys($map).join(', ')
      throw new Error(
        `i18n t read for unknown language "${$locale}"; registered: ${known}`,
      )
    }
    return bundle
  },
)

export type { LanguageCode, Messages, CoreMessages } from './types'
