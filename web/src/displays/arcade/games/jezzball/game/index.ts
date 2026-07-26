/**
 * Public entry points for the JezzBall game engine layer. The Svelte component
 * builds boards and input through these; the pure grid/layout/collider modules
 * are imported directly where needed.
 */
export { BoardController, LAYER_BALL, LAYER_SOLID } from './board'
export type { BoardColors, BoardCallbacks } from './board'
export { InputController, classifyGesture } from './input'
export * from './types'
