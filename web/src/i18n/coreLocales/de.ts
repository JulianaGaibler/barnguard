import type { CoreMessages } from '../types'

/**
 * Core German shell strings. A display composes its own bundle via `{
 * ...coreLocales.de, game: {...}, states: {...} }`. Overrides work by spreading
 * later.
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
  keyboard: {
    close: 'Tastatur schließen',
    enter: 'Eingabe',
    space: 'Leertaste',
    backspace: 'Löschen',
    symbols: '?123',
    letters: 'ABC',
  },
  print: {
    printButton: 'Etikett drucken',
    printing: 'Wird gedruckt …',
    printed: 'Gedruckt ✓',
    printError: 'Druck fehlgeschlagen',
    retry: 'Erneut drucken',
  },
}
