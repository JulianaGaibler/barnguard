/**
 * Pointer input and hit testing. {@link InputSystem} tracks active pointers on a
 * stage, captures them on press, and dispatches {@link PointerEvent2D}s to scene
 * nodes (and the stage emitter). World coordinates re-project each frame so a
 * held pointer stays glued to its target during camera motion.
 * {@link findHitNode} is the top-most-hit walker behind dispatch.
 *
 * @module input
 * @category Input
 */
export { InputSystem } from '../input/InputSystem'
export { findHitNode } from '../input/hit'
export type {
  PointerEvent2D,
  PointerStateSnapshot,
  PointerPhase,
} from '../input/PointerState'
