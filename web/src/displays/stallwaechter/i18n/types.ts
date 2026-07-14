import type { CoreMessages, Messages } from '@src/i18n'

/**
 * Strongly-typed message tree for the Stallwächter display. Extends the
 * core shell with the game + states sections; both locale bundles satisfy
 * this shape, and display components import a `t` store typed to it.
 */
export interface StallwaechterMessages extends CoreMessages {
  /** The public-facing game screen shown to visitors. */
  game: {
    title: string
    subtitle: string
    startButton: string
    idleHint: string
    loading: string
    confirmStateTitle: string
    confirmStateHint: string
    confirmButton: string
    cancelButton: string
    gameOverTitle: string
    gameOverExited: string
    gameOverCollision: string
    tryAgainButton: string
    point: string
    points: string
    highScoreLabel: string
    stateHighScoreLabel: string
    newHighScoreBanner: string
    continueButton: string
    pauseTitle: string
    pauseHint: string
    resumeButton: string
  }
  /** German state names (long form) keyed by ISO code. */
  states: {
    BW: string
    BY: string
    BE: string
    BB: string
    HB: string
    HH: string
    HE: string
    MV: string
    NI: string
    NW: string
    RP: string
    SL: string
    SN: string
    ST: string
    SH: string
    TH: string
  }
}

/**
 * `StallwaechterMessages` narrows the framework's `Messages` — the two are
 * interchangeable at the store boundary. This alias makes the intent explicit
 * where a variable is typed as the core shape but consumed as the display's
 * one (e.g. the manifest's label-render callbacks).
 */
export type MessagesAsStallwaechter = Messages & StallwaechterMessages
