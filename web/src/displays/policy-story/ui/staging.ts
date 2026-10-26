import type { Pace } from '../story/types'

/** What a screen shows, which decides how its parts arrive. */
export interface StagingSpec {
  pace: Pace
  /** Extra seconds before the button and the answers show. */
  hold: number
  hasLabel: boolean
  /** Paragraphs of the reply above the text. */
  replies: number
  paragraphs: number
  hasPrompt: boolean
}

/** When each part of a screen starts to show, and when the buttons may. */
export interface Staging {
  /**
   * Seconds after the screen has arrived that each part starts to fade in, in
   * the order the label, the reply, the text and the prompt appear.
   */
  starts: readonly number[]
  /** Seconds a part takes to fade in. */
  fade: number
  /** Seconds after the screen arrived when the last part has finished. */
  textEnd: number
  /** Seconds after `textEnd` before the button and the answers show. */
  hold: number
}

/** Seconds a part takes to fade in. */
const FADE = 0.55

/** Seconds between the starts of two parts, for each pace. */
const GAPS: Record<Pace, { text: number; reply: number; label: number }> = {
  together: { text: 0, reply: 0, label: 0 },
  beats: { text: 0.75, reply: 0.95, label: 1.1 },
  slow: { text: 1.3, reply: 1.5, label: 1.8 },
}

/** Seconds the button waits after the last part, before the story's own hold. */
const SETTLE: Record<Pace, number> = { together: 0, beats: 0.2, slow: 0.3 }

/** The seconds that count as "later than anything", once everything shows. */
export const SHOWN = 1e6

/**
 * The schedule of a screen. With `together` every part shows at once. Otherwise
 * the label comes first and holds alone for a moment, then the reply, then a
 * beat before the text, and each paragraph after the one before.
 */
export function stagingFor(spec: StagingSpec): Staging {
  const gap = GAPS[spec.pace]
  const starts: number[] = []
  let at = 0
  const add = (after: number): void => {
    starts.push(at)
    at += after
  }
  if (spec.hasLabel) add(gap.label)
  for (let i = 0; i < spec.replies; i++) {
    add(i === spec.replies - 1 ? gap.reply : gap.text)
  }
  for (let i = 0; i < spec.paragraphs; i++) add(gap.text)
  if (spec.hasPrompt) add(gap.text)
  if (spec.pace === 'together') {
    return { starts: starts.map(() => 0), fade: 0, textEnd: 0, hold: spec.hold }
  }
  const last = starts.length ? starts[starts.length - 1]! : 0
  return {
    starts,
    fade: FADE,
    textEnd: last + FADE,
    hold: SETTLE[spec.pace] + spec.hold,
  }
}

/**
 * How far part `index` has faded in, 0 to 1, `seconds` after the screen
 * arrived.
 */
export function pieceAlpha(
  staging: Staging,
  index: number,
  seconds: number,
): number {
  const start = staging.starts[index] ?? 0
  if (staging.fade <= 0) return seconds >= start ? 1 : 0
  return Math.min(1, Math.max(0, (seconds - start) / staging.fade))
}
