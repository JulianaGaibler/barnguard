import type { EnterpriseMessages } from './types'
import { coreEn } from '@src/i18n/coreLocales'

/** English strings, secondary language, mainly for development and testing. */
export const en: EnterpriseMessages = {
  ...coreEn,
  app: {
    // TODO: placeholder copy, pending final Enterprise brand text.
    title: 'Firefox Enterprise',
  },
  cover: {
    backSoon: 'We’ll be right back',
  },
  game: {
    title: 'Welcome to Firefox Enterprise',
    subtitle: 'Route your data safely across the network.',
    startButton: 'Start',
    idleHint: 'Choose a state',
    loading: 'Loading map …',
    confirmStateTitle: 'Ready to play?',
    confirmStateHint:
      'Route the data safely into your state without collisions or letting them leave Germany.',
    confirmButton: 'Start',
    cancelButton: 'Cancel',
    gameOverTitle: 'Data lost',
    gameOverExited: 'The data left Germany.',
    gameOverCollision: 'Two data packets collided.',
    tryAgainButton: 'Try again',
    point: 'Point',
    points: 'Points',
    highScoreLabel: 'High score',
    stateHighScoreLabel: 'High score {state}',
    newHighScoreBanner: 'New high score',
    continueButton: 'Continue',
    pauseTitle: 'Paused',
    pauseHint: 'Tap anywhere to resume.',
    resumeButton: 'Resume',
  },
  states: {
    BW: 'Baden-Württemberg',
    BY: 'Bavaria',
    BE: 'Berlin',
    BB: 'Brandenburg',
    HB: 'Bremen',
    HH: 'Hamburg',
    HE: 'Hesse',
    MV: 'Mecklenburg-Vorpommern',
    NI: 'Lower Saxony',
    NW: 'North Rhine-Westphalia',
    RP: 'Rhineland-Palatinate',
    SL: 'Saarland',
    SN: 'Saxony',
    ST: 'Saxony-Anhalt',
    SH: 'Schleswig-Holstein',
    TH: 'Thuringia',
  },
}
