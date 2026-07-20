/**
 * Collision shapes and the {@link Collider} that attaches one to a body.
 *
 * Shapes are plain data in a collider's local space. A collider adds an offset,
 * sensor flag, optional layer/mask override, and material to a shape. Bodies
 * own any number of colliders.
 */

import { rect, type Rect } from '../math/Rect'
import { vec2, vec2Rotate, type Vec2 } from '../math/Vec2'
import {
  polygonArea,
  polygonCentroid,
  polygonComputeNormals,
  polygonMomentOfInertia,
} from '../math/polygon'
import type { Body } from './Body'
import type { Material } from './types'

/**
 * A circle of the given radius, centered on the collider offset. @category
 * Physics
 */
export interface CircleShape {
  kind: 'circle'
  radius: number
}

/** An axis-aligned box with the given half-extents. @category Physics */
export interface AABBShape {
  kind: 'aabb'
  halfW: number
  halfH: number
}

/**
 * A convex polygon wound counter-clockwise in local space. Build one with
 * {@link polygonShape}, which validates and precomputes edge normals.
 *
 * @category Physics
 */
export interface PolygonShape {
  kind: 'polygon'
  vertices: readonly Vec2[]
  /** Outward unit edge normals, parallel to `vertices`. */
  normals: readonly Vec2[]
}

/** Any collision shape. @category Physics */
export type Shape = CircleShape | AABBShape | PolygonShape

/**
 * Make a circle shape.
 *
 * @category Physics
 * @example
 *   body.addCollider({ shape: circleShape(0.5) })
 */
export function circleShape(radius: number): CircleShape {
  return { kind: 'circle', radius }
}

/**
 * Make an axis-aligned box shape from its half-width and half-height.
 *
 * @category Physics
 */
export function aabbShape(halfW: number, halfH: number): AABBShape {
  return { kind: 'aabb', halfW, halfH }
}

/**
 * Make a convex polygon shape. Vertices must be convex and wound
 * counter-clockwise; the winding is validated in dev builds. Edge normals are
 * precomputed once here.
 *
 * @category Physics
 * @example
 *   const tri = polygonShape([vec2(0, -1), vec2(1, 1), vec2(-1, 1)])
 */
export function polygonShape(
  vertices: readonly Readonly<Vec2>[],
): PolygonShape {
  if (import.meta.env?.DEV) {
    if (vertices.length < 3) {
      throw new Error('polygonShape: need at least 3 vertices')
    }
    if (polygonArea(vertices) <= 0) {
      throw new Error(
        'polygonShape: vertices must be wound counter-clockwise (positive area)',
      )
    }
  }
  const verts = vertices.map((v) => vec2(v.x, v.y))
  const normals = polygonComputeNormals([], verts)
  return { kind: 'polygon', vertices: verts, normals }
}

/** Signed-positive area of a shape, used for mass distribution. */
export function shapeArea(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return Math.PI * shape.radius * shape.radius
    case 'aabb':
      return 4 * shape.halfW * shape.halfH
    case 'polygon':
      return Math.abs(polygonArea(shape.vertices))
  }
}

/** Centroid of a shape in its own local space (before the collider offset). */
export function shapeCentroid(shape: Shape, out: Vec2): Vec2 {
  if (shape.kind === 'polygon') return polygonCentroid(out, shape.vertices)
  out.x = 0
  out.y = 0
  return out
}

/**
 * Moment of inertia of a shape about its centroid, for the given mass and a
 * uniform density.
 */
export function shapeInertia(shape: Shape, mass: number): number {
  switch (shape.kind) {
    case 'circle':
      return 0.5 * mass * shape.radius * shape.radius
    case 'aabb': {
      const w = 2 * shape.halfW
      const h = 2 * shape.halfH
      return (mass * (w * w + h * h)) / 12
    }
    case 'polygon': {
      const c = polygonCentroid(vec2(), shape.vertices)
      return polygonMomentOfInertia(shape.vertices, mass, c)
    }
  }
}

/**
 * A shape plus its placement and surface properties on a body. Create colliders
 * through {@link Body.addCollider} rather than constructing directly.
 *
 * @category Physics
 */
export interface ColliderDef {
  shape: Shape
  /** Local offset from the body origin. Default `(0, 0)`. */
  offset?: Readonly<Vec2>
  /** Sensor: detected and reported via trigger events, never resolved. */
  sensor?: boolean
  /** Layer override; defaults to the owning body's layer. */
  layer?: number
  /** Mask override; defaults to the owning body's mask. */
  mask?: number
  material?: Material
  userData?: unknown
}

/**
 * A collision shape attached to a {@link Body}.
 *
 * @category Physics
 */
export class Collider {
  readonly shape: Shape
  readonly offset: Vec2
  sensor: boolean
  /** Effective layer; `-1` means "inherit from body" at query time. */
  layer: number
  mask: number
  material: Material
  userData: unknown
  /** Set when the collider is added to a body. */
  body!: Body

  constructor(def: ColliderDef) {
    this.shape = def.shape
    this.offset = vec2(def.offset?.x ?? 0, def.offset?.y ?? 0)
    this.sensor = def.sensor ?? false
    this.layer = def.layer ?? -1
    this.mask = def.mask ?? -1
    this.material = def.material ?? {}
    this.userData = def.userData
  }

  /** Effective layer: the collider override, or the body's layer. */
  effectiveLayer(): number {
    return this.layer >= 0 ? this.layer : this.body.layer
  }
  /** Effective mask: the collider override, or the body's mask. */
  effectiveMask(): number {
    return this.mask >= 0 ? this.mask : this.body.mask
  }
  effectiveRestitution(): number {
    return this.material.restitution ?? this.body.restitution
  }
  effectiveFriction(): number {
    return this.material.friction ?? this.body.friction
  }

  /**
   * World-space AABB of this collider given the owning body's transform,
   * written into `out`.
   */
  computeWorldAABB(out: Rect): Rect {
    const { position, rotation } = this.body
    const shape = this.shape
    // Collider offset rotated into world.
    const off = vec2Rotate(SCRATCH_OFF, this.offset, rotation)
    const cx = position.x + off.x
    const cy = position.y + off.y
    if (shape.kind === 'circle') {
      out.x = cx - shape.radius
      out.y = cy - shape.radius
      out.width = 2 * shape.radius
      out.height = 2 * shape.radius
      return out
    }
    if (shape.kind === 'aabb') {
      // AABB shapes stay axis-aligned in world space; only the center follows
      // the rotated offset. Rotating boxes should use polygonShape.
      out.x = cx - shape.halfW
      out.y = cy - shape.halfH
      out.width = 2 * shape.halfW
      out.height = 2 * shape.halfH
      return out
    }
    // Polygon: transform each vertex by the body rotation, take min/max.
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const verts = shape.vertices
    for (let i = 0; i < verts.length; i++) {
      const wv = vec2Rotate(SCRATCH_V, verts[i], rotation)
      const wx = cx + wv.x
      const wy = cy + wv.y
      if (wx < minX) minX = wx
      if (wy < minY) minY = wy
      if (wx > maxX) maxX = wx
      if (wy > maxY) maxY = wy
    }
    out.x = minX
    out.y = minY
    out.width = maxX - minX
    out.height = maxY - minY
    return out
  }
}

const SCRATCH_OFF = vec2()
const SCRATCH_V = vec2()
const AABB_CORNERS = [vec2(), vec2(), vec2(), vec2()]

/** Four local corners of an AABB shape, reused. */
export function aabbCorners(shape: AABBShape): Vec2[] {
  const { halfW, halfH } = shape
  AABB_CORNERS[0].x = -halfW
  AABB_CORNERS[0].y = -halfH
  AABB_CORNERS[1].x = halfW
  AABB_CORNERS[1].y = -halfH
  AABB_CORNERS[2].x = halfW
  AABB_CORNERS[2].y = halfH
  AABB_CORNERS[3].x = -halfW
  AABB_CORNERS[3].y = halfH
  return AABB_CORNERS
}

/** Local AABB (offset applied, no rotation) for internal use. */
export function colliderLocalBounds(c: Collider, out: Rect): Rect {
  const shape = c.shape
  if (shape.kind === 'circle') {
    out.x = c.offset.x - shape.radius
    out.y = c.offset.y - shape.radius
    out.width = 2 * shape.radius
    out.height = 2 * shape.radius
  } else if (shape.kind === 'aabb') {
    out.x = c.offset.x - shape.halfW
    out.y = c.offset.y - shape.halfH
    out.width = 2 * shape.halfW
    out.height = 2 * shape.halfH
  } else {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const v of shape.vertices) {
      if (v.x < minX) minX = v.x
      if (v.y < minY) minY = v.y
      if (v.x > maxX) maxX = v.x
      if (v.y > maxY) maxY = v.y
    }
    out.x = c.offset.x + minX
    out.y = c.offset.y + minY
    out.width = maxX - minX
    out.height = maxY - minY
  }
  return out
}

/** A reusable zero rect for callers that just need the type. */
export const SCRATCH_RECT: Rect = rect()
