/**
 * Drives one JezzBall board: an isolated physics world, the bouncing balls, the
 * grid field, and the wall lifecycle. A placed wall is TWO independent segments
 * growing in opposite directions from the seed cell; each grows, solidifies,
 * and is destroyed on its own — a ball touching one segment removes only that
 * segment (and costs a life) while the other keeps growing. A segment that
 * reaches a border or existing solid solidifies into grid walls and triggers a
 * flood-capture of any newly-enclosed, ball-free region.
 *
 * Operates directly in world coordinates — its space node sits at the origin,
 * so physics/scene/world coordinates all coincide with the board's
 * {@link FieldGeom}. The session layer sits on top and owns lives, scoring, and
 * level flow via the callbacks here.
 */
import {
  Behavior,
  Body,
  BodyType,
  PhysicsWorldBehavior,
  Node2D,
  aabbShape,
  circleShape,
  type EngineHost,
  type PhysicsWorld,
} from '@src/stargazer'
import {
  captureEmptyRegions,
  createGrid,
  markWallSpan,
  takenPct,
  inBounds,
  cellAt,
  wallSpans,
  type Grid,
  type WallSpans,
} from './grid'
import {
  cellAtWorld,
  cellCenter,
  computeFieldGeom,
  containsWorld,
  seedCell,
  type FieldGeom,
} from './layout'
import { buildColliderRects, circleHitsRect } from './colliders'
import { ANIM, PHYSICS, ballRadiusWorld } from './tuning'
import { CELL_OPEN, type Bounds, type CellRef, type Orientation } from './types'
import { GridFieldNode } from './nodes/GridFieldNode'
import { WallSegmentNode } from './nodes/WallNode'
import { BallNode } from './nodes/BallNode'
import { BurstNode } from './nodes/BurstNode'

/** Physics collision layers. Balls hit solids; balls ignore each other. */
export const LAYER_BALL = 1 << 0
export const LAYER_SOLID = 1 << 1

export interface BoardColors {
  primary: string
  variant: string
}

export interface BoardCallbacks {
  /** A region was captured: current percentage and cell count just filled. */
  onCapture?: (pct: number, newlyCaptured: number) => void
  /** A growing wall segment was hit by a ball (world hit location). */
  onWallDestroyed?: (worldX: number, worldY: number) => void
}

/** One growing half of a placed wall. */
export interface WallSegment {
  node: WallSegmentNode
  orientation: Orientation
  /** Column for a vertical wall, row for a horizontal wall. */
  fixedIndex: number
  /** Inclusive cell range this segment covers along its axis (whole cells). */
  startCell: number
  endCell: number
  dir: -1 | 1
  target: number
  len: number
}

/** Placement geometry for a two-way wall seeded at `seed`, or null when the seed cell isn't open. */
export interface WallPlan {
  /** Column for a vertical wall, row for a horizontal wall. */
  fixedIndex: number
  anchorX: number
  anchorY: number
  halfThick: number
  spans: WallSpans
}

/**
 * Pure placement geometry for a two-way wall seeded at `seed`: the axis index
 * it's fixed to, the anchor point (the seed cell's far edge, so a broken half
 * leaves the seed cell open for a clean follow-up abut) the two segments grow
 * from, half-thickness, and the cell spans each segment covers. Shared by
 * {@link BoardController.placeWall} and the tutorial demos so a demo's walls
 * match real placement exactly.
 */
export function planWallPlacement(
  grid: Grid,
  geom: FieldGeom,
  orientation: Orientation,
  seed: CellRef,
): WallPlan | null {
  if (cellAt(grid, seed.col, seed.row) !== CELL_OPEN) return null
  const g = geom
  const halfThick = g.cell * ANIM.wallThicknessFrac * 0.5
  const fixedIndex = orientation === 'vertical' ? seed.col : seed.row
  const seedIndex = orientation === 'vertical' ? seed.row : seed.col
  const axisOrigin = orientation === 'vertical' ? g.y : g.x
  const splitEdge = axisOrigin + (seedIndex + 1) * g.cell
  const crossCenter =
    orientation === 'vertical'
      ? g.x + (seed.col + 0.5) * g.cell
      : g.y + (seed.row + 0.5) * g.cell
  return {
    fixedIndex,
    anchorX: orientation === 'vertical' ? crossCenter : splitEdge,
    anchorY: orientation === 'vertical' ? splitEdge : crossCenter,
    halfThick,
    spans: wallSpans(grid, orientation, seed),
  }
}

export class BoardController {
  readonly geom: FieldGeom
  readonly root: Node2D

  readonly #grid: Grid
  readonly #world: PhysicsWorld
  readonly #colors: BoardColors
  readonly #callbacks: BoardCallbacks
  readonly #radius: number

  readonly #field: GridFieldNode
  readonly #wallLayer: Node2D
  readonly #ballLayer: Node2D
  /** Every wall node (growing + solidified), for teardown on level reset. */
  readonly #wallNodes = new Set<Node2D>()

  readonly #balls: Body[] = []
  readonly #ballNodes = new Map<number, BallNode>()
  #solidBodies: Body[] = []
  /** Currently-growing segments (solidified/destroyed ones are dropped). */
  #segments: WallSegment[] = []
  #frozen = false
  readonly #savedVel: Array<{ x: number; y: number }> = []

  constructor(
    host: EngineHost,
    board: Bounds,
    cols: number,
    rows: number,
    colors: BoardColors,
    callbacks: BoardCallbacks = {},
  ) {
    this.#colors = colors
    this.#callbacks = callbacks
    this.geom = computeFieldGeom(board, cols, rows)
    this.#radius = ballRadiusWorld(this.geom.cell)
    this.#grid = createGrid(cols, rows)

    this.root = new Node2D('jezzball-board')
    const physics = this.root.addBehavior(
      new PhysicsWorldBehavior({
        config: {
          gravity: { x: 0, y: 0 },
          maxLinearSpeed: PHYSICS.ballSpeed * PHYSICS.maxSpeedMultiple,
        },
      }),
    )
    this.#world = physics.world

    this.#field = new GridFieldNode(this.geom, this.#grid)
    this.#wallLayer = new Node2D('walls')
    this.#ballLayer = new Node2D('balls')
    this.root.add(this.#field)
    this.root.add(this.#wallLayer)
    this.root.add(this.#ballLayer)
    this.root.addBehavior(new BoardTickBehavior(this))

    this.#rebuildColliders()
    host.engine.tree.root.add(this.root)
  }

  // --- Level lifecycle ---

  /** Reset the grid, clear walls, and (re)spawn `ballCount` balls. */
  startLevel(ballCount: number): void {
    this.#clearWalls()
    this.#grid.cells.fill(CELL_OPEN)
    this.#field.snapRevealed()
    this.#clearBalls()
    for (let i = 0; i < ballCount; i++) this.#spawnBall()
    this.#rebuildColliders()
  }

  capturedPct(): number {
    return takenPct(this.#grid)
  }

  /** True while any segment is still growing (blocks a new placement). */
  get hasActiveWall(): boolean {
    return this.#segments.length > 0
  }

  get ballRadius(): number {
    return this.#radius
  }

  containsWorldPoint(x: number, y: number): boolean {
    return containsWorld(this.geom, x, y)
  }

  freeze(): void {
    if (this.#frozen) return
    this.#frozen = true
    this.#savedVel.length = 0
    for (const b of this.#balls) {
      this.#savedVel.push({ x: b.velocity.x, y: b.velocity.y })
      b.velocity.x = 0
      b.velocity.y = 0
    }
  }

  unfreeze(): void {
    if (!this.#frozen) return
    this.#frozen = false
    for (let i = 0; i < this.#balls.length; i++) {
      const v = this.#savedVel[i]
      if (v) this.#balls[i].setVelocity(v.x, v.y)
    }
    this.#savedVel.length = 0
  }

  destroy(): void {
    this.#clearWalls()
    if (!this.root.isDestroyed) this.root.destroy()
  }

  // --- Wall placement ---

  /**
   * Start a two-way wall of `orientation` from the grid cell under `(worldX,
   * worldY)`: two independent segments growing in opposite directions. Rejected
   * (returns false) when the point is outside the field, the seed cell is not
   * open, a wall is already growing here, or the board is frozen.
   */
  placeWall(orientation: Orientation, worldX: number, worldY: number): boolean {
    if (this.hasActiveWall || this.#frozen) return false
    if (!containsWorld(this.geom, worldX, worldY)) return false
    const seed = seedCell(this.geom, worldX, worldY)
    const plan = planWallPlacement(this.#grid, this.geom, orientation, seed)
    if (!plan) return false
    const { fixedIndex, anchorX, anchorY, halfThick, spans } = plan
    const cell = this.geom.cell

    const [a0, a1] = spans.a
    this.#addSegment(
      orientation,
      fixedIndex,
      a0,
      a1,
      -1,
      (a1 - a0 + 1) * cell,
      anchorX,
      anchorY,
      halfThick,
      this.#colors.primary,
    )
    if (spans.b) {
      const [b0, b1] = spans.b
      this.#addSegment(
        orientation,
        fixedIndex,
        b0,
        b1,
        1,
        (b1 - b0 + 1) * cell,
        anchorX,
        anchorY,
        halfThick,
        this.#colors.variant,
      )
    }
    return true
  }

  #addSegment(
    orientation: Orientation,
    fixedIndex: number,
    startCell: number,
    endCell: number,
    dir: -1 | 1,
    target: number,
    anchorX: number,
    anchorY: number,
    halfThick: number,
    color: string,
  ): void {
    const node = new WallSegmentNode(
      anchorX,
      anchorY,
      halfThick,
      orientation,
      dir,
      color,
    )
    this.#wallLayer.add(node)
    this.#wallNodes.add(node)
    this.#segments.push({
      node,
      orientation,
      fixedIndex,
      startCell,
      endCell,
      dir,
      target,
      len: 0,
    })
  }

  // --- Per-frame update ---

  update(dt: number): void {
    if (this.#frozen) return
    this.#renormalizeBalls()
    this.#unstickBalls()
    this.#advanceSegments(dt)
  }

  #advanceSegments(dt: number): void {
    if (this.#segments.length === 0) return
    const step = PHYSICS.wallGrowSpeed * dt
    const survivors: WallSegment[] = []
    for (const seg of this.#segments) {
      seg.len = Math.min(seg.target, seg.len + step)
      seg.node.setLength(seg.len)

      // Solidify-before-trigger: a segment reaching its target this frame
      // commits and is not eligible to be destroyed by a ball this frame.
      if (seg.len >= seg.target) {
        this.#solidifySegment(seg)
        continue
      }

      // Growing: a ball touching this segment destroys only this half.
      const rect = seg.node.currentRect()
      let hitBall: Body | null = null
      for (const b of this.#balls) {
        if (circleHitsRect(b.position.x, b.position.y, this.#radius, rect)) {
          hitBall = b
          break
        }
      }
      if (hitBall) {
        this.#destroySegment(seg, hitBall.position.x, hitBall.position.y)
        continue
      }
      survivors.push(seg)
    }
    this.#segments = survivors
  }

  #solidifySegment(seg: WallSegment): void {
    markWallSpan(
      this.#grid,
      seg.orientation,
      seg.fixedIndex,
      seg.startCell,
      seg.endCell,
    )
    const filled = captureEmptyRegions(this.#grid, this.#ballCells())
    this.#field.revealCells(filled)
    this.#rebuildColliders()
    this.#callbacks.onCapture?.(this.capturedPct(), filled.length)
    // The node stays in the wall layer as the solid two-tone half.
  }

  #destroySegment(seg: WallSegment, hitX: number, hitY: number): void {
    const burst = new BurstNode(hitX, hitY, this.#colors.primary)
    this.#wallLayer.add(burst)
    this.#callbacks.onWallDestroyed?.(hitX, hitY)
    this.#removeWallNode(seg.node)
  }

  #clearWalls(): void {
    this.#segments = []
    for (const node of this.#wallNodes) {
      if (!node.isDestroyed) node.destroy()
    }
    this.#wallNodes.clear()
  }

  #removeWallNode(node: Node2D): void {
    this.#wallNodes.delete(node)
    if (!node.isDestroyed) node.destroy()
  }

  // --- Balls ---

  #spawnBall(): void {
    const g = this.geom
    const minSep = this.#radius * 3
    let x = 0
    let y = 0
    let ok = false
    for (let attempt = 0; attempt < 40 && !ok; attempt++) {
      const col = 1 + Math.floor(Math.random() * (g.cols - 2))
      const row = 1 + Math.floor(Math.random() * (g.rows - 2))
      const c = cellCenter(g, col, row)
      x = c.x
      y = c.y
      ok = true
      for (const b of this.#balls) {
        const dx = b.position.x - x
        const dy = b.position.y - y
        if (dx * dx + dy * dy < minSep * minSep) {
          ok = false
          break
        }
      }
    }

    // Lively, non-axis-aligned direction.
    const base = (25 + Math.random() * 40) * (Math.PI / 180)
    const angle = base + (Math.PI / 2) * Math.floor(Math.random() * 4)
    const speed = PHYSICS.ballSpeed
    const body = this.#world.createBody({
      type: BodyType.Dynamic,
      position: { x, y },
      velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      restitution: PHYSICS.restitution,
      friction: 0,
      linearDamping: PHYSICS.linearDamping,
      fixedRotation: true,
      canSleep: false,
      layer: LAYER_BALL,
      mask: LAYER_SOLID,
      colliders: [{ shape: circleShape(this.#radius) }],
    })
    this.#balls.push(body)
    const node = new BallNode(body, this.#radius, '#272727')
    this.#ballNodes.set(body.id, node)
    this.#ballLayer.add(node)
  }

  #clearBalls(): void {
    for (const b of this.#balls) this.#world.removeBody(b)
    this.#balls.length = 0
    for (const node of this.#ballNodes.values()) {
      if (!node.isDestroyed) node.destroy()
    }
    this.#ballNodes.clear()
  }

  #renormalizeBalls(): void {
    const target = PHYSICS.ballSpeed
    for (const b of this.#balls) {
      const sp = Math.hypot(b.velocity.x, b.velocity.y)
      if (sp > 1e-3) {
        const s = target / sp
        b.velocity.x *= s
        b.velocity.y *= s
      } else {
        const a = (35 + Math.random() * 20) * (Math.PI / 180)
        b.velocity.x = Math.cos(a) * target
        b.velocity.y = Math.sin(a) * target
      }
    }
  }

  /** Push any ball that tunneled into a solid back into open space. */
  #unstickBalls(): void {
    const bounds: Bounds = {
      x: this.geom.x,
      y: this.geom.y,
      width: this.geom.width,
      height: this.geom.height,
    }
    for (const b of this.#balls) {
      if (this.#pointInSolid(b.position.x, b.position.y)) {
        this.#world.resolveOverlaps(b, 6, bounds)
      }
    }
  }

  #pointInSolid(x: number, y: number): boolean {
    const cell = cellAtWorld(this.geom, x, y)
    if (!cell) return false
    if (!inBounds(this.#grid, cell.col, cell.row)) return false
    return cellAt(this.#grid, cell.col, cell.row) !== CELL_OPEN
  }

  #ballCells(): CellRef[] {
    const out: CellRef[] = []
    for (const b of this.#balls) {
      const c = cellAtWorld(this.geom, b.position.x, b.position.y)
      if (c) out.push(c)
    }
    return out
  }

  // --- Colliders ---

  #rebuildColliders(): void {
    for (const body of this.#solidBodies) this.#world.removeBody(body)
    this.#solidBodies = []
    for (const r of buildColliderRects(this.#grid, this.geom)) {
      const body = this.#world.createBody({
        type: BodyType.Static,
        position: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        restitution: PHYSICS.restitution,
        friction: 0,
        layer: LAYER_SOLID,
        mask: LAYER_BALL,
        colliders: [{ shape: aabbShape(r.width / 2, r.height / 2) }],
      })
      this.#solidBodies.push(body)
    }
  }
}

/** Forwards the scene frame tick into a {@link BoardController}. */
class BoardTickBehavior extends Behavior {
  readonly #ctrl: BoardController
  constructor(ctrl: BoardController) {
    super()
    this.#ctrl = ctrl
  }
  override onUpdate(dt: number): void {
    this.#ctrl.update(dt)
  }
}
