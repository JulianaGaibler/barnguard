import { writable } from 'svelte/store'
import type { StateId } from '@src/game/data/states'

/**
 * Currently-selected state on the map, mirrored from the game session so
 * observers outside the game canvas (booth menu, future score-management panel)
 * can react without having to hold a `GameSession` reference. Set by
 * `GameScreen` in the `stateSelected` / `selectionCanceled` / `roundStarted`
 * event handlers.
 *
 * Semantics match `GameSession.selectedStateId`:
 *
 * - `stateSelected` → the tapped state id
 * - `selectionCanceled` → `null`
 * - `roundStarted` → `null` (selection has been consumed by the round)
 */
export const selectedStateId = writable<StateId | null>(null)

/**
 * Attendant-facing "stop the game" handle. `GameScreen` registers a callback
 * once the session is ready; the booth menu's Debug section invokes it to force
 * the game back to idle from any state (mid-round, mid-selection, gameOver
 * overlay showing). `null` while the session is booting or after teardown — the
 * button hides in that case.
 */
export const stopGameHandle = writable<(() => void) | null>(null)
