import { writable } from 'svelte/store'

/**
 * Opaque id of whatever the active display considers "currently selected",
 * mirrored from the game session so observers outside the game canvas (booth
 * menu, future score-management panel) can react without holding a session
 * reference. The display sets its own id shape (state code, level tag, …). This
 * store is a plain string bag with no interpretation.
 *
 * Semantics:
 *
 * - Selected: the tapped id.
 * - Canceled: `null`.
 * - RoundStarted: `null` (selection consumed by the round).
 */
export const selectedStateId = writable<string | null>(null)

/**
 * Attendant-facing "stop the game" handle. A display registers a callback once
 * it is ready, and the booth menu's Debug section invokes it to put the display
 * back where a visitor starts, from any state: mid-round, mid-selection, with a
 * result card showing, or with a screen that has stopped answering. `null`
 * while the display is booting, after teardown, or when it has nothing to stop,
 * and the button is disabled then.
 */
export const stopGameHandle = writable<(() => void) | null>(null)
