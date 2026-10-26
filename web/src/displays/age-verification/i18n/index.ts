import type { Readable } from 'svelte/store'
import type { LocaleBundle } from '@src/core/display'
import { t as coreT } from '@src/i18n'
import type { AgeVerificationMessages } from './types'
import { en } from './en'

/** English only, so the language toggle stays hidden. */
export const ageVerificationLocales: LocaleBundle[] = [
  { language: 'en', label: 'English', messages: en },
]

export const AGE_VERIFICATION_DEFAULT_LANGUAGE = 'en'

/** Strongly typed `t` store for this display's components. */
export const t: Readable<AgeVerificationMessages> =
  coreT as unknown as Readable<AgeVerificationMessages>

export type { AgeVerificationMessages } from './types'
