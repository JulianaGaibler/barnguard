import {
  PointerBehavior,
  type PointerEvent2D,
  type PointerHandlers,
  type Vec2,
} from '@src/stargazer'
import type { EndpointHandleNode } from '../nodes/EndpointHandleNode'
import type { EpicenterNode } from '../nodes/EpicenterNode'
import type { PacketNode } from '../nodes/PacketNode'
import { PacketBehavior } from './PacketBehavior'
import { PathTrailNode } from '../nodes/PathTrailNode'
import { TUNING } from '../data/tuning'

export interface EndpointResumeHooks {
  isPlaying(): boolean
  epicenter(): EpicenterNode | null
  /** Arcade-world pointer coord → map-local space; see `PathDrawSessionHooks`. */
  worldToMap(x: number, y: number): Vec2
}

/**
 * Attached to an `EndpointHandleNode`. Lets the player continue the packet's
 * existing path from the tip.
 *
 * - Down: capture, latch onto the packet's bound trail (extend, not clear).
 * - Move: move handle to finger, push into trail (snap check first).
 * - Up/cancel: on snap-to-epicenter, destroy handle. Otherwise park at the new
 *   tip for another extension. Parallel to `PathDrawBehavior` but "continue"
 *   instead of "start fresh".
 */
export class EndpointResumeBehavior extends PointerBehavior {
  readonly #hooks: EndpointResumeHooks
  readonly #packet: PacketNode
  #dragging = false
  #trail: PathTrailNode | null = null
  #snapped = false
  readonly #scratch = { x: 0, y: 0 }

  constructor(packet: PacketNode, hooks: EndpointResumeHooks) {
    super()
    this.#packet = packet
    this.#hooks = hooks
  }

  protected handlers(): PointerHandlers {
    return {
      singlePointer: true, // one finger owns the drag; ignore extra touches
      down: (e) => this.#handleDown(e),
      move: (e) => this.#handleMove(e),
      up: (e) => this.#handleUp(e),
      cancel: (e) => this.#handleCancel(e),
    }
  }

  override onUpdate(_dt: number): void {
    // Once the packet has consumed every drawn point (or its trail was
    // cleared / destroyed), the handle sits far from the packet and no
    // longer points at "where the path ends", retire it. Guarded on
    // `#dragging` so a live drag doesn't yank the handle out from
    // under the user during a momentary drain (packet catches finger
    // between `pushIfFar` acceptances).
    if (this.#dragging) return
    if (this.node.isDestroyed) return
    if (this.#packet.isDestroyed) {
      this.node.destroy()
      return
    }
    const trail = this.#packet.getBehavior(PacketBehavior)?.boundTrail
    if (!trail || trail.isDestroyed) {
      this.node.destroy()
      return
    }
    if (trail.nextTargetIndex >= trail.pointCount) {
      this.node.destroy()
    }
  }

  #handleDown(e: PointerEvent2D): void {
    if (!this.#hooks.isPlaying()) return
    if (e.pointer.capturedBy !== this.node) return
    // The packet may have been destroyed since the handle was spawned
    // (capture / lost / reset). Bail, the handle's cleanup will follow.
    if (this.#packet.isDestroyed) return
    const behavior = this.#packet.getBehavior(PacketBehavior)
    const trail = behavior?.boundTrail ?? null
    if (!trail || trail.isDestroyed) return
    this.#trail = trail
    this.#snapped = false
    this.#dragging = true
    // Hide the handle for the duration of the drag, the trail itself
    // is the visual feedback. The node stays hit-enabled so subsequent
    // move / up events keep firing on it.
    this.node.transform.alpha = 0
  }

  #handleMove(e: PointerEvent2D): void {
    if (!this.#trail || this.#snapped) return
    const ep = this.#hooks.epicenter()
    const world = this.#hooks.worldToMap(e.pointer.world.x, e.pointer.world.y)
    if (ep) {
      const dx = ep.center.x - world.x
      const dy = ep.center.y - world.y
      if (
        dx * dx + dy * dy <=
        TUNING.path.snapRadiusWorld * TUNING.path.snapRadiusWorld
      ) {
        this.#trail.push(ep.center.x, ep.center.y)
        this.#snapped = true
        return
      }
    }
    this.#trail.pushIfFar(world.x, world.y, TUNING.path.minPointDistWorld)
  }

  #handleUp(_e: PointerEvent2D): void {
    this.#finalise()
  }

  #handleCancel(_e: PointerEvent2D): void {
    this.#finalise()
  }

  #finalise(): void {
    this.#dragging = false
    const handle = this.node as EndpointHandleNode
    if (this.#snapped) {
      // Path reached the epicenter, the handle's job is done.
      handle.destroy()
      this.#trail = null
      return
    }
    // Re-park at the trail's actual last drawn point (handle stayed put
    // while we hid it during drag), then unhide.
    const trail = this.#trail
    if (trail && !trail.isDestroyed && trail.pointCount > 0) {
      trail.pointAt(trail.pointCount - 1, this.#scratch)
      handle.transform.x = this.#scratch.x
      handle.transform.y = this.#scratch.y
    }
    handle.transform.alpha = 1
    this.#trail = null
  }
}
