import type { Node2D } from './Node2D'

/**
 * A development-only hook that `Node2D.worldToLocal` calls with the point it
 * was given. The input system installs a check that spots a camera-space
 * pointer position being passed to a node placed by a layer, which is almost
 * always a mistake. Nothing else sets it, and it is never called in a
 * production build.
 *
 * @internal
 */
let check: ((node: Node2D, x: number, y: number) => void) | null = null

/** @internal Install the check, or `null` to remove it. */
export function setWorldToLocalCheck(
  fn: ((node: Node2D, x: number, y: number) => void) | null,
): void {
  check = fn
}

/** @internal Run the check, if one is installed. */
export function checkWorldToLocal(node: Node2D, x: number, y: number): void {
  check?.(node, x, y)
}
