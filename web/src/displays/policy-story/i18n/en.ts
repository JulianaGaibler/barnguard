import type { PolicyStoryMessages } from './types'
import { coreEn } from '@src/i18n/coreLocales'

/** English strings, the only language this display ships. */
export const en: PolicyStoryMessages = {
  ...coreEn,
  app: {
    title: 'Build your own age verification law',
  },
  splash: {
    title: 'Build your own age verification law',
    intro: [
      'Governments around the world are deciding whether apps and websites must check how old their users are. In this booth, you make that decision.',
    ],
    start: 'Start',
  },
  story: {
    continue: 'Continue',
    startOver: 'Start over',
    restart: 'Start over',
    optionLabel: (label) => label,
    progressLabel: (step) => `Step ${step}`,
  },
}
