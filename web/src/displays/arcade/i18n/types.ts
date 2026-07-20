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
  }
}

export type MessagesAsArcade = Messages & ArcadeMessages
