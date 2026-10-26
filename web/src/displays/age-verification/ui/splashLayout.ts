import type { UiRegion } from '@src/core/ui/uiRegion.svelte'
import { isStacked } from './frame'
import type { Box } from './layout'
import type { Point } from './motion'
import { NO_INSETS, readSafeArea, scaleInsets, type Insets } from './safeArea'

/**
 * The splash screen's layout: the text on the left, and the animation on a dark
 * panel that runs to the right edge. The panel's inner edge steps out and back
 * like the brand's pixel shapes. On a portrait screen the panel runs across the
 * top, its lower edge stepped, and the text sits under it. At 1920 by 1080
 * every number is the design's.
 */

/** The share of the width the panel takes, less its steps. */
const PANEL_SHARE = 982 / 1920
/** The share of the height the panel takes on a portrait screen. */
const STACK_PANEL_SHARE = 0.46

/**
 * The steps of the panel's inner edge, from its start (the top, or the left on
 * a portrait screen) to its end. Each runs to `to`, a share of the edge's
 * length, and stands `depth` design pixels out of the panel.
 */
const STEPS: readonly { to: number; depth: number }[] = [
  { to: 337 / 1080, depth: 0 },
  { to: 961 / 1080, depth: 100 },
  { to: 1, depth: 43 },
]
const STEP_DEPTH = Math.max(...STEPS.map((step) => step.depth))

/** The space left of the text. */
const TEXT_MARGIN = 105
/** The least space between the text and the panel. */
const TEXT_GAP = 96
/** The space around the text on a portrait screen. */
const STACK_MARGIN = 64

export interface SplashLayout {
  /** True when the panel is above the text. */
  stacked: boolean
  /** The box the text is centered in. */
  text: Box
  /** The panel's bounds, steps included. The animation covers it. */
  panel: Box
  /** The panel's outline, from the panel's top left, in design pixels. */
  outline: readonly Point[]
}

/**
 * Lays the splash out in a visible area of `width` by `height` design pixels,
 * for the frame {@link pickFrame} chose. The panel reaches the edges of the
 * visible area, under any safe-area insets, and the text keeps clear of them.
 */
export function splashLayoutFor(
  width: number,
  height: number,
  frame: { width: number; height: number },
  insets: Insets = NO_INSETS,
): SplashLayout {
  if (isStacked(frame)) {
    const base = Math.round(height * STACK_PANEL_SHARE)
    const panel = { x: 0, y: 0, width, height: base + STEP_DEPTH }
    const top = panel.height + STACK_MARGIN
    const bottom = height - insets.bottom - STACK_MARGIN
    return {
      stacked: true,
      panel,
      outline: stepped(width, base).map(([along, out]) => ({
        x: along,
        y: base + out,
      })),
      text: {
        x: insets.left + STACK_MARGIN,
        y: top,
        width: Math.max(
          width - insets.left - insets.right - STACK_MARGIN * 2,
          0,
        ),
        height: Math.max(bottom - top, 0),
      },
    }
  }
  const base = Math.round(width * PANEL_SHARE)
  const panel = {
    x: width - base - STEP_DEPTH,
    y: 0,
    width: base + STEP_DEPTH,
    height,
  }
  const left = insets.left + TEXT_MARGIN
  return {
    stacked: false,
    panel,
    outline: stepped(height, base).map(([along, out]) => ({
      x: STEP_DEPTH - out,
      y: along,
    })),
    text: {
      x: left,
      y: insets.top,
      width: Math.max(panel.x - TEXT_GAP - left, 0),
      height: Math.max(height - insets.top - insets.bottom, 0),
    },
  }
}

/**
 * The outline of a panel `base` deep along an edge `length` long, as pairs of a
 * place along the edge and how far out of the panel it is: the stepped edge
 * from its start to its end, then back along the far side.
 */
function stepped(length: number, base: number): [number, number][] {
  const points: [number, number][] = []
  let from = 0
  for (const step of STEPS) {
    const to = Math.round(length * step.to)
    points.push([from, step.depth], [to, step.depth])
    from = to
  }
  points.push([length, -base], [0, -base])
  return points
}

/** The splash layout in `region`, with the device's safe area kept clear. */
export function splashLayoutIn(
  region: Pick<UiRegion, 'rect' | 'frame' | 'cssPxInWorld'>,
): SplashLayout {
  const { rect, cssPxInWorld } = region
  return splashLayoutFor(
    rect.width,
    rect.height,
    region.frame ?? rect,
    scaleInsets(readSafeArea(), cssPxInWorld),
  )
}
