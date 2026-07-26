/**
 * Connect Four session. Mirrors Orbo's control surface (a `GameSession` with a
 * typed event emitter) so the arcade shell and the splash/pause overlays work
 * the same, but there is no physics: discs drop with a tween, and the rules
 * live in the pure `board.ts`.
 *
 * Async steps (reveal, drop, AI turn, win/draw, fold back) share one
 * {@link AbortScope}: `startMatch` / `reset` / `destroy` call `scope.reset()`
 * (or `dispose()`), which aborts whatever is in flight so the awaiting sequence
 * unwinds on its own — no generation-counter guards.
 */
import {
  Node2D,
  TextNode,
  ParticleEmitterNode,
  bindRegionGesture,
  createEmitter,
  easings,
  ignoreAbort,
  type Emitter,
  type EngineHost,
  type Rect,
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
import { GradientBackgroundNode } from '../../common/GradientBackgroundNode'
import { BoardNode } from './nodes/BoardNode'
import { DiscNode } from './nodes/DiscNode'
import { PreviewNode } from './nodes/PreviewNode'
import { DropIndicatorNode } from './nodes/DropIndicatorNode'
import { FrameNode } from './nodes/FrameNode'
import { PlayerTabNode } from './nodes/PlayerTabNode'
import {
  ANIM,
  BACKGROUND,
  BOARD,
  FRAME,
  PILL,
  PLAYER_COLORS,
  TAB,
  TRAIL,
  WIN_GLOW,
} from './tuning'
import { CF_STRINGS } from '../strings'
import { playWinHighlight } from './anim'
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
  /** Refit the gradient background to a new visible rect (call on resize). */
  resize(view: Rect): void
  destroy(): void
}

/** Column the drop pill rests over between drags (center). */
const DEFAULT_PILL_COL = Math.floor(COLS / 2)

export async function startGame(
  host: EngineHost,
  bounds: Bounds,
  view: Rect,
): Promise<GameSession> {
  const events = createEmitter<GameEvents>()
  const layout = computeLayout(bounds)
  const cell = layout.cell
  const discRadius = cell * BOARD.discRadiusFrac

  const board: Board = createBoard()

  // Scene, back to front: the game's own gray gradient, then the board (a light
  // panel of slot wells with a faint X behind each), then the discs ON TOP (so a
  // chip covers its slot's X), the drop preview + column pill, the registration
  // frame + technical labels, the two player tabs, and the win burst layer.
  // The board fades between hidden on the menu (the stylized preview stands in
  // for it) and full opacity while playing; alpha is per drawing node (the
  // render walk doesn't cascade group alpha), so the front-of-board chrome is
  // toggled by `visible` on the play/menu transition instead.
  const MENU_ALPHA = 0
  const root = new Node2D('cf-root')
  const background = new GradientBackgroundNode({
    rect: view,
    topLeft: BACKGROUND.topLeft,
    bottomRight: BACKGROUND.bottomRight,
  })
  const discLayer = new Node2D('cf-discs')
  const boardNode = new BoardNode(layout)
  boardNode.transform.alpha = MENU_ALPHA // hidden behind the menu
  const preview = new PreviewNode(discRadius)
  const dropPill = new DropIndicatorNode(
    cell * PILL.widthFrac,
    cell * PILL.heightFrac,
  )
  dropPill.transform.y = layout.panelY - cell * PILL.yOffsetFrac
  const frame = new FrameNode(layout)
  const { leftTab, rightTab } = buildTabs()
  const labelTL = buildLabel(
    FRAME.topLeftLabel,
    layout.panelX - cell * 0.32,
    layout.panelY + cell * 1.1,
  )
  const labelBR = buildLabel(
    FRAME.bottomRightLabel,
    layout.panelX + layout.panelW + cell * 0.32,
    layout.panelY + layout.panelH - cell * 1.1,
  )
  const winLayer = new Node2D('cf-wins')

  root.add(background)
  root.add(boardNode)
  root.add(discLayer)
  root.add(preview)
  root.add(dropPill)
  root.add(frame)
  root.add(labelTL)
  root.add(labelBR)
  root.add(leftTab)
  root.add(rightTab)
  root.add(winLayer)
  host.engine.tree.root.add(root)

  setChromeVisible(false)

  const discByCell = new Map<number, DiscNode>()

  let state: SessionState = 'idle'
  let mode: GameMode | null = null
  const matchScore: MatchScore = { teamL: 0, teamR: 0 }
  // One cancellation scope for the match/menu async sequences. `reset()` opens a
  // new epoch and aborts the previous one; sequences pass its signal into their
  // tweens/waits so a supersede unwinds them.
  const scope = root.scope()
  let paused = false
  let inputLocked = false

  const isHumanTurn = (): boolean => mode?.kind === '2p' || board.turn === 1

  function buildTabs(): { leftTab: PlayerTabNode; rightTab: PlayerTabNode } {
    const w = cell * TAB.widthFrac
    const h = cell * TAB.heightFrac
    const gap = cell * TAB.gapFrac
    const margin = cell * 0.3
    const y = layout.panelY + layout.panelH / 2 - h / 2
    const leftX = Math.max(view.x + margin, layout.panelX - gap - w)
    const rightX = Math.min(
      view.x + view.width - margin - w,
      layout.panelX + layout.panelW + gap,
    )
    const left = new PlayerTabNode({
      width: w,
      height: h,
      roundedCorner: 'tr',
      color: PLAYER_COLORS[1],
      label: CF_STRINGS.tab.p1,
      yourTurn: CF_STRINGS.tab.yourTurn,
      won: CF_STRINGS.tab.won,
    })
    left.transform.x = leftX
    left.transform.y = y
    const right = new PlayerTabNode({
      width: w,
      height: h,
      roundedCorner: 'tr',
      color: PLAYER_COLORS[2],
      label: CF_STRINGS.tab.p2,
      yourTurn: CF_STRINGS.tab.yourTurn,
      won: CF_STRINGS.tab.won,
    })
    right.transform.x = rightX
    right.transform.y = y
    return { leftTab: left, rightTab: right }
  }

  function buildLabel(text: string, x: number, y: number): TextNode {
    const label = new TextNode({
      text,
      fontFamily: FRAME.labelFont,
      fontSize: FRAME.labelSizePx,
      sizeSpace: 'screen',
      color: FRAME.labelColor,
      align: 'center',
      baseline: 'middle',
    })
    label.transform.x = x
    label.transform.y = y
    label.transform.rotation = -Math.PI / 2
    return label
  }

  function setChromeVisible(visible: boolean): void {
    dropPill.visible = visible
    frame.visible = visible
    labelTL.visible = visible
    labelBR.visible = visible
    leftTab.visible = visible
    rightTab.visible = visible
  }

  function updateTabsForTurn(player: Player): void {
    leftTab.setState(player === 1 ? 'active' : 'inactive')
    rightTab.setState(player === 2 ? 'active' : 'inactive')
  }

  function updateTabsForWin(winner: Player | null): void {
    if (winner === null) {
      leftTab.setState('inactive')
      rightTab.setState('inactive')
      return
    }
    leftTab.setState(winner === 1 ? 'won' : 'lost')
    rightTab.setState(winner === 2 ? 'won' : 'lost')
  }

  function setPillColumn(col: number): void {
    dropPill.transform.x = cellCenter(layout, col, ROWS - 1).x
  }

  function focusTurn(player: Player): void {
    updateTabsForTurn(player)
    dropPill.setColor(PLAYER_COLORS[player])
    setPillColumn(DEFAULT_PILL_COL)
  }

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

  function revealOpen(signal: AbortSignal): Promise<void> {
    boardNode.transform.alpha = MENU_ALPHA
    return boardNode.tween(
      { alpha: 1 },
      { duration: ANIM.revealOpen, easing: easings.outCubic, signal },
    )
  }

  async function returnToMenu(): Promise<void> {
    // Fresh epoch: aborts any in-flight drop/win branch, and its signal drives
    // this fold-back so a later supersede (a new match, a quit) aborts it too.
    const signal = scope.reset()
    if (paused) resume()
    preview.visible = false
    setChromeVisible(false)
    // Fade the board back to the dimmed menu backdrop; fade any discs out with
    // it (alpha is per node, so each is tweened directly).
    const discs = [...discByCell.values()].filter((disc) => !disc.isDestroyed)
    await Promise.all([
      boardNode.tween(
        { alpha: MENU_ALPHA },
        { duration: ANIM.foldClose, easing: easings.inCubic, signal },
      ),
      ...discs.map((disc) =>
        disc.tween(
          { alpha: 0 },
          { duration: ANIM.foldClose, easing: easings.inCubic, signal },
        ),
      ),
    ])
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
    const signal = scope.signal
    inputLocked = true
    preview.visible = false

    const player = board.turn
    const target = cellCenter(layout, col, row)
    const disc = new DiscNode(PLAYER_COLORS[player], discRadius)
    disc.transform.x = target.x
    disc.transform.y = topEntryY(layout)

    // A short square trail lagging behind the falling chip. Lives in the disc
    // layer (world space, an earlier sibling so it draws behind the chip); the
    // drop drives its origin each frame. Children of the disc would follow it
    // and leave no trail, so it's a sibling.
    const trail = new ParticleEmitterNode({
      config: {
        capacity: TRAIL.capacity,
        ratePerSec: TRAIL.ratePerSec,
        lifetimeSec: TRAIL.lifetimeSec,
        speedWorld: TRAIL.speedWorld,
        spreadRad: TRAIL.spreadRad,
        emitDirectionRad: -Math.PI / 2, // up, opposite the fall
        sizeWorld: [cell * TRAIL.sizeFrac[0], cell * TRAIL.sizeFrac[1]],
        palette: [PLAYER_COLORS[player]],
        spriteStyle: 'square',
        blend: 'source-over',
        dampingPerSec: TRAIL.dampingPerSec,
        scaleOverLife: [1, 0],
        alphaOverLife: [1, 0],
      },
    })
    trail.emitter.setOrigin(disc.transform.x, disc.transform.y)
    discLayer.add(trail)
    discLayer.add(disc)
    discByCell.set(row * COLS + col, disc)

    // Commit to the model now (win/draw is decided), animate the disc into it.
    makeMove(board, col)

    await disc.drop(
      target.y,
      ROWS - row,
      () => trail.emitter.setOrigin(disc.transform.x, disc.transform.y),
      signal,
    )
    // Stop emitting and let the tail finish before removing the emitter.
    trail.emitter.config.ratePerSec = 0
    void host.engine
      .wait(TRAIL.lifetimeSec[1], signal)
      .then(() => trail.destroy())
      .catch(ignoreAbort)

    if (board.winner !== 0) {
      await winSequence(signal, player, col, row)
      return
    }
    if (isFull(board)) {
      dropPill.visible = false
      updateTabsForWin(null)
      events.emit('roundOver', { winner: null, matchScore: { ...matchScore } })
      await host.engine.wait(ANIM.winHold * 0.5, signal)
      await returnToMenu()
      return
    }

    focusTurn(board.turn)
    events.emit('turnChanged', { player: board.turn })
    if (mode?.kind === 'ai' && board.turn === 2) {
      void aiMove(signal).catch(ignoreAbort)
    } else {
      inputLocked = false
    }
  }

  async function aiMove(signal: AbortSignal): Promise<void> {
    await host.engine.wait(ANIM.aiThinkDelay, signal)
    if (mode?.kind !== 'ai') return
    const col = chooseColumn(board, mode.difficulty)
    if (col < 0) return
    await commitDrop(col)
  }

  async function winSequence(
    signal: AbortSignal,
    player: Player,
    col: number,
    row: number,
  ): Promise<void> {
    if (player === 1) matchScore.teamL += 1
    else matchScore.teamR += 1
    dropPill.visible = false
    updateTabsForWin(player)
    events.emit('roundOver', { winner: player, matchScore: { ...matchScore } })

    const cells = winningCells(board, col, row) ?? []
    await playWinHighlight({
      cells,
      discByCell,
      layout,
      glowColor: WIN_GLOW[player],
      discRadius,
      winLayer,
      shouldAbort: () => signal.aborted,
    })
    if (signal.aborted) return
    await host.engine.wait(ANIM.winHold, signal)
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
  const insideBoard = (x: number, y: number): boolean =>
    x >= layout.panelX &&
    x <= layout.panelX + layout.panelW &&
    y >= layout.panelY &&
    y <= layout.panelY + layout.panelH

  // Only accept input on a human's turn while playing and unlocked.
  const canPlay = (): boolean =>
    state === 'playing' && !paused && !inputLocked && isHumanTurn()

  const offGesture = bindRegionGesture(host.engine, {
    enabled: canPlay,
    hitTest: (w) => insideBoard(w.x, w.y),
    down: (e) => {
      const col = columnAtX(layout, e.pointer.world.x)
      if (col === null) return
      preview.setColor(PLAYER_COLORS[board.turn])
      preview.transform.x = cellCenter(layout, col, ROWS - 1).x
      preview.transform.y = topEntryY(layout)
      preview.visible = true
      setPillColumn(col)
    },
    move: (e) => {
      if (paused || inputLocked) return
      const col = columnAtX(layout, e.pointer.world.x)
      if (col === null) {
        preview.visible = false
      } else {
        preview.visible = true
        preview.transform.x = cellCenter(layout, col, ROWS - 1).x
        setPillColumn(col)
      }
    },
    up: (e) => {
      const col = columnAtX(layout, e.pointer.world.x)
      if (col !== null && dropRow(board, col) !== null && isHumanTurn()) {
        void commitDrop(col).catch(ignoreAbort)
      } else {
        preview.visible = false
      }
    },
    cancel: () => {
      preview.visible = false
    },
    // A press that passes the play gate but lands outside the board opens the
    // menu. `canPlay()` here is false when the gate itself rejected the press
    // (so we don't pause), and true only for the genuine tap-outside case.
    onReject: () => {
      if (canPlay()) pause()
    },
  })

  // --- Public methods -----------------------------------------------------

  function startMatch(next: GameMode): void {
    const signal = scope.reset()
    if (paused) resume()
    clearBoard()
    boardNode.transform.alpha = MENU_ALPHA // dimmed until the fade-in
    mode = next
    state = 'playing'
    inputLocked = true // locked until the reveal finishes
    setChromeVisible(true)
    focusTurn(board.turn)
    events.emit('matchStarted', { mode: next })
    void (async () => {
      await revealOpen(signal)
      inputLocked = false
      focusTurn(board.turn)
      events.emit('turnChanged', { player: board.turn })
    })().catch(ignoreAbort)
  }

  function reset(): void {
    void returnToMenu().catch(ignoreAbort)
  }

  function resetScores(): void {
    matchScore.teamL = 0
    matchScore.teamR = 0
    events.emit('scoresReset', undefined)
  }

  function destroy(): void {
    scope.dispose()
    offGesture()
    if (paused) {
      paused = false
      host.engine.setPaused(false)
    }
    root.destroy()
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
    resize(view: Rect): void {
      background.setRect(view)
    },
    destroy,
  }
}
