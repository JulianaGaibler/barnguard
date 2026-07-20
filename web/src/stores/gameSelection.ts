import { writable } from 'svelte/store'

/**
 * Opaque id of whatever the active display considers "currently selected",
 * mirrored from the game session so observers outside the game canvas (booth
 * menu, future score-management panel) can react without holding a session
 * reference. The display sets its own id shape (state code, level tag, …) —
 * this store is a plain string bag with no interpretation.
 *
 * Semantics:
 *
 * - Selected → the tapped id
 * - Canceled → `null`
 * - RoundStarted → `null` (selection consumed by the round)
 */
export const selectedStateId = writable<string | null>(null)

/**
 * Attendant-facing "stop the game" handle. `GameScreen` registers a callback
 * once the session is ready; the booth menu's Debug section invokes it to force
 * the game back to idle from any state (mid-round, mid-selection, gameOver
 * overlay showing). `null` while the session is booting or after teardown — the
 * button hides in that case.
 */
export const stopGameHandle = writable<(() => void) | null>(null)
