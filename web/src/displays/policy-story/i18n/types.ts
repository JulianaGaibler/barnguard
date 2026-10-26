import type { CoreMessages } from '@src/i18n'

/**
 * Message tree for the screens around the story. The story's own text lives in
 * the story module, not here.
 */
export interface PolicyStoryMessages extends CoreMessages {
  splash: {
    title: string
    /** The paragraphs under the title, on what the visitor is in for. */
    intro: readonly string[]
    /** The call to begin. */
    start: string
  }
  story: {
    /** Moves on from a screen with no choice. */
    continue: string
    /** Leaves an ending for the splash screen. */
    startOver: string
    /** The chip that drops a saved place and starts the story again. */
    restart: string
    /** Accessible name for one choice. */
    optionLabel: (label: string) => string
    /** Accessible name for the row of progress marks. */
    progressLabel: (step: number) => string
  }
}
