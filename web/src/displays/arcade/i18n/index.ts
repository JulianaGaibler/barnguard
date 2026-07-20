import type { Readable } from 'svelte/store'
import type { LocaleBundle } from '@src/core/display'
import { t as coreT } from '@src/i18n'
import type { ArcadeMessages } from './types'
import { en } from './en'

/** The arcade ships English only — the language toggle stays hidden. */
export const arcadeLocales: LocaleBundle[] = [
  { language: 'en', label: 'English', messages: en },
]

export const ARCADE_DEFAULT_LANGUAGE = 'en'

/** Strongly-typed `t` store for arcade shell components. */
export const t: Readable<ArcadeMessages> =
  coreT as unknown as Readable<ArcadeMessages>

export type { ArcadeMessages } from './types'
