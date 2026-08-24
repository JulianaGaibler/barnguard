/**
 * Every live tile on one board, and the place a {@link MoveResult} becomes
 * motion. Nothing else reads the board model to work out what changed.
 *
 * Paint order is load-bearing here. Tile depth grows with value, so a tall tile
 * extrudes down over the gap toward the row beneath it. Children are therefore
 * kept sorted by their live y, so a lower tile always paints after (over) the
 * one above it. Sorting by live position rather than by grid row matters
 * because a tile crossing rows has to hand over cleanly partway through its
 * slide instead of jumping the order the instant the model changes.
 */
import { ignoreAbort, Node2D } from '@src/stargazer'
import { type BoardGeom, cellCenter } from '../layout'
import { ANIM, GOAL } from '../tuning'
import { type BoardState, type MoveResult, SIZE, type Tile } from '../types'
import { TileNode } from './TileNode'

/**
 * How long a tile waits before popping in the goal cascade: one step per cell
 * of grid distance from the winning tile, so the wave rolls outward. The
 * winning tile itself gets 0 and is skipped, having just popped from its
 * merge.
 */
export function cascadeDelay(from: number, index: number): number {
  const dist =
    Math.abs((index % SIZE) - (from % SIZE)) +
    Math.abs(Math.floor(index / SIZE) - Math.floor(from / SIZE))
  return dist * GOAL.cascadeStepSec
}

/**
 * Back to front for a board lit from above: the higher a tile sits, the earlier
 * it paints, so the tile below it covers its skirt.
 */
export function byPaintOrder(
  a: { transform: { y: number } },
  b: { transform: { y: number } },
): number {
  return a.transform.y - b.transform.y
}

export class TileLayerNode extends Node2D {
  #geom: BoardGeom
  readonly #tiles = new Map<number, TileNode>()

  constructor(geom: BoardGeom) {
    super('t48-tiles')
    this.renderLayer = 'dynamic'
    this.#geom = geom
    this.#refit()
  }

  #refit(): void {
    const p = this.#geom.plate
    // Room below the plate for the deepest skirt, so culling cannot clip one.
    const slack = this.#geom.cell * 0.2
    this.debugBounds = {
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height + slack,
    }
  }

  /** Re-place every tile after a resize. No animation: the board just refits. */
  setGeom(geom: BoardGeom, state: BoardState): void {
    this.#geom = geom
    this.#refit()
    for (const t of state.tiles) {
      const node = this.#tiles.get(t.id)
      if (!node) continue
      node.setCell(geom.cell)
      const c = cellCenter(geom, t.index)
      node.snapTo(c.x, c.y)
    }
  }

  /** Drop every tile and rebuild from `state`, with each one popping in. */
  reset(state: BoardState): void {
    for (const node of this.#tiles.values()) {
      if (!node.isDestroyed) node.destroy()
    }
    this.#tiles.clear()
    for (const t of state.tiles) this.spawn(t)
  }

  /** Add one newly dealt tile. */
  spawn(tile: Tile): void {
    const node = new TileNode(tile.value, this.#geom.cell)
    const c = cellCenter(this.#geom, tile.index)
    node.snapTo(c.x, c.y)
    this.#tiles.set(tile.id, node)
    // Attach before animating: `Node.tween` rejects on a node with no scene, so
    // `appear` on a detached node would leave the tile stuck at scale 0.
    this.add(node)
    node.appear()
  }

  /**
   * Animate one move.
   *
   * Order matters: the surviving tiles slide first, then each consumed pair is
   * sent onto its destination and destroyed on arrival, and the merged tile is
   * created underneath them so it is already in place when they vanish. Doing
   * it the other way round makes a merge read as a teleport.
   */
  applyMove(result: MoveResult): void {
    const merging = new Set<number>()
    for (const m of result.merges) {
      merging.add(m.consumed[0])
      merging.add(m.consumed[1])
    }

    for (const s of result.slides) {
      if (merging.has(s.id)) continue
      const node = this.#tiles.get(s.id)
      if (!node) continue
      const c = cellCenter(this.#geom, s.to)
      node.slideTo(c.x, c.y)
    }

    for (const m of result.merges) {
      const c = cellCenter(this.#geom, m.at)

      const merged = new TileNode(m.value, this.#geom.cell)
      merged.snapTo(c.x, c.y)
      // Hidden until the two halves have arrived, so it does not sit under
      // them looking like a third tile.
      merged.transform.alpha = 0
      this.#tiles.set(m.id, merged)
      this.add(merged)

      for (const id of m.consumed) {
        const node = this.#tiles.get(id)
        this.#tiles.delete(id)
        node?.absorbInto(c.x, c.y)
      }

      merged
        .wait(ANIM.slide * 0.9)
        .then(() => {
          if (merged.isDestroyed) return
          merged.transform.alpha = 1
          merged.pop()
        })
        .catch(ignoreAbort)
    }
  }

  /**
   * Every tile pops in a wave rolling out from `from`, for the goal moment. One
   * ring on one cell is what a milestone looks like, and reaching 2048 should
   * visibly move the whole board.
   */
  cascade(state: BoardState, from: number): void {
    for (const tile of state.tiles) {
      const node = this.#tiles.get(tile.id)
      if (!node) continue
      const delay = cascadeDelay(from, tile.index)
      if (delay === 0) continue
      node
        .wait(delay)
        .then(() => {
          if (!node.isDestroyed) node.pop()
        })
        .catch(ignoreAbort)
    }
  }

  override onUpdate(): void {
    // Cheap at this size (never more than seventeen nodes) and it has to run
    // every frame, since tiles cross rows mid-slide.
    this._children.sort((a, b) => byPaintOrder(a as Node2D, b as Node2D))
  }
}
