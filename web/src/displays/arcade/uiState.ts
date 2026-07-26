import { writable } from 'svelte/store'

/**
 * True while a game's "How to play" modal is open. The arcade-wide swipe-down
 * escape hatch ({@link ReturnToLauncherOverlay}) reads this to suspend its
 * `window`-level gesture, so a downward drift inside the tutorial carousel
 * can't trip a return-to-launcher.
 */
export const tutorialOpen = writable(false)
