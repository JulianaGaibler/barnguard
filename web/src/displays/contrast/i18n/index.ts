import type { Readable } from 'svelte/store'
import type { LocaleBundle } from '@src/core/display'
import { t as coreT } from '@src/i18n'
import type { ContrastMessages } from './types'
import { en } from './en'

/** English only, so the language toggle stays hidden. */
export const contrastLocales: LocaleBundle[] = [
  { language: 'en', label: 'English', messages: en },
]

export const CONTRAST_DEFAULT_LANGUAGE = 'en'

/** Strongly typed `t` store for this display's components. */
export const t: Readable<ContrastMessages> =
  coreT as unknown as Readable<ContrastMessages>

export type { ContrastMessages } from './types'
