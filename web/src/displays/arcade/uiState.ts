import { get, writable } from 'svelte/store'
import {
  DAY_CYCLE,
  effectiveElevationDeg,
  paletteAt,
} from './background/dayCycle'
import { rgbaStr, type SkyPalette } from './background/palette'

// Where the sun is as this module loads, so the stores below open on the right
// values instead of a placeholder the first repaint has to correct.
const SEED_DRIVE = effectiveElevationDeg(Date.now(), DAY_CYCLE.fallbackLocation)
const SEED = paletteAt(SEED_DRIVE)

/**
 * True while a game's "How to play" modal is open. The arcade-wide swipe-down
 * escape hatch ({@link ReturnToLauncherOverlay}) reads this to suspend its
 * `window`-level gesture, so a downward drift inside the tutorial carousel
 * can't trip a return-to-launcher.
 */
export const tutorialOpen = writable(false)

/**
 * Minutes past midnight the launcher sky is pinned to, on the booth's own
 * clock, or null to follow the sun. The attendant slider writes it, and it
 * outranks the dev URL params.
 */
export const skyTimeOverride = writable<number | null>(null)

/**
 * The sky's current top color as a CSS string. `ArcadeScreen` mirrors it into
 * the theme so the DOM surfaces that are sky track the canvas.
 */
export const skyTopColor = writable(rgbaStr(SEED.skyTop))

/**
 * True once the sky is dark enough that the launcher should wear its night
 * chrome. Discrete rather than a blend, so both palettes can be authored and
 * contrast-checked as they will actually be seen.
 */
export const skyIsDark = writable(SEED_DRIVE < DAY_CYCLE.darkBelowDeg)

/**
 * Publish everything the DOM derives from the sky. Safe to call on every tick,
 * since each store is only written when its value actually moves. The dark
 * switch tracks the driver rather than the palette, so it still fires while the
 * sun crosses a plateau where the colors hold still.
 */
export function publishSky(palette: SkyPalette, driveDeg: number): void {
  const top = rgbaStr(palette.skyTop)
  if (get(skyTopColor) !== top) skyTopColor.set(top)
  const dark = driveDeg < DAY_CYCLE.darkBelowDeg
  if (get(skyIsDark) !== dark) skyIsDark.set(dark)
}
