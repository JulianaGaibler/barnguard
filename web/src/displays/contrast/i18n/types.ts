import type { CoreMessages } from '@src/i18n'

/** One block of the manifesto: a paragraph, or an item of its numbered list. */
export interface ManifestoBlock {
  kind: 'paragraph' | 'item'
  text: string
}

/** Message tree for the contrast display. */
export interface ContrastMessages extends CoreMessages {
  banner: {
    /** Left and right of the logo, in capitals. */
    left: string
    right: string
  }
  splash: {
    title: string
    premise: string
    play: string
  }
  /** The text on every card. It is the start of the Mozilla manifesto. */
  manifesto: {
    title: readonly string[]
    blocks: readonly ManifestoBlock[]
  }
  game: {
    correct: string
    incorrect: string
    timeout: string
    /** The chip over the right answer on the scale. */
    actual: string
    /** The caption under the player's answer on the scale. */
    yourPick: string
    /** The accessible names of the three answers. */
    levels: { 1: string; 2: string; 3: string }
    score: (points: number) => string
    seconds: (left: number) => string
    /** Announced when a round is answered. */
    announceCorrect: string
    announceWrong: (answer: string) => string
    announceTimeout: (answer: string) => string
  }
  gameOver: {
    words: readonly [string, string]
    best: (score: number) => string
    newBest: string
    close: string
    retry: string
    /** Between the answer and the right one on a missed card. */
    butWas: readonly [string, string]
    /** The countdown notice shown before an idle booth resets itself. */
    idleReturning: string
    announce: (score: number) => string
  }
  algorithmPanel: {
    algorithm: string
    apca: string
    wcag: string
    /** Shown under the choice, since switching ends the run. */
    note: string
  }
}
