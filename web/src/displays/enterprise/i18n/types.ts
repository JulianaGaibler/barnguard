import type { CoreMessages, Messages } from '@src/i18n'

/** The per-map strings every map has to supply. */
export interface MapCopy {
  /** The picker's headline, naming what the player chooses. */
  selectPrompt: string
  /** The splash description: the goal, and what the packets must not leave. */
  splashDescription: string
  /** Game-over message when the packet left the play area. */
  lost: string
}

/**
 * Strongly-typed message tree for the Enterprise display. Extends the core
 * shell with the game + states sections. Both locale bundles satisfy this
 * shape, and display components import a `t` store typed to it.
 */
export interface EnterpriseMessages extends CoreMessages {
  /** The attendant's off-duty cover screen (see `attendant/CoverScreen.svelte`). */
  cover: {
    /** "We'll be right back" preset headline. */
    backSoon: string
  }
  /** The public-facing game screen shown to visitors. */
  game: {
    title: string
    subtitle: string
    startButton: string
    loading: string
    gameOverTitle: string
    gameOverCollision: string
    point: string
    points: string
    newHighScoreBanner: string
    pauseTitle: string
    pauseHint: string
    resumeButton: string
    /** The splash headline. */
    splashHeadline: string
    /** The splash button that moves on to the picker. */
    playButton: string
    /** The label on the pill showing the map's overall high score. */
    allScores: string
    /** Title of the game over leaderboard card. */
    leaderboardTitle: string
    /** Placeholder in the player's own leaderboard row. */
    enterName: string
    /** Shown on the leaderboard card when the board could not be loaded. */
    leaderboardUnavailable: string
    printButton: string
    /** The print button once its label is queued. */
    printedButton: string
    playAgainButton: string
    closeButton: string
    /** Label of the tap target that dismisses the keyboard. */
    closeKeyboard: string
    /** Placeholder in the print picker's name field. */
    labelNamePlaceholder: string
    /** Label of the print picker's button back to the game over screen. */
    backButton: string
    /** Names of the label variants, for the picker's preview buttons. */
    labelVariants: { purple: string; orange: string; pink: string }
    /** Name shown for a best score nobody put a name to. */
    unnamed: string
    /** The notice before an idle screen returns to the start. */
    idleReturning: string
  }
  /**
   * Copy that reads differently per map, keyed by map id. A map's prompt names
   * what the player is picking, and its loss message names what the packet
   * actually crossed, which is a coastline on one map and the screen edge on
   * another.
   */
  maps: Record<'de' | 'eu', MapCopy>
  /** Country names (long form) keyed by ISO 3166-1 alpha-3, for the Europe map. */
  countries: {
    ALB: string
    AND: string
    AUT: string
    BEL: string
    BGR: string
    BIH: string
    BLR: string
    CHE: string
    CYP: string
    CZE: string
    DEU: string
    DNK: string
    ESP: string
    EST: string
    FIN: string
    FRA: string
    GBR: string
    GRC: string
    HRV: string
    HUN: string
    IRL: string
    ISL: string
    ITA: string
    LIE: string
    LTU: string
    LUX: string
    LVA: string
    MCO: string
    MDA: string
    MKD: string
    MLT: string
    MNE: string
    NLD: string
    NOR: string
    POL: string
    PRT: string
    ROU: string
    SMR: string
    SRB: string
    SVK: string
    SVN: string
    SWE: string
    UKR: string
    VAT: string
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
 * `EnterpriseMessages` narrows the framework's `Messages`. The two are
 * interchangeable at the store boundary. This alias makes the intent explicit
 * where a variable is typed as the core shape but consumed as the display's one
 * (e.g. the manifest's label-render callbacks).
 */
export type MessagesAsEnterprise = Messages & EnterpriseMessages
