import type { Node2D } from '../scene/Node2D'
import type { Node3D } from '../scene/Node3D'
import type { Stage } from '../render/Stage'
import type { Vec2 } from '../math/Vec2'

/**
 * A node that can capture a pointer: a 2D {@link Node2D} (bounds hit) or a
 * 3D {@link Node3D} (ray pick). The input system dispatches pointer callbacks to
 * whichever captured on `down`.
 *
 * @category Input
 */
export type PointerTarget = Node2D | Node3D

/**
 * Snapshot of a single active pointer's state. `world` is re-projected each
 * frame from `screen` via the currently-active camera, so it stays fresh even
 * during a camera animation while a finger is held still.
 *
 * @category Input
 */
export interface PointerStateSnapshot {
  readonly id: number
  readonly kind: 'touch' | 'mouse' | 'pen'
  /** CSS pixels, canvas-local (via `getBoundingClientRect`). */
  readonly screen: Readonly<Vec2>
  /** World coords via `activeCamera.screenToWorld(screen)`. */
  readonly world: Readonly<Vec2>
  readonly startedAtMs: number
  /**
   * The node that captured this pointer on `down`, or `null` for untargeted. A
   * `Node2D` for a 2D hit, a `Node3D` for a 3D ray pick.
   */
  readonly capturedBy: PointerTarget | null
}

/**
 * Lifecycle phase of a pointer event.
 *
 * @category Input
 */
export type PointerPhase = 'down' | 'move' | 'up' | 'cancel'

/**
 * A single pointer event dispatched to node behaviors and stage emitters.
 *
 * @category Input
 */
export interface PointerEvent2D {
  readonly pointer: PointerStateSnapshot
  /** World-coord delta from the previously-dispatched event for this pointer. */
  readonly delta: Readonly<Vec2>
  readonly phase: PointerPhase
  /**
   * `'native'`, dispatched in response to a browser PointerEvent.
   * `'synthetic'`, generated per-frame because the active camera moved
   * underneath a still finger (see plan §"Multi-touch input pipeline").
   */
  readonly source: 'native' | 'synthetic'
  /**
   * The stage whose canvas + scene this event belongs to. Node behaviors can
   * infer this from `this.node`, but exposing it on the event lets emitter
   * consumers filter by canvas of origin.
   */
  readonly stage: Stage
  /**
   * The pointer's `world` position converted into `node`'s local space via
   * {@link Node2D.worldToLocal}. Convenience for drag handlers whose target
   * sits under a scaled/translated ancestor, so they read local coords directly
   * instead of threading a bespoke world→local closure. Pass `out` to reuse a
   * scratch {@link Vec2}.
   */
  localTo(node: Node2D, out?: Vec2): Vec2
}
