import type { SceneNode } from './SceneNode'

/**
 * Base for logic attached to a `SceneNode`. Override lifecycle hooks.
 * `node` is set by `addBehaviour` before `onAttach`, cleared on detach.
 */
export abstract class Behaviour {
  // Set by SceneNode.addBehaviour before onAttach fires; cleared on detach.
  node!: SceneNode

  /** Internal, guards `onSceneReady`. Reset by `removeBehaviour`. */
  _sceneReadyFired = false

  onAttach?(): void
  /**
   * Fires once after `onAttach`, guaranteed after scene attach. Use when
   * you need `node.scene?.engine`. If the node is already scene-attached,
   * fires synchronously with `onAttach`, no 1-frame pop. Detach+reattach to
   * the same scene doesn't re-fire, but remove+re-add does.
   */
  onSceneReady?(): void
  onDetach?(): void
  onUpdate?(dt: number): void
  onFixedStep?(fixedDt: number): void
}

export type BehaviourCtor<T extends Behaviour> = new (...args: never[]) => T
