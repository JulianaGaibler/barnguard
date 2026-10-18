import type { CoreMessages } from '@src/i18n'

/**
 * Message tree for the screens around the story. The story's own text lives in
 * the story module, not here.
 */
export interface AgeVerificationMessages extends CoreMessages {
  splash: {
    title: string
    /** One or two sentences under the title, on what the visitor is in for. */
    intro: string
    /** The call to begin. */
    start: string
  }
  story: {
    /** Steps back one screen. */
    back: string
    /** Leaves the story for the splash screen. */
    home: string
    /** Moves on from a screen with no choice. */
    continue: string
    /** Leaves an ending for the splash screen. */
    startOver: string
    /** Accessible name for one choice, as in "Choice A: …". */
    optionLabel: (letter: string, label: string) => string
    /** Accessible name for the row of progress marks. */
    progressLabel: (step: number) => string
    /** The countdown notice shown before an idle booth resets itself. */
    idleReturning: string
  }
}
