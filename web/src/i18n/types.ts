/** Supported UI languages. German is the primary language of the booth. */
export type Language = 'de' | 'en'

/** The default language shown when the booth boots. */
export const DEFAULT_LANGUAGE: Language = 'de'

/**
 * The complete, typed message tree. This interface is the single source of
 * truth for every user-facing string: each locale file (`de.ts`, `en.ts`) must
 * satisfy it, which guarantees the two languages stay structurally in sync.
 *
 * No German (or English) text may live in components or markup — components
 * only ever reference keys on this tree via the `t` store.
 */
export interface Messages {
  /** Global, app-wide strings. */
  app: {
    title: string
  }
  /** The public-facing game screen shown to visitors. */
  game: {
    title: string
    subtitle: string
    startButton: string
    idleHint: string
    /** Text shown while the SVG map + BitmapMask are being loaded. */
    loading: string
    /** Prompt shown in the state-confirm dialog. e.g. "Confirm selection". */
    confirmStateTitle: string
    /** Small message under the state ID in the confirm dialog. */
    confirmStateHint: string
    confirmButton: string
    cancelButton: string
    /** Headline of the game-over dialog. */
    gameOverTitle: string
    /** Reason text for a data packet leaving Germany. */
    gameOverExited: string
    /** Reason text for two data packets colliding. */
    gameOverCollision: string
    tryAgainButton: string
    /** Singular "point" label — used on the game-over card when score === 1. */
    point: string
    /** Plural "points" label on the in-game HUD and game-over card. */
    points: string
    /** Overall high-score label. */
    highScoreLabel: string
    /** State-specific high-score label — parameterised via the state code. */
    stateHighScoreLabel: string
    /** Banner shown on the game-over card when either high-score was beaten. */
    newHighScoreBanner: string
    /** Button label on the game-over card advancing back to the idle map. */
    continueButton: string
    /** Headline of the pause overlay. */
    pauseTitle: string
    /** Small copy under the pause title. */
    pauseHint: string
    /** Label of the "resume" button on the pause overlay. */
    resumeButton: string
  }
  /**
   * Small, faint attendant-facing controls in the bottom-right corner of the
   * game screen: language toggle + pause / resume. Not shown to visitors as a
   * primary UI element; text is used for aria-labels + button copy.
   */
  attendant: {
    pauseAriaLabel: string
    resumeAriaLabel: string
    languageToggleAriaLabel: string
  }
  /** Player-facing label-printing controls on the game-over card. */
  print: {
    /** Print button label in its default state. */
    printButton: string
    /** Button label while rendering / printing. */
    printing: string
    /** Button label after a successful print. */
    printed: string
    /** Button label / message when a print failed. */
    printError: string
    /** Button label offering to retry after a failure. */
    retry: string
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
