/**
 * The menu backdrop: a real 2048 board that deals itself an opening and then
 * settles.
 *
 * It reuses the game's own frame and tile nodes and the real rules, driven by
 * the greedy {@link chooseMove}, so what a player sees on the menu is exactly
 * what they get when they tap Play. The board sits off to the right, tilted and
 * bled past the edge of the view, so the rail reads over the empty corner
 * rather than over tiles.
 *
 * It plays a bounded opening rather than a whole game and then holds its last
 * position. A menu is something you read, and a board still shuffling behind
 * the buttons competes with it. The bound matters: greedy play survives for
 * hundreds of moves, so "play until stuck" would be minutes of motion.
 */
import { ignoreAbort, Node2D, type EngineHost, type Rect } from '@src/stargazer'
import type { MenuPreview } from '@src/displays/arcade/menu/types'
import { chooseMove } from './autoplay'
import { computeBoardGeom } from './layout'
import { BoardFrameNode } from './nodes/BoardFrameNode'
import { TileLayerNode } from './nodes/TileLayerNode'
import { createStartState, move, spawnTile } from './rules'
import { createSpawnStream } from './spawn'
import { ACCENT_SOLO, ANIM } from './tuning'
import type { BoardState } from './types'

/** Board side as a fraction of the view height. */
const SIDE_FRAC = 0.86
/** How far right of center the board sits, as a fraction of view width. */
const CENTER_X_FRAC = 0.72
/** A lazy lean, so the preview does not read as the playfield itself. */
const TILT_RAD = -0.06
/** Pause between the autoplayer's moves. Slower than a person, on purpose. */
const MOVE_INTERVAL_SEC = 0.45
/**
 * Moves played before the board settles. Long enough to build something worth
 * looking at, short enough that the menu goes quiet soon after you walk up.
 */
const PREVIEW_MOVES = 18
/** A fixed seed, so the menu always opens on the same pleasant-looking board. */
const SEED = 20_481

export function buildTwenty48MenuPreview(
  host: EngineHost,
  view: Rect,
): MenuPreview {
  const root = new Node2D('t48-menu-preview')
  host.engine.tree.root.add(root)

  const side = view.height * SIDE_FRAC
  const slot = {
    x: view.x + view.width * CENTER_X_FRAC - side / 2,
    y: view.y + view.height / 2 - side / 2,
    width: side,
    height: side,
  }
  const geom = computeBoardGeom(slot)

  // Rotate about the board's own center rather than the node origin, so the
  // lean does not also shift it off toward a corner.
  const pivot = new Node2D('t48-preview-pivot')
  pivot.transform.x = slot.x + side / 2
  pivot.transform.y = slot.y + side / 2
  pivot.transform.rotation = TILT_RAD
  root.add(pivot)

  const inner = new Node2D('t48-preview-inner')
  inner.transform.x = -(slot.x + side / 2)
  inner.transform.y = -(slot.y + side / 2)
  pivot.add(inner)

  const frame = new BoardFrameNode(geom, ACCENT_SOLO)
  const tiles = new TileLayerNode(geom)
  inner.add(frame, tiles)

  const stream = createSpawnStream(SEED)
  let state: BoardState = createStartState(stream)
  tiles.reset(state)

  void (async () => {
    for (let played = 0; played < PREVIEW_MOVES; played++) {
      await root.wait(MOVE_INTERVAL_SEC).catch(ignoreAbort)
      if (root.isDestroyed) return

      const dir = chooseMove(state)
      if (!dir) break
      const result = move(state, dir)
      state = result.state
      tiles.applyMove(result)

      await root.wait(ANIM.slide).catch(ignoreAbort)
      if (root.isDestroyed) return
      const spawned = spawnTile(state, stream)
      state = spawned.state
      if (spawned.tile) tiles.spawn(spawned.tile)
    }
    // Settles here, holding the last position for as long as the menu is up.
  })()

  return {
    destroy() {
      if (!root.isDestroyed) root.destroy()
    },
  }
}
