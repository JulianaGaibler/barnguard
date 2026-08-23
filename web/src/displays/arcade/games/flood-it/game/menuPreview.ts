/**
 * The in-engine menu backdrop: a board that floods a few times and comes to
 * rest.
 *
 * Deliberately quiet. It sits behind a menu, so it has to read as texture and
 * not compete with the rail for attention. Four things keep it down:
 *
 * No line tracking the owned region and no recess framing the board, so there
 * is no hard edge drawn anywhere.
 *
 * A palette of white at low opacities rather than the game's six hues, the
 * first entry fully transparent so the field is full of holes.
 *
 * A ragged bite cut out of the left side, deeper toward the bottom, so the side
 * facing the rail has no straight boundary to read as a panel.
 *
 * A short run of evenly paced moves that stops, instead of looping for as long
 * as anyone is looking at it.
 *
 * It is still the real board running the real flood, so what settles on screen
 * is a genuine position.
 */
import { Node2D, withAlpha, type EngineHost, type Rect } from '@src/stargazer'
import type { MenuPreview } from '@src/displays/arcade/menu/types'
import { buildAutoBoard } from './autoBoard'
import { COLORS } from './tuning'
import type { Bounds } from './types'

/**
 * How much of the view's height the board spans. Over 1, so it bleeds past the
 * edge and no boundary is visible anywhere on screen.
 *
 * The overhang is cropped to the on-screen rect rather than left to run. The
 * arcade holds both regions in one world, separated by a band of sky, so
 * anything drawn past this region shows up in the launcher's view.
 */
const BOARD_SPAN = 1.34
/**
 * Where the board's centre sits across the view. Pushed right, since the menu
 * rail owns the left of the region.
 */
const CENTER_X_FRAC = 0.72

/**
 * Finer and with more shades than a real board.
 *
 * Both work against the run eating the field. Nine moves on a coarse board with
 * few colors flood most of it, leaving one flat shade where the texture used to
 * be; at this size and spread they take a seventh of it, so the pattern
 * survives and the moves read as ripples across it.
 */
const GRID = { cols: 16, rows: 16, colors: 7 }

/**
 * How much of the width is cut away at the bottom row, tapering to nothing at
 * the top.
 *
 * Most of the way across, so the side facing the rail is eaten right back while
 * the top keeps its full width. The top is where the region grows from, so it
 * is also the part that has to stay intact.
 */
const CARVE_FRAC = 0.62

/**
 * White at rising opacities, the first of them invisible.
 *
 * The transparent entry is not dealt into the body of the board at all. It is
 * reserved for the cut, and the run never floods to it, which is what keeps the
 * bite from filling back in. It has to be the first entry, since that is the
 * one the carve uses.
 */
const PALETTE = [
  withAlpha(COLORS.paper, 0),
  withAlpha(COLORS.paper, 0.04),
  withAlpha(COLORS.paper, 0.07),
  withAlpha(COLORS.paper, 0.11),
  withAlpha(COLORS.paper, 0.15),
  withAlpha(COLORS.paper, 0.2),
  withAlpha(COLORS.paper, 0.26),
]

/** Moves before it settles for good. */
const MOVES = 9
/**
 * Pause between moves, on top of each flood. An even pulse: the board steps
 * outward at one pace and then stops, which reads calmer behind a menu than a
 * run that visibly slows down.
 */
const BEAT = 0.18

/**
 * @param view Rect the board is sized and placed against, the cover rect.
 * @param crop On-screen rect to crop to. The board is deliberately larger than
 *   `view`, and the part past this is another region's to show.
 */
export function buildFloodItMenuPreview(
  host: EngineHost,
  view: Rect,
  crop: Rect,
): MenuPreview {
  const root = new Node2D('flood-menu-preview')
  // Behind the launcher rail's DOM, and over the arcade sky.
  root.renderLayer = 'dynamic'
  host.engine.tree.root.add(root)

  const side = view.height * BOARD_SPAN
  const rect: Bounds = {
    x: view.x + view.width * CENTER_X_FRAC - side / 2,
    y: view.y + view.height / 2 - side / 2,
    width: side,
    height: side,
  }

  const board = buildAutoBoard({
    host,
    parent: root,
    rect,
    grid: GRID,
    // Fixed, so the menu looks the same on every visit rather than sometimes
    // opening on a board that floods in three moves.
    seed: 0x5eed,
    stopAfter: MOVES,
    beat: BEAT,
    carveLeftFrac: CARVE_FRAC,
    look: { palette: PALETTE, outline: false, well: null, clip: crop },
  })

  return {
    destroy() {
      board.destroy()
      if (!root.isDestroyed) root.destroy()
    },
  }
}
