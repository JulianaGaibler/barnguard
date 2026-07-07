import type { Messages } from './types'

/** English strings — secondary language, mainly for development and testing. */
export const en: Messages = {
  app: {
    title: 'Stallwächterparty',
  },
  game: {
    title: 'Welcome to the Stallwächterparty',
    subtitle:
      'The political summer party of the Baden-Württemberg State Representation',
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
  attendant: {
    pauseAriaLabel: 'Pause the game',
    resumeAriaLabel: 'Resume the game',
    languageToggleAriaLabel: 'Switch language',
  },
  print: {
    printButton: 'Print label',
    printing: 'Printing …',
    printed: 'Printed ✓',
    printError: 'Print failed',
    retry: 'Retry print',
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
