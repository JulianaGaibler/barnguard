import { Behaviour, type PointerEvent2D } from '@src/stargazer'
import type { EndpointHandleNode } from '../nodes/EndpointHandleNode'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import type { PacketNode } from '../nodes/PacketNode'
import { PacketBehaviour } from './PacketBehaviour'
import { PathTrailNode } from '../nodes/PathTrailNode'
import { TUNING } from '../data/tuning'

export interface EndpointResumeHooks {
  isPlaying(): boolean
  epicenter(): EpicenterNode | null
}

/**
 * Attaches to an `EndpointHandleNode` and lets the player continue the parent
 * packet's already-drawn path from the tip:
 *
 * - **pointerdown**: capture, latch onto the packet's currently-bound
 *   `PathTrailNode` (no clear, we're extending, not replacing).
 * - **pointermove**: move the handle to the finger's world position and push into
 *   the trail (snap-to-epicenter check runs first).
 * - **pointerup / cancel**: on snap-to-epicenter, destroy the handle (path is now
 *   complete). Otherwise, park the handle at the trail's new tip so the player
 *   can pick it up again for another extension.
 *
 * A parallel of `PathDrawBehaviour` scoped to "continue" instead of "start
 * fresh". Both push into the same `PathTrailNode`, the packet's
 * `PacketBehaviour.steerAlongTrail` doesn't care which drag pushed the
 * samples.
 */
export class EndpointResumeBehaviour extends Behaviour {
  private readonly hooks: EndpointResumeHooks
  private readonly packet: PacketNode
  private activePointerId: number | null = null
  private trail: PathTrailNode | null = null
  private snapped = false
  private readonly scratch = { x: 0, y: 0 }

  constructor(packet: PacketNode, hooks: EndpointResumeHooks) {
    super()
    this.packet = packet
    this.hooks = hooks
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
  }

  override onUpdate(_dt: number): void {
    // Once the packet has consumed every drawn point (or its trail was
    // cleared / destroyed), the handle sits far from the packet and no
    // longer points at "where the path ends", retire it. Guarded on
    // `activePointerId` so a live drag doesn't yank the handle out from
    // under the user during a momentary drain (packet catches finger
    // between `pushIfFar` acceptances).
    if (this.activePointerId !== null) return
    if (this.node.isDestroyed) return
    if (this.packet.isDestroyed) {
      this.node.destroy()
      return
    }
    const trail = this.packet.getBehaviour(PacketBehaviour)?.boundTrail
    if (!trail || trail.isDestroyed) {
      this.node.destroy()
      return
    }
    if (trail.nextTargetIndex >= trail.pointCount) {
      this.node.destroy()
    }
  }

  private handleDown(e: PointerEvent2D): void {
    if (!this.hooks.isPlaying()) return
    if (this.activePointerId !== null) return
    if (e.pointer.capturedBy !== this.node) return
    // The packet may have been destroyed since the handle was spawned
    // (capture / lost / reset). Bail, the handle's cleanup will follow.
    if (this.packet.isDestroyed) return
    const behaviour = this.packet.getBehaviour(PacketBehaviour)
    const trail = behaviour?.boundTrail ?? null
    if (!trail || trail.isDestroyed) return
    this.trail = trail
    this.snapped = false
    this.activePointerId = e.pointer.id
    // Hide the handle for the duration of the drag, the trail itself
    // is the visual feedback. The node stays hit-enabled so subsequent
    // move / up events keep firing on it.
    this.node.transform.alpha = 0
  }

  private handleMove(e: PointerEvent2D): void {
    if (e.pointer.id !== this.activePointerId) return
    if (!this.trail || this.snapped) return
    const ep = this.hooks.epicenter()
    const world = e.pointer.world
    if (ep) {
      const dx = ep.center.x - world.x
      const dy = ep.center.y - world.y
      if (
        dx * dx + dy * dy <=
        TUNING.path.snapRadiusWorld * TUNING.path.snapRadiusWorld
      ) {
        this.trail.push(ep.center.x, ep.center.y)
        this.snapped = true
        return
      }
    }
    this.trail.pushIfFar(world.x, world.y, TUNING.path.minPointDistWorld)
  }

  private handleUp(e: PointerEvent2D): void {
    if (e.pointer.id !== this.activePointerId) return
    this.finalise()
  }

  private handleCancel(e: PointerEvent2D): void {
    if (e.pointer.id !== this.activePointerId) return
    this.finalise()
  }

  private finalise(): void {
    this.activePointerId = null
    const handle = this.node as EndpointHandleNode
    if (this.snapped) {
      // Path reached the epicenter, the handle's job is done.
      if (!handle.isDestroyed) handle.destroy()
      this.trail = null
      return
    }
    // Re-park at the trail's actual last drawn point (handle stayed put
    // while we hid it during drag), then unhide.
    const trail = this.trail
    if (trail && !trail.isDestroyed && trail.pointCount > 0) {
      trail.pointAt(trail.pointCount - 1, this.scratch)
      handle.transform.x = this.scratch.x
      handle.transform.y = this.scratch.y
    }
    handle.transform.alpha = 1
    this.trail = null
  }
}
