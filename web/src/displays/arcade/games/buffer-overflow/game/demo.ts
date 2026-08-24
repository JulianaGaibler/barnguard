/**
 * The in-engine scenes behind the how-to-play cards.
 *
 * Each drives the real rules through the real nodes, so a card cannot drift
 * away from how the game actually behaves, and each shows the gesture that
 * causes what it is demonstrating rather than leaving the motion unexplained.
 *
 * The cards run a genuinely SMALLER buffer, not the game's one drawn small.
 * `createBuffer` takes its dimensions for exactly this: a card that built the
 * full ten-by-twenty buffer would draw twenty rows of stack into a window that
 * only covers a dozen, putting its own floor below the bottom of the card and
 * dropping pieces out of sight. Six columns also read at card size, where ten
 * do not.
 *
 * A piece spawns in the band above the visible rows, which nothing draws, so
 * every card brings its piece down into view before anything is on screen.
 *
 * Every wait and animation goes through {@link runDemoLoop}, which is what keeps
 * a card that stops from stopping silently.
 */
import { Node2D, type Gfx2D, type ShapeNode, type Stage } from '@src/stargazer'
import { DEMO_DEBUG, demoLog, demoLogFirst } from '../../../tutorial/demoDebug'
import type { DemoBuilder, DemoHandle } from '../../../tutorial/types'
import { runDemoLoop, type DemoLoopContext } from '../../common/demoLoop'
import {
  createFingerDot,
  showFlick,
  showSwipe,
  showTap,
  type DotPoint,
} from '../../common/fingerDot'
import {
  createBuffer,
  HIDDEN_ROWS,
  lockPiece,
  VISIBLE_TOP,
  visibleRows,
  type Buffer,
} from './board'
import { EXTENSION_SECONDS, START_SECONDS } from './countdown'
import { BufferNode } from './nodes/BufferNode'
import { ClockNode } from './nodes/PanelNodes'
import { PieceLayerNode } from './nodes/PieceLayerNode'
import {
  hardDropTarget,
  spawnPiece,
  tryRotate,
  tryShift,
  type ActivePiece,
} from './rules'
import { COLORS } from './tuning'
import type { Bounds, PieceKind } from './types'

/** The card's buffer. Small enough to read at card size and still be a buffer. */
export const DEMO_COLS = 6
export const DEMO_ROWS = 10

/** Share of the card the buffer takes on each axis. */
const FILL_FRAC = 0.82

/** The lowest row a card's buffer has. */
export const DEMO_FLOOR = HIDDEN_ROWS + DEMO_ROWS - 1

const BEAT = 0.45
const FALL_STEP = 0.12
const HOLD = 1.2
const RESET = 0.7

interface Scene {
  root: Node2D
  buffer: Buffer
  bufferNode: BufferNode
  pieces: PieceLayerNode
  rect: Bounds
  cell: number
  dot: ShapeNode
  /** The card's whole drawable area, for anything placed beside the buffer. */
  view: Bounds
}

/**
 * A marker over the demo's own rect, mounted only under `?debug=demo`.
 *
 * The one thing the other traces cannot tell you: whether this scene reaches
 * the renderer at all. If the outline appears and the buffer does not, the
 * geometry is right and something about the buffer is wrong. If neither
 * appears, nothing in this stage is drawing and the fault is upstream of the
 * card entirely.
 */
class DemoProbeNode extends Node2D {
  readonly #rect: Bounds
  constructor(rect: Bounds) {
    super('bo-demo-probe')
    this.renderLayer = 'dynamic'
    this.#rect = rect
    this.debugBounds = null
  }
  override draw(gfx: Gfx2D): void {
    const r = this.#rect
    demoLogFirst('probe drawn', 2, { rect: r })
    gfx.strokeRoundRect(r.x, r.y, r.width, r.height, 0, {
      color: '#FF00FF',
      width: 3,
    })
    // A cross at the rect's centre, so an off-by-a-viewport is obvious.
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    const s = 24
    gfx.strokeLine(cx - s, cy, cx + s, cy, { color: '#FF00FF', width: 3 })
    gfx.strokeLine(cx, cy - s, cx, cy + s, { color: '#FF00FF', width: 3 })
  }
}

/** A card's buffer, sized so its floor is the bottom of what is drawn. */
export function createDemoBuffer(): Buffer {
  return createBuffer(DEMO_COLS, HIDDEN_ROWS + DEMO_ROWS)
}

function buildScene(stage: Stage, name: string, rightGutter = 0): Scene {
  // The demo stage always has a 2D camera, but the type allows none, and a
  // fallback viewport is a better failure than a thrown builder.
  const view = stage.currentCamera2D?.viewport ?? {
    x: 0,
    y: 0,
    width: 1000,
    height: 750,
  }
  const usableW = view.width * (1 - rightGutter)
  const cell = Math.min(
    (usableW * FILL_FRAC) / DEMO_COLS,
    (view.height * FILL_FRAC) / DEMO_ROWS,
  )
  const rect: Bounds = {
    x: view.x + (usableW - cell * DEMO_COLS) / 2,
    y: view.y + (view.height - cell * DEMO_ROWS) / 2,
    width: cell * DEMO_COLS,
    height: cell * DEMO_ROWS,
  }

  const root = new Node2D(name)
  const buffer = createDemoBuffer()
  const bufferNode = new BufferNode()
  bufferNode.setBuffer(buffer)
  const framePad = cell * 0.3
  bufferNode.setRect(
    rect,
    {
      x: rect.x - framePad,
      y: rect.y - framePad,
      width: rect.width + framePad * 2,
      height: rect.height + framePad * 2,
    },
    cell,
  )
  const pieces = new PieceLayerNode()
  pieces.setRect(rect, cell)
  const dot = createFingerDot(cell * 0.4, COLORS.ink)
  root.add(bufferNode, pieces, dot)
  if (DEMO_DEBUG) root.add(new DemoProbeNode(rect))
  stage.tree.root.add(root)
  demoLog(`build ${name}`, {
    viewport: view,
    rect,
    cell,
    active: stage.active,
    px: { ...stage.renderer.pixelSize },
    hasEngine: root.engine !== null,
    visibleWorld: stage.currentCamera2D?.visibleWorldRect(),
  })
  return { root, buffer, bufferNode, pieces, rect, cell, dot, view }
}

/** Fill a row, leaving `gaps` open. */
function fillRow(
  b: Buffer,
  row: number,
  gaps: readonly number[],
  kind: PieceKind,
): void {
  for (let x = 0; x < b.cols; x++) {
    if (!gaps.includes(x)) b.cells[row * b.cols + x] = kind
  }
}

/** Centre of a cell, in the demo's world units. */
function cellCenter(scene: Scene, col: number, row: number): DotPoint {
  return {
    x: scene.rect.x + (col + 0.5) * scene.cell,
    y: scene.rect.y + (row - VISIBLE_TOP + 0.5) * scene.cell,
  }
}

/** Show the piece and its landing outline. */
function show(scene: Scene, piece: ActivePiece | null): void {
  scene.pieces.setPiece(
    piece,
    piece ? hardDropTarget(scene.buffer, piece) : null,
  )
}

/**
 * A piece brought down out of the spawn band into view.
 *
 * Nothing above {@link VISIBLE_TOP} is drawn, so a card that skipped this would
 * sit blank until its first drop.
 */
export function enterPiece(buffer: Buffer, kind: PieceKind): ActivePiece {
  let piece = spawnPiece(kind, buffer.cols)
  while (piece.y < VISIBLE_TOP) {
    const next = tryShift(buffer, piece, 0, 1)
    if (!next) break
    piece = next
  }
  return piece
}

/** Let a piece drift down `rows`, so the card shows it falling. */
async function fall(
  ctx: DemoLoopContext,
  scene: Scene,
  piece: ActivePiece,
  rows: number,
): Promise<ActivePiece> {
  let current = piece
  for (let i = 0; i < rows; i++) {
    const next = tryShift(scene.buffer, current, 0, 1)
    if (!next) break
    current = next
    show(scene, current)
    await ctx.wait(FALL_STEP)
    if (!ctx.alive()) return current
  }
  return current
}

/** Slide a piece one column at a time, so the travel reads. */
async function slide(
  ctx: DemoLoopContext,
  scene: Scene,
  piece: ActivePiece,
  columns: number,
): Promise<ActivePiece> {
  const dir = Math.sign(columns)
  let current = piece
  for (let i = 0; i < Math.abs(columns); i++) {
    const next = tryShift(scene.buffer, current, dir, 0)
    if (!next) break
    current = next
    show(scene, current)
    await ctx.wait(0.1)
    if (!ctx.alive()) return current
  }
  return current
}

/** Drop a piece, show the impact, and write it in. */
async function drop(
  ctx: DemoLoopContext,
  scene: Scene,
  piece: ActivePiece,
): Promise<ActivePiece> {
  const landed = hardDropTarget(scene.buffer, piece)
  show(scene, landed)
  scene.pieces.impact()
  await ctx.wait(0.3)
  lockPiece(scene.buffer, landed.kind, landed.rot, landed.x, landed.y)
  show(scene, null)
  return landed
}

/**
 * Card one: steer a piece across, turn it, and drop it.
 *
 * The drag, the tap-to-turn and the flick, in the order a player reaches for
 * them, each with the finger that causes it.
 */
export const buildMoveDemo: DemoBuilder = (stage): DemoHandle => {
  const scene = buildScene(stage, 'bo-demo-move')

  runDemoLoop(scene.root, 'move', async (ctx) => {
    scene.buffer.cells.fill(null)
    // A step in the floor, so sliding has a visible reason to happen.
    fillRow(scene.buffer, DEMO_FLOOR, [0, 1], 'J')

    let piece = enterPiece(scene.buffer, 'T')
    show(scene, piece)
    await ctx.wait(BEAT)
    if (!ctx.alive()) return

    piece = await fall(ctx, scene, piece, 2)
    if (!ctx.alive()) return

    await ctx.play(
      showSwipe(
        scene.dot,
        cellCenter(scene, 3, piece.y + 1),
        cellCenter(scene, 0, piece.y + 1),
      ),
    )
    piece = await slide(ctx, scene, piece, -2)
    if (!ctx.alive()) return

    await ctx.wait(BEAT * 0.5)
    await ctx.play(showTap(scene.dot, cellCenter(scene, 3, DEMO_FLOOR - 4)))
    const turned = tryRotate(scene.buffer, piece, 1)
    if (turned) piece = turned.piece
    show(scene, piece)
    await ctx.wait(BEAT)
    if (!ctx.alive()) return

    await ctx.play(
      showFlick(
        scene.dot,
        cellCenter(scene, piece.x, piece.y + 1),
        cellCenter(scene, piece.x, DEMO_FLOOR),
      ),
    )
    await drop(ctx, scene, piece)
    await ctx.wait(HOLD)
  })

  return { destroy: () => scene.root.destroy() }
}

/** The rows a flush card fills, and the column it leaves open for the bar. */
const FLUSH_ROWS = [DEMO_FLOOR, DEMO_FLOOR - 1, DEMO_FLOOR - 2, DEMO_FLOOR - 3]
const FLUSH_GAP = DEMO_COLS - 1

/** A four-row stack with one open column. Shared by two cards. */
function stackForFlush(b: Buffer): void {
  b.cells.fill(null)
  FLUSH_ROWS.forEach((row, i) =>
    fillRow(b, row, [FLUSH_GAP], i % 2 ? 'S' : 'Z'),
  )
}

/** The upright bar, walked over the open column. */
function barOverGap(b: Buffer): ActivePiece {
  const entered = enterPiece(b, 'I')
  const turned = tryRotate(b, entered, 1)
  let placed = turned ? turned.piece : entered
  // Walked rather than computed from the box offset, so this stays right if the
  // rotation ever kicks the piece sideways on the way up.
  for (let i = 0; i < b.cols; i++) {
    const cols = placed.x
    if (cols >= FLUSH_GAP) break
    const next = tryShift(b, placed, 1, 0)
    if (!next) break
    placed = next
  }
  return placed
}

/**
 * Card two: four rows filled at once, which is the flush.
 *
 * An upright bar into a one-wide gap is the shape the whole scoring table is
 * built around, so the card shows exactly that, gesture and all.
 */
export const buildFlushDemo: DemoBuilder = (stage): DemoHandle => {
  const scene = buildScene(stage, 'bo-demo-flush')

  runDemoLoop(scene.root, 'flush', async (ctx) => {
    stackForFlush(scene.buffer)
    scene.bufferNode.clearFlash()

    let piece = enterPiece(scene.buffer, 'I')
    const turned = tryRotate(scene.buffer, piece, 1)
    if (turned) piece = turned.piece
    show(scene, piece)
    await ctx.wait(BEAT)
    if (!ctx.alive()) return

    const target = barOverGap(scene.buffer)
    await ctx.play(
      showSwipe(
        scene.dot,
        cellCenter(scene, 1, piece.y + 2),
        cellCenter(scene, FLUSH_GAP, piece.y + 2),
      ),
    )
    piece = await slide(ctx, scene, piece, target.x - piece.x)
    if (!ctx.alive()) return

    await ctx.wait(BEAT * 0.5)
    await ctx.play(
      showFlick(
        scene.dot,
        cellCenter(scene, FLUSH_GAP, piece.y + 1),
        cellCenter(scene, FLUSH_GAP, DEMO_FLOOR),
      ),
    )
    await drop(ctx, scene, piece)

    scene.bufferNode.flashRows(FLUSH_ROWS)
    scene.bufferNode.shake(4)
    await ctx.wait(HOLD)
    if (!ctx.alive()) return

    scene.bufferNode.clearFlash()
    await ctx.wait(RESET)
  })

  return { destroy: () => scene.root.destroy() }
}

/**
 * Card three: the stack reaching the top, which is the failure state.
 *
 * Grows rather than simply being there, because the card has to teach that the
 * danger arrives gradually and is the player's to manage.
 */
export const buildOverflowDemo: DemoBuilder = (stage): DemoHandle => {
  const scene = buildScene(stage, 'bo-demo-overflow')

  runDemoLoop(scene.root, 'overflow', async (ctx) => {
    scene.buffer.cells.fill(null)
    scene.bufferNode.setDimmed(false)
    show(scene, null)
    await ctx.wait(RESET)
    if (!ctx.alive()) return

    for (let row = 0; row < visibleRows(scene.buffer); row++) {
      // A ragged stack, which is what an unmanaged buffer actually looks like:
      // never quite level, and never quite clearing.
      const gap = (row * 2 + 1) % DEMO_COLS
      fillRow(scene.buffer, DEMO_FLOOR - row, [gap], 'L')
      await ctx.wait(0.18)
      if (!ctx.alive()) return
    }
    scene.bufferNode.setDimmed(true)
    scene.bufferNode.shake(3)
    await ctx.wait(HOLD * 1.4)
  })

  return { destroy: () => scene.root.destroy() }
}

/**
 * Card four: what the two modes are.
 *
 * Uptime is the buffer filling with no clock at all, and Countdown is the same
 * buffer with one. Rather than describe the difference, the card runs the real
 * {@link ClockNode}: it drains, a clear puts time back, and the readout says how
 * much. That is the whole of what Countdown adds.
 */
export const buildModesDemo: DemoBuilder = (stage): DemoHandle => {
  // A gutter on the right, so the clock sits beside the buffer, not over it.
  const scene = buildScene(stage, 'bo-demo-modes', 0.3)
  const clock = new ClockNode()
  clock.setRect(
    {
      x: scene.rect.x + scene.rect.width + scene.cell * 1.2,
      y: scene.rect.y + scene.rect.height * 0.3,
      width: scene.view.width * 0.24,
      height: scene.cell * 2.6,
    },
    scene.cell,
  )
  scene.root.add(clock)

  runDemoLoop(scene.root, 'modes', async (ctx) => {
    stackForFlush(scene.buffer)
    scene.bufferNode.clearFlash()
    let remaining = START_SECONDS * 0.4
    clock.setRemaining(remaining)
    show(scene, null)
    await ctx.wait(RESET)
    if (!ctx.alive()) return

    // The clock draining on its own, which is the pressure Countdown adds.
    for (let i = 0; i < 12; i++) {
      remaining -= 0.6
      clock.setRemaining(remaining)
      await ctx.wait(0.1)
      if (!ctx.alive()) return
    }

    const piece = barOverGap(scene.buffer)
    show(scene, piece)
    await ctx.wait(BEAT)
    if (!ctx.alive()) return
    await drop(ctx, scene, piece)

    scene.bufferNode.flashRows(FLUSH_ROWS)
    scene.bufferNode.shake(4)
    // A flush is worth the most the table gives, and the readout says so.
    const granted = EXTENSION_SECONDS[4]
    remaining = Math.min(START_SECONDS, remaining + granted)
    clock.setRemaining(remaining)
    clock.granted(granted)
    await ctx.wait(HOLD * 1.4)
    if (!ctx.alive()) return

    scene.bufferNode.clearFlash()
    await ctx.wait(RESET)
  })

  return { destroy: () => scene.root.destroy() }
}
