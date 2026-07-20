/**
 * Async tweens and sequencing. {@link Animator} owns the active tween/wait set
 * and ticks in engine time; {@link Timeline} chains steps in sequence or
 * parallel. Most game code reaches these through the scoped helpers
 * (`SceneNode.tween`, `SceneNode.wait`, `Camera.animateTo`). The abort helpers
 * ({@link combineAbortSignals}, {@link isAbortError}) implement the cancel
 * contract, tweens reject with `AbortError` when their node is destroyed.
 *
 * @module anim
 * @category Animation
 */
export { Animator } from '../anim/Animator'
export type { TweenOptions } from '../anim/Animator'
export { Timeline } from '../anim/Timeline'
export type { TimelineStep } from '../anim/Timeline'
export {
  ignoreAbort,
  isAbortError,
  abortError,
  combineAbortSignals,
} from '../anim/abortSignal'
export type { CombinedAbort } from '../anim/abortSignal'
