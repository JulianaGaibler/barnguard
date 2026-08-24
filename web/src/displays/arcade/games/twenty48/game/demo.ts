/**
 * The four tutorial demos, built on the shared demo stage.
 *
 * Every one drives the real rules through the real nodes, so a card cannot
 * drift away from how the game actually behaves. Each runs a short scripted
 * loop rather than the autoplayer, because a card has to make one point legibly
 * rather than play well.
 *
 * - {@link buildMoveDemo}: a finger swipes, and an arrow bar is tapped.
 * - {@link buildMergeDemo}: two equal tiles slide together and score.
 * - {@link buildFullDemo}: a packed board runs out of moves.
 * - {@link buildGoalDemo}: tiles gather into one corner, toward 2048.
 */
import { ignoreAbort, Node2D, type Stage } from '@src/stargazer'
import type { DemoBuilder } from '@src/displays/arcade/tutorial/types'
import { cellCenter, computeBoardGeom, type BoardGeom } from './layout'
import { ArrowBarNode } from './nodes/ArrowBarNode'
import { BoardFrameNode } from './nodes/BoardFrameNode'
import { TileLayerNode } from './nodes/TileLayerNode'
import { indexOf, move, spawnTile } from './rules'
import { createSpawnStream } from './spawn'
import { ACCENT_SOLO, ANIM, COLORS } from './tuning'
import { createFingerDot, showSwipe, showTap } from '../../common/fingerDot'
import type { BoardState, Direction, Tile } from './types'

/** Board side inside the demo card, in the stage's own world units. */
const SIDE_FRAC = 0.78
const HOLD_SEC = 1.2
const GAP_SEC = 0.6

interface DemoBoard {
  root: Node2D
  geom: BoardGeom
  tiles: TileLayerNode
}

/** A board centered in the stage's viewport, at whatever size that viewport is. */
function buildDemoBoard(stage: Stage, name: string, arrows = false): DemoBoard {
  // The demo stage always has a 2D camera, but the type allows none, and a
  // fallback viewport is a better failure than a thrown builder.
  const view = stage.currentCamera2D?.viewport ?? {
    x: 0,
    y: 0,
    width: 1000,
    height: 750,
  }
  const side = Math.min(view.width, view.height) * SIDE_FRAC
  const slot = {
    x: view.x + (view.width - side) / 2,
    y: view.y + (view.height - side) / 2,
    width: side,
    height: side,
  }
  const geom = computeBoardGeom(slot)
  const root = new Node2D(name)
  const tiles = new TileLayerNode(geom)
  root.add(new BoardFrameNode(geom, ACCENT_SOLO), tiles)
  if (arrows) {
    for (const dir of ['up', 'down', 'left', 'right'] as Direction[]) {
      root.add(
        new ArrowBarNode(dir, geom.arrows[dir], {
          onPress: () => {},
          enabled: () => false,
        }),
      )
    }
  }
  stage.tree.root.add(root)
  return { root, geom, tiles }
}

/** A board from a literal grid, so a card can set up exactly the case it needs. */
function stateFrom(rows: readonly (readonly number[])[]): BoardState {
  const tiles: Tile[] = []
  let id = 1
  rows.forEach((cells, row) => {
    cells.forEach((value, col) => {
      if (value) tiles.push({ id: id++, value, index: indexOf(col, row) })
    })
  })
  return {
    tiles,
    score: 0,
    highest: tiles.reduce((m, t) => Math.max(m, t.value), 0),
    won: false,
    nextTileId: id,
    spawnOrdinal: 0,
  }
}

/** Play one move on a demo board and show it, without spawning. */
async function step(
  board: DemoBoard,
  state: BoardState,
  dir: Direction,
): Promise<BoardState> {
  const result = move(state, dir)
  if (!result.moved) return state
  board.tiles.applyMove(result)
  await board.root.wait(ANIM.slide + 0.1).catch(ignoreAbort)
  return result.state
}

/**
 * Each card's starting board and the moves it plays, exported so `demo.test.ts`
 * can assert every one of them actually changes the board. A scripted move that
 * turns out to be a no-op leaves the card showing a gesture with nothing
 * happening after it, which is worse than showing nothing at all.
 */
export const MOVE_DEMO_ROWS: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  [2, 0, 4, 0],
  [0, 0, 0, 0],
  [0, 8, 0, 0],
]
export const MOVE_DEMO_MOVES: readonly Direction[] = ['right', 'up']

export const MERGE_DEMO_ROWS: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  [4, 0, 0, 4],
  [0, 16, 16, 0],
  [0, 0, 0, 0],
]
export const MERGE_DEMO_MOVES: readonly Direction[] = ['left', 'down']

export const GOAL_DEMO_ROWS: readonly (readonly number[])[] = [
  [1024, 512, 128, 64],
  [0, 0, 0, 32],
  [0, 0, 0, 0],
  [0, 0, 2, 2],
]
export const GOAL_DEMO_MOVES: readonly Direction[] = ['right', 'up']

/** Swipe to move, or tap one of the bars. */
export const buildMoveDemo: DemoBuilder = (stage) => {
  const board = buildDemoBoard(stage, 't48-demo-move', true)
  const dot = createFingerDot(board.geom.cell * 0.3, COLORS.ink)
  board.root.add(dot)

  void (async () => {
    for (;;) {
      let state = stateFrom(MOVE_DEMO_ROWS)
      board.tiles.reset(state)
      await board.root.wait(GAP_SEC).catch(ignoreAbort)
      if (board.root.isDestroyed) return

      const from = cellCenter(board.geom, 12)
      const to = cellCenter(board.geom, 15)
      await showSwipe(dot, from, to).catch(ignoreAbort)
      state = await step(board, state, MOVE_DEMO_MOVES[0])
      if (board.root.isDestroyed) return

      await board.root.wait(HOLD_SEC).catch(ignoreAbort)
      const bar = board.geom.arrows[MOVE_DEMO_MOVES[1]]
      await showTap(dot, {
        x: bar.x + bar.width / 2,
        y: bar.y + bar.height / 2,
      }).catch(ignoreAbort)
      state = await step(board, state, MOVE_DEMO_MOVES[1])
      if (board.root.isDestroyed) return
      await board.root.wait(HOLD_SEC).catch(ignoreAbort)
    }
  })()

  return {
    destroy() {
      if (!board.root.isDestroyed) board.root.destroy()
    },
  }
}

/** Equal tiles merge, and the merged value is the score. */
export const buildMergeDemo: DemoBuilder = (stage) => {
  const board = buildDemoBoard(stage, 't48-demo-merge')

  void (async () => {
    for (;;) {
      let state = stateFrom(MERGE_DEMO_ROWS)
      board.tiles.reset(state)
      await board.root.wait(GAP_SEC).catch(ignoreAbort)
      if (board.root.isDestroyed) return

      state = await step(board, state, MERGE_DEMO_MOVES[0])
      if (board.root.isDestroyed) return
      await board.root.wait(HOLD_SEC).catch(ignoreAbort)
      state = await step(board, state, MERGE_DEMO_MOVES[1])
      if (board.root.isDestroyed) return
      await board.root.wait(HOLD_SEC).catch(ignoreAbort)
    }
  })()

  return {
    destroy() {
      if (!board.root.isDestroyed) board.root.destroy()
    },
  }
}

/**
 * A tile arrives after every move, and eventually there is no room.
 *
 * Plays once and rests on the dead board. The other cards loop because they
 * show a mechanic repeating, but this one ends in a terminal state, and
 * replaying it would undo the very thing it is there to show.
 *
 * The single free cell is walled in by 8 and 32, so neither a 2 nor a 4 landing
 * there has a neighbour to merge with, and no other pair on the board is equal
 * and adjacent either. That matters: a board that still has a legal move would
 * be demonstrating the opposite of what the card claims. `demo.test.ts` pins
 * it.
 */
export const FULL_DEMO_ROWS: readonly (readonly number[])[] = [
  [2, 4, 8, 0],
  [4, 2, 16, 32],
  [2, 4, 8, 16],
  [4, 2, 4, 2],
]

export const buildFullDemo: DemoBuilder = (stage) => {
  const board = buildDemoBoard(stage, 't48-demo-full')
  const stream = createSpawnStream(3)

  void (async () => {
    const state = stateFrom(FULL_DEMO_ROWS)
    board.tiles.reset(state)
    await board.root.wait(GAP_SEC).catch(ignoreAbort)
    if (board.root.isDestroyed) return

    const spawned = spawnTile(state, stream)
    if (spawned.tile) board.tiles.spawn(spawned.tile)
    // Settles here, holding the full board for as long as the card is up.
  })()

  return {
    destroy() {
      if (!board.root.isDestroyed) board.root.destroy()
    },
  }
}

/** Keep the big tile in one corner and build toward it. */
export const buildGoalDemo: DemoBuilder = (stage) => {
  const board = buildDemoBoard(stage, 't48-demo-goal')

  void (async () => {
    for (;;) {
      let state = stateFrom(GOAL_DEMO_ROWS)
      board.tiles.reset(state)
      await board.root.wait(GAP_SEC).catch(ignoreAbort)
      if (board.root.isDestroyed) return

      state = await step(board, state, GOAL_DEMO_MOVES[0])
      if (board.root.isDestroyed) return
      await board.root.wait(HOLD_SEC).catch(ignoreAbort)
      state = await step(board, state, GOAL_DEMO_MOVES[1])
      if (board.root.isDestroyed) return
      await board.root.wait(HOLD_SEC * 1.4).catch(ignoreAbort)
    }
  })()

  return {
    destroy() {
      if (!board.root.isDestroyed) board.root.destroy()
    },
  }
}
