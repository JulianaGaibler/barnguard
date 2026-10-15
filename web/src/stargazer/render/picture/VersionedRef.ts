import type { Versioned } from './Picture'

/**
 * A value shared between nodes, with a `version` that a node's `paint` can
 * depend on through `canvas.use(ref)`. Change the value with {@link set}, or
 * call {@link touch} after changing it in place, and every node that drew from
 * it repaints.
 *
 * @example
 *   const grid = new VersionedRef(makeGrid())
 *   // In a node's paint:
 *   canvas.use(grid)
 *   drawCells(canvas, grid.value)
 *   // Wherever the grid changes:
 *   grid.value.cells[3] = 1
 *   grid.touch()
 */
export class VersionedRef<T> implements Versioned {
  value: T
  version = 0

  constructor(value: T) {
    this.value = value
  }

  /** Replace the value. Does nothing when it is the same one. */
  set(value: T): void {
    if (Object.is(this.value, value)) return
    this.value = value
    this.version++
  }

  /** Mark the value as changed in place. */
  touch(): void {
    this.version++
  }
}
