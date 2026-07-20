/**
 * Boot, lifecycle, and the frame loop. {@link createEngineHost} is the usual
 * entry point: it builds an {@link Engine}, wires the debug controller, and
 * handles WebGL context loss, returning an {@link EngineHost} for
 * start/stop/pause and scene swapping. Drop to {@link Engine} directly for finer
 * control, or {@link createTicker} for a standalone frame loop.
 *
 * @module engine
 * @category Engine
 */
export { createEngineHost } from '../engine/EngineHost'
export type {
  EngineHost,
  EngineHostOptions,
  SceneBuilder,
} from '../engine/EngineHost'
export { Engine } from '../engine/Engine'
export type {
  EngineOptions,
  RegisteredPhysicsWorld,
  RegisterPhysicsWorldOptions,
} from '../engine/Engine'
export { createTicker } from '../engine/Ticker'
export type { Ticker, TickerOptions } from '../engine/Ticker'
