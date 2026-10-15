/**
 * Label sizing shared by every display that prints. The printer's resolution
 * and the tape width give the label's edge in pixels. Each display draws its
 * own label in its `label.ts`.
 */

/** Brother VC-500W resolution (~317 lpi vivid). */
export const PIXELS_PER_MM = 12.48
/** Fallback tape width when the printer's is unknown (common CZ-1004 ≈ 25mm). */
export const DEFAULT_TAPE_WIDTH_MM = 25

/** Square edge in px for a given tape width, falling back to a safe default. */
export function squarePxFrom(
  tapeWidthMm?: number | null,
  density: number = PIXELS_PER_MM,
): number {
  const mm =
    tapeWidthMm && tapeWidthMm > 0 ? tapeWidthMm : DEFAULT_TAPE_WIDTH_MM
  return Math.round(mm * density)
}
