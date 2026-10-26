import type { AgeVerificationMessages } from './types'
import { coreEn } from '@src/i18n/coreLocales'

/** English strings, the only language this display ships. */
export const en: AgeVerificationMessages = {
  ...coreEn,
  app: {
    title: 'Age Verification',
  },
  splash: {
    title: ['Configuring', 'age assurance'],
    intro:
      'Governments around the world are deciding whether apps and websites need to know your age.',
    start: 'Start',
  },
  story: {
    back: 'Back',
    home: 'Home',
    continue: 'Continue',
    startOver: 'Start over',
    restart: 'Start over',
    optionLabel: (letter, label) => `Choice ${letter}: ${label}`,
    progressLabel: (step) => `Step ${step}`,
    idleReturning: 'Returning to the start',
  },
}
