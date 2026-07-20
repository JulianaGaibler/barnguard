// Physics overlay for the debug HUD. Pure function of a physics world + camera,
// no controller state. Draws in screen space, projecting each body's coords
// through an optional `space` transform (physics space → world) and then
// `cam.worldToScreen`, same screen-space convention as the grid/outline
// overlays. Every layer is gated by a flag so an all-off overlay costs one
// early return.
//
// `space` exists because a game may run physics in a coordinate system that is
// offset/rotated from world space (e.g. a field group translated to a panel
// origin). When null, bodies are assumed to live directly in world space.

import type { Camera } from '../camera/Camera'
import type { Gfx2D, GfxStrokeStyle } from '../render/gfx/Gfx2D'
import type { Vec2 } from '../math/Vec2'
import { lerp, lerpAngle } from '../math/scalar'
import { BodyType } from '../physics/types'
import type { Body } from '../physics/Body'
import type { PhysicsWorld } from '../physics/PhysicsWorld'

/** Which physics layers the overlay draws. All off by default. */
export interface PhysicsOverlayFlags {
  /** Collider outlines, colored by body type, dimmed when sleeping. */
  colliders: boolean
  /** World-space AABB per body. */
  aabbs: boolean
  /** Contact points and normal arrows from the last step. */
  contacts: boolean
  /** Linear-velocity arrows. */
  velocities: boolean
}

// Body-type base colors.
const COLOR_STATIC = '96, 165, 250' // blue
const COLOR_DYNAMIC = '134, 239, 172' // green
const COLOR_KINEMATIC = '253, 186, 116' // orange
const COLOR_AABB = 'rgba(148, 163, 184, 0.35)'
const COLOR_CONTACT = 'rgba(248, 113, 113, 0.95)'
const COLOR_NORMAL = 'rgba(248, 113, 113, 0.8)'
const COLOR_VELOCITY = 'rgba(250, 204, 21, 0.9)'

const NORMAL_LEN_PX = 18
const VELOCITY_SCALE_PX = 0.12 // screen px per (world unit / sec)
const ARROWHEAD_PX = 5
const CONTACT_DOT_PX = 3

// Reused scratch so the per-frame overlay allocates nothing beyond the fresh
// Vec2 that `cam.worldToScreen` returns (matches the other debug renderers).
const polyPts = new Float32Array(64)

/** Per-call transform context so points map physics space → world → screen. */
interface Ctx {
  cam: Camera
  /** Physics-space → world affine, or null when physics is in world space. */
  space: DOMMatrix | null
  /** Linear scale of `space` (1 when null), for radii and vector lengths. */
  spaceScale: number
  /** Interpolation fraction between each body's prev and current state. */
  alpha: number
}

function bodyColor(body: Body): string {
  const rgb =
    body.type === BodyType.Static
      ? COLOR_STATIC
      : body.type === BodyType.Kinematic
        ? COLOR_KINEMATIC
        : COLOR_DYNAMIC
  const alpha = body.sleeping ? 0.35 : 0.9
  return `rgba(${rgb}, ${alpha})`
}

/** Map a physics-space point to screen (through `space`, then the camera). */
function toScreen(ctx: Ctx, px: number, py: number): Vec2 {
  const m = ctx.space
  if (m) {
    return ctx.cam.worldToScreen(
      m.a * px + m.c * py + m.e,
      m.b * px + m.d * py + m.f,
    )
  }
  return ctx.cam.worldToScreen(px, py)
}

/** Map a physics-space point into `polyPts[i*2, i*2+1]` (screen px). */
function projectInto(ctx: Ctx, px: number, py: number, i: number): void {
  const s = toScreen(ctx, px, py)
  polyPts[i * 2] = s.x
  polyPts[i * 2 + 1] = s.y
}

/**
 * Draw the enabled physics layers for `world` through `cam`. `space` maps the
 * world's coordinates into scene-world space (null = already world space).
 * Caller guards on whether any flag is on.
 *
 * When `accent` is set, the overlay also draws a boundary around the world's
 * occupied region and a `label` at that region, so several worlds stay distinct
 * on screen. Collider colors still track body type, so static, dynamic, and
 * kinematic bodies remain readable within each world.
 */
export function drawPhysicsOverlay(
  gfx: Gfx2D,
  world: PhysicsWorld,
  cam: Camera,
  flags: PhysicsOverlayFlags,
  space: DOMMatrix | null = null,
  alpha = 1,
  accent?: string,
  label?: string,
): void {
  const spaceScale = space ? Math.hypot(space.a, space.b) : 1
  const ctx: Ctx = { cam, space, spaceScale, alpha }
  const pxPerWorld = cam.screenPxPerWorldUnit() * spaceScale
  const bodies = world.bodies

  if (accent) drawWorldBoundary(gfx, ctx, world, accent, label)

  if (flags.aabbs) {
    const style: GfxStrokeStyle = { color: COLOR_AABB, width: 1 }
    for (let i = 0; i < bodies.length; i++) {
      drawBodyAABB(gfx, ctx, bodies[i], style)
    }
  }

  if (flags.colliders) {
    for (let i = 0; i < bodies.length; i++) {
      drawBodyColliders(gfx, ctx, bodies[i], pxPerWorld)
    }
  }

  if (flags.velocities) {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]
      if (b.type === BodyType.Static || b.sleeping) continue
      drawVelocity(gfx, ctx, b, pxPerWorld)
    }
  }

  if (flags.contacts) {
    drawContacts(gfx, ctx, world)
  }
}

const BOUNDARY_HALO = 'rgba(0, 0, 0, 0.7)'

/** A label drawn on a dark backplate so it reads on any background. */
function labelWithHalo(
  gfx: Gfx2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  // 11px monospace advance is ~6.6px; no measureText on Gfx2D, so approximate.
  const w = text.length * 6.6
  gfx.fillRect(x - 2, y - 10, w + 4, 14, 'rgba(0, 0, 0, 0.65)')
  gfx.fillText(text, x, y, { font: '11px monospace', color })
}

/**
 * Outline the region the world's bodies occupy (their union AABB) and label it.
 * With no bodies, just place the label at the physics-space origin.
 */
function drawWorldBoundary(
  gfx: Gfx2D,
  ctx: Ctx,
  world: PhysicsWorld,
  accent: string,
  label?: string,
): void {
  const bodies = world.bodies
  if (bodies.length === 0) {
    if (label) {
      const o = toScreen(ctx, 0, 0)
      labelWithHalo(gfx, label, o.x + 4, o.y - 4, accent)
    }
    return
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < bodies.length; i++) {
    const r = bodies[i].computeAABB(SCRATCH_RECT)
    if (r.x < minX) minX = r.x
    if (r.y < minY) minY = r.y
    if (r.x + r.width > maxX) maxX = r.x + r.width
    if (r.y + r.height > maxY) maxY = r.y + r.height
  }
  projectInto(ctx, minX, minY, 0)
  projectInto(ctx, maxX, minY, 1)
  projectInto(ctx, maxX, maxY, 2)
  projectInto(ctx, minX, maxY, 3)
  // Dark underlay then the accent line so the boundary reads on any background.
  gfx.strokePolyline(polyPts, 4, {
    color: BOUNDARY_HALO,
    width: 3,
    closed: true,
  })
  gfx.strokePolyline(polyPts, 4, {
    color: accent,
    width: 1.5,
    dash: [2, 4],
    closed: true,
  })
  if (label) {
    labelWithHalo(gfx, label, polyPts[0] + 4, polyPts[1] - 4, accent)
  }
}

function drawBodyAABB(
  gfx: Gfx2D,
  ctx: Ctx,
  body: Body,
  style: GfxStrokeStyle,
): void {
  const r = body.computeAABB(SCRATCH_RECT)
  // Shift the AABB by the body's interpolation offset so it tracks the
  // interpolated render position.
  const ox = (body.prevPosition.x - body.position.x) * (1 - ctx.alpha)
  const oy = (body.prevPosition.y - body.position.y) * (1 - ctx.alpha)
  const x = r.x + ox
  const y = r.y + oy
  projectInto(ctx, x, y, 0)
  projectInto(ctx, x + r.width, y, 1)
  projectInto(ctx, x + r.width, y + r.height, 2)
  projectInto(ctx, x, y + r.height, 3)
  gfx.strokePolyline(polyPts, 4, { ...style, closed: true })
}

/** Interpolated body center X for this frame. */
function interpX(ctx: Ctx, body: Body): number {
  return lerp(body.prevPosition.x, body.position.x, ctx.alpha)
}
function interpY(ctx: Ctx, body: Body): number {
  return lerp(body.prevPosition.y, body.position.y, ctx.alpha)
}

function drawBodyColliders(
  gfx: Gfx2D,
  ctx: Ctx,
  body: Body,
  pxPerWorld: number,
): void {
  const color = bodyColor(body)
  const rot = lerpAngle(body.prevRotation, body.rotation, ctx.alpha)
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const bx = interpX(ctx, body)
  const by = interpY(ctx, body)
  for (const c of body.colliders) {
    const style: GfxStrokeStyle = {
      color,
      width: 1.5,
      dash: c.sensor ? [4, 3] : undefined,
    }
    // Collider center in physics space = interpolated body pos + rotated offset.
    const ox = c.offset.x * cos - c.offset.y * sin
    const oy = c.offset.x * sin + c.offset.y * cos
    const cx = bx + ox
    const cy = by + oy
    const shape = c.shape
    if (shape.kind === 'circle') {
      const s = toScreen(ctx, cx, cy)
      gfx.strokeCircle(s.x, s.y, shape.radius * pxPerWorld, style)
      // Rotation tick to the rim.
      const rim = toScreen(
        ctx,
        cx + shape.radius * cos,
        cy + shape.radius * sin,
      )
      gfx.strokeLine(s.x, s.y, rim.x, rim.y, style)
    } else if (shape.kind === 'aabb') {
      // Axis-aligned in physics space even on a rotating body.
      projectInto(ctx, cx - shape.halfW, cy - shape.halfH, 0)
      projectInto(ctx, cx + shape.halfW, cy - shape.halfH, 1)
      projectInto(ctx, cx + shape.halfW, cy + shape.halfH, 2)
      projectInto(ctx, cx - shape.halfW, cy + shape.halfH, 3)
      gfx.strokePolyline(polyPts, 4, { ...style, closed: true })
    } else {
      const verts = shape.vertices
      const n = Math.min(verts.length, 32)
      for (let i = 0; i < n; i++) {
        const v = verts[i]
        projectInto(
          ctx,
          cx + (v.x * cos - v.y * sin),
          cy + (v.x * sin + v.y * cos),
          i,
        )
      }
      gfx.strokePolyline(polyPts, n, { ...style, closed: true })
    }
  }
}

function drawVelocity(
  gfx: Gfx2D,
  ctx: Ctx,
  body: Body,
  pxPerWorld: number,
): void {
  const vx = body.velocity.x
  const vy = body.velocity.y
  if (vx * vx + vy * vy < 1e-6) return
  const from = toScreen(ctx, interpX(ctx, body), interpY(ctx, body))
  // Velocity drawn in screen px, scaled from world units/sec.
  const scale = pxPerWorld * VELOCITY_SCALE_PX
  const ex = from.x + vx * scale
  const ey = from.y + vy * scale
  const style: GfxStrokeStyle = { color: COLOR_VELOCITY, width: 1.5 }
  gfx.strokeLine(from.x, from.y, ex, ey, style)
  drawArrowhead(gfx, from.x, from.y, ex, ey, style)
}

function drawContacts(gfx: Gfx2D, ctx: Ctx, world: PhysicsWorld): void {
  const normalStyle: GfxStrokeStyle = { color: COLOR_NORMAL, width: 1.5 }
  const count = world.contactCount
  for (let i = 0; i < count; i++) {
    const m = world.getContact(i)
    if (m.isSensor) continue
    for (let ci = 0; ci < m.contactCount; ci++) {
      const p = m.points[ci].point
      const s = toScreen(ctx, p.x, p.y)
      gfx.fillCircle(s.x, s.y, CONTACT_DOT_PX, COLOR_CONTACT)
      // Normal is a screen-space direction (rotation-only from space is fine
      // for the small fixed-length arrow); use it directly.
      gfx.strokeLine(
        s.x,
        s.y,
        s.x + m.normal.x * NORMAL_LEN_PX,
        s.y + m.normal.y * NORMAL_LEN_PX,
        normalStyle,
      )
    }
  }
}

/** Small V-shaped arrowhead at (ex, ey) pointing away from (fx, fy). */
function drawArrowhead(
  gfx: Gfx2D,
  fx: number,
  fy: number,
  ex: number,
  ey: number,
  style: GfxStrokeStyle,
): void {
  const dx = ex - fx
  const dy = ey - fy
  const len = Math.hypot(dx, dy)
  if (len < 1e-3) return
  const ux = dx / len
  const uy = dy / len
  const a = ARROWHEAD_PX
  gfx.strokeLine(ex, ey, ex - ux * a - uy * a, ey - uy * a + ux * a, style)
  gfx.strokeLine(ex, ey, ex - ux * a + uy * a, ey - uy * a - ux * a, style)
}

const SCRATCH_RECT = { x: 0, y: 0, width: 0, height: 0 }
