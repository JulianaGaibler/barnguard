import type { GfxDevice, Program, VBuffer, Vao } from './GfxDevice'
import type { Mat4 } from '../../math/Mat4'
import { mat4TransformPoint } from '../../math/Mat4'
import { vec3 } from '../../math/Vec3'
import debugLineVertSrc from './webgl2/shaders/debugLine.vert.glsl?raw'
import debugLineFragSrc from './webgl2/shaders/debugLine.frag.glsl?raw'

/** RGBA in `0..1` for a debug line. */
export type LineColor = readonly [number, number, number, number]

// 7 floats per vertex: position xyz + color rgba.
const FLOATS_PER_VERT = 7
const LOC_POSITION = 0
const LOC_COLOR = 1

/**
 * Accumulates world-space line segments for the 3D debug pass and draws them
 * through the {@link GfxDevice} seam as `GL_LINES`, projected by the active 3D
 * camera. `Stage` owns one instance and drives it each frame while a 3D debug
 * overlay is on: `begin()`, push gizmos, then `flush(device, viewProj)`.
 *
 * Two groups: **occluded** lines depth-test against the scene (a grid or AABB
 * sits behind solid geometry); **overlay** lines ignore depth (a selection
 * highlight or pick ray stays visible through meshes). Neither writes depth, so
 * gizmos never corrupt the buffer the meshes share.
 *
 * Not part of the public API; used by `DebugController`/`Stage`.
 */
export class DebugLine3DRenderer {
  readonly #device: GfxDevice
  #program: Program
  #vbo: VBuffer
  #vao: Vao
  #capacityVerts: number
  #scratch: Float32Array
  readonly #offRestore: () => void

  // Interleaved vertex data for the current frame, split by depth behavior.
  #occluded: number[] = []
  #overlay: number[] = []

  constructor(device: GfxDevice, initialVerts = 4096) {
    this.#device = device
    this.#capacityVerts = initialVerts
    this.#scratch = new Float32Array(initialVerts * FLOATS_PER_VERT)
    this.#program = this.#createProgram()
    this.#vbo = device.createVertexBuffer(this.#scratch.byteLength)
    this.#vao = this.#createVao()
    this.#offRestore = device.onContextRestored(() => this.#onContextRestored())
  }

  #createProgram(): Program {
    return this.#device.createProgram({
      vertexSrc: debugLineVertSrc,
      fragmentSrc: debugLineFragSrc,
      attribs: { a_position: LOC_POSITION, a_color: LOC_COLOR },
    })
  }

  #createVao(): Vao {
    const stride = FLOATS_PER_VERT * 4
    return this.#device.createVao(this.#program, [
      {
        buffer: this.#vbo,
        location: LOC_POSITION,
        size: 3,
        type: 'float',
        normalized: false,
        offset: 0,
        stride,
        divisor: 0,
      },
      {
        buffer: this.#vbo,
        location: LOC_COLOR,
        size: 4,
        type: 'float',
        normalized: false,
        offset: 12,
        stride,
        divisor: 0,
      },
    ])
  }

  #onContextRestored(): void {
    this.#program = this.#createProgram()
    this.#vbo = this.#device.createVertexBuffer(this.#scratch.byteLength)
    this.#vao = this.#createVao()
  }

  /** Clear both groups for a new frame. */
  begin(): void {
    this.#occluded.length = 0
    this.#overlay.length = 0
  }

  // --- push helpers ----------------------------------------------------------

  /** A world-space segment. `overlay` draws it through geometry (no depth test). */
  line(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    color: LineColor,
    overlay = false,
  ): void {
    const buf = overlay ? this.#overlay : this.#occluded
    const [r, g, b, a] = color
    buf.push(ax, ay, az, r, g, b, a, bx, by, bz, r, g, b, a)
  }

  /** Axis-aligned box wireframe (12 edges) spanning `min`→`max`. */
  box(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    color: LineColor,
    overlay = false,
  ): void {
    const c = color
    const L = (
      x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    ): void => this.line(x0, y0, z0, x1, y1, z1, c, overlay)
    // Bottom rectangle (min y), top rectangle (max y), then the 4 verticals.
    L(minX, minY, minZ, maxX, minY, minZ)
    L(maxX, minY, minZ, maxX, minY, maxZ)
    L(maxX, minY, maxZ, minX, minY, maxZ)
    L(minX, minY, maxZ, minX, minY, minZ)
    L(minX, maxY, minZ, maxX, maxY, minZ)
    L(maxX, maxY, minZ, maxX, maxY, maxZ)
    L(maxX, maxY, maxZ, minX, maxY, maxZ)
    L(minX, maxY, maxZ, minX, maxY, minZ)
    L(minX, minY, minZ, minX, maxY, minZ)
    L(maxX, minY, minZ, maxX, maxY, minZ)
    L(maxX, minY, maxZ, maxX, maxY, maxZ)
    L(minX, minY, maxZ, minX, maxY, maxZ)
  }

  /** RGB axes of length `size` from `(ox,oy,oz)`: X red, Y green, Z blue. */
  axes(ox: number, oy: number, oz: number, size: number, overlay = false): void {
    this.line(ox, oy, oz, ox + size, oy, oz, [1, 0.25, 0.25, 1], overlay)
    this.line(ox, oy, oz, ox, oy + size, oz, [0.3, 1, 0.35, 1], overlay)
    this.line(ox, oy, oz, ox, oy, oz + size, [0.35, 0.55, 1, 1], overlay)
  }

  /**
   * XZ ground grid centered at the origin: `divisions` cells each `step` wide,
   * with the two center axis lines accented.
   */
  grid(step: number, divisions: number, color: LineColor, axisColor: LineColor): void {
    const half = (step * divisions) / 2
    for (let i = 0; i <= divisions; i++) {
      const p = -half + i * step
      const isAxis = Math.abs(p) < step * 0.001
      const c = isAxis ? axisColor : color
      this.line(p, 0, -half, p, 0, half, c)
      this.line(-half, 0, p, half, 0, p, c)
    }
  }

  /** Frustum wireframe from an inverse view-projection: unproject the 8 NDC corners. */
  frustum(invViewProj: Mat4, color: LineColor): void {
    const corners: number[][] = []
    for (const z of [-1, 1]) {
      for (const y of [-1, 1]) {
        for (const x of [-1, 1]) {
          const p = mat4TransformPoint(vec3(), invViewProj, x, y, z)
          corners.push([p.x, p.y, p.z])
        }
      }
    }
    // Corner index bits: x=1, y=2, z=4. Near plane z=-1 (0..3), far z=1 (4..7).
    const edge = (a: number, b: number): void =>
      this.line(
        corners[a][0], corners[a][1], corners[a][2],
        corners[b][0], corners[b][1], corners[b][2],
        color, true,
      )
    edge(0, 1); edge(1, 3); edge(3, 2); edge(2, 0) // near
    edge(4, 5); edge(5, 7); edge(7, 6); edge(6, 4) // far
    edge(0, 4); edge(1, 5); edge(2, 6); edge(3, 7) // connectors
  }

  /** A ray from `origin` along `dir` for `length` units (overlay, always visible). */
  ray(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    length: number,
    color: LineColor,
  ): void {
    this.line(ox, oy, oz, ox + dx * length, oy + dy * length, oz + dz * length, color, true)
  }

  /** Upload the frame's segments and draw them, projected by `viewProj`. */
  flush(viewProj: Mat4): void {
    const total = this.#occluded.length + this.#overlay.length
    if (total === 0) return
    const device = this.#device
    const vertsNeeded = total / FLOATS_PER_VERT

    if (vertsNeeded > this.#capacityVerts) {
      this.#capacityVerts = Math.ceil(vertsNeeded * 1.5)
      this.#scratch = new Float32Array(this.#capacityVerts * FLOATS_PER_VERT)
      device.deleteVao(this.#vao)
      device.deleteBuffer(this.#vbo)
      this.#vbo = device.createVertexBuffer(this.#scratch.byteLength)
      this.#vao = this.#createVao()
    }

    // Pack occluded first, then overlay, into the single buffer.
    const scratch = this.#scratch
    scratch.set(this.#occluded, 0)
    scratch.set(this.#overlay, this.#occluded.length)
    device.updateBufferSubData(this.#vbo, 0, scratch, 0, total * 4)

    device.useProgram(this.#program)
    device.setUniformMat4(this.#program, 'u_viewProj', viewProj)
    device.setDepthWrite(false)
    device.setCullFace('none')
    device.bindVao(this.#vao)

    const occludedVerts = this.#occluded.length / FLOATS_PER_VERT
    if (occludedVerts > 0) {
      device.setDepthTest(true)
      device.drawLines(0, occludedVerts)
    }
    const overlayVerts = this.#overlay.length / FLOATS_PER_VERT
    if (overlayVerts > 0) {
      device.setDepthTest(false)
      device.drawLines(occludedVerts, overlayVerts)
    }
  }

  destroy(): void {
    this.#offRestore()
    this.#device.deleteVao(this.#vao)
    this.#device.deleteBuffer(this.#vbo)
    this.#device.deleteProgram(this.#program)
  }
}
