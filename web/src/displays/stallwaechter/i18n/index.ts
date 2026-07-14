import type { Readable } from 'svelte/store'
import type { LocaleBundle } from '@src/core/display'
import { t as coreT } from '@src/i18n'
import type { StallwaechterMessages } from './types'
import { de } from './de'
import { en } from './en'

/**
 * Locales the Stallwächter display ships. German is authoritative for the
 * booth; English is a secondary language for testing and dev.
 */
export const stallwaechterLocales: LocaleBundle[] = [
  { language: 'de', label: 'Deutsch', messages: de },
  { language: 'en', label: 'English', messages: en },
]

export const STALLWAECHTER_DEFAULT_LANGUAGE = 'de'

/**
 * Strongly-typed `t` store for use inside the display. Wraps the framework
 * store and narrows its return type to the display's message shape — safe
 * because `main.ts` registers this display's bundles before mount.
 */
export const t: Readable<StallwaechterMessages> =
  coreT as unknown as Readable<StallwaechterMessages>

export type { StallwaechterMessages } from './types'
