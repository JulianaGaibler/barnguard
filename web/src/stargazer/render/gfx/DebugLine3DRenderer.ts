import type {
  BindGroup,
  BindGroupLayout,
  ColorFormat,
  GfxDevice,
  Pipeline,
  ShaderModule,
  UBuffer,
  VBuffer,
  VertexBufferLayout,
} from './GfxDevice'
import type { Mat4 } from '../../math/Mat4'
import { mat4TransformPoint } from '../../math/Mat4'
import { vec3 } from '../../math/Vec3'
import { CAMERA3D_UBO_BINDING } from './batchLayout'
import type { ShaderReflection } from './GfxDevice'
import debugLineWgsl from './shaders/debugLine.wgsl?raw'
import debugLineVertSrc from './shaders/debugLine.gen.vert.glsl?raw'
import debugLineFragSrc from './shaders/debugLine.gen.frag.glsl?raw'
import debugLineReflect from './shaders/debugLine.reflect.json'

/** RGBA in `0..1` for a debug line. */
export type LineColor = readonly [number, number, number, number]

// 7 floats per vertex: position xyz + color rgba.
const FLOATS_PER_VERT = 7
const LOC_POSITION = 0
const LOC_COLOR = 1

/**
 * Accumulates world-space line segments for the 3D debug pass and draws them
 * through the {@link GfxDevice} seam as line primitives, projected by the active
 * 3D camera. `Stage` owns one instance and drives it each frame while a 3D
 * debug overlay is on: `begin()`, push gizmos, then `flush(viewProj)`.
 *
 * Two groups: **occluded** lines depth-test against the scene; **overlay**
 * lines ignore depth. Each maps to a `line-list` pipeline variant differing
 * only in depth-test; neither writes depth, so gizmos never corrupt the mesh
 * buffer.
 */
export class DebugLine3DRenderer {
  readonly #device: GfxDevice
  readonly #targetColor: { format: ColorFormat; samples: number }
  #shader!: ShaderModule
  #occludedPipeline!: Pipeline
  #overlayPipeline!: Pipeline
  #vertexLayout!: VertexBufferLayout[]
  #camLayout!: BindGroupLayout
  #camUbo!: UBuffer
  #camBindGroup!: BindGroup
  #vbo!: VBuffer
  #capacityVerts: number
  #scratch: Float32Array
  #ready = false
  readonly #offRestore: () => void

  // Interleaved vertex data for the current frame, split by depth behavior.
  #occluded: number[] = []
  #overlay: number[] = []

  constructor(
    device: GfxDevice,
    targetColor: { format: ColorFormat; samples: number },
    initialVerts = 4096,
  ) {
    this.#device = device
    this.#targetColor = targetColor
    this.#capacityVerts = initialVerts
    this.#scratch = new Float32Array(initialVerts * FLOATS_PER_VERT)
    this.#createResources()
    this.#offRestore = device.onContextRestored(() => this.#createResources())
  }

  /** Whether the pipelines are warm; `flush` no-ops until then. */
  get ready(): boolean {
    return this.#ready
  }

  #createResources(): void {
    const device = this.#device
    this.#shader = device.createShaderModule({
      glsl: { vertex: debugLineVertSrc, fragment: debugLineFragSrc },
      wgsl: {
        code: debugLineWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: debugLineReflect as ShaderReflection,
      label: 'debugLine',
    })
    this.#vbo = device.createVertexBuffer(this.#scratch.byteLength)
    this.#vertexLayout = [
      {
        arrayStride: FLOATS_PER_VERT * 4,
        stepMode: 'vertex',
        attributes: [
          { location: LOC_POSITION, format: 'float32x3', offset: 0 },
          { location: LOC_COLOR, format: 'float32x4', offset: 12 },
        ],
      },
    ]
    this.#camLayout = device.createBindGroupLayout([
      { binding: CAMERA3D_UBO_BINDING, type: 'uniform-buffer' },
    ])
    this.#camUbo = device.createUniformBuffer(64) // mat4
    this.#camBindGroup = device.createBindGroup(this.#camLayout, [
      {
        binding: CAMERA3D_UBO_BINDING,
        resource: { uniformBuffer: this.#camUbo },
      },
    ])
    void this.#warmup()
  }

  async #warmup(): Promise<void> {
    this.#ready = false
    const base = {
      shader: this.#shader,
      vertexLayout: this.#vertexLayout,
      bindGroupLayouts: [this.#camLayout],
      color: {
        format: this.#targetColor.format,
        blend: 'source-over' as const,
      },
      cull: 'none' as const,
      frontFace: this.#device.ndc.frontFace,
      primitive: 'line-list' as const,
      samples: this.#targetColor.samples,
    }
    this.#occludedPipeline = await this.#device.createPipeline({
      ...base,
      depth: { test: true, write: false },
    })
    this.#overlayPipeline = await this.#device.createPipeline({
      ...base,
      depth: { test: false, write: false },
    })
    this.#ready = true
  }

  /** Clear both groups for a new frame. */
  begin(): void {
    this.#occluded.length = 0
    this.#overlay.length = 0
  }

  // --- push helpers ----------------------------------------------------------

  /** A world-space segment. `overlay` draws it through geometry (no depth test). */
  line(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    color: LineColor,
    overlay = false,
  ): void {
    const buf = overlay ? this.#overlay : this.#occluded
    const [r, g, b, a] = color
    buf.push(ax, ay, az, r, g, b, a, bx, by, bz, r, g, b, a)
  }

  /** Axis-aligned box wireframe (12 edges) spanning `min`→`max`. */
  box(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    color: LineColor,
    overlay = false,
  ): void {
    const c = color
    const L = (
      x0: number,
      y0: number,
      z0: number,
      x1: number,
      y1: number,
      z1: number,
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
  axes(
    ox: number,
    oy: number,
    oz: number,
    size: number,
    overlay = false,
  ): void {
    this.line(ox, oy, oz, ox + size, oy, oz, [1, 0.25, 0.25, 1], overlay)
    this.line(ox, oy, oz, ox, oy + size, oz, [0.3, 1, 0.35, 1], overlay)
    this.line(ox, oy, oz, ox, oy, oz + size, [0.35, 0.55, 1, 1], overlay)
  }

  /**
   * XZ ground grid centered at the origin: `divisions` cells each `step` wide,
   * with the two center axis lines accented.
   */
  grid(
    step: number,
    divisions: number,
    color: LineColor,
    axisColor: LineColor,
  ): void {
    const half = (step * divisions) / 2
    for (let i = 0; i <= divisions; i++) {
      const p = -half + i * step
      const isAxis = Math.abs(p) < step * 0.001
      const c = isAxis ? axisColor : color
      this.line(p, 0, -half, p, 0, half, c)
      this.line(-half, 0, p, half, 0, p, c)
    }
  }

  /**
   * Frustum wireframe from an inverse view-projection: unproject the 8 NDC
   * corners.
   */
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
        corners[a][0],
        corners[a][1],
        corners[a][2],
        corners[b][0],
        corners[b][1],
        corners[b][2],
        color,
        true,
      )
    edge(0, 1)
    edge(1, 3)
    edge(3, 2)
    edge(2, 0) // near
    edge(4, 5)
    edge(5, 7)
    edge(7, 6)
    edge(6, 4) // far
    edge(0, 4)
    edge(1, 5)
    edge(2, 6)
    edge(3, 7) // connectors
  }

  /**
   * A ray from `origin` along `dir` for `length` units (overlay, always
   * visible).
   */
  ray(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    length: number,
    color: LineColor,
  ): void {
    this.line(
      ox,
      oy,
      oz,
      ox + dx * length,
      oy + dy * length,
      oz + dz * length,
      color,
      true,
    )
  }

  /** Upload the frame's segments and draw them, projected by `viewProj`. */
  flush(viewProj: Mat4): void {
    if (!this.#ready) return
    const total = this.#occluded.length + this.#overlay.length
    if (total === 0) return
    const device = this.#device
    const vertsNeeded = total / FLOATS_PER_VERT

    if (vertsNeeded > this.#capacityVerts) {
      this.#capacityVerts = Math.ceil(vertsNeeded * 1.5)
      this.#scratch = new Float32Array(this.#capacityVerts * FLOATS_PER_VERT)
      device.deleteBuffer(this.#vbo)
      this.#vbo = device.createVertexBuffer(this.#scratch.byteLength)
    }

    // Pack occluded first, then overlay, into the single buffer.
    const scratch = this.#scratch
    scratch.set(this.#occluded, 0)
    scratch.set(this.#overlay, this.#occluded.length)
    device.updateBufferSubData(this.#vbo, 0, scratch, 0, total * 4)
    device.updateUniformBuffer(
      this.#camUbo,
      viewProj as unknown as Float32Array,
    )

    const bindGroups = [{ group: 0, bindGroup: this.#camBindGroup }]
    const occludedVerts = this.#occluded.length / FLOATS_PER_VERT
    if (occludedVerts > 0) {
      device.draw({
        pipeline: this.#occludedPipeline,
        vertexBuffers: [{ buffer: this.#vbo, offset: 0 }],
        bindGroups,
        vertexCount: occludedVerts,
        first: 0,
      })
    }
    const overlayVerts = this.#overlay.length / FLOATS_PER_VERT
    if (overlayVerts > 0) {
      device.draw({
        pipeline: this.#overlayPipeline,
        vertexBuffers: [{ buffer: this.#vbo, offset: 0 }],
        bindGroups,
        vertexCount: overlayVerts,
        first: occludedVerts,
      })
    }
  }

  destroy(): void {
    this.#offRestore()
    this.#device.deleteBuffer(this.#vbo)
    this.#device.deleteUniformBuffer(this.#camUbo)
    this.#device.deleteBindGroup(this.#camBindGroup)
    this.#device.deleteShaderModule(this.#shader)
  }
}
