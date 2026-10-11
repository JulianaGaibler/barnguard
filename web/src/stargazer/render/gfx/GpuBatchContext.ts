// Shared batch state every GPU draw program reads or writes: the device
// handle, the transform/state stacks, the texture manager, the shared per-frame
// bind group, and which batch is currently open. Centralizing it here means a
// program module never needs a back-reference to `GpuGfx` itself.

import type {
  BindGroup,
  BindGroupLayout,
  DrawBindGroup,
  GfxDevice,
  TargetFormat,
  Texture,
  UBuffer,
} from './GfxDevice'
import { hasStencilAspect } from './depthStencil'
import type { GpuGeometry } from './GeometryHandle'
import type { GfxBlend } from './Gfx2D'
import type { BitmapMask } from '../../assets/BitmapMask'
import type { TextureManager } from './TextureManager'
import type { VectorQuality } from '../VectorQuality'
import {
  CLIP_UBO_BINDING,
  CLIP_UBO_BYTES,
  FRAME_UBO_BINDING,
  FRAME_UBO_FLOATS,
  GROUP_FRAME,
  type BatchKind,
} from './batchLayout'
import { TransformStack, type TransformOut } from './TransformStack'
import { StateStack, type ResolvedClip } from './StateStack'
import { UboRing } from './programs/programCommon'
import type { GpuProgram } from './GpuProgram'
import type { RingStream } from './RingStream'

/**
 * Debug render overlays. `coloredTri` and `shape` draws are affected
 * (fills, strokes, circles, round-rects, analytic shadows, text, sprites);
 * the segment stroker, gradient-radial, masked-gradient, text-quad, and
 * path-shadow composite programs render normally in every mode.
 *
 * - `'normal'`. Shipping look.
 * - `'polygons'`. Cyan outlines around every fill's outer polygon.
 * - `'overdraw'`. Constant dim red under `lighter` blend. Hot regions accumulate.
 * - `'batch-color'`. Each flush picks a distinct hue.
 * - `'clip-mask'`. End-of-frame overlay of the inspected `BitmapMask`.
 */
export type DebugRenderMode =
  'normal' | 'polygons' | 'overdraw' | 'batch-color' | 'clip-mask'

/**
 * One recorded draw call: a program's contiguous sub-range of its ring buffer
 * plus the device state captured while that batch was open. During the frame,
 * batch changes push `DrawRun`s onto a command list instead of drawing. At
 * frame end each stream uploads once and the list replays in order, so painter
 * order holds. `blend` selects the program's matching pipeline variant.
 */
export interface DrawRun {
  kind: BatchKind
  /** Word offsets into the program's ring buffer: `[startWord, endWord)`. */
  startWord: number
  endWord: number
  blend: GfxBlend
  clipMask: BitmapMask | null
  clip: ResolvedClip | null
  texture: import('./GfxDevice').Texture | null
  lut: import('./GfxDevice').Texture | null
  paint: ResolvedRunPaint | null
  debugMode: DebugRenderMode
  /** Monotonic index for the `'batch-color'` hue, fixed at record time. */
  debugBatchIndex: number
  /**
   * Retained-geometry draw: when set, this run draws pre-uploaded GPU geometry
   * with an indexed draw instead of a streamed range, so `startWord`/`endWord`
   * are unused. `model` is the captured world matrix (2D affine as a
   * column-major mat3, 9 floats). `colorRgba` is premultiplied 0..1.
   */
  geometry?: GpuGeometry
  model?: Float32Array
  colorRgba?: readonly [number, number, number, number]
  /**
   * Which pass of a deduplicated stroke this run is, over one shared instance
   * range. `'core'` paints only near-full-coverage fragments, so a joint's
   * solid body claims its pixels before any neighbour's antialiased rim can.
   * `'fringe'` then fills what is left, and `'reset'` zeroes the stencil again
   * with color writes off. Absent on an ordinary stroke.
   */
  strokePass?: 'core' | 'fringe' | 'reset'
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
  /** Analytic drop-shadow instances (`SHAPE_KIND_SHADOW`), this frame. */
  shadowInstances: number
  msaaSamples: number
  // The remaining fields are cumulative since startup, not per-frame: each
  // backs a cache whose activity is bursty (a bake, a tessellation, a ramp
  // write), so a one-frame window reads mostly zero. A polling debug panel
  // still shows a burst between two samples, the same reasoning
  // `TextureManager`'s `labelEvictions` etc. use.
  /** `strokeOutline` tessellations built (not served from cache). */
  outlineTessellations: number
  /** `strokeOutline` cache hits. */
  outlineCacheHits: number
  /** Gradient ramp-atlas rows actually (re)painted (an LRU touch doesn't count). */
  rampRowsWritten: number
  /** Path-shadow masks successfully baked. */
  maskBakes: number
  /** Total tap-work (§7.6) spent on path-shadow bakes. */
  maskBakeWork: number
  /** Bytes currently held by live path-shadow mask entries. */
  maskBytes: number
  /** Path-shadow bake scratch-target pool: reused-target hits. */
  poolHits: number
  /** Path-shadow bake scratch-target pool: new-target allocations. */
  poolMisses: number
}

/**
 * `coloredTri`'s resolved per-run gradient paint: a device-space axis
 * projection (see `strokeOutline`'s WebRender-derived note in `coloredTri.ts`)
 * plus the atlas row and the draw's own alpha (the ramp can't bake a per-draw
 * alpha, since a row is shared by content, not by caller). Compared by value,
 * not by reference: two draws resolving to the same five numbers may share a
 * run, and any difference, including two distinct gradients back to back,
 * forces a break so each gets its own `DrawParams`.
 */
export interface ResolvedGradientPaint {
  kind: 'gradient'
  scaleDirX: number
  scaleDirY: number
  startOffset: number
  rampRow: number
  opacity: number
}

/**
 * `coloredTri`'s resolved per-run inset-shadow mask paint: the device-space
 * rect→uv projection for the cached mask (same "project a device position"
 * shape the gradient axis uses) plus the mask texture itself. A run's mask
 * texture also joins the batch key like a gradient's ramp row does, so two
 * different inset shadows drawn back to back each get their own
 * `DrawParams` slice and their own bound texture.
 */
export interface ResolvedMaskPaint {
  kind: 'mask'
  originX: number
  originY: number
  invW: number
  invH: number
  maskTex: Texture
}

export type ResolvedRunPaint = ResolvedGradientPaint | ResolvedMaskPaint

function paintEquals(
  a: ResolvedRunPaint | null,
  b: ResolvedRunPaint | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'gradient') {
    const bb = b as ResolvedGradientPaint
    return (
      a.scaleDirX === bb.scaleDirX &&
      a.scaleDirY === bb.scaleDirY &&
      a.startOffset === bb.startOffset &&
      a.rampRow === bb.rampRow &&
      a.opacity === bb.opacity
    )
  }
  const bb = b as ResolvedMaskPaint
  return (
    a.originX === bb.originX &&
    a.originY === bb.originY &&
    a.invW === bb.invW &&
    a.invH === bb.invH &&
    a.maskTex === bb.maskTex
  )
}

/** Batch key fields a program's flush needs to bind before drawing. */
export interface BatchKey {
  texture?: import('./GfxDevice').Texture | null
  lut?: import('./GfxDevice').Texture | null
  clipMask?: BitmapMask | null
  paint?: ResolvedRunPaint | null
}

export class GpuBatchContext {
  device: GfxDevice
  readonly stats: GpuGfxStats

  /**
   * The attachment signature the 2D pipelines render into. `GpuGfx` sets this
   * before warming pipelines and whenever the target changes. A program reads
   * it in `warmup` to build matching pipeline variants.
   */
  targetFormat: TargetFormat = {
    format: 'linear',
    samples: 1,
    depthStencil: 'none',
  }

  /**
   * Whether the target carries stencil bits. A program reads it in `warmup` to
   * decide whether to build its stencil pipeline variants, and the stroke path
   * reads it to decide whether deduplication is available at all.
   */
  get targetHasStencil(): boolean {
    return hasStencilAspect(this.targetFormat.depthStencil)
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
  /** Per-run analytic clip params, bound through the frame group at binding 8. */
  #clipRing: UboRing | null = null
  readonly #clipStaging = new Float32Array(8)

  readonly txStack = new TransformStack(32)
  readonly stateStack = new StateStack(32)
  readonly txOut: TransformOut = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

  textureManager!: TextureManager
  vectorQuality!: VectorQuality

  /** Unit-quad template shared by every instanced program. */
  unitQuadBuffer!: import('./GfxDevice').VBuffer

  /**
   * 1×1 opaque-white texture, bound to a sampler slot a shader declares but
   * does not sample this draw (a `shape` instance with no atlas, a `coloredTri`
   * run with no clip mask). A bind group must still supply every texture its
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
  curPaint: ResolvedRunPaint | null = null
  curBlend: GfxBlend = 'source-over'
  curClipMask: BitmapMask | null = null
  curClip: ResolvedClip | null = null

  readonly #programs = new Map<BatchKind, GpuProgram>()

  readonly #drawRuns: DrawRun[] = []
  /** Index into `#drawRuns` where the open stencil group began, or -1. */
  #stencilGroupStart = -1

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
    this.#clipRing = new UboRing(this.device, CLIP_UBO_BYTES, 2048, 'clip')
    // Group 0 carries the per-frame Frame block plus a per-run dynamic clip UBO,
    // so every 2D pipeline reaches the analytic clip through the shared group it
    // already binds. No per-program material-layout change is required.
    this.#frameLayout = this.device.createBindGroupLayout([
      { binding: FRAME_UBO_BINDING, type: 'uniform-buffer' },
      {
        binding: CLIP_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    this.#frameBindGroup = this.device.createBindGroup(this.#frameLayout, [
      {
        binding: FRAME_UBO_BINDING,
        resource: { uniformBuffer: this.#frameUbo },
      },
      {
        binding: CLIP_UBO_BINDING,
        resource: {
          uniformBuffer: this.#clipRing.buffer,
          size: CLIP_UBO_BYTES,
        },
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
  frameBindGroupEntry(clipOffset = 0): DrawBindGroup {
    if (!this.#frameBindGroup)
      throw new Error('GpuBatchContext: frame UBO not initialized')
    return {
      group: GROUP_FRAME,
      bindGroup: this.#frameBindGroup,
      dynamicOffsets: [clipOffset],
    }
  }

  /**
   * Reset the clip ring and reserve slot 0 as the "no clip" slice. Once per
   * submit.
   */
  resetClipRing(): void {
    const ring = this.#clipRing
    if (!ring) return
    ring.reset()
    this.#clipStaging.fill(0) // kind 0 → clipCoverage returns 1
    ring.push(this.device, this.#clipStaging) // offset 0 = no clip
  }

  /**
   * Dynamic offset of a run's clip slice: 0 (the no-clip slot) or a freshly
   * pushed slice. On ring overflow it returns 0, so the run draws unclipped
   * rather than being dropped.
   */
  clipOffsetForRun(run: DrawRun): number {
    const ring = this.#clipRing
    const clip = run.clip
    if (!ring || !clip) return 0
    const s = this.#clipStaging
    s[0] = clip.kind
    s[1] = clip.cx
    s[2] = clip.cy
    s[3] = clip.r
    s[4] = clip.halfW
    s[5] = clip.halfH
    s[6] = clip.rrRadius
    s[7] = 0
    const off = ring.push(this.device, s)
    return off < 0 ? 0 : off
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
    // targetH + fragYFlip follow the mat3 (offsets 48/52 B). Height comes from
    // the projection itself (p[4] = -2/h), so it always matches the pass the
    // fragment renders into (main or offscreen). WebGL2's gl_FragCoord.y is
    // bottom-up, so the clip's device-px Y must flip there. WebGPU's is top-down.
    s[12] = p[4] !== 0 ? -2 / p[4] : 0
    s[13] = this.device.backend === 'webgl2' ? 1 : 0
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
    // Compared by value: the atlas texture never changes between a solid fill
    // and a gradient fill (or between two different gradients), but the
    // per-run paint `coloredTri` draws through `DrawParams` does, and two
    // draws merged into one run would share a single `DrawParams` slice.
    const samePaint = !('paint' in key) || paintEquals(this.curPaint, key.paint ?? null)
    // Clip is global like blend, pulled from the state stack, so every program
    // breaks its batch when the analytic clip changes.
    const wantClip = this.stateStack.getClip()
    const sameClip = this.curClip === wantClip
    if (
      sameBatch &&
      sameBlend &&
      sameTexture &&
      sameLut &&
      sameMask &&
      samePaint &&
      sameClip
    )
      return
    this.#recordActiveRun()
    this.curBatch = kind
    this.curBlend = wantBlend
    this.curClip = wantClip
    if ('texture' in key) this.curTexture = key.texture ?? null
    if ('lut' in key) this.curLut = key.lut ?? null
    if ('clipMask' in key) this.curClipMask = key.clipMask ?? null
    if ('paint' in key) this.curPaint = key.paint ?? null
  }

  /** Record the active batch's pending range as a `DrawRun` (nothing draws). */
  flushActive(): void {
    this.#recordActiveRun()
  }

  /**
   * Record a retained-geometry draw into the command list, preserving painter
   * order across streamed + retained draws.
   */
  /**
   * Open a deduplicated stroke. Every run recorded until
   * {@link GpuBatchContext.endStencilGroup} is replayed a second time to clear
   * the stencil bits it set.
   *
   * Scoped to one stroke on purpose: two separate translucent strokes that
   * cross must still blend where they cross, and only self-overlap within a
   * single stroke is removed.
   */
  beginStencilGroup(): void {
    this.#recordActiveRun()
    this.#stencilGroupStart = this.#drawRuns.length
  }

  /** Close the group opened by {@link GpuBatchContext.beginStencilGroup}. */
  endStencilGroup(): void {
    const start = this.#stencilGroupStart
    if (start < 0) return
    this.#stencilGroupStart = -1
    this.#recordActiveRun()
    this.#sealStencilGroup(start)
  }

  /**
   * Turn `[start, end)` into the core pass and append the fringe and reset
   * passes after it. All three point at the same buffer range, so the extra
   * passes cost no upload and no extra instance data.
   */
  #sealStencilGroup(start: number): void {
    const end = this.#drawRuns.length
    for (let i = start; i < end; i++) {
      this.#drawRuns[i].strokePass = 'core'
    }
    for (const pass of ['fringe', 'reset'] as const) {
      for (let i = start; i < end; i++) {
        this.#drawRuns.push({ ...this.#drawRuns[i], strokePass: pass })
      }
    }
  }

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
      clip: null,
      texture: null,
      lut: null,
      paint: null,
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
        clip: this.curClip,
        texture: this.curTexture,
        lut: this.curLut,
        paint: this.curPaint,
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
    this.resetClipRing()
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
    // Every run queued before this call has now been replayed, so a texture
    // evicted earlier this frame (or an earlier overflow submit within it) is
    // safe to reuse now. This runs on every `submitFrame` call, not only the
    // frame's final one: `#overflowSubmit` calls this mid-frame too, and a row
    // pinned there must not wait for the frame's true end to be recyclable.
    this.textureManager.flushRampRowPins()
    // Indices into the list are meaningless once it is emptied.
    this.#stencilGroupStart = -1
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
   * Force everything recorded so far this frame to submit and replay now,
   * mid-frame, rather than waiting for the frame's own end. The active
   * batch's state survives the call, so the interrupted emit resumes as if
   * nothing happened. Reaches for this only when something needs the replay
   * to have already happened, such as `TextureManager.ensureStopsRow`
   * recycling a ramp-atlas row while every row is pinned.
   */
  forceMidFrameSubmit(): void {
    this.#overflowSubmit()
  }

  /**
   * Buffer full mid-frame: record the active run, submit + replay everything
   * pending into the open pass, then orphan every stream's GPU buffer and
   * restart its cursor. The active batch's marker + state are preserved so the
   * interrupted emit resumes.
   */
  #overflowSubmit(): void {
    // A mid-stroke overflow would replay the group's draw runs and then wipe
    // the command list, so the reset runs that were still to come would never
    // be recorded. The stencil would stay set over those pixels for the rest of
    // the frame and silently reject every later stroke touching them. Sealing
    // here splits the stroke into two self-contained groups instead.
    //
    // The cost is one bead: the first segment after the split overlaps the last
    // one before it, and the earlier half has already zeroed its bits, so that
    // single joint double-blends. Overflow mid-stroke is rare enough to accept
    // it. If a lone dark spot on a translucent stroke is ever reported, this is
    // where it comes from.
    const stencilGroup = this.#stencilGroupStart
    if (stencilGroup >= 0) {
      this.#recordActiveRun()
      this.#sealStencilGroup(stencilGroup)
    }
    const batch = this.curBatch
    const blend = this.curBlend
    const texture = this.curTexture
    const lut = this.curLut
    const paint = this.curPaint
    const clipMask = this.curClipMask
    const clip = this.curClip
    this.submitFrame()
    for (const program of this.#programs.values()) {
      this.device.orphanBuffer(program.stream.buffers[this.curSlot])
      program.stream.resetAfterSubmit(this.curSlot)
    }
    this.curBatch = batch
    this.curBlend = blend
    this.curTexture = texture
    this.curLut = lut
    this.curPaint = paint
    this.curClipMask = clipMask
    this.curClip = clip
    // Reopen the group so the rest of the stroke gets its own reset runs.
    if (stencilGroup >= 0) this.#stencilGroupStart = this.#drawRuns.length
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
    this.curClip = null
    this.debugBatchCounter = 0
    this.#drawRuns.length = 0
  }
}
