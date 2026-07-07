import { ShapeNode, type Vec2 } from '@src/stargazer'

/**
 * Visible circle radius (world units). Kept small, the handle is a discreet
 * hint, not a UI target the eye should latch onto.
 */
const VISUAL_RADIUS = 1.6
/**
 * Hit-test radius (world units). Deliberately much larger than the visible
 * circle so touch targets stay generous on the 4K kiosk.
 */
const HIT_RADIUS = 14

/**
 * A small hit-enabled circle drawn at the tip of a partially-drawn path.
 * Grabbing it resumes the drag via `EndpointResumeBehaviour`, the behaviour
 * hides the handle during drag and re-parks it at the trail's new tip on
 * release.
 *
 * Renders as a filled cream dot (no stroke) so the affordance reads as a
 * discreet marker without pulling attention off the packet. Overrides `hitTest`
 * so the hit target stays large regardless of the visible radius.
 */
export class EndpointHandleNode extends ShapeNode {
  constructor(worldPos: Vec2) {
    super({
      id: 'endpoint-handle',
      geometry: { kind: 'circle', radius: VISUAL_RADIUS },
      fill: 'rgba(253, 246, 227, 0.95)',
    })
    this.transform.x = worldPos.x
    this.transform.y = worldPos.y
    this.hitEnabled = true
  }

  override hitTest(
    worldX: number,
    worldY: number,
    touchSlopWorld: number,
  ): boolean {
    // Skip the base class's `geometry.radius`-driven check, the visible
    // circle is tiny (1.6 wu) but we want a generous 14-wu hit target.
    // The handle never scales / rotates in practice, so a straight
    // world-space distance check against the transform origin is exact.
    const w = this.transform.world
    const dx = worldX - w.e
    const dy = worldY - w.f
    const r = HIT_RADIUS + touchSlopWorld
    return dx * dx + dy * dy <= r * r
  }
}
