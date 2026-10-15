/**
 * Companion node that draws ONLY an orb's white scoring ring. It lives in a
 * separate layer that renders BELOW every orb fill, so when two orbs touch, a
 * ring is painted over by the neighbouring orb's body instead of obstructing
 * it. It mirrors its `OrbNode`'s placement (position + bounce scale) and owns
 * the animated ring width, which the orb tweens.
 */
import { Node2D, definePaintProps, type Canvas } from '@src/stargazer'
import type { OrbNode } from './OrbNode'
import { RING } from '../tuning'

export class RingNode extends Node2D {
  readonly #orb: OrbNode
  /** Outline width in world units, 0 when hidden. */
  declare width: number

  constructor(orb: OrbNode) {
    super(`ring-${orb.body.id}`)
    this.#orb = orb
    definePaintProps(this, { width: 0 })
  }

  override onUpdate(): void {
    // Track the orb: position from the physics body (source of truth), scale
    // from the orb node's transform so the count-bounce grows the ring too.
    const orbTransform = this.#orb.transform
    this.transform.x = this.#orb.body.x
    this.transform.y = this.#orb.body.y
    this.transform.scaleX = orbTransform.scaleX
    this.transform.scaleY = orbTransform.scaleY
    this.transform.rotation = orbTransform.rotation
    this.visible = this.#orb.visible && !this.#orb.isDestroyed
  }

  override paint(gfx: Canvas): void {
    const width = this.width
    if (width <= 0.01) return
    // Inner edge pinned to the orb radius: a stroke of width `width` centered
    // at `r + width/2` spans exactly [r, r + width].
    const r = this.#orb.body.radius
    gfx.strokeCircle(0, 0, r + width / 2, { color: RING.color, width })
  }
}
