import type { CoreMessages, LanguageCode } from '../types'
import { de } from './de'
import { en } from './en'

/**
 * Default core shell strings the framework ships. Displays typically build
 * their own bundles by spreading one of these entries and then adding their
 * own message sections. Kept as a plain lookup so a display can also cherry-
 * pick a language it wants to reuse verbatim.
 */
export const coreLocales: Record<LanguageCode, CoreMessages> = { de, en }

export { de as coreDe, en as coreEn }
