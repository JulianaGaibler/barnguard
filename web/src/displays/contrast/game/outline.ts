/**
 * A card whose fill is close to the screen behind it would melt into it, so it
 * gets a faint outline. The measure is the WCAG ratio whatever algorithm is
 * playing, because this is about telling two surfaces apart and not about
 * text.
 */
import { wcagContrast, type Rgb } from './contrast'

/** The ratio below which a surface needs an edge. WCAG asks 3 for UI parts. */
export const OUTLINE_BELOW = 3

/** The screen the cards sit on. */
export const SCREEN_BACKGROUND: Rgb = [22, 22, 22]

/** The outline, 25 percent white. */
export const OUTLINE_COLOR = 'rgba(255, 255, 255, 0.25)'

export function needsOutline(
  card: Rgb,
  screen: Rgb = SCREEN_BACKGROUND,
): boolean {
  return wcagContrast(card, screen) < OUTLINE_BELOW
}
