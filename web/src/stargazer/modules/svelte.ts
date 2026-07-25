/**
 * Svelte bindings, the only part of stargazer that touches the DOM.
 * {@link mountEngine} is a `use:` action that builds an `EngineHost` from a
 * `<canvas>` and tears it down on unmount; {@link mountStage} attaches a
 * secondary `Stage` to an existing engine. {@link domAnchor} pins an HTML
 * element to a scene node so it rides the camera (see the dom module).
 * {@link a11yRoot} hands an element to the accessibility tree as its mount point
 * (see the a11y module). {@link emitterStore} adapts an `Emitter` event into a
 * Svelte store for the low-frequency events.
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
export { a11yRoot } from '../svelte/a11yRoot'
export type { A11yRootParams } from '../svelte/a11yRoot'
export { emitterStore, latestEventStore } from '../svelte/emitterStore'
