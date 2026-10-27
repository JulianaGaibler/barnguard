import type { CoreMessages } from '@src/i18n'

/**
 * Message tree for the screens around the story. The story's own text lives in
 * the story module, not here.
 */
export interface AgeVerificationMessages extends CoreMessages {
  splash: {
    /** The title, one line each, so it breaks where the design does. */
    title: readonly string[]
    /** The line under the title. */
    intro: string
    /** The call to begin. */
    start: string
  }
  story: {
    /** Steps back one screen. */
    back: string
    /** Leaves the story for the splash screen. */
    home: string
    /** Said of an answer already taken, which can't be picked again. */
    optionDone: string
    /** Moves on from a screen with no choice. */
    continue: string
    /** Leaves an ending for the splash screen. */
    startOver: string
    /** Drops a story resumed partway and starts again from the splash. */
    restart: string
    /** Accessible name for one choice, as in "Choice A: …". */
    optionLabel: (letter: string, label: string) => string
    /** Accessible name for the row of progress marks. */
    progressLabel: (step: number) => string
    /** The countdown notice shown before an idle booth resets itself. */
    idleReturning: string
  }
}
