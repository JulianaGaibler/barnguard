/**
 * In-engine tutorial demos for Connect Four, built on the shared demo stage.
 * Both reuse the real game nodes (`BoardNode`, `DiscNode`), the board model,
 * `DiscNode.drop`, and the shared `playWinHighlight` celebration, laid out to
 * the stage's fixed viewport. They skip the session/AI/pointer input entirely —
 * a demo builds a subtree and drops scripted discs directly.
 */
import {
  Node2D,
  ignoreAbort,
  type EngineHost,
  type Stage,
} from '@src/stargazer'
import type { DemoHandle } from '@src/displays/arcade/tutorial/types'
import { BoardNode } from './nodes/BoardNode'
import { DiscNode } from './nodes/DiscNode'
import {
  cellCenter,
  computeLayout,
  topEntryY,
  type BoardLayout,
} from './layout'
import {
  COLS,
  ROWS,
  createBoard,
  dropRow,
  legalColumns,
  makeMove,
  unmakeMove,
  winningCells,
  type Board,
} from './board'
import { BOARD, PLAYER_COLORS, WIN_GLOW } from './tuning'
import { playWinHighlight } from './anim'
import type { Player } from './types'

/** World-space margin between the board and the demo viewport edges. */
const FIELD_PADDING = 32

interface Scene {
  root: Node2D
  discLayer: Node2D
  winLayer: Node2D
  layout: BoardLayout
  discRadius: number
  abort: AbortController
}

function buildScene(stage: Stage): Scene {
  const vp = stage.camera.viewport
  const layout = computeLayout({
    x: vp.x + FIELD_PADDING,
    y: vp.y + FIELD_PADDING,
    width: vp.width - FIELD_PADDING * 2,
    height: vp.height - FIELD_PADDING * 2,
  })
  const discRadius = layout.cell * BOARD.discRadiusFrac

  const root = new Node2D('cf-demo')
  const discLayer = new Node2D('cf-demo-discs')
  const winLayer = new Node2D('cf-demo-wins')
  // Discs behind the board so its holes frame them; win bursts on top.
  root.add(discLayer)
  root.add(new BoardNode(layout))
  root.add(winLayer)
  stage.tree.root.add(root)

  return {
    root,
    discLayer,
    winLayer,
    layout,
    discRadius,
    abort: new AbortController(),
  }
}

/** Drop a disc into `(col, row)` for `player`, using the real drop animation. */
async function dropDisc(
  scene: Scene,
  player: Player,
  col: number,
  row: number,
): Promise<void> {
  const center = cellCenter(scene.layout, col, row)
  const disc = new DiscNode(PLAYER_COLORS[player], scene.discRadius)
  disc.transform.x = center.x
  disc.transform.y = topEntryY(scene.layout)
  scene.discLayer.add(disc)
  await disc.drop(center.y, ROWS - row)
}

interface Placement {
  col: number
  row: number
  player: Player
}

/**
 * Commit a random legal move that does NOT complete a four-in-a-row (probing
 * with `makeMove`/`unmakeMove`), so the stacking demo never triggers a win. If
 * every legal move would win (rare, late board), commits the first anyway.
 */
function placeNonWinning(board: Board): Placement | null {
  const legal = legalColumns(board)
  if (legal.length === 0) return null
  // Fisher-Yates so each cycle stacks differently.
  const order = [...legal]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  let fallback: Placement | null = null
  for (const col of order) {
    const row = dropRow(board, col)
    if (row === null) continue
    const player = board.turn
    makeMove(board, col)
    if (board.winner === 0) return { col, row, player }
    unmakeMove(board, col)
    fallback ??= { col, row, player }
  }
  if (fallback) {
    makeMove(board, fallback.col)
    return fallback
  }
  return null
}

/**
 * "Take turns placing discs": alternating players drop into random columns,
 * stacking on top of each other, with no win — just the falling + stacking
 * mechanic. Clears and reshuffles each cycle.
 */
export function buildConnectFourStackDemo(
  stage: Stage,
  host: EngineHost,
): DemoHandle {
  const scene = buildScene(stage)
  const { root, discLayer, abort } = scene
  const MOVES_PER_CYCLE = 16

  async function run(): Promise<void> {
    while (!abort.signal.aborted && !root.isDestroyed) {
      const board = createBoard()
      for (let i = 0; i < MOVES_PER_CYCLE; i++) {
        if (abort.signal.aborted || root.isDestroyed) return
        const placed = placeNonWinning(board)
        if (!placed) break
        await dropDisc(scene, placed.player, placed.col, placed.row)
        if (abort.signal.aborted || root.isDestroyed) return
        await host.engine.wait(0.18, abort.signal).catch(ignoreAbort)
        if (abort.signal.aborted || root.isDestroyed) return
      }
      await host.engine.wait(1.0, abort.signal).catch(ignoreAbort)
      if (abort.signal.aborted || root.isDestroyed) return
      discLayer.destroyChildren()
    }
  }
  void run()

  return {
    destroy() {
      abort.abort()
      if (!root.isDestroyed) root.destroy()
    },
  }
}

/**
 * "Connect four": scripted discs drop until Team L completes a DIAGONAL
 * four-in-a-row (the least obvious shape to a newcomer), which pulses and
 * bursts. Then it clears and repeats.
 */
export function buildConnectFourWinDemo(
  stage: Stage,
  host: EngineHost,
): DemoHandle {
  const scene = buildScene(stage)
  const { root, discLayer, winLayer, layout, discRadius, abort } = scene

  // Minimal diagonal win for Team L (blue): the "/" run (0,0)-(1,1)-(2,2)-(3,3).
  // Red fills the staircase of supports beneath it; one throwaway red disc
  // (col 4) fixes turn parity so blue plays the completing disc last. 11 moves —
  // the fewest a diagonal allows under strict alternation.
  const sequence = [0, 1, 1, 2, 3, 2, 3, 3, 2, 4, 3]
  // Pre-place the first two thirds instantly; only the finish drops in, so the
  // loop reaches the win fast.
  const PREFILL = Math.floor((sequence.length * 2) / 3)

  const addDisc = (
    discByCell: Map<number, DiscNode>,
    player: Player,
    col: number,
    row: number,
    animate: boolean,
  ): Promise<void> => {
    const center = cellCenter(layout, col, row)
    const disc = new DiscNode(PLAYER_COLORS[player], discRadius)
    disc.transform.x = center.x
    disc.transform.y = animate ? topEntryY(layout) : center.y
    discLayer.add(disc)
    discByCell.set(row * COLS + col, disc)
    return animate ? disc.drop(center.y, ROWS - row) : Promise.resolve()
  }

  async function run(): Promise<void> {
    while (!abort.signal.aborted && !root.isDestroyed) {
      const board = createBoard()
      const discByCell = new Map<number, DiscNode>()
      let won = false

      for (let i = 0; i < sequence.length; i++) {
        if (abort.signal.aborted || root.isDestroyed) return
        const col = sequence[i]
        const row = dropRow(board, col)
        if (row === null) continue
        const player = board.turn
        makeMove(board, col)

        const animate = i >= PREFILL
        await addDisc(discByCell, player, col, row, animate)
        if (!animate) continue
        if (abort.signal.aborted || root.isDestroyed) return
        await host.engine.wait(0.22, abort.signal).catch(ignoreAbort)
        if (abort.signal.aborted || root.isDestroyed) return

        if (board.winner !== 0) {
          const cells = winningCells(board, col, row)
          if (cells) {
            await playWinHighlight({
              cells,
              discByCell,
              layout,
              glowColor: WIN_GLOW[player],
              discRadius,
              winLayer,
              shouldAbort: () => abort.signal.aborted || root.isDestroyed,
            })
          }
          won = true
          break
        }
      }

      // Linger on the completed board before resetting.
      await host.engine.wait(won ? 3.0 : 0.8, abort.signal).catch(ignoreAbort)
      if (abort.signal.aborted || root.isDestroyed) return
      discLayer.destroyChildren()
      winLayer.destroyChildren()
    }
  }
  void run()

  return {
    destroy() {
      abort.abort()
      if (!root.isDestroyed) root.destroy()
    },
  }
}
