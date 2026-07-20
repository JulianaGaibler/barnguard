/**
 * Companion node that draws ONLY an orb's white scoring ring. It lives in a
 * separate layer that renders BELOW every orb fill, so when two orbs touch, a
 * ring is painted over by the neighbouring orb's body instead of obstructing
 * it. It owns no state of its own — it mirrors its `OrbNode`'s placement
 * (position + bounce scale) and reads the animated ring width straight off it.
 */
import { SceneNode, type Gfx2D } from '@src/stargazer'
import type { OrbNode } from './OrbNode'
import { RING } from '../tuning'

export class RingNode extends SceneNode {
  readonly #orb: OrbNode

  constructor(orb: OrbNode) {
    super(`ring-${orb.body.id}`)
    this.#orb = orb
    this.renderLayer = 'dynamic'
  }

  override onUpdate(): void {
    // Track the orb: position from the physics body (source of truth), scale
    // from the orb node's transform so the count-bounce grows the ring too.
    const t = this.#orb.transform
    this.transform.x = this.#orb.body.x
    this.transform.y = this.#orb.body.y
    this.transform.scaleX = t.scaleX
    this.transform.scaleY = t.scaleY
    this.transform.rotation = t.rotation
    this.visible = this.#orb.visible && !this.#orb.isDestroyed
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#orb.ringWidth
    if (w <= 0.01) return
    // Inner edge pinned to the orb radius: a stroke of width `w` centered at
    // `r + w/2` spans exactly [r, r + w].
    const r = this.#orb.body.radius
    gfx.strokeCircle(0, 0, r + w / 2, { color: RING.color, width: w })
  }
}
