// World-space 3D gizmo geometry for the debug HUD: oriented boxes, light
// shapes, and mesh wireframes pushed into a `DebugLine3DRenderer`. Pure
// functions of their arguments, no controller state. `DebugController.
// drawOverlay3D` reads the toggle state and calls these.

import type {
  DebugLine3DRenderer,
  LineColor,
} from '../render/gfx/DebugLine3DRenderer'
import { MeshNode } from '../nodes/MeshNode'
import {
  Light3D,
  DirectionalLight3D,
  PointLight3D,
  SpotLight3D,
} from '../nodes/Light3D'
import { mat4TransformPoint, type Mat4 } from '../math/Mat4'
import { vec3, vec3Cross, vec3Normalize, type Vec3 } from '../math/Vec3'

/** Push the 12 edges of a local AABB transformed by `world` (an oriented box). */
export function pushObb(
  lines: DebugLine3DRenderer,
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  world: Mat4,
  color: readonly [number, number, number, number],
  overlay: boolean,
): void {
  const c: Array<{ x: number; y: number; z: number }> = []
  for (const z of [min.z, max.z]) {
    for (const y of [min.y, max.y]) {
      for (const x of [min.x, max.x]) {
        c.push({ ...mat4TransformPoint(vec3(), world, x, y, z) })
      }
    }
  }
  // Corner index bits: x=1, y=2, z=4.
  const e = (a: number, b: number): void =>
    lines.line(c[a].x, c[a].y, c[a].z, c[b].x, c[b].y, c[b].z, color, overlay)
  e(0, 1)
  e(1, 3)
  e(3, 2)
  e(2, 0) // z=min face
  e(4, 5)
  e(5, 7)
  e(7, 6)
  e(6, 4) // z=max face
  e(0, 4)
  e(1, 5)
  e(2, 6)
  e(3, 7) // connectors
}

/**
 * Draw the selected light's shape in its own color: a directional light's aim,
 * a point light's range sphere, or a spot light's cone. Lines overlay geometry
 * so the gizmo reads through the scene.
 */
export function drawLightGizmo(
  lines: DebugLine3DRenderer,
  light: Light3D,
): void {
  const w = light.worldMatrix
  const px = w[12]
  const py = w[13]
  const pz = w[14]
  const f = vec3Normalize(vec3(), vec3(-w[8], -w[9], -w[10])) // world −Z (aim)
  const col: LineColor = [light.color[0], light.color[1], light.color[2], 1]
  // Basis spanning the plane perpendicular to the aim, for circles/cones.
  const up0 = Math.abs(f.y) > 0.99 ? vec3(1, 0, 0) : vec3(0, 1, 0)
  const right = vec3Normalize(vec3(), vec3Cross(vec3(), up0, f))
  const up = vec3Cross(vec3(), f, right)

  if (light instanceof DirectionalLight3D) {
    const len = 2
    lines.ray(px, py, pz, f.x, f.y, f.z, len, col)
    const tx = px + f.x * len
    const ty = py + f.y * len
    const tz = pz + f.z * len
    const h = 0.2
    for (const s of [1, -1]) {
      lines.line(
        tx,
        ty,
        tz,
        tx - f.x * h + right.x * h * s,
        ty - f.y * h + right.y * h * s,
        tz - f.z * h + right.z * h * s,
        col,
        true,
      )
    }
    circleGizmo(lines, px, py, pz, right, up, 0.3, 16, col)
  } else if (light instanceof PointLight3D) {
    // A small solid-color marker keeps the light spottable even when its range
    // sphere is huge, the range sphere itself is drawn faint.
    sphereGizmo(lines, px, py, pz, 0.15, 16, col)
    if (light.range > 0) {
      const faint: LineColor = [col[0], col[1], col[2], 0.35]
      sphereGizmo(lines, px, py, pz, light.range, 28, faint)
    }
  } else if (light instanceof SpotLight3D) {
    const len = light.range > 0 ? light.range : 3
    const rad = Math.tan(Math.min(light.outerConeAngle, 1.45)) * len
    const bx = px + f.x * len
    const by = py + f.y * len
    const bz = pz + f.z * len
    circleGizmo(lines, bx, by, bz, right, up, rad, 28, col)
    for (const [rc, uc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      lines.line(
        px,
        py,
        pz,
        bx + right.x * rad * rc + up.x * rad * uc,
        by + right.y * rad * rc + up.y * rad * uc,
        bz + right.z * rad * rc + up.z * rad * uc,
        col,
        true,
      )
    }
    if (light.innerConeAngle > 0) {
      const rin = Math.tan(Math.min(light.innerConeAngle, 1.45)) * len
      circleGizmo(lines, bx, by, bz, right, up, rin, 28, [
        col[0],
        col[1],
        col[2],
        0.4,
      ])
    }
  }
}

/** Three axis-aligned rings approximating a wireframe sphere. */
function sphereGizmo(
  lines: DebugLine3DRenderer,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  segments: number,
  color: LineColor,
): void {
  circleGizmo(
    lines,
    cx,
    cy,
    cz,
    vec3(1, 0, 0),
    vec3(0, 1, 0),
    r,
    segments,
    color,
  )
  circleGizmo(
    lines,
    cx,
    cy,
    cz,
    vec3(1, 0, 0),
    vec3(0, 0, 1),
    r,
    segments,
    color,
  )
  circleGizmo(
    lines,
    cx,
    cy,
    cz,
    vec3(0, 1, 0),
    vec3(0, 0, 1),
    r,
    segments,
    color,
  )
}

/** A closed circle centered at `c`, spanning the `u`/`v` plane, `r` radius. */
function circleGizmo(
  lines: DebugLine3DRenderer,
  cx: number,
  cy: number,
  cz: number,
  u: Vec3,
  v: Vec3,
  r: number,
  segments: number,
  color: LineColor,
): void {
  let prevX = 0
  let prevY = 0
  let prevZ = 0
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2
    const ca = Math.cos(t) * r
    const sa = Math.sin(t) * r
    const x = cx + u.x * ca + v.x * sa
    const y = cy + u.y * ca + v.y * sa
    const z = cz + u.z * ca + v.z * sa
    if (i > 0) lines.line(prevX, prevY, prevZ, x, y, z, color, true)
    prevX = x
    prevY = y
    prevZ = z
  }
}

/**
 * Push a mesh's triangle edges as world-space lines (the wireframe/"mesh"
 * view). Occluded (depth-tested), so the shaded fill hides back-facing edges.
 * O(triangles), only runs while the HUD is open in wireframe mode.
 */
export function pushWireframe(
  lines: DebugLine3DRenderer,
  mesh: MeshNode,
): void {
  const g = mesh.geometry
  if (!g) return
  const pos = g.positions
  const idx = g.indices
  const w = mesh.worldMatrix
  const color: readonly [number, number, number, number] = [0.5, 1, 0.65, 0.85]
  const a = vec3()
  const b = vec3()
  const c = vec3()
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = idx[t] * 3
    const i1 = idx[t + 1] * 3
    const i2 = idx[t + 2] * 3
    mat4TransformPoint(a, w, pos[i0], pos[i0 + 1], pos[i0 + 2])
    mat4TransformPoint(b, w, pos[i1], pos[i1 + 1], pos[i1 + 2])
    mat4TransformPoint(c, w, pos[i2], pos[i2 + 1], pos[i2 + 2])
    lines.line(a.x, a.y, a.z, b.x, b.y, b.z, color)
    lines.line(b.x, b.y, b.z, c.x, c.y, c.z, color)
    lines.line(c.x, c.y, c.z, a.x, a.y, a.z, color)
  }
}

/**
 * Wireframe for a unit quad (a `Viewport2DNode` surface): the 4 border edges
 * plus one diagonal, showing its two triangles. Local corners span `[-0.5,
 * 0.5]` in x/y at z = 0, transformed by `world`.
 */
export function pushQuadWireframe(
  lines: DebugLine3DRenderer,
  world: Mat4,
): void {
  const color: readonly [number, number, number, number] = [0.5, 1, 0.65, 0.85]
  const tl = mat4TransformPoint(vec3(), world, -0.5, 0.5, 0)
  const tr = mat4TransformPoint(vec3(), world, 0.5, 0.5, 0)
  const br = mat4TransformPoint(vec3(), world, 0.5, -0.5, 0)
  const bl = mat4TransformPoint(vec3(), world, -0.5, -0.5, 0)
  lines.line(tl.x, tl.y, tl.z, tr.x, tr.y, tr.z, color)
  lines.line(tr.x, tr.y, tr.z, br.x, br.y, br.z, color)
  lines.line(br.x, br.y, br.z, bl.x, bl.y, bl.z, color)
  lines.line(bl.x, bl.y, bl.z, tl.x, tl.y, tl.z, color)
  lines.line(tl.x, tl.y, tl.z, br.x, br.y, br.z, color) // diagonal
}
