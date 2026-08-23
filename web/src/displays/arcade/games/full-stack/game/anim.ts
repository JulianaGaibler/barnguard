// What a change to a shortlist slot looks like, and how a row of them plays.
//
// The board is rebuilt by `sync`, which knows what every slot should hold but
// not what it held a moment ago. These two together are what turn a rebuild
// into motion: a snapshot of the last pass, and a rule for reading one against
// the next.

import { ANIM } from './tuning'
import type { CardNode } from './nodes/CardNode'
import type { Card } from './rules/deck'

/** What a slot held on the previous pass. */
export interface SlotShot {
  card: Card
  faceDown: boolean
}

export type Entrance = 'none' | 'deal' | 'flip'

/**
 * How a slot got from `prev` to `next`.
 *
 * The comparison runs against a snapshot rather than the drawn face, because a
 * face-down card does not carry the card it is hiding. Without the identity,
 * turning a card face up and dealing a different one both look the same.
 */
export function entranceFor(prev: SlotShot | null, next: SlotShot): Entrance {
  if (!prev) return 'deal'
  if (prev.card !== next.card) return 'deal'
  return prev.faceDown === next.faceDown ? 'none' : 'flip'
}

/** How long a staggered row of `n` cards takes to finish arriving. */
export const rowTime = (n: number): number =>
  ANIM.dealIn + Math.max(0, n - 1) * ANIM.dealStagger

/** Deal a row in, left to right. */
export function dealRow(nodes: readonly CardNode[]): void {
  nodes.forEach((node, i) => node.appear(i * ANIM.dealStagger))
}

/**
 * Throw a row away, left to right.
 *
 * Each card drifts a little further than the one before it, so three cards
 * leaving read as three rather than as one wide shape.
 */
export function tossRow(nodes: readonly CardNode[], reach: number): void {
  nodes.forEach((node, i) => node.tossOut(reach * (1 + i * 0.25)))
}
