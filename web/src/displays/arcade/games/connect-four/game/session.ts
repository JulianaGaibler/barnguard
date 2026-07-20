/**
 * Connect Four session. Mirrors Orbo's control surface (a `GameSession` with a
 * typed event emitter) so the arcade shell and the splash/pause overlays work
 * the same, but there is no physics: discs drop with a tween, and the rules
 * live in the pure `board.ts`.
 *
 * Async steps (reveal, drop, AI turn, win/draw, fold back) are guarded by a
 * `moveGen` counter: `startMatch` / `reset` bump it, and a step that resumes
 * after an await bails if the generation changed underneath it.
 */
import {
  SceneNode,
  createEmitter,
  easings,
  ignoreAbort,
  type Emitter,
  type EngineHost,
} from '@src/stargazer'
import {
  COLS,
  ROWS,
  createBoard,
  dropRow,
  isFull,
  makeMove,
  winningCells,
  type Board,
} from './board'
import {
  cellCenter,
  columnAtX,
  computeLayout,
  topEntryY,
  type Bounds,
} from './layout'
import { chooseColumn } from './ai'
import { BoardNode } from './nodes/BoardNode'
import { DiscNode } from './nodes/DiscNode'
import { PreviewNode } from './nodes/PreviewNode'
import { WinBurstNode } from './nodes/WinBurstNode'
import { ANIM, BOARD, PLAYER_COLORS } from './tuning'
import type { GameMode, MatchScore, Player } from './types'

export interface RoundResult {
  /** Winning player, or null on a draw. */
  winner: Player | null
  matchScore: MatchScore
}

export interface GameEvents {
  matchStarted: { mode: GameMode }
  /** A new side is on the move (drives any turn HUD). */
  turnChanged: { player: Player }
  /** The game ended (win or draw); the cumulative score is already updated. */
  roundOver: RoundResult
  /** Returned to the idle main screen. */
  reset: void
  scoresReset: void
  paused: void
  resumed: void
}

export type SessionState = 'idle' | 'playing' | 'gameOver'

export interface GameSession {
  readonly events: Emitter<GameEvents>
  readonly state: SessionState
  readonly mode: GameMode | null
  readonly matchScore: MatchScore
  /** Side to move while playing, else null. */
  currentPlayer(): Player | null
  startMatch(mode: GameMode): void
  pause(): void
  resume(): void
  reset(): void
  resetScores(): void
  destroy(): void
}

export async function startGame(
  host: EngineHost,
  bounds: Bounds,
): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const layout = computeLayout(bounds)
  const discRadius = layout.cell * BOARD.discRadiusFrac

  const board: Board = createBoard()

  // Scene: discs behind the board (holes frame them), then the board, the drop
  // preview, and the win burst on top. The board fades between a dimmed backdrop
  // in the menus and full opacity while playing. Alpha is per drawing node (the
  // render walk doesn't cascade group alpha), so the board node carries it.
  const MENU_ALPHA = 0.25
  const root = new SceneNode('cf-root')
  const discLayer = new SceneNode('cf-discs')
  const boardNode = new BoardNode(layout)
  boardNode.transform.alpha = MENU_ALPHA // dimmed backdrop behind the splash
  const preview = new PreviewNode(discRadius)
  const winLayer = new SceneNode('cf-wins')
  root.add(discLayer)
  root.add(boardNode)
  root.add(preview)
  root.add(winLayer)
  host.engine.scene.root.add(root)

  const discByCell = new Map<number, DiscNode>()

  let state: SessionState = 'idle'
  let mode: GameMode | null = null
  const matchScore: MatchScore = { teamL: 0, teamR: 0 }
  let moveGen = 0
  let paused = false
  let inputLocked = false

  const isHumanTurn = (): boolean => mode?.kind === '2p' || board.turn === 1

  function clearBoard(): void {
    discLayer.destroyChildren()
    winLayer.destroyChildren()
    discByCell.clear()
    board.cells.fill(0)
    board.heights.fill(0)
    board.turn = 1
    board.ply = 0
    board.winner = 0
    preview.visible = false
  }

  // --- Reveal / fold (alpha fade of the whole board group) ----------------

  function revealOpen(): Promise<void> {
    boardNode.transform.alpha = MENU_ALPHA
    return boardNode
      .tween(
        { alpha: 1 },
        { duration: ANIM.revealOpen, easing: easings.outCubic },
      )
      .catch(ignoreAbort)
  }

  async function returnToMenu(): Promise<void> {
    const gen = ++moveGen
    if (paused) resume()
    preview.visible = false
    // Fade the board back to the dimmed menu backdrop; fade any discs out with
    // it (alpha is per node, so each is tweened directly).
    const discs = [...discByCell.values()].filter((d) => !d.isDestroyed)
    await Promise.all([
      boardNode
        .tween(
          { alpha: MENU_ALPHA },
          { duration: ANIM.foldClose, easing: easings.inCubic },
        )
        .catch(ignoreAbort),
      ...discs.map((d) =>
        d
          .tween(
            { alpha: 0 },
            { duration: ANIM.foldClose, easing: easings.inCubic },
          )
          .catch(ignoreAbort),
      ),
    ])
    if (gen !== moveGen) return
    clearBoard()
    state = 'idle'
    mode = null
    events.emit('reset', undefined)
  }

  // --- Turn flow ----------------------------------------------------------

  async function commitDrop(col: number): Promise<void> {
    // External taps are gated by `inputLocked` at pointerDown; the AI calls this
    // directly while locked, so don't re-check the lock here.
    const row = dropRow(board, col)
    if (row === null) return
    const gen = moveGen
    inputLocked = true
    preview.visible = false

    const player = board.turn
    const target = cellCenter(layout, col, row)
    const disc = new DiscNode(PLAYER_COLORS[player], discRadius)
    disc.transform.x = target.x
    disc.transform.y = topEntryY(layout)
    discLayer.add(disc)
    discByCell.set(row * COLS + col, disc)

    // Commit to the model now (win/draw is decided), animate the disc into it.
    makeMove(board, col)

    const rowsFallen = ROWS - row
    const duration = ANIM.dropBase + rowsFallen * ANIM.dropPerRow
    await disc
      .tween({ y: target.y }, { duration, easing: easings.outBack })
      .catch(ignoreAbort)
    if (gen !== moveGen) return

    if (board.winner !== 0) {
      await winSequence(gen, player, col, row)
      return
    }
    if (isFull(board)) {
      events.emit('roundOver', { winner: null, matchScore: { ...matchScore } })
      await host.engine.wait(ANIM.winHold * 0.5).catch(ignoreAbort)
      if (gen !== moveGen) return
      await returnToMenu()
      return
    }

    events.emit('turnChanged', { player: board.turn })
    if (mode?.kind === 'ai' && board.turn === 2) {
      void aiMove(gen)
    } else {
      inputLocked = false
    }
  }

  async function aiMove(gen: number): Promise<void> {
    await host.engine.wait(ANIM.aiThinkDelay).catch(ignoreAbort)
    if (gen !== moveGen || mode?.kind !== 'ai') return
    const col = chooseColumn(board, mode.difficulty)
    if (col < 0) return
    await commitDrop(col)
  }

  async function winSequence(
    gen: number,
    player: Player,
    col: number,
    row: number,
  ): Promise<void> {
    if (player === 1) matchScore.teamL += 1
    else matchScore.teamR += 1
    events.emit('roundOver', { winner: player, matchScore: { ...matchScore } })

    const cells = winningCells(board, col, row) ?? []
    const color = PLAYER_COLORS[player]
    // Pulse the winning discs, then burst them.
    await Promise.all(
      cells.map((c) => {
        const disc = discByCell.get(c.row * COLS + c.col)
        if (!disc) return Promise.resolve()
        return disc
          .tween(
            { scaleX: 1.25, scaleY: 1.25 },
            { duration: ANIM.winPulse, easing: easings.outBack },
          )
          .catch(ignoreAbort)
      }),
    )
    if (gen !== moveGen) return
    for (const c of cells) {
      winLayer.add(
        new WinBurstNode(cellCenter(layout, c.col, c.row), color, discRadius),
      )
    }
    await host.engine.wait(ANIM.winHold).catch(ignoreAbort)
    if (gen !== moveGen) return
    await returnToMenu()
  }

  // --- Pause + input ------------------------------------------------------

  function pause(): void {
    if (state !== 'playing' || paused) return
    paused = true
    host.engine.setPaused(true)
    events.emit('paused', undefined)
  }
  function resume(): void {
    if (!paused) return
    paused = false
    host.engine.setPaused(false)
    events.emit('resumed', undefined)
  }

  // A tap inside the board drops in that column; a tap in the empty space
  // outside the board opens the pause menu (discoverable, no gesture to learn).
  let ptrId: number | null = null

  const insideBoard = (x: number, y: number): boolean =>
    x >= layout.panelX &&
    x <= layout.panelX + layout.panelW &&
    y >= layout.panelY &&
    y <= layout.panelY + layout.panelH

  const offDown = host.engine.events.on('pointerDown', (e) => {
    if (state !== 'playing' || paused || inputLocked || !isHumanTurn()) return
    const { x, y } = e.pointer.world
    if (!insideBoard(x, y)) {
      pause() // tap outside the board → pause menu
      return
    }
    const col = columnAtX(layout, x)
    if (col === null) return
    ptrId = e.pointer.id
    preview.setColor(PLAYER_COLORS[board.turn])
    preview.transform.x = cellCenter(layout, col, ROWS - 1).x
    preview.transform.y = topEntryY(layout)
    preview.visible = true
  })

  const offMove = host.engine.events.on('pointerMove', (e) => {
    if (ptrId !== e.pointer.id || paused || inputLocked) return
    const col = columnAtX(layout, e.pointer.world.x)
    if (col === null) {
      preview.visible = false
    } else {
      preview.visible = true
      preview.transform.x = cellCenter(layout, col, ROWS - 1).x
    }
  })

  const offUp = host.engine.events.on('pointerUp', (e) => {
    if (ptrId !== e.pointer.id) return
    ptrId = null
    const col = columnAtX(layout, e.pointer.world.x)
    if (col !== null && dropRow(board, col) !== null && isHumanTurn()) {
      void commitDrop(col)
    } else {
      preview.visible = false
    }
  })

  const offCancel = host.engine.events.on('pointerCancel', (e) => {
    if (ptrId !== e.pointer.id) return
    ptrId = null
    preview.visible = false
  })

  // --- Public methods -----------------------------------------------------

  function startMatch(next: GameMode): void {
    moveGen++
    if (paused) resume()
    clearBoard()
    boardNode.transform.alpha = MENU_ALPHA // dimmed until the fade-in
    mode = next
    state = 'playing'
    inputLocked = true // locked until the reveal finishes
    events.emit('matchStarted', { mode: next })
    const gen = moveGen
    void (async () => {
      await revealOpen()
      if (gen !== moveGen) return
      inputLocked = false
      events.emit('turnChanged', { player: board.turn })
    })()
  }

  function reset(): void {
    void returnToMenu()
  }

  function resetScores(): void {
    matchScore.teamL = 0
    matchScore.teamR = 0
    events.emit('scoresReset', undefined)
  }

  function destroy(): void {
    moveGen++
    offDown()
    offMove()
    offUp()
    offCancel()
    if (paused) {
      paused = false
      host.engine.setPaused(false)
    }
    if (!root.isDestroyed) root.destroy()
    state = 'idle'
  }

  return {
    events,
    get state() {
      return state
    },
    get mode() {
      return mode
    },
    get matchScore() {
      return { ...matchScore }
    },
    currentPlayer() {
      return state === 'playing' ? board.turn : null
    },
    startMatch,
    pause,
    resume,
    reset,
    resetScores,
    destroy,
  }
}
