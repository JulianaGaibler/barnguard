import type { CoreMessages, Messages } from '@src/i18n'

/** Message tree for the arcade shell. Extends the core shell with launcher copy. */
export interface ArcadeMessages extends CoreMessages {
  arcade: {
    berlinOffice: string
    play: string
    players: string
    player: string
    /** Conjunction joining non-consecutive player counts, as in "2 or 4". */
    or: string
    /** Badge on the launcher card of the game leading the carousel today. */
    gameOfTheDay: string
    /** The launcher's filter bar, above the game cards. */
    filters: {
      /** Accessible name for the bar as a whole. */
      label: string
      /** Leading label for the player-count chips. */
      players: string
      /** Accessible label for one player-count chip. */
      playerCount: (n: number) => string
      /** Accessible label for the leaderboard toggle, which shows only an icon. */
      leaderboardAriaLabel: string
      /** Visible label on the AI toggle. */
      ai: string
      /** Accessible label for that toggle, since "AI" alone is thin. */
      aiAriaLabel: string
      /** Shown in place of the cards when nothing matches. */
      noMatches: string
      /** Resets every filter. */
      clear: string
    }
    /** Label for the swipe-down escape-hatch pill. */
    returnToLauncher: string
    /** Accessible label for the confirm (✓) button. */
    confirm: string
    /** Accessible label for the cancel (✗) button. */
    cancel: string
    /** The countdown notice shown before an idle booth resets itself. */
    idle: {
      /** Notice body, beside the countdown ring. */
      returningToLauncher: string
    }
    /** Shared pause menu, the one modal during play. */
    pause: {
      /** Card heading. */
      title: string
      /** Returns to the board. */
      resume: string
      /** Ends the run and returns to the game's own menu. */
      quit: string
    }
    /** Shared "How to play" tutorial chrome. */
    tutorial: {
      /** Modal heading. */
      title: string
      /** Accessible label for the close (✕) button. */
      close: string
      /** Accessible label for the previous-card button. */
      prev: string
      /** Accessible label for the next-card button. */
      next: string
    }
    /** Shared leaderboard modal + entry point. */
    leaderboard: {
      /** Accessible label for the menu's leaderboard icon button. */
      openLeaderboard: string
      /** Modal heading. */
      title: string
      /** Accessible label for the close (✕) button. */
      close: string
      /** Shown when a display has no entries yet. */
      empty: string
      /** `GameOverPanel`'s exit buttons, shared across every game. */
      playAgain: string
      menu: string
      /** Shown when the leaderboard couldn't be reached at all. */
      unavailable: string
      /** Hint line while the name field is empty. */
      wontBeSaved: string
      /** Hint line once a name has been entered. */
      willBeSavedAs: (name: string) => string
      /** Pending row's CTA pill while the name is empty. */
      enterNameToSave: string
      /** Accessible label for the keyboard's collapse key. */
      closeKeyboard: string
      /**
       * Warning when both players in a versus result type the same name. The
       * board keeps one row per name, so only the higher score can survive.
       */
      sameName: string
    }
  }
}

export type MessagesAsArcade = Messages & ArcadeMessages
