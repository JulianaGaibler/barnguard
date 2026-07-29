// Shared batch state every GPU draw program reads or writes: the device
// handle, the transform/state stacks, the texture manager, the shared per-frame
// bind group, and which batch is currently open. Centralizing it here means a
// program module never needs a back-reference to `GpuGfx` itself.

import type {
  BindGroup,
  BindGroupLayout,
  ColorFormat,
  DrawBindGroup,
  GfxDevice,
  UBuffer,
} from './GfxDevice'
import type { GpuGeometry } from './GeometryHandle'
import type { GfxBlend } from './Gfx2D'
import type { BitmapMask } from '../../assets/BitmapMask'
import type { TextureManager } from './TextureManager'
import {
  FRAME_UBO_BINDING,
  FRAME_UBO_FLOATS,
  GROUP_FRAME,
  type BatchKind,
} from './batchLayout'
import { TransformStack, type TransformOut } from './TransformStack'
import { StateStack } from './StateStack'
import type { GpuProgram } from './GpuProgram'
import type { RingStream } from './RingStream'

/**
 * Debug render overlays. Only `coloredTri` draws are affected, strokes, SDF,
 * and gradients render normally in every mode.
 *
 * - `'normal'`. Shipping look.
 * - `'polygons'`. Cyan outlines around every fill's outer polygon.
 * - `'overdraw'`. Constant dim red under `lighter` blend. Hot regions accumulate.
 * - `'batch-color'`. Each coloredTri flush picks a distinct hue.
 * - `'clip-mask'`. End-of-frame overlay of the inspected `BitmapMask`.
 *
 * @category Debug
 */
export type DebugRenderMode =
  'normal' | 'polygons' | 'overdraw' | 'batch-color' | 'clip-mask'

/**
 * One recorded draw call: a program's contiguous sub-range of its ring buffer
 * plus the device state captured while that batch was open. During the frame,
 * batch changes push `DrawRun`s onto a command list instead of drawing; at
 * frame end each stream uploads once and the list replays in order, so painter
 * order holds. `blend` selects the program's matching pipeline variant.
 *
 * @category Debug
 */
export interface DrawRun {
  kind: BatchKind
  /** Word offsets into the program's ring buffer: `[startWord, endWord)`. */
  startWord: number
  endWord: number
  blend: GfxBlend
  clipMask: BitmapMask | null
  texture: import('./GfxDevice').Texture | null
  lut: import('./GfxDevice').Texture | null
  debugMode: DebugRenderMode
  /** Monotonic index for the `'batch-color'` hue, fixed at record time. */
  debugBatchIndex: number
  /**
   * Retained-geometry draw: when set, this run draws pre-uploaded GPU geometry
   * with an indexed draw instead of a streamed range, so `startWord`/`endWord`
   * are unused. `model` is the captured world matrix (2D affine as a
   * column-major mat3, 9 floats); `colorRgba` is premultiplied 0..1.
   */
  geometry?: GpuGeometry
  model?: Float32Array
  colorRgba?: readonly [number, number, number, number]
}

/** Per-frame stats surfaced to the debug HUD. */
export interface GpuGfxStats {
  drawCalls: number
  programSwitches: number
  textureBinds: number
  blendSwitches: number
  overflowWarns: number
  sdfInstances: number
  strokeInstances: number
  roundRectInstances: number
  msaaSamples: number
}

/** Batch key fields a program's flush needs to bind before drawing. */
export interface BatchKey {
  texture?: import('./GfxDevice').Texture | null
  lut?: import('./GfxDevice').Texture | null
  clipMask?: BitmapMask | null
}

export class GpuBatchContext {
  device: GfxDevice
  readonly stats: GpuGfxStats

  /**
   * Color format + sample count of the target the 2D pipelines render into.
   * `GpuGfx` sets this before warming pipelines and on MSAA/format change; a
   * program reads it in `warmup` to build matching pipeline variants.
   */
  targetColor: { format: ColorFormat; samples: number } = {
    format: 'linear',
    samples: 1,
  }

  /** Column-major 3×3 for `u_proj`. Updated once per frame. */
  readonly projMat = new Float32Array(9)

  #frameUbo: UBuffer | null = null
  #frameLayout: BindGroupLayout | null = null
  #frameBindGroup: BindGroup | null = null
  /**
   * Std140 staging for the `Frame` block: the `mat3` is 3 vec4-aligned columns
   * (12 floats), so `projMat`'s 3 columns are copied with a padding float after
   * each.
   */
  readonly #frameStaging = new Float32Array(FRAME_UBO_FLOATS)

  readonly txStack = new TransformStack(32)
  readonly stateStack = new StateStack(32)
  readonly txOut: TransformOut = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

  textureManager!: TextureManager

  /** Unit-quad template shared by every instanced program. */
  unitQuadBuffer!: import('./GfxDevice').VBuffer

  /**
   * 1×1 opaque-white texture, bound to a sampler slot a shader declares but
   * does not sample this draw (a `shape` instance with no atlas, a `coloredTri`
   * run with no clip mask) — a bind group must still supply every texture its
   * layout declares.
   */
  placeholderTexture!: import('./GfxDevice').Texture

  curSlot = 0

  curDebugMode: DebugRenderMode = 'normal'
  debugBatchCounter = 0

  // Current batch. A change to any of these forces a flush.
  curBatch: BatchKind = 'none'
  curTexture: import('./GfxDevice').Texture | null = null
  curLut: import('./GfxDevice').Texture | null = null
  curBlend: GfxBlend = 'source-over'
  curClipMask: BitmapMask | null = null

  readonly #programs = new Map<BatchKind, GpuProgram>()

  readonly #drawRuns: DrawRun[] = []

  constructor(device: GfxDevice, stats: GpuGfxStats) {
    this.device = device
    this.stats = stats
  }

  registerProgram(program: GpuProgram): void {
    this.#programs.set(program.kind, program)
  }

  /**
   * Create the shared `Frame` UBO, its bind-group layout, and the bind group.
   * Called from `GpuGfx` on device create and on context restore.
   */
  initFrameUbo(): void {
    this.#frameUbo = this.device.createUniformBuffer(FRAME_UBO_FLOATS * 4)
    this.#frameLayout = this.device.createBindGroupLayout([
      { binding: FRAME_UBO_BINDING, type: 'uniform-buffer' },
    ])
    this.#frameBindGroup = this.device.createBindGroup(this.#frameLayout, [
      {
        binding: FRAME_UBO_BINDING,
        resource: { uniformBuffer: this.#frameUbo },
      },
    ])
  }

  /**
   * The shared `Frame` bind-group layout, referenced as group 0 by every 2D
   * pipeline.
   */
  get frameBindGroupLayout(): BindGroupLayout {
    if (!this.#frameLayout)
      throw new Error('GpuBatchContext: frame UBO not initialized')
    return this.#frameLayout
  }

  /** The group-0 bind-group entry every 2D draw attaches. */
  frameBindGroupEntry(): DrawBindGroup {
    if (!this.#frameBindGroup)
      throw new Error('GpuBatchContext: frame UBO not initialized')
    return { group: GROUP_FRAME, bindGroup: this.#frameBindGroup }
  }

  #uploadFrameUbo(): void {
    if (!this.#frameUbo) return
    const p = this.projMat
    const s = this.#frameStaging
    // Column 0, 1, 2 each padded to a vec4 (std140 mat3 column alignment).
    s[0] = p[0]
    s[1] = p[1]
    s[2] = p[2]
    s[4] = p[3]
    s[5] = p[4]
    s[6] = p[5]
    s[8] = p[6]
    s[9] = p[7]
    s[10] = p[8]
    this.device.updateUniformBuffer(this.#frameUbo, s)
  }

  /**
   * Flush-on-state-change guard. `key` carries only the fields this batch's
   * identity depends on.
   */
  beginBatch(kind: BatchKind, key: BatchKey = {}): void {
    const wantBlend = this.stateStack.getBlend()
    const sameBatch = this.curBatch === kind
    const sameBlend = this.curBlend === wantBlend
    const sameTexture = !('texture' in key) || this.curTexture === key.texture
    const sameLut = !('lut' in key) || this.curLut === key.lut
    const sameMask = !('clipMask' in key) || this.curClipMask === key.clipMask
    if (sameBatch && sameBlend && sameTexture && sameLut && sameMask) return
    this.#recordActiveRun()
    this.curBatch = kind
    this.curBlend = wantBlend
    if ('texture' in key) this.curTexture = key.texture ?? null
    if ('lut' in key) this.curLut = key.lut ?? null
    if ('clipMask' in key) this.curClipMask = key.clipMask ?? null
  }

  /** Record the active batch's pending range as a `DrawRun` (nothing draws). */
  flushActive(): void {
    this.#recordActiveRun()
  }

  /**
   * Record a retained-geometry draw into the command list, preserving painter
   * order across streamed + retained draws.
   */
  recordRetained(
    geometry: GpuGeometry,
    model: Float32Array,
    colorRgba: readonly [number, number, number, number],
  ): void {
    this.#recordActiveRun()
    this.#drawRuns.push({
      kind: 'coloredTri',
      startWord: 0,
      endWord: 0,
      blend: this.stateStack.getBlend(),
      clipMask: null,
      texture: null,
      lut: null,
      debugMode: this.curDebugMode,
      debugBatchIndex: this.debugBatchCounter++,
      geometry,
      model,
      colorRgba,
    })
  }

  #recordActiveRun(): void {
    if (this.curBatch === 'none') return
    const program = this.#programs.get(this.curBatch)
    const range = program?.stream.takeRun(this.curSlot)
    if (range) {
      this.#drawRuns.push({
        kind: this.curBatch,
        startWord: range.startWord,
        endWord: range.endWord,
        blend: this.curBlend,
        clipMask: this.curClipMask,
        texture: this.curTexture,
        lut: this.curLut,
        debugMode: this.curDebugMode,
        debugBatchIndex: this.debugBatchCounter++,
      })
    }
    this.curBatch = 'none'
  }

  /**
   * Frame end: record the last pending run, upload the Frame UBO + each stream
   * once, then replay the command list in painter order (inside the open render
   * pass). The only place mid-frame-recorded draws reach the GPU.
   */
  submitFrame(): void {
    this.#recordActiveRun()
    this.#uploadFrameUbo()
    for (const program of this.#programs.values()) {
      program.stream.upload(this.device, this.curSlot)
    }
    // The frame starts at source-over, so only a run whose blend differs from
    // the running value is a real switch (a new blend-variant pipeline bind).
    let prevBlend: GfxBlend = 'source-over'
    let blendSwitches = 0
    for (const run of this.#drawRuns) {
      if (run.blend !== prevBlend) {
        blendSwitches++
        prevBlend = run.blend
      }
      this.#programs.get(run.kind)?.drawRun(this, run)
    }
    this.stats.blendSwitches = blendSwitches
    this.#drawRuns.length = 0
  }

  /**
   * Reserve `words`/`verts` for a vertex batch. On overflow, submit everything
   * pending mid-frame, orphan the buffers, and retry once. Returns the word
   * offset or `-1` if a single record can't fit.
   */
  reserveVerts(stream: RingStream, words: number, verts: number): number {
    let off = stream.reserve(this.curSlot, words, verts)
    if (off < 0) {
      this.#overflowSubmit()
      off = stream.reserve(this.curSlot, words, verts)
    }
    return off
  }

  /** Instanced counterpart to {@link GpuBatchContext.reserveVerts}. */
  reserveInstance(stream: RingStream): number {
    let off = stream.reserveInstance(this.curSlot)
    if (off < 0) {
      this.#overflowSubmit()
      off = stream.reserveInstance(this.curSlot)
    }
    return off
  }

  /**
   * Buffer full mid-frame: record the active run, submit + replay everything
   * pending into the open pass, then orphan every stream's GPU buffer and
   * restart its cursor. The active batch's marker + state are preserved so the
   * interrupted emit resumes.
   */
  #overflowSubmit(): void {
    const batch = this.curBatch
    const blend = this.curBlend
    const texture = this.curTexture
    const lut = this.curLut
    const clipMask = this.curClipMask
    this.submitFrame()
    for (const program of this.#programs.values()) {
      this.device.orphanBuffer(program.stream.buffers[this.curSlot])
      program.stream.resetAfterSubmit(this.curSlot)
    }
    this.curBatch = batch
    this.curBlend = blend
    this.curTexture = texture
    this.curLut = lut
    this.curClipMask = clipMask
  }

  /** Called once per frame, after the ring slot has advanced. */
  resetSlot(slot: number): void {
    for (const program of this.#programs.values()) {
      program.stream.reset(slot)
      program.resetFrame?.()
    }
  }

  /** Called once per frame, alongside `resetSlot`. */
  resetBatchMarkers(): void {
    this.curBatch = 'none'
    this.curTexture = null
    this.curLut = null
    this.curClipMask = null
    this.debugBatchCounter = 0
    this.#drawRuns.length = 0
  }
}
