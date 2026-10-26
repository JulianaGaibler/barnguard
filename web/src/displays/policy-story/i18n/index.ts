import type { Readable } from 'svelte/store'
import type { LocaleBundle } from '@src/core/display'
import { t as coreT } from '@src/i18n'
import type { PolicyStoryMessages } from './types'
import { en } from './en'

/** English only, so the language toggle stays hidden. */
export const policyStoryLocales: LocaleBundle[] = [
  { language: 'en', label: 'English', messages: en },
]

export const POLICY_STORY_DEFAULT_LANGUAGE = 'en'

/** Strongly typed `t` store for this display's components. */
export const t: Readable<PolicyStoryMessages> =
  coreT as unknown as Readable<PolicyStoryMessages>

export type { PolicyStoryMessages } from './types'
