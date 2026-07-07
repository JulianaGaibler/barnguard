import type { SceneNode } from './SceneNode'

/**
 * Base class for logic attached to a `SceneNode`. Extend and override any of
 * the lifecycle hooks. The engine sets `node` when `SceneNode.addBehaviour` is
 * called and clears it on detach.
 *
 * Behaviours never assume `node` is null at runtime, only mutate them via
 * `SceneNode.addBehaviour` / `removeBehaviour`.
 */
export abstract class Behaviour {
  // Set by SceneNode.addBehaviour before onAttach fires; cleared on detach.
  node!: SceneNode

  /**
   * Internal, tracks whether `onSceneReady` has fired since the last add. Reset
   * on `removeBehaviour` so an add / remove / add cycle fires again. Do not
   * touch from user code.
   */
  _sceneReadyFired = false

  onAttach?(): void
  /**
   * Fires once, AFTER `onAttach`, guaranteed AFTER the node is attached to an
   * Engine-owned Scene. Use this (not `onAttach`) when you need
   * `this.node.scene?.engine`, e.g. to schedule tweens, waits, or a background
   * async loop.
   *
   * Timing:
   *
   * - If the node is ALREADY scene-attached when `addBehaviour(this)` runs, this
   *   fires SYNCHRONOUSLY after `onAttach`. No 1-frame pop.
   * - Otherwise, it fires synchronously from `onAttachedToScene`, i.e. the moment
   *   the node's subtree is added to a scene-attached parent. Either way, no
   *   rendering happens between attach and `onSceneReady`.
   *
   * Removing then re-adding the behaviour causes this to fire again on the next
   * attach. Attaching, detaching from a scene, then re-attaching to the same
   * scene does NOT refire, `onSceneReady` is "first sight of any scene" for the
   * current add.
   */
  onSceneReady?(): void
  onDetach?(): void
  onUpdate?(dt: number): void
  onFixedStep?(fixedDt: number): void
}

export type BehaviourCtor<T extends Behaviour> = new (...args: never[]) => T
