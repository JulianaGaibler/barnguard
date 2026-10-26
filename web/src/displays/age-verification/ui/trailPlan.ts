import type { ProgressMark } from '../story/run'

/** What changed in the progress row, and so how it should move. */
export type TrailChange =
  /** The row is new, or changed in a way no animation explains. Rebuild it. */
  | 'reset'
  /** The same marks, so only which one is current may differ. */
  | 'same'
  /** One more mark at the end, because the visitor moved on. */
  | 'add'
  /** The last mark is gone, because the visitor went back. */
  | 'remove'

/**
 * Compares the marks shown with the marks to show. A row grows or shrinks one
 * mark at a time as the visitor moves, so that is the case worth animating, and
 * anything else is rebuilt.
 */
export function planTrail(
  shown: readonly ProgressMark[],
  next: readonly ProgressMark[],
): TrailChange {
  if (shown.length === 0) return 'reset'
  const shared = Math.min(shown.length, next.length)
  for (let i = 0; i < shared; i++) {
    if (shown[i].kind !== next[i].kind) return 'reset'
  }
  if (next.length === shown.length) return 'same'
  if (next.length === shown.length + 1) return 'add'
  if (next.length === shown.length - 1) return 'remove'
  return 'reset'
}
