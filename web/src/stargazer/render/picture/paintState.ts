/**
 * Whether a node's `paint` is running. Marking a node for repaint from inside
 * one is a bug, because the compose walk has already decided what to draw this
 * frame, so it throws in development.
 */
let painting: object | null = null

/** @internal */
export function beginPaint(node: object): void {
  painting = node
}

/** @internal */
export function endPaint(): void {
  painting = null
}

/** @internal The node being painted, or `null`. */
export function paintingNode(): object | null {
  return painting
}
