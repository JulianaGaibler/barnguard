/**
 * Scripted tutorial demos, built on the shared demo stage (fixed 1000×750
 * viewport). Each reuses the real field/wall nodes and the real placement math
 * (`planWallPlacement`, `markWallSpan`, `circleHitsRect`,
 * `captureEmptyRegions`) but drives a lightweight, physics-free loop so the
 * mechanic in question reads clearly on its own:
 *
 * - {@link buildWallDemo}: two finger dots pop in and place a two-way wall.
 * - {@link buildCaptureDemo}: a wall seals off a region, which floods in.
 * - {@link buildDestroyDemo}: three balls repeatedly break a growing wall.
 *
 * {@link buildScoreDemo} has no field at all: a scorecard for one cleared stage,
 * tallied through the real scoring functions.
 */
import {
  Behavior,
  ShapeNode,
  Node2D,
  TextNode,
  easings,
  type Stage,
} from '@src/stargazer'
import type { DemoBuilder } from '@src/displays/arcade/tutorial/types'
import {
  createGrid,
  captureEmptyRegions,
  markWallSpan,
  type Grid,
} from './grid'
import { cellCenter, computeFieldGeom, type FieldGeom } from './layout'
import { circleHitsRect } from './colliders'
import { planWallPlacement, type WallSegment } from './board'
import { GridFieldNode } from './nodes/GridFieldNode'
import { WallSegmentNode } from './nodes/WallNode'
import { BurstNode } from './nodes/BurstNode'
import {
  eliminationPoints,
  fillBonus,
  makeBreakdown,
  timeBonus,
} from './scoring'
import {
  CELL_OPEN,
  type Bounds,
  type CellRef,
  type Orientation,
  type ScoreBreakdown,
} from './types'
import { ACCENT_SOLO, COLORS, GRID, PHYSICS, ballRadiusWorld } from './tuning'
import { JEZZBALL_STRINGS } from '../strings'
import { JEZZBALL_FONTS } from '../fonts'

const COLS = 10
const ROWS = 10
const BOARD = { x: 220, y: 95, width: 560, height: 560 }
/**
 * Demo-only wall growth speed, slower than `PHYSICS.wallGrowSpeed` so the
 * mechanic is easy to follow on a small looping card.
 */
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
    markWallSpan(
      grid,
      seg.orientation,
      seg.fixedIndex,
      seg.startCell,
      seg.endCell,
    )
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
    this.#orientation =
      this.#orientation === 'vertical' ? 'horizontal' : 'vertical'
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
// whole loop, so only the ball-free right side ever gets captured, making
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

  constructor(
    d: DemoField,
    seed: CellRef,
    orientation: Orientation,
    ball: DemoBall,
  ) {
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
 * This demo's own (much slower) wall growth speed. A wall this size takes ~1.5s
 * to fully grow at this pace, long enough that three balls bouncing the full
 * board width almost always cross the growing column before it solidifies, so
 * the break reads as a near-sure thing rather than a fluke.
 */
const DESTROY_GROW_SPEED = 190

/**
 * Minimum distance (world units) a ball must clear from the seed column before
 * the next attempt spawns. Otherwise a ball loitering right on the seed would
 * break each new wall within its first frame or two, reading as constant sparks
 * rather than a clean grow, break, pause, regrow cycle.
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
  /**
   * Segments that finished growing unbroken, held for teardown at the next
   * attempt. This demo is about the break, so an uninterrupted wall doesn't get
   * to linger once a fresh attempt starts.
   */
  #solidNodes: WallSegmentNode[] = []

  constructor(d: DemoField, seed: CellRef, balls: DemoBall[]) {
    super()
    this.#d = d
    this.#seed = seed
    this.#seedX = cellCenter(d.geom, seed.col, seed.row).x
    this.#balls = balls
    this.#segments = spawnSegments(
      d.wallLayer,
      d.geom,
      'vertical',
      seed,
      d.grid,
    )
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
        markWallSpan(
          this.#d.grid,
          seg.orientation,
          seg.fixedIndex,
          seg.startCell,
          seg.endCell,
        )
        this.#solidNodes.push(seg.node)
        continue
      }

      const rect = seg.node.currentRect()
      const hit = this.#balls.find((b) =>
        circleHitsRect(b.node.transform.x, b.node.transform.y, b.radius, rect),
      )
      if (hit) {
        this.#d.wallLayer.add(
          new BurstNode(
            hit.node.transform.x,
            hit.node.transform.y,
            ACCENT_SOLO.primary,
          ),
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

// --- 4. Scoring: a cleared stage tallies itself up, line by line. ---

/**
 * The cleared stage the tally scores. Every figure on the card comes out of the
 * game's own scoring functions, so the card cannot drift from `SCORING`.
 */
const TALLY_SAMPLE = { capturedPct: 82, elapsedSec: 38, lives: 5 } as const

// Tally geometry, in the demo viewport's world units.
const TALLY_LEFT = 200
const TALLY_RIGHT = 800
const TALLY_TOP = 180
const TALLY_ROW_H = 88
const TALLY_RULE_GAP = 52
const TALLY_TOTAL_GAP = 78
const TALLY_RULE_H = 3
const TALLY_LABEL_PX = 36
const TALLY_VALUE_PX = 46
const TALLY_TOTAL_LABEL_PX = 44
const TALLY_TOTAL_VALUE_PX = 66
/** How far right of its resting position a row starts. */
const TALLY_SLIDE = 44

// Tally timeline (seconds).
const TALLY_LEAD = 0.35
const TALLY_STAGGER = 0.55
const TALLY_REVEAL = 0.45
/** Pause between the last component row and the total landing. */
const TALLY_TOTAL_DELAY = 0.35

/** Score the sample stage. Its cell count is `capturedPct` of the full grid. */
function tallyBreakdown(): ScoreBreakdown {
  const cells = Math.round(
    GRID.cols * GRID.rows * (TALLY_SAMPLE.capturedPct / 100),
  )
  return makeBreakdown(
    eliminationPoints(cells),
    fillBonus(TALLY_SAMPLE.capturedPct),
    timeBonus(TALLY_SAMPLE.elapsedSec),
    TALLY_SAMPLE.lives,
  )
}

/**
 * One line of the tally: a label and a right-aligned figure in one group, so a
 * single transform slides both. Alpha does not cascade through the 2D render
 * walk, so the reveal sets it on each text node separately.
 */
interface TallyRow {
  group: Node2D
  label: TextNode
  value: TextNode
  /** Figure the row counts up to. */
  points: number
  /** `'+'` on the component rows, empty on the total. */
  prefix: string
  /** Seconds into the timeline at which this row starts revealing. */
  start: number
}

interface TallyRowSpec {
  text: string
  points: number
  prefix: string
  y: number
  labelPx: number
  valuePx: number
  valueColor: string
  start: number
}

function buildTallyRow(parent: Node2D, spec: TallyRowSpec): TallyRow {
  const group = new Node2D('jb-tally-row')
  group.transform.x = TALLY_SLIDE
  const label = new TextNode({
    text: spec.text,
    x: TALLY_LEFT,
    y: spec.y,
    fontFamily: JEZZBALL_FONTS.text,
    fontWeight: 700,
    fontSize: spec.labelPx,
    sizeSpace: 'world',
    color: COLORS.ink,
    align: 'left',
    baseline: 'middle',
  })
  const value = new TextNode({
    text: '',
    x: TALLY_RIGHT,
    y: spec.y,
    fontFamily: JEZZBALL_FONTS.text,
    fontWeight: 900,
    fontSize: spec.valuePx,
    sizeSpace: 'world',
    color: spec.valueColor,
    align: 'right',
    baseline: 'middle',
  })
  label.transform.alpha = 0
  value.transform.alpha = 0
  group.add(label)
  group.add(value)
  parent.add(group)
  return {
    group,
    label,
    value,
    points: spec.points,
    prefix: spec.prefix,
    start: spec.start,
  }
}

/**
 * Slides each row in and counts its figure up, then holds the finished tally
 * for as long as the card is open. The reveal plays once.
 */
class TallyReveal extends Behavior {
  readonly #rows: readonly TallyRow[]
  readonly #rule: ShapeNode
  /** The rule reveals on the total row's schedule. */
  readonly #ruleStart: number
  /** Time by which every row has finished revealing. */
  readonly #settleAt: number
  #t = 0
  #settled = false

  constructor(rows: readonly TallyRow[], rule: ShapeNode) {
    super()
    this.#rows = rows
    this.#rule = rule
    this.#ruleStart = rows[rows.length - 1].start
    this.#settleAt = this.#ruleStart + TALLY_REVEAL
  }

  override onUpdate(dt: number): void {
    if (this.#settled) return
    this.#t += dt
    for (const row of this.#rows) {
      const p = easings.outCubic(this.#progressAt(row.start))
      row.group.transform.x = TALLY_SLIDE * (1 - p)
      row.label.transform.alpha = p
      row.value.transform.alpha = p
      row.value.text = `${row.prefix}${Math.round(row.points * p)}`
    }
    this.#rule.transform.alpha = this.#progressAt(this.#ruleStart)
    this.#settled = this.#t >= this.#settleAt
  }

  /** Reveal progress in `[0, 1]` for a row starting at `start`. */
  #progressAt(start: number): number {
    return Math.max(0, Math.min(1, (this.#t - start) / TALLY_REVEAL))
  }
}

export const buildScoreDemo: DemoBuilder = (stage) => {
  const S = JEZZBALL_STRINGS.tutorial.scoreRows
  const b = tallyBreakdown()
  const components: readonly (readonly [string, number])[] = [
    [S.cells, b.elimination],
    [S.fill, b.fillBonus],
    [S.time, b.timeBonus],
    [S.lives, b.livesBonus],
  ]

  const root = new Node2D('jezzball-demo-score')
  const rows = components.map(([text, points], i) =>
    buildTallyRow(root, {
      text,
      points,
      prefix: '+',
      y: TALLY_TOP + i * TALLY_ROW_H,
      labelPx: TALLY_LABEL_PX,
      valuePx: TALLY_VALUE_PX,
      valueColor: COLORS.ink,
      start: TALLY_LEAD + i * TALLY_STAGGER,
    }),
  )

  const ruleY =
    TALLY_TOP + (components.length - 1) * TALLY_ROW_H + TALLY_RULE_GAP
  const rule = new ShapeNode({
    geometry: {
      kind: 'rect',
      width: TALLY_RIGHT - TALLY_LEFT,
      height: TALLY_RULE_H,
      centered: false,
    },
    fill: COLORS.captured,
  })
  rule.transform.x = TALLY_LEFT
  rule.transform.y = ruleY
  rule.transform.alpha = 0
  root.add(rule)

  rows.push(
    buildTallyRow(root, {
      text: S.total,
      points: b.total,
      prefix: '',
      y: ruleY + TALLY_TOTAL_GAP,
      labelPx: TALLY_TOTAL_LABEL_PX,
      valuePx: TALLY_TOTAL_VALUE_PX,
      valueColor: ACCENT_SOLO.primary,
      start: TALLY_LEAD + components.length * TALLY_STAGGER + TALLY_TOTAL_DELAY,
    }),
  )

  stage.tree.root.add(root)
  root.addBehavior(new TallyReveal(rows, rule))
  return {
    destroy() {
      if (!root.isDestroyed) root.destroy()
    },
  }
}
