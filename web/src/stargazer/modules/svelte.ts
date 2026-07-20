/**
 * Svelte bindings, the only part of stargazer that touches the DOM.
 * {@link mountEngine} is a `use:` action that builds an `EngineHost` from a
 * `<canvas>` and tears it down on unmount; {@link mountStage} attaches a
 * secondary `Stage` to an existing engine. {@link domAnchor} pins an HTML
 * element to a scene node so it rides the camera (see the dom module).
 * {@link emitterStore} adapts an `Emitter` event into a Svelte store for the
 * low-frequency events.
 *
 * @module svelte
 * @category Svelte
 */
export { mountEngine } from '../svelte/mountEngine'
export type { MountEngineActionParams } from '../svelte/mountEngine'
export { mountStage } from '../svelte/mountStage'
export type { MountStageParams } from '../svelte/mountStage'
export { domAnchor } from '../svelte/domAnchor'
export type { DomAnchorParams } from '../svelte/domAnchor'
export { emitterStore, latestEventStore } from '../svelte/emitterStore'
