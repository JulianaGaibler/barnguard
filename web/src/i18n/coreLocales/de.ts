import type { CoreMessages } from '../types'

/**
 * Core German shell strings. A display composes its own bundle via
 * `{ ...coreLocales.de, game: {...}, states: {...} }` — overrides work by
 * spreading later.
 */
export const de: CoreMessages = {
  app: {
    title: 'Barnguard',
  },
  attendant: {
    pauseAriaLabel: 'Spiel pausieren',
    resumeAriaLabel: 'Spiel fortsetzen',
    languageToggleAriaLabel: 'Sprache wechseln',
  },
  print: {
    printButton: 'Etikett drucken',
    printing: 'Wird gedruckt …',
    printed: 'Gedruckt ✓',
    printError: 'Druck fehlgeschlagen',
    retry: 'Erneut drucken',
  },
  cover: {
    backSoon: 'Wir sind gleich wieder da',
  },
}
