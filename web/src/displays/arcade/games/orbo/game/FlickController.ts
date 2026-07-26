/**
 * Drag-to-flick input for the active orb. Ports the reference `_interaction.ts`
 * onto stargazer's pointer pipeline: `bindPointer` gives us multi-touch +
 * capture for free, and `e.pointer.world` is the finger position in field
 * units. Ports faithfully:
 *
 * - Ghost mode while dragging (`body.isBeingDragged` → skipped in collisions).
 * - Glue the orb to the finger.
 * - Auto-launch the moment the drag crosses the strip boundary into the field.
 * - Snap back (keep the turn) on a too-slow release; otherwise launch.
 *
 * Improved per the plan: release velocity is measured over a short trailing
 * window (touch digitizers are noisy), and auto-launch / launch only fire when
 * the windowed velocity is fast enough AND points into the playfield.
 */
import {
  clamp,
  easings,
  ignoreAbort,
  type PointerEvent2D,
  type Node2D,
} from '@src/stargazer'
import type { OrbNode } from './nodes/OrbNode'
import { launchBoundary, type FieldLayout } from './layout'
import { ANIM, FLICK } from './tuning'
import type { Orb } from './Orb'

interface Sample {
  x: number
  y: number
  t: number
}

export interface FlickCallbacks {
  /**
   * A valid flick was released. The body is still ghosted (`isBeingDragged`);
   * the session resolves overlaps, un-ghosts, and assigns the (already
   * force-multiplied) launch velocity.
   */
  onLaunched(vx: number, vy: number): void
}

export class FlickController {
  readonly #node: OrbNode
  readonly #body: Orb
  readonly #layout: FieldLayout
  readonly #cb: FlickCallbacks
  /**
   * Node whose local space the field's coordinates live in. The arcade nests
   * the field in a scaled/translated group, so `e.localTo(this.#localNode)`
   * maps a world pointer into field units (which body position + release
   * velocity use, matching the tuning).
   */
  readonly #localNode: Node2D
  readonly #unbind: () => void
  readonly #samples: Sample[] = []
  #dragging = false
  /** True during the snap-back tween: ignore new pointer-downs until it ends. */
  #busy = false
  #destroyed = false

  constructor(
    node: OrbNode,
    body: Orb,
    layout: FieldLayout,
    cb: FlickCallbacks,
    /** Node whose local space maps `e.localTo(...)` into field units. */
    localNode: Node2D,
  ) {
    this.#node = node
    this.#body = body
    this.#layout = layout
    this.#cb = cb
    this.#localNode = localNode
    this.#unbind = node.bindPointer({
      singlePointer: true, // one finger owns the flick; ignore extra touches
      down: (e) => this.#onDown(e),
      move: (e) => this.#onMove(e),
      up: (e) => this.#onUp(e),
      cancel: () => this.#onCancel(),
    })
  }

  destroy(): void {
    this.#destroyed = true
    this.#unbind()
  }

  #onDown(e: PointerEvent2D): void {
    if (this.#busy || this.#destroyed) return
    this.#dragging = true
    this.#body.isBeingDragged = true
    this.#body.isSleeping = false
    this.#samples.length = 0
    const w = e.localTo(this.#localNode)
    this.#samples.push({ x: w.x, y: w.y, t: performance.now() })
  }

  #onMove(e: PointerEvent2D): void {
    if (!this.#dragging) return
    const w = e.localTo(this.#localNode)
    // Glue to finger, clamped inside the field so it can't be dragged off-screen.
    this.#body.x = clamp(
      w.x,
      this.#body.radius,
      this.#layout.width - this.#body.radius,
    )
    this.#body.y = clamp(
      w.y,
      this.#body.radius,
      this.#layout.height - this.#body.radius,
    )
    this.#pushSample(w.x, w.y)

    // Auto-launch once the orb crosses its strip boundary into the field.
    const { x: boundary, dir } = launchBoundary(this.#layout, this.#body.team)
    const crossed =
      dir === 1 ? this.#body.x > boundary : this.#body.x < boundary
    if (crossed) this.#release()
  }

  #onUp(e: PointerEvent2D): void {
    if (!this.#dragging) return
    const w = e.localTo(this.#localNode)
    this.#pushSample(w.x, w.y)
    this.#release()
  }

  #onCancel(): void {
    if (!this.#dragging) return
    this.#snapBack()
  }

  /** Decide launch vs snap-back from the windowed release velocity. */
  #release(): void {
    if (!this.#dragging) return
    this.#dragging = false

    const { vx, vy } = this.#windowedVelocity()
    const speed = Math.hypot(vx, vy)
    const { dir } = launchBoundary(this.#layout, this.#body.team)
    const intoField = dir === 1 ? vx > 0 : vx < 0

    if (speed < FLICK.minThrowVelocity || !intoField) {
      this.#snapBack()
      return
    }

    // Valid throw. Unbind first so no stray move/up lands mid-launch; hand the
    // force-multiplied velocity to the session (body stays ghosted for it).
    this.#unbind()
    this.#cb.onLaunched(vx * FLICK.velocityToForce, vy * FLICK.velocityToForce)
  }

  /** Tween the orb home, keeping the turn. Stays ghosted during the tween. */
  #snapBack(): void {
    this.#dragging = false
    this.#busy = true
    this.#node
      .tweenTo(
        this.#body,
        { x: this.#body.homeX, y: this.#body.homeY },
        { duration: ANIM.snapBack, easing: easings.outCubic },
      )
      .then(() => {
        this.#body.isBeingDragged = false
        this.#busy = false
      })
      .catch((err) => {
        ignoreAbort(err)
        // On abort (node destroyed / turn ended) just release ghost state.
        this.#body.isBeingDragged = false
        this.#busy = false
      })
  }

  #pushSample(x: number, y: number): void {
    const now = performance.now()
    this.#samples.push({ x, y, t: now })
    const cutoff = now - FLICK.sampleWindowMs * 3
    while (this.#samples.length > 2 && this.#samples[0].t < cutoff) {
      this.#samples.shift()
    }
  }

  /** Velocity (world u/s) over the trailing `sampleWindowMs`. */
  #windowedVelocity(): { vx: number; vy: number } {
    const count = this.#samples.length
    if (count < 2) return { vx: 0, vy: 0 }
    const last = this.#samples[count - 1]
    // Oldest sample still inside the window (fall back to the earliest we have).
    let ref = this.#samples[0]
    for (let i = count - 1; i >= 0; i--) {
      if (last.t - this.#samples[i].t >= FLICK.sampleWindowMs) {
        ref = this.#samples[i]
        break
      }
    }
    const dt = (last.t - ref.t) / 1000
    if (dt <= 0) return { vx: 0, vy: 0 }
    return { vx: (last.x - ref.x) / dt, vy: (last.y - ref.y) / dt }
  }
}
