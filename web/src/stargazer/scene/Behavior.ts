import type { Node } from './Node'
import type { Node2D } from './Node2D'

/**
 * Reusable game logic attached to a node. Subclass it, override the hooks you
 * need, and attach an instance with {@link Node.addBehavior}. Keeping logic in
 * behaviors (rather than node subclasses) lets one node combine several
 * independent behaviors and keeps the engine's node types game-agnostic.
 *
 * The attached node is available as `this.node` from `onAttach` onward. The
 * type parameter `N` is the node kind it attaches to; it defaults to
 * {@link Node2D}, so a plain `extends Behavior` targets 2D nodes. A behavior for
 * the 3D tree declares `extends Behavior<Node3D>` (or `Behavior<Node>` for
 * either).
 *
 * @category Scene
 * @example
 *   class Spin extends Behavior {
 *     readonly #radPerSec: number
 *     constructor(radPerSec: number) {
 *       super()
 *       this.#radPerSec = radPerSec
 *     }
 *     override onUpdate(dt: number): void {
 *       this.node.transform.rotation += this.#radPerSec * dt
 *     }
 *   }
 *
 *   node.addBehavior(new Spin(Math.PI))
 */
export abstract class Behavior<N extends Node = Node2D> {
  /**
   * The node this behavior is attached to. Set by {@link Node.addBehavior}
   * before `onAttach` fires; reading it before attach is a bug.
   */
  node!: N

  /** Internal, guards `onSceneReady`. Reset by `removeBehavior`. */
  _sceneReadyFired = false

  /** Fires when the behavior is attached to a node, before `onSceneReady`. */
  onAttach?(): void
  /**
   * Fires once after `onAttach`, guaranteed after the node is in a scene. Use
   * it when you need `node.scene?.engine`. If the node is already
   * scene-attached, fires synchronously with `onAttach` (no 1-frame pop).
   * Detach+reattach to the same scene doesn't re-fire, but remove+re-add does.
   */
  onSceneReady?(): void
  /** Fires when the behavior is removed, or when its node is destroyed. */
  onDetach?(): void
  /** Per-render-frame update. `dt` is the variable frame delta in seconds. */
  onUpdate?(dt: number): void
  /**
   * Deterministic fixed-step update. `fixedDt` is constant (see
   * `EngineOptions.fixedStepHz`). Put physics and other order-sensitive
   * integration here so it runs at a steady rate regardless of frame rate.
   */
  onFixedStep?(fixedDt: number): void
}

/**
 * Constructor for a {@link Behavior} subclass, used by `getBehavior` /
 * `getBehaviors` to look up attached behaviors by type.
 *
 * @category Scene
 */
export type BehaviorCtor<T extends Behavior<Node>> = new (...args: never[]) => T
