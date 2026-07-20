/**
 * In-engine queue indicator for one player: a horizontal, center-anchored row
 * of small filled circles (no outline) sized to represent the queued orbs.
 * Rendering it in the scene (rather than DOM) makes the animations trivial —
 * each dot is a `ShapeNode` we tween.
 *
 * The group sits at the world origin; dots live in absolute world coordinates,
 * laid out centered on `(cx, cy)` so the row re-centers as it grows and
 * shrinks. `update(orbs)` (all motion is horizontal, conveyor-style):
 *
 * - New orbs (returned to the end) fade in and slide in from the right.
 * - Removed orbs (spawned from the front) fade out and slide off to the left.
 * - Survivors slide horizontally to fill the gap / make space, staying centered.
 */
import { SceneNode, ShapeNode, easings, ignoreAbort } from '@src/stargazer'
import { INDICATOR, ORB_SIZES } from '../tuning'
import type { OrbSize, QueuedOrbView } from '../types'

export class IndicatorNode extends SceneNode {
  readonly #color: string
  readonly #cx: number
  readonly #cy: number
  readonly #dots = new Map<string, ShapeNode>()

  constructor(color: string, cx: number, cy: number) {
    super('indicator')
    this.#color = color
    this.#cx = cx
    this.#cy = cy
    this.renderLayer = 'dynamic'
  }

  #radiusFor(size: OrbSize): number {
    return ORB_SIZES[size].radius * INDICATOR.sizeScale
  }

  update(orbs: QueuedOrbView[]): void {
    const nextIds = new Set(orbs.map((o) => o.id))

    // Removed (spawned from the front): fade out + slide left, then destroy.
    for (const [id, node] of this.#dots) {
      if (nextIds.has(id)) continue
      this.#dots.delete(id)
      void node.autoDestroy(
        node.tween(
          { x: node.transform.x - INDICATOR.driftWorld, alpha: 0 },
          { duration: INDICATOR.removeSec, easing: easings.inCubic },
        ),
      )
    }

    // Added (returned to the end): created hidden to the right of their slot;
    // the fade-in + slide is kicked off in `relayout` once positions are known.
    const fresh = new Set<string>()
    for (const o of orbs) {
      if (this.#dots.has(o.id)) continue
      const node = new ShapeNode({
        id: `ind-${o.id}`,
        geometry: { kind: 'circle', radius: this.#radiusFor(o.size) },
        fill: this.#color,
      })
      node.transform.alpha = 0
      this.add(node)
      this.#dots.set(o.id, node)
      fresh.add(o.id)
    }

    this.#relayout(orbs, fresh)
  }

  #relayout(orbs: QueuedOrbView[], fresh: Set<string>): void {
    const gap = INDICATOR.gapWorld
    let total = 0
    for (let i = 0; i < orbs.length; i++) {
      total += 2 * this.#radiusFor(orbs[i].size)
      if (i > 0) total += gap
    }

    let cursor = this.#cx - total / 2
    for (const o of orbs) {
      const r = this.#radiusFor(o.size)
      const tx = cursor + r
      cursor += 2 * r + gap
      const node = this.#dots.get(o.id)
      if (!node) continue
      if (fresh.has(o.id)) {
        // Start to the right of the slot + transparent, then fade in + slide left.
        node.transform.x = tx + INDICATOR.driftWorld
        node.transform.y = this.#cy
        node.transform.alpha = 0
        void node
          .tween(
            { x: tx, alpha: 1 },
            { duration: INDICATOR.addSec, easing: easings.outCubic },
          )
          .catch(ignoreAbort)
      } else {
        // Slide horizontally to the new centered slot.
        void node
          .tween(
            { x: tx },
            { duration: INDICATOR.shiftSec, easing: easings.outCubic },
          )
          .catch(ignoreAbort)
      }
    }
  }
}
