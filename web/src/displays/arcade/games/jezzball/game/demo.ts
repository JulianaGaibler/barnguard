/**
 * Scripted tutorial demos, built on the shared demo stage (fixed 1000×750
 * viewport). Each reuses the real field/wall nodes and the real placement
 * math (`planWallPlacement`, `markWallSpan`, `circleHitsRect`,
 * `captureEmptyRegions`) but drives a lightweight, physics-free loop so the
 * mechanic in question reads clearly on its own:
 *
 * - {@link buildWallDemo}: two finger dots pop in and place a two-way wall.
 * - {@link buildCaptureDemo}: a wall seals off a region, which floods in.
 * - {@link buildDestroyDemo}: three balls repeatedly break a growing wall.
 */
import {
  Behavior,
  ShapeNode,
  Node2D,
  easings,
  type Stage,
} from '@src/stargazer'
import type { DemoBuilder } from '@src/displays/arcade/tutorial/types'
import { createGrid, captureEmptyRegions, markWallSpan, type Grid } from './grid'
import { cellCenter, computeFieldGeom, type FieldGeom } from './layout'
import { circleHitsRect } from './colliders'
import { planWallPlacement, type WallSegment } from './board'
import { GridFieldNode } from './nodes/GridFieldNode'
import { WallSegmentNode } from './nodes/WallNode'
import { BurstNode } from './nodes/BurstNode'
import { CELL_OPEN, type Bounds, type CellRef, type Orientation } from './types'
import { ACCENT_SOLO, COLORS, PHYSICS, ballRadiusWorld } from './tuning'

const COLS = 10
const ROWS = 10
const BOARD = { x: 220, y: 95, width: 560, height: 560 }
/** Demo-only wall growth speed — slower than `PHYSICS.wallGrowSpeed` so the
 * mechanic is easy to follow on a small looping card. */
const GROW_SPEED = 520
const HOLD_SEC = 1.3
const GAP_SEC = 0.5

/** A grid + its rendered field, shared setup for all three demos. */
interface DemoField {
  root: Node2D
  grid: Grid
  geom: FieldGeom
  field: GridFieldNode
  wallLayer: Node2D
}

function buildDemoField(stage: Stage, name: string): DemoField {
  const root = new Node2D(name)
  const grid = createGrid(COLS, ROWS)
  const geom = computeFieldGeom(BOARD, COLS, ROWS)
  const field = new GridFieldNode(geom, grid)
  const wallLayer = new Node2D(`${name}-walls`)
  root.add(field)
  root.add(wallLayer)
  stage.tree.root.add(root)
  return { root, grid, geom, field, wallLayer }
}

/** Build the (up to) two growing segments for a wall placed at `seed`. */
function spawnSegments(
  wallLayer: Node2D,
  geom: FieldGeom,
  orientation: Orientation,
  seed: CellRef,
  grid: Grid,
): WallSegment[] {
  const plan = planWallPlacement(grid, geom, orientation, seed)
  if (!plan) return []
  const { fixedIndex, anchorX, anchorY, halfThick, spans } = plan
  const segments: WallSegment[] = []

  const [a0, a1] = spans.a
  const nodeA = new WallSegmentNode(
    anchorX,
    anchorY,
    halfThick,
    orientation,
    -1,
    ACCENT_SOLO.primary,
  )
  wallLayer.add(nodeA)
  segments.push({
    node: nodeA,
    orientation,
    fixedIndex,
    startCell: a0,
    endCell: a1,
    dir: -1,
    target: (a1 - a0 + 1) * geom.cell,
    len: 0,
  })

  if (spans.b) {
    const [b0, b1] = spans.b
    const nodeB = new WallSegmentNode(
      anchorX,
      anchorY,
      halfThick,
      orientation,
      1,
      ACCENT_SOLO.variant,
    )
    wallLayer.add(nodeB)
    segments.push({
      node: nodeB,
      orientation,
      fixedIndex,
      startCell: b0,
      endCell: b1,
      dir: 1,
      target: (b1 - b0 + 1) * geom.cell,
      len: 0,
    })
  }
  return segments
}

/** Write every segment's span into the grid as a permanent wall. */
function solidifySegments(grid: Grid, segments: readonly WallSegment[]): void {
  for (const seg of segments) {
    markWallSpan(grid, seg.orientation, seg.fixedIndex, seg.startCell, seg.endCell)
  }
}

/** A physics-free demo ball: a plain circle node plus a constant velocity. */
interface DemoBall {
  node: ShapeNode
  radius: number
  vx: number
  vy: number
}

interface BallSpawn {
  xFrac: number
  yFrac: number
  angleDeg: number
}

/** Spawn demo balls at fractional positions within the field, at `speed`. */
function spawnDemoBalls(
  d: DemoField,
  spawns: readonly BallSpawn[],
  speed: number,
): DemoBall[] {
  const radius = ballRadiusWorld(d.geom.cell)
  return spawns.map(({ xFrac, yFrac, angleDeg }) => {
    const node = new ShapeNode({
      geometry: { kind: 'circle', radius },
      fill: COLORS.ink,
    })
    node.renderLayer = 'dynamic'
    node.transform.x = d.geom.x + d.geom.width * xFrac
    node.transform.y = d.geom.y + d.geom.height * yFrac
    d.wallLayer.add(node)
    const angle = (angleDeg * Math.PI) / 180
    return {
      node,
      radius,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    }
  })
}

/** Bounce a ball around inside an axis-aligned box, reflecting at each edge. */
function bounceBallInBox(ball: DemoBall, box: Bounds, dt: number): void {
  const t = ball.node.transform
  const r = ball.radius
  let x = t.x + ball.vx * dt
  let y = t.y + ball.vy * dt
  if (x < box.x + r) {
    x = box.x + r
    ball.vx = Math.abs(ball.vx)
  } else if (x > box.x + box.width - r) {
    x = box.x + box.width - r
    ball.vx = -Math.abs(ball.vx)
  }
  if (y < box.y + r) {
    y = box.y + r
    ball.vy = Math.abs(ball.vy)
  } else if (y > box.y + box.height - r) {
    y = box.y + box.height - r
    ball.vy = -Math.abs(ball.vy)
  }
  t.x = x
  t.y = y
}

/** The grid cell each ball currently sits in, for `captureEmptyRegions`. */
function ballCellsOf(geom: FieldGeom, balls: readonly DemoBall[]): CellRef[] {
  return balls.map((b) => ({
    col: Math.floor((b.node.transform.x - geom.x) / geom.cell),
    row: Math.floor((b.node.transform.y - geom.y) / geom.cell),
  }))
}

// --- 1. Build walls: two finger dots pop in, then place a wall. ---

/** A 50%-black dot standing in for a fingertip, popped in via `tween`/`play`. */
function makeFingerDot(x: number, y: number, radius: number): ShapeNode {
  const dot = new ShapeNode({
    geometry: { kind: 'circle', radius },
    fill: COLORS.ink,
  })
  dot.renderLayer = 'dynamic'
  dot.transform.x = x
  dot.transform.y = y
  dot.transform.alpha = 0
  dot.transform.scaleX = 0
  dot.transform.scaleY = 0
  return dot
}

const DOT_ALPHA = 0.5
const DOT_SCALE = 0.8
const DOT_POP_SEC = 0.5
const DOT_FADE_SEC = 0.2
/** Half the on-screen gap between the two finger dots. */
const DOT_SPREAD = 70

type WallPhase = 'dots' | 'grow' | 'hold' | 'gap'

class WallGrowLoop extends Behavior {
  readonly #d: DemoField
  readonly #seed: CellRef
  #orientation: Orientation = 'vertical'
  #phase: WallPhase = 'gap'
  #timer = 0
  #segments: WallSegment[] = []
  #dotA: ShapeNode | null = null
  #dotB: ShapeNode | null = null

  constructor(d: DemoField, seed: CellRef) {
    super()
    this.#d = d
    this.#seed = seed
  }

  override onUpdate(dt: number): void {
    switch (this.#phase) {
      case 'gap':
        this.#timer += dt
        if (this.#timer >= GAP_SEC) this.#beginDots()
        break
      case 'dots':
        this.#timer += dt
        if (this.#timer >= DOT_POP_SEC) this.#beginGrow()
        break
      case 'grow':
        this.#advanceGrow(dt)
        break
      case 'hold':
        this.#timer += dt
        if (this.#timer >= HOLD_SEC) this.#reset()
        break
    }
  }

  #beginDots(): void {
    this.#orientation = this.#orientation === 'vertical' ? 'horizontal' : 'vertical'
    const c = cellCenter(this.#d.geom, this.#seed.col, this.#seed.row)
    const dotRadius = this.#d.geom.cell * 0.75
    const dx = this.#orientation === 'horizontal' ? DOT_SPREAD : 0
    const dy = this.#orientation === 'vertical' ? DOT_SPREAD : 0

    const dotA = makeFingerDot(c.x - dx, c.y - dy, dotRadius)
    const dotB = makeFingerDot(c.x + dx, c.y + dy, dotRadius)
    this.#d.wallLayer.add(dotA)
    this.#d.wallLayer.add(dotB)
    this.#dotA = dotA
    this.#dotB = dotB
    for (const dot of [dotA, dotB]) {
      dot.play(
        { alpha: DOT_ALPHA, scaleX: DOT_SCALE, scaleY: DOT_SCALE },
        { duration: DOT_POP_SEC, easing: easings.outBack },
      )
    }
    this.#phase = 'dots'
    this.#timer = 0
  }

  #beginGrow(): void {
    this.#dotA?.play({ alpha: 0 }, { duration: DOT_FADE_SEC })
    this.#dotB?.play({ alpha: 0 }, { duration: DOT_FADE_SEC })
    this.#segments = spawnSegments(
      this.#d.wallLayer,
      this.#d.geom,
      this.#orientation,
      this.#seed,
      this.#d.grid,
    )
    this.#phase = 'grow'
  }

  #advanceGrow(dt: number): void {
    const step = GROW_SPEED * dt
    let allDone = true
    for (const seg of this.#segments) {
      seg.len = Math.min(seg.target, seg.len + step)
      seg.node.setLength(seg.len)
      if (seg.len < seg.target) allDone = false
    }
    if (allDone) {
      this.#phase = 'hold'
      this.#timer = 0
    }
  }

  #reset(): void {
    if (!this.#dotA?.isDestroyed) this.#dotA?.destroy()
    if (!this.#dotB?.isDestroyed) this.#dotB?.destroy()
    this.#dotA = null
    this.#dotB = null
    for (const seg of this.#segments) {
      if (!seg.node.isDestroyed) seg.node.destroy()
    }
    this.#segments = []
    this.#d.grid.cells.fill(CELL_OPEN)
    this.#d.field.snapRevealed()
    this.#phase = 'gap'
    this.#timer = 0
  }
}

export const buildWallDemo: DemoBuilder = (stage) => {
  const d = buildDemoField(stage, 'jezzball-demo-build')
  const seed: CellRef = { col: 4, row: 4 }
  d.root.addBehavior(new WallGrowLoop(d, seed))
  return {
    destroy() {
      if (!d.root.isDestroyed) d.root.destroy()
    },
  }
}

// --- 2. Claim space: a wall seals off a region, which floods in. ---
//
// A single slow ball patrols the left (open) side, confined there for the
// whole loop, so only the ball-free right side ever gets captured — making
// the "no ball inside" half of the rule visible, not just the flood-in.

type CapturePhase = 'grow' | 'hold' | 'gap'

class CaptureLoop extends Behavior {
  readonly #d: DemoField
  readonly #seed: CellRef
  readonly #orientation: Orientation
  readonly #ball: DemoBall
  readonly #ballBox: Bounds
  #phase: CapturePhase = 'gap'
  #timer = 0
  #segments: WallSegment[] = []

  constructor(d: DemoField, seed: CellRef, orientation: Orientation, ball: DemoBall) {
    super()
    this.#d = d
    this.#seed = seed
    this.#orientation = orientation
    this.#ball = ball
    // The open region left of the seed column, with a small buffer so the
    // ball never visually grazes the wall it's meant to stay clear of.
    this.#ballBox = {
      x: d.geom.x,
      y: d.geom.y,
      width: seed.col * d.geom.cell - d.geom.cell * 0.2,
      height: d.geom.height,
    }
  }

  override onUpdate(dt: number): void {
    bounceBallInBox(this.#ball, this.#ballBox, dt)
    switch (this.#phase) {
      case 'gap':
        this.#timer += dt
        if (this.#timer >= GAP_SEC) this.#beginGrow()
        break
      case 'grow':
        this.#advanceGrow(dt)
        break
      case 'hold':
        this.#timer += dt
        if (this.#timer >= HOLD_SEC) this.#reset()
        break
    }
  }

  #beginGrow(): void {
    this.#segments = spawnSegments(
      this.#d.wallLayer,
      this.#d.geom,
      this.#orientation,
      this.#seed,
      this.#d.grid,
    )
    this.#phase = 'grow'
  }

  #advanceGrow(dt: number): void {
    const step = GROW_SPEED * dt
    let allDone = true
    for (const seg of this.#segments) {
      seg.len = Math.min(seg.target, seg.len + step)
      seg.node.setLength(seg.len)
      if (seg.len < seg.target) allDone = false
    }
    if (allDone) {
      solidifySegments(this.#d.grid, this.#segments)
      const filled = captureEmptyRegions(
        this.#d.grid,
        ballCellsOf(this.#d.geom, [this.#ball]),
      )
      this.#d.field.revealCells(filled)
      this.#phase = 'hold'
      this.#timer = 0
    }
  }

  #reset(): void {
    for (const seg of this.#segments) {
      if (!seg.node.isDestroyed) seg.node.destroy()
    }
    this.#segments = []
    this.#d.grid.cells.fill(CELL_OPEN)
    this.#d.field.snapRevealed()
    this.#phase = 'gap'
    this.#timer = 0
  }
}

export const buildCaptureDemo: DemoBuilder = (stage) => {
  const d = buildDemoField(stage, 'jezzball-demo-capture')
  const seed: CellRef = { col: 6, row: 4 }
  const [ball] = spawnDemoBalls(
    d,
    [{ xFrac: 0.24, yFrac: 0.5, angleDeg: 40 }],
    PHYSICS.ballSpeed * 0.2,
  )
  d.root.addBehavior(new CaptureLoop(d, seed, 'vertical', ball))
  return {
    destroy() {
      if (!d.root.isDestroyed) d.root.destroy()
    },
  }
}

// --- 3. Destructive balls: three balls repeatedly break a growing wall. ---

const DESTROY_BALL_STARTS: readonly BallSpawn[] = [
  { xFrac: 0.22, yFrac: 0.28, angleDeg: 35 },
  { xFrac: 0.72, yFrac: 0.68, angleDeg: 205 },
  { xFrac: 0.65, yFrac: 0.25, angleDeg: 320 },
]

/**
 * This demo's own (much slower) wall growth speed. A wall this size takes
 * ~1.5s to fully grow at this pace — long enough that three balls bouncing
 * the full board width almost always cross the growing column before it
 * solidifies, so the break reads as a near-sure thing rather than a fluke.
 */
const DESTROY_GROW_SPEED = 190

/**
 * Minimum distance (world units) a ball must clear from the seed column
 * before the next attempt spawns — otherwise a ball loitering right on the
 * seed would break each new wall within its first frame or two, reading as
 * constant sparks rather than a clean grow → break → pause → regrow cycle.
 */
const RESPAWN_CLEARANCE = 90

type DestroyPhase = 'grow' | 'gap'

class DestroyLoop extends Behavior {
  readonly #d: DemoField
  readonly #seed: CellRef
  readonly #seedX: number
  readonly #balls: DemoBall[]
  #phase: DestroyPhase = 'grow'
  #timer = 0
  #segments: WallSegment[] = []
  /** Segments that finished growing unbroken, held for teardown at the next
   * attempt — this demo is about the break, so an uninterrupted wall doesn't
   * get to linger once a fresh attempt starts. */
  #solidNodes: WallSegmentNode[] = []

  constructor(d: DemoField, seed: CellRef, balls: DemoBall[]) {
    super()
    this.#d = d
    this.#seed = seed
    this.#seedX = cellCenter(d.geom, seed.col, seed.row).x
    this.#balls = balls
    this.#segments = spawnSegments(d.wallLayer, d.geom, 'vertical', seed, d.grid)
  }

  override onUpdate(dt: number): void {
    for (const ball of this.#balls) bounceBallInBox(ball, this.#d.geom, dt)
    if (this.#phase === 'grow') this.#advanceGrow(dt)
    else {
      this.#timer += dt
      if (this.#timer >= GAP_SEC && this.#seedIsClear()) this.#beginAttempt()
    }
  }

  #advanceGrow(dt: number): void {
    const step = DESTROY_GROW_SPEED * dt
    const survivors: WallSegment[] = []
    for (const seg of this.#segments) {
      seg.len = Math.min(seg.target, seg.len + step)
      seg.node.setLength(seg.len)

      if (seg.len >= seg.target) {
        markWallSpan(this.#d.grid, seg.orientation, seg.fixedIndex, seg.startCell, seg.endCell)
        this.#solidNodes.push(seg.node)
        continue
      }

      const rect = seg.node.currentRect()
      const hit = this.#balls.find((b) =>
        circleHitsRect(b.node.transform.x, b.node.transform.y, b.radius, rect),
      )
      if (hit) {
        this.#d.wallLayer.add(
          new BurstNode(hit.node.transform.x, hit.node.transform.y, ACCENT_SOLO.primary),
        )
        if (!seg.node.isDestroyed) seg.node.destroy()
        continue
      }
      survivors.push(seg)
    }
    this.#segments = survivors
    if (this.#segments.length === 0) {
      // No balls occupy a sealed region reliably in this demo, but resolve it
      // the same way the real game does in case one solidified uninterrupted.
      const filled = captureEmptyRegions(
        this.#d.grid,
        ballCellsOf(this.#d.geom, this.#balls),
      )
      this.#d.field.revealCells(filled)
      this.#phase = 'gap'
      this.#timer = 0
    }
  }

  #seedIsClear(): boolean {
    return this.#balls.every(
      (b) => Math.abs(b.node.transform.x - this.#seedX) >= RESPAWN_CLEARANCE,
    )
  }

  #beginAttempt(): void {
    for (const node of this.#solidNodes) {
      if (!node.isDestroyed) node.destroy()
    }
    this.#solidNodes = []
    this.#d.grid.cells.fill(CELL_OPEN)
    this.#d.field.snapRevealed()
    this.#segments = spawnSegments(
      this.#d.wallLayer,
      this.#d.geom,
      'vertical',
      this.#seed,
      this.#d.grid,
    )
    this.#phase = 'grow'
  }
}

export const buildDestroyDemo: DemoBuilder = (stage) => {
  const d = buildDemoField(stage, 'jezzball-demo-destroy')
  const seed: CellRef = { col: 4, row: 4 }
  const balls = spawnDemoBalls(d, DESTROY_BALL_STARTS, PHYSICS.ballSpeed * 0.55)
  d.root.addBehavior(new DestroyLoop(d, seed, balls))
  return {
    destroy() {
      if (!d.root.isDestroyed) d.root.destroy()
    },
  }
}
