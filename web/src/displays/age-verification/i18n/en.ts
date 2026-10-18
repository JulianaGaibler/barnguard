import type { AgeVerificationMessages } from './types'
import { coreEn } from '@src/i18n/coreLocales'

/** English strings, the only language this display ships. */
export const en: AgeVerificationMessages = {
  ...coreEn,
  app: {
    title: 'Age Verification',
  },
  splash: {
    title: 'Age verification',
    intro:
      'Laws around the world want websites and apps to check how old you are. Make the calls, and see where they lead.',
    start: 'Start',
  },
  story: {
    back: 'Back',
    home: 'Home',
    continue: 'Continue',
    startOver: 'Start over',
    optionLabel: (letter, label) => `Choice ${letter}: ${label}`,
    progressLabel: (step) => `Step ${step}`,
    idleReturning: 'Returning to the start',
  },
}
