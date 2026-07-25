/**
 * Stylized in-engine menu preview for JezzBall: a square and a circle
 * overlaid, with four diagonal spokes reaching in from the square's corners
 * toward its center (stopping short, so the middle stays open). The square
 * sits like a `bottom: -20%; right: -20%` box — its own height tall, pinned
 * so it bleeds past the view's bottom and right edges — and every stroke is
 * clipped to the view rect by hand, since the renderer's `setClipMask` only
 * affects filled triangles, not the `strokeLine`/`strokeCircle` calls this
 * decoration is built from. The square's edges and the spokes are real static
 * colliders, but the collider box itself is inset to the visible area (not
 * the full, partly off-screen square) so the balls — solid fills, which
 * can't be clipped the same cheap way — never wander past the frame either.
 */
import {
  Body,
  BodyType,
  PhysicsWorldBehavior,
  SceneNode,
  aabbShape,
  circleShape,
  lerp,
  polygonShape,
  type Camera,
  type EngineHost,
  type Gfx2D,
  type Rect,
  type Vec2,
} from '@src/stargazer'
import type { MenuPreview } from '@src/displays/arcade/menu/types'
import { BallNode } from './nodes/BallNode'
import { COLORS, PHYSICS } from './tuning'

const SQUARE_SIDE_FRAC = 1 // of view height — the square is as tall as the view
/**
 * How far the square's bottom-right corner sits past the view's bottom-right
 * corner, as a fraction of the square's own side — the "slightly off screen"
 * `bottom: -20%; right: -20%` positioning.
 */
const OFFSCREEN_FRAC = 0.2
const CIRCLE_RADIUS_FRAC = 0.62 // of square side
/** How far each spoke reaches from its corner toward the center. */
const SPOKE_REACH_FRAC = 0.55
const BALL_RADIUS_FRAC = 0.018 // of square side — "relatively small"
const LINE_WIDTH_PX = 2.5
/** Straight segments a stroked circle is approximated by, so it can be
 * clipped the same way as every other line in this file. */
const CIRCLE_SEGMENTS = 96
/**
 * Collider half-thickness (border + spokes), as a fraction of the square
 * side. Thin, but comfortably wider than a ball's per-step travel at
 * `PHYSICS.ballSpeed` and 120Hz so nothing tunnels through.
 */
const COLLIDER_HALF_THICKNESS_FRAC = 0.012

/**
 * Rewind `verts` so its signed area is positive — `polygonShape` requires
 * counter-clockwise winding, which in this y-down world means "visually
 * clockwise on screen". Easier to test the sign per segment than to reason
 * about winding for every spoke's direction by hand.
 */
function windCcw(verts: Vec2[]): Vec2[] {
  let area = 0
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i]
    const q = verts[(i + 1) % verts.length]
    area += p.x * q.y - q.x * p.y
  }
  return area < 0 ? verts.reverse() : verts
}

/** A thin rectangle spanning `a` to `b`, `halfThickness` on each side — the
 * closest stand-in for a line-segment collider, since the physics module has
 * no dedicated segment shape. */
function segmentVerts(a: Vec2, b: Vec2, halfThickness: number): Vec2[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = (-dy / len) * halfThickness
  const ny = (dx / len) * halfThickness
  return windCcw([
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ])
}

/**
 * The portion of segment `a`→`b` inside `rect`, via Liang-Barsky clipping —
 * `null` when none of it is. The engine has no cheap way to clip a stroke
 * (`setClipMask` only wires into filled-triangle draws), so every line this
 * file draws is clipped by hand before it reaches `Gfx2D`.
 */
function clipSegment(a: Vec2, b: Vec2, rect: Rect): [Vec2, Vec2] | null {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [
    a.x - rect.x,
    rect.x + rect.width - a.x,
    a.y - rect.y,
    rect.y + rect.height - a.y,
  ]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null
      continue
    }
    const r = q[i] / p[i]
    if (p[i] < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ]
}

/** The static outline: square border, decorative circle, and corner spokes,
 * all clipped to `clip` since they're free to run past it. */
class DecorNode extends SceneNode {
  readonly #square: readonly Vec2[]
  readonly #circle: Readonly<{ x: number; y: number; r: number }>
  readonly #spokes: ReadonlyArray<readonly [Vec2, Vec2]>
  readonly #clip: Rect

  constructor(
    square: readonly Vec2[],
    circle: Readonly<{ x: number; y: number; r: number }>,
    spokes: ReadonlyArray<readonly [Vec2, Vec2]>,
    clip: Rect,
  ) {
    super('jezzball-menu-decor')
    this.renderLayer = 'dynamic'
    this.#square = square
    this.#circle = circle
    this.#spokes = spokes
    this.#clip = clip
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const width = LINE_WIDTH_PX * camera.strokeSpaceScale()
    const style = { color: COLORS.ink, width, cap: 'round' as const }
    const stroke = (a: Vec2, b: Vec2): void => {
      const seg = clipSegment(a, b, this.#clip)
      if (seg) gfx.strokeLine(seg[0].x, seg[0].y, seg[1].x, seg[1].y, style)
    }

    const sq = this.#square
    for (let i = 0; i < sq.length; i++) stroke(sq[i], sq[(i + 1) % sq.length])
    for (const [a, b] of this.#spokes) stroke(a, b)

    // The circle is approximated as a fan of short segments so it can be
    // clipped the same way as every straight line above.
    const { x: cx, y: cy, r } = this.#circle
    let prev = { x: cx + r, y: cy }
    for (let i = 1; i <= CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2
      const next = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }
      stroke(prev, next)
      prev = next
    }
  }
}

export function buildJezzballMenuPreview(
  host: EngineHost,
  view: Rect,
): MenuPreview {
  const vw = view.width
  const vh = view.height
  const clip: Rect = { x: 0, y: 0, width: vw, height: vh }

  const side = vh * SQUARE_SIDE_FRAC
  const sqX = vw - side * (1 - OFFSCREEN_FRAC)
  const sqY = vh - side * (1 - OFFSCREEN_FRAC)
  const cx = sqX + side / 2
  const cy = sqY + side / 2

  const corners: Vec2[] = [
    { x: sqX, y: sqY },
    { x: sqX + side, y: sqY },
    { x: sqX + side, y: sqY + side },
    { x: sqX, y: sqY + side },
  ]
  const spokes: Array<[Vec2, Vec2]> = corners.map((c) => [
    c,
    { x: lerp(c.x, cx, SPOKE_REACH_FRAC), y: lerp(c.y, cy, SPOKE_REACH_FRAC) },
  ])

  const root = new SceneNode('jezzball-menu-preview')
  root.transform.x = view.x
  root.transform.y = view.y
  root.add(
    new DecorNode(corners, { x: cx, y: cy, r: side * CIRCLE_RADIUS_FRAC }, spokes, clip),
  )

  const physicsLayer = new SceneNode('jezzball-menu-physics')
  const world = physicsLayer.addBehavior(
    new PhysicsWorldBehavior({
      config: { gravity: { x: 0, y: 0 } },
      label: 'jezzball-menu',
    }),
  ).world

  // The balls are solid fills, not strokes, so they can't be clipped the same
  // cheap way as the decoration above — instead their play area is the square
  // INSET to the visible view, so they never reach the part of the square
  // that bleeds past the frame in the first place.
  const play: Rect = {
    x: sqX,
    y: sqY,
    width: Math.min(side, vw - sqX),
    height: Math.min(side, vh - sqY),
  }
  const playCx = play.x + play.width / 2
  const playCy = play.y + play.height / 2

  const halfT = side * COLLIDER_HALF_THICKNESS_FRAC
  world.addBody(
    new Body({
      type: BodyType.Static,
      restitution: PHYSICS.restitution,
      friction: PHYSICS.friction,
      colliders: [
        // Play-area border, one collider per edge, each overlapping the
        // corners by `halfT` so there's no gap at the seams.
        { shape: aabbShape(play.width / 2 + halfT, halfT), offset: { x: playCx, y: play.y - halfT } },
        { shape: aabbShape(play.width / 2 + halfT, halfT), offset: { x: playCx, y: play.y + play.height + halfT } },
        { shape: aabbShape(halfT, play.height / 2 + halfT), offset: { x: play.x - halfT, y: playCy } },
        { shape: aabbShape(halfT, play.height / 2 + halfT), offset: { x: play.x + play.width + halfT, y: playCy } },
        // Spokes keep the true (partly off-screen) corners — the border walls
        // above already block balls from ever reaching the part that would
        // hang past them, so the unreachable tail is harmless dead geometry.
        ...spokes.map((seg) => ({ shape: polygonShape(segmentVerts(seg[0], seg[1], halfT)) })),
      ],
    }),
  )

  root.add(physicsLayer)
  host.engine.scene.root.add(root)

  const ballRadius = side * BALL_RADIUS_FRAC
  const spawnBall = (xFrac: number, yFrac: number, angleDeg: number): void => {
    const angle = (angleDeg * Math.PI) / 180
    const body = new Body({
      type: BodyType.Dynamic,
      position: { x: play.x + play.width * xFrac, y: play.y + play.height * yFrac },
      velocity: {
        x: Math.cos(angle) * PHYSICS.ballSpeed,
        y: Math.sin(angle) * PHYSICS.ballSpeed,
      },
      restitution: PHYSICS.restitution,
      friction: PHYSICS.friction,
      linearDamping: PHYSICS.linearDamping,
      fixedRotation: true,
      canSleep: false,
      colliders: [{ shape: circleShape(ballRadius) }],
    })
    world.addBody(body)
    physicsLayer.add(new BallNode(body, ballRadius, COLORS.ink))
  }
  // Two open pockets between adjacent spokes, well clear of them at rest.
  spawnBall(0.38, 0.24, 35)
  spawnBall(0.64, 0.72, 200)

  return {
    destroy() {
      if (!root.isDestroyed) root.destroy()
    },
  }
}
