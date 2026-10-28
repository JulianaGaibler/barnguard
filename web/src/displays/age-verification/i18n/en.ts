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
      'In the name of protecting children, governments around the world are rushing to ban social media based on age. What does it take to implement a ban like this? Here, you get to make that call and get a glimpse into the complex and challenging world of age assurance.',
    start: 'Start',
  },
  story: {
    back: 'Back',
    home: 'Home',
    continue: 'Continue',
    startOver: 'Start over',
    restart: 'Start over',
    optionDone: 'Done',
    optionLabel: (letter, label) => `Choice ${letter}: ${label}`,
    progressLabel: (step) => `Step ${step}`,
    idleReturning: 'Returning to the start',
  },
  signup: {
    submit: 'Sign up',
    skip: 'No thanks',
    invalidEmail: 'That doesn’t look like an email address.',
    thanksTitle: 'Thank you!',
    thanksBody: 'You’re on the list. Thanks for playing.',
    saveFailed: 'Something went wrong. Please ask someone at the booth.',
  },
  signupPanel: {
    title: 'Sign-ups',
    count: (n) => (n === 1 ? '1 sign-up' : `${n} sign-ups`),
    download: 'Download CSV',
    copy: 'Copy CSV',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    clear: 'Clear',
    note: 'Kept on this device only. Export before clearing the browser.',
  },
}
