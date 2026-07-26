import type { CoreMessages, Messages } from '@src/i18n'

/** Message tree for the arcade shell. Extends the core shell with launcher copy. */
export interface ArcadeMessages extends CoreMessages {
  arcade: {
    berlinOffice: string
    play: string
    players: string
    player: string
    /** Label for the swipe-down escape-hatch pill. */
    returnToLauncher: string
    /** Accessible label for the confirm (✓) button. */
    confirm: string
    /** Accessible label for the cancel (✗) button. */
    cancel: string
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
      /** `GameOverPanel`'s exit buttons — shared across every game. */
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
    }
  }
}

export type MessagesAsArcade = Messages & ArcadeMessages
