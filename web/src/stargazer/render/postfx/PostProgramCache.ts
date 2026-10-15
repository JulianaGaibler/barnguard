import type {
  BindGroupLayout,
  ColorFormat,
  GfxDevice,
  Pipeline,
  ShaderModule,
  VBuffer,
} from '../gfx/GfxDevice'
import type { PostPass } from './PostEffect'
import { POST_PARAMS_UBO_BINDING } from '../gfx/batchLayout'

/** Attribute location the fullscreen vertex shader forces for `a_pos`. */
const LOC_POS = 0
/** Attribute location for `a_uv`. */
const LOC_UV = 1
/** Bytes per fullscreen-triangle vertex: `vec2` position plus `vec2` uv. */
const VERTEX_STRIDE = 16
/** Sampler unit for the input texture `u_tex`. */
export const POST_U_TEX = 0

/**
 * Frames a pass's GPU resources survive after the last effect stopped listing
 * it, so an effect that cycles between pass lists does not pay a recompile each
 * time. A few seconds at 60 Hz.
 */
export const PASS_GPU_GRACE_FRAMES = 240

/** Clip-space corners of the fullscreen triangle. */
const TRI_POS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [3, -1],
  [-1, 3],
]

/**
 * The fullscreen triangle, interleaved as `[x, y, u, v]` per vertex. It covers
 * the whole `[-1,1]` viewport, with the two off-screen corners clipped. One
 * triangle rather than a quad avoids the diagonal seam that splits `dFdx/dFdy`
 * and hurts texture-cache locality.
 *
 * The uv is carried as an attribute rather than derived from the position in
 * the shader, because the backends disagree on which row of a sampled render
 * target is the top: WebGPU stores row 0 at the top, WebGL at the bottom. A
 * shader deriving `uv = pos * 0.5 + 0.5` therefore samples upside down on
 * WebGPU, which turned every odd-numbered ping-pong pass on its head and left a
 * single enabled effect rendering the whole frame flipped. Baking the flip into
 * three vertices costs nothing per draw and keeps the shaders backend-
 * agnostic.
 *
 * Exported so the orientation contract can be asserted for both backends
 * without a GPU.
 */
export function fullscreenTri(flipV: boolean): Float32Array {
  const out = new Float32Array(TRI_POS.length * 4)
  TRI_POS.forEach(([x, y], i) => {
    out[i * 4] = x
    out[i * 4 + 1] = y
    out[i * 4 + 2] = x * 0.5 + 0.5
    out[i * 4 + 3] = flipV ? 0.5 - y * 0.5 : y * 0.5 + 0.5
  })
  return out
}

/** GPU resources compiled for one {@link PostPass}. */
interface PassProgram {
  shader: ShaderModule
  layout: BindGroupLayout
  /**
   * Pipeline per target color format (a pass may run into linear or srgb
   * pools).
   */
  pipelines: Map<ColorFormat, Pipeline>
  pending: Set<ColorFormat>
  /** The `epoch` the last time a live effect listed this pass. */
  seen: number
}

/**
 * The compiled shader, bind group layout and pipelines of every {@link PostPass}
 * on one device, plus the fullscreen triangle they all draw. Shared by every
 * {@link PostChain} on the device, so a pass used by two chains compiles once.
 *
 * @remarks
 *   Engine developers: programs are keyed by pass identity and hold no per-run
 *   state, which is why they can be shared. The params uniform buffer is not
 *   here, because on WebGPU only the last `writeBuffer` before a submit counts.
 *   A buffer shared by two runs of one pass in a frame would give both draws
 *   the later run's values, so each chain owns its own.
 *
 *   Pipelines compile asynchronously. `pipeline` returns `null` until one is
 *   ready. A pass that no live effect has listed for `PASS_GPU_GRACE_FRAMES`
 *   calls to `endFrame` is freed. Owners report liveness with `noteLive` and
 *   call `endFrame` once per frame after their last draw, so a pass list
 *   swapped mid-run never frees a module still bound by a draw that frame.
 *
 *   A context restore drops every handle. `generation` counts restores so a
 *   holder of per-pass resources can tell its own are dead.
 */
export class PostProgramCache {
  readonly #device: GfxDevice
  readonly #programs = new Map<PostPass, PassProgram>()
  readonly #offRestore: () => void
  #vbo: VBuffer | null = null
  readonly #compiling = new Set<Promise<unknown>>()
  #epoch = 0
  #generation = 0

  constructor(device: GfxDevice) {
    this.#device = device
    this.#offRestore = device.onContextRestored(() => {
      // GPU handles are dead after a loss. Drop references and let the next
      // use rebuild the vertex buffer and the shaders and pipelines lazily.
      this.#vbo = null
      this.#programs.clear()
      this.#generation++
    })
  }

  /** Counts context restores. A holder of per-pass resources compares it. */
  get generation(): number {
    return this.#generation
  }

  /** The fullscreen triangle, created on first use. */
  vbo(): VBuffer {
    if (!this.#vbo) {
      const tri = fullscreenTri(this.#device.ndc.textureTopDown)
      this.#vbo = this.#device.createVertexBuffer(tri.byteLength)
      this.#device.updateBufferSubData(this.#vbo, 0, tri)
    }
    return this.#vbo
  }

  /** The bind group layout of a pass, once `pipeline` has been called for it. */
  layout(pass: PostPass): BindGroupLayout {
    return this.#programs.get(pass)!.layout
  }

  /**
   * Make sure a pass has GPU resources and return its pipeline for `cs`, or
   * `null` while that pipeline is still compiling.
   */
  pipeline(pass: PostPass, cs: ColorFormat): Pipeline | null {
    let program = this.#programs.get(pass)
    if (!program) {
      const device = this.#device
      const shader = device.createShaderModule({
        glsl: pass.shader.glsl,
        wgsl: pass.shader.wgsl,
        reflection: pass.shader.reflection,
        label: 'postfx',
      })
      const layout = device.createBindGroupLayout(
        pass.paramsBytes > 0
          ? [
              { binding: POST_U_TEX, type: 'texture-2d' },
              { binding: POST_PARAMS_UBO_BINDING, type: 'uniform-buffer' },
            ]
          : [{ binding: POST_U_TEX, type: 'texture-2d' }],
      )
      program = {
        shader,
        layout,
        pipelines: new Map(),
        pending: new Set(),
        seen: this.#epoch,
      }
      this.#programs.set(pass, program)
    }
    const existing = program.pipelines.get(cs)
    if (existing) return existing
    if (program.pending.has(cs)) return null
    program.pending.add(cs)
    const p = program
    const compile = this.#device
      .createPipeline({
        shader: p.shader,
        vertexLayout: [
          {
            arrayStride: VERTEX_STRIDE,
            stepMode: 'vertex',
            attributes: [
              { location: LOC_POS, format: 'float32x2', offset: 0 },
              { location: LOC_UV, format: 'float32x2', offset: 8 },
            ],
          },
        ],
        bindGroupLayouts: [p.layout],
        color: { format: cs, blend: 'none' },
        depth: null,
        cull: 'none',
        frontFace: 'ccw',
        primitive: 'triangle-list',
        samples: 1,
        label: 'postfx',
      })
      .then((pipeline) => {
        // A restore between the request and its completion cleared the
        // program, so the pipeline belongs to a dead context.
        if (this.#programs.get(pass) !== p) return
        p.pipelines.set(cs, pipeline)
        p.pending.delete(cs)
      })
    this.#compiling.add(compile)
    void compile
      .catch(() => undefined)
      .finally(() => this.#compiling.delete(compile))
    return null
  }

  /** Whether any pipeline is still compiling. */
  get compiling(): boolean {
    return this.#compiling.size > 0
  }

  /**
   * Resolves once every pipeline compiling now has finished, whether it
   * compiled or failed.
   */
  whenCompiled(): Promise<void> {
    return Promise.allSettled([...this.#compiling]).then(() => undefined)
  }

  /**
   * Compile the pipelines of `passes` for every color space in `colorSpaces`.
   * Idempotent, an already compiled pass is skipped.
   */
  warm(passes: Iterable<PostPass>, colorSpaces: readonly ColorFormat[]): void {
    this.vbo()
    for (const pass of passes) {
      for (const cs of colorSpaces) this.pipeline(pass, cs)
    }
  }

  /** Record that a live effect lists `pass`, which keeps it from being freed. */
  noteLive(pass: PostPass): void {
    const program = this.#programs.get(pass)
    if (program) program.seen = this.#epoch
  }

  /**
   * Free the passes no live effect has listed for `PASS_GPU_GRACE_FRAMES`. Call
   * once per frame after the frame's last draw.
   *
   * An effect that rebuilds its `passes` array (for example when a blur's level
   * count changes) orphans the old pass objects, and their shader modules would
   * otherwise leak one at a time. Freeing on the first unseen frame would
   * punish an effect that cycles between pass lists, because recompiling drops
   * the chain back to presenting an unprocessed frame. The grace period keeps a
   * recently used pass warm long enough to come back for free.
   */
  endFrame(): void {
    for (const [pass, program] of this.#programs) {
      if (this.#epoch - program.seen <= PASS_GPU_GRACE_FRAMES) continue
      this.#device.deleteShaderModule(program.shader)
      this.#programs.delete(pass)
    }
    this.#epoch++
  }

  /** Free a pass's shader module now. */
  release(pass: PostPass): void {
    const program = this.#programs.get(pass)
    if (!program) return
    this.#device.deleteShaderModule(program.shader)
    this.#programs.delete(pass)
  }

  destroy(): void {
    this.#offRestore()
    for (const program of this.#programs.values()) {
      this.#device.deleteShaderModule(program.shader)
    }
    this.#programs.clear()
    if (this.#vbo) {
      this.#device.deleteBuffer(this.#vbo)
      this.#vbo = null
    }
  }
}
