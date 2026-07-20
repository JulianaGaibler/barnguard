/**
 * A small typed event bus. {@link createEmitter} builds an {@link Emitter} keyed
 * by an event map; {@link EngineEvents} is the map the engine itself uses
 * (`ready`, `frame`, `resize`, pointer events, context loss). Subscribe with
 * `on`, which returns an unsubscribe function.
 *
 * @module events
 * @category Events
 */
export { createEmitter } from '../events/Emitter'
export type { Emitter, EmitterHandler } from '../events/Emitter'
export type { EngineEvents } from '../events/EngineEvents'
