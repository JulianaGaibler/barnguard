import {
  Behaviour,
  easings,
  ignoreAbort,
  type PointerEvent2D,
} from '@src/stargazer'
import type { PacketNode } from '../nodes/PacketNode'
import { PathTrailNode } from '../nodes/PathTrailNode'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import { PacketBehaviour } from './PacketBehaviour'
import { EndpointHandleNode } from '../nodes/EndpointHandleNode'
import { EndpointResumeBehaviour } from './EndpointResumeBehaviour'
import { TUNING } from '../data/tuning'

export interface PathDrawSessionHooks {
  isPlaying(): boolean
  epicenter(): EpicenterNode | null
  /** Layer where drawn polylines mount. Owned by the session, not the packet. */
  pathLayerAdd(node: PathTrailNode): void
  /**
   * Layer where endpoint-resume handles mount. Separate from the path layer so
   * the small circle draws on top of the polyline and never gets obscured by
   * newly-appended segments.
   */
  handleLayerAdd(node: EndpointHandleNode): void
  /**
   * The session provides this so `PacketBehaviour.steerAlongTrail` picks up
   * points the drag has queued. The trail stays bound across pointerup; a
   * subsequent drag on the same packet clears the same node in place.
   */
  bindTrailToPacket(packet: PacketNode, trail: PathTrailNode): void
}

/**
 * Multi-touch drag on a packet body, draws a `PathTrailNode` that the packet's
 * `PacketBehaviour` will follow. Guards against two fingers on the same packet
 * via `activePointerId`, only the first `pointerdown` starts a drag; subsequent
 * pointers are ignored until the tracked pointer releases.
 */
export class PathDrawBehaviour extends Behaviour {
  private readonly session: PathDrawSessionHooks
  private activePointerId: number | null = null
  private trail: PathTrailNode | null = null
  private snapped = false
  /**
   * The endpoint-resume handle spawned at the last drawn point after a drag
   * that didn't reach the epicenter. Persists between drags so the player can
   * grab it to continue. Cleared on: fresh drag on the packet (drag replaces
   * the path), snap-to-epicenter, or packet destroy.
   */
  private handle: EndpointHandleNode | null = null
  private readonly tailScratch = { x: 0, y: 0 }

  constructor(session: PathDrawSessionHooks) {
    super()
    this.session = session
  }

  private unbindPointer: (() => void) | null = null

  override onAttach(): void {
    this.unbindPointer = this.node.bindPointer({
      down: (e) => this.handleDown(e),
      move: (e) => this.handleMove(e),
      up: (e) => this.handleUp(e),
      cancel: (e) => this.handleCancel(e),
    })
  }

  override onDetach(): void {
    this.unbindPointer?.()
    this.unbindPointer = null
    // Packet died, its endpoint handle would otherwise sit orphaned
    // in `handleLayer` until the round ends.
    this.destroyHandle()
  }

  private destroyHandle(): void {
    if (this.handle && !this.handle.isDestroyed) this.handle.destroy()
    this.handle = null
  }

  private handleDown(e: PointerEvent2D): void {
    if (!this.session.isPlaying()) return
    if (this.activePointerId !== null) return
    if (e.pointer.capturedBy !== this.node) return
    this.activePointerId = e.pointer.id
    this.snapped = false
    this.playPressFeedback()
    // Fresh drag on the packet replaces the previous path, retire the
    // resume handle too so it doesn't sit atop a cleared trail.
    this.destroyHandle()
    // No point is pushed on touchdown, the trail is a QUEUE of guidance
    // points; the packet's own current position isn't part of it. Only the
    // finger's motion generates points. This keeps the packet from snapping
    // to the touchdown location on drag start.
    this.beginTrail()
  }

  /**
   * Two-phase scale pop, 1 → `scaleTo` then back to 1, that fires on every
   * touchdown so the player gets an immediate visual "heard you" before their
   * finger starts producing samples. Runs on the packet's transform;
   * `PacketBehaviour::steerAlongTrail` doesn't touch scale so the tween never
   * fights physics. Rapid re-taps stack tweens, the animator will handle it
   * (later tween wins on shared props).
   */
  private playPressFeedback(): void {
    const cfg = TUNING.packet.pressFeedback
    const packet = this.node as PacketNode
    packet
      .tween(
        { scaleX: cfg.scaleTo, scaleY: cfg.scaleTo },
        { duration: cfg.upSec, easing: easings.outQuad },
      )
      .then(() => {
        if (packet.isDestroyed) return
        return packet.tween(
          { scaleX: 1, scaleY: 1 },
          { duration: cfg.downSec, easing: easings.outCubic },
        )
      })
      .catch(ignoreAbort)
  }

  private handleMove(e: PointerEvent2D): void {
    if (e.pointer.id !== this.activePointerId) return
    if (!this.trail || this.snapped) return
    const ep = this.session.epicenter()
    const world = e.pointer.world
    if (ep) {
      const dx = ep.center.x - world.x
      const dy = ep.center.y - world.y
      if (
        dx * dx + dy * dy <=
        TUNING.path.snapRadiusWorld * TUNING.path.snapRadiusWorld
      ) {
        this.snapIntoCone(ep)
        return
      }
    }
    this.trail.pushIfFar(world.x, world.y, TUNING.path.minPointDistWorld)
  }

  /**
   * Finger has entered the snap radius around the cone's apex. The player MUST
   * enter the cone from within its opening (`±(coneSweep/2 +
   * approachForgivenessRad)` around the inward axis). Good approaches push the
   * apex directly; off-angle approaches insert two waypoints , an entry point
   * sitting at 85 % of `coneRadius` along the axis, then the apex, so the
   * packet's angular-velocity-limited steering naturally U-turns into the
   * cone's mouth. Either way, `snapped` locks further pushes for the remainder
   * of this drag.
   */
  private snapIntoCone(ep: EpicenterNode): void {
    if (!this.trail) return
    const apex = ep.center
    const half = ep.coneSweep * 0.5
    const tolerance = half + TUNING.epicenter.approachForgivenessRad

    // Approach direction of the LAST-pushed trail point → apex. A drag
    // that hits the snap radius without any prior points (first sample
    // already inside) accepts any angle so we don't force a spurious
    // U-turn when the player taps directly on the target.
    let approachAngle: number
    if (this.trail.pointCount > 0) {
      this.trail.pointAt(this.trail.pointCount - 1, this.tailScratch)
      approachAngle = Math.atan2(
        apex.y - this.tailScratch.y,
        apex.x - this.tailScratch.x,
      )
    } else {
      approachAngle = ep.axisRad + Math.PI
    }

    const inward = ep.axisRad + Math.PI
    const delta = wrapAngle(approachAngle - inward)
    if (Math.abs(delta) <= tolerance) {
      this.trail.push(apex.x, apex.y)
    } else {
      // Off-angle approach: the forced entry point sits 10 % OUTSIDE
      // the cone's outer radius (on the axis) so the packet clearly
      // enters from beyond the wedge and traces the full length in.
      const entryDist = ep.coneRadius * 1.1
      const entryX = apex.x + Math.cos(ep.axisRad) * entryDist
      const entryY = apex.y + Math.sin(ep.axisRad) * entryDist
      this.trail.push(entryX, entryY)
      this.trail.push(apex.x, apex.y)
    }
    this.snapped = true
  }

  private handleUp(e: PointerEvent2D): void {
    if (e.pointer.id !== this.activePointerId) return
    this.finaliseDrag()
  }

  private handleCancel(e: PointerEvent2D): void {
    if (e.pointer.id !== this.activePointerId) return
    this.finaliseDrag()
  }

  /**
   * Bind a trail node to this packet, ready to receive move-generated points.
   * If the packet already has one bound (from a previous drag), reuse it, a
   * fresh drag REPLACES the old queue (we `clear` in place so the same
   * PolylineNode instance stays in the scene, no node churn). The packet keeps
   * its current velocity until the first move pushes a point; then
   * `PacketBehaviour.steerAlongTrail` aims at it.
   */
  private beginTrail(): void {
    const packet = this.node as PacketNode
    const behaviour = packet.getBehaviour(PacketBehaviour)
    const existing = behaviour?.boundTrail ?? null
    if (existing && !existing.isDestroyed) {
      existing.clear()
      this.trail = existing
      return
    }
    const trail = new PathTrailNode()
    this.session.pathLayerAdd(trail)
    this.trail = trail
    this.session.bindTrailToPacket(packet, trail)
  }

  private finaliseDrag(): void {
    this.activePointerId = null
    const trail = this.trail
    this.trail = null
    // The trail stays BOUND to the packet across pointerup. PacketBehaviour
    // continues consuming any remaining points; a fresh tap on the packet
    // clears + reuses the node via `beginTrail`. If the drag never reached
    // the epicenter, spawn a resume handle at the trail's tip so the
    // player can pick up and continue.
    if (this.snapped) {
      this.destroyHandle()
      return
    }
    if (!trail || trail.isDestroyed || trail.pointCount === 0) return
    trail.pointAt(trail.pointCount - 1, this.tailScratch)
    this.spawnHandle(this.tailScratch.x, this.tailScratch.y)
  }

  private spawnHandle(x: number, y: number): void {
    // Reuse an existing handle if one is still alive, happens when a
    // partial drag lands after a previous partial drag; we just move
    // the same node to the new tip rather than churning through
    // create/destroy pairs on every release.
    if (this.handle && !this.handle.isDestroyed) {
      this.handle.transform.x = x
      this.handle.transform.y = y
      return
    }
    const handle = new EndpointHandleNode({ x, y })
    handle.addBehaviour(
      new EndpointResumeBehaviour(this.node as PacketNode, {
        isPlaying: () => this.session.isPlaying(),
        epicenter: () => this.session.epicenter(),
      }),
    )
    this.session.handleLayerAdd(handle)
    this.handle = handle
  }
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}
