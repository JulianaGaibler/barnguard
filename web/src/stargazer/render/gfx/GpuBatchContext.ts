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
import type { StencilRow } from './stencilRecipe'
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
import { StateStack, clipEquals, type ResolvedClip } from './StateStack'
import { PARAM_TABLE_BINDING, ParamTable } from './ParamTable'
import {
  UboRing,
  buildBlendPipelines,
  type BlendPipelineOptions,
  type SampledPipelines,
} from './programs/programCommon'
import type { ShaderQuadDraw } from './programs/shaderQuad'
import type { Surface } from './OffscreenSurfaces'
import type { CompositeDraw } from './programs/offscreenComposite'
import type { GpuProgram } from './GpuProgram'
import type { RingStream } from './RingStream'

/**
 * Debug render overlays. `coloredTri` and `shape` draws are affected (fills,
 * strokes, circles, round-rects, analytic shadows, text, sprites); the segment
 * stroker, gradient-radial, masked-gradient, text-quad, and path-shadow
 * composite programs render normally in every mode.
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
  /**
   * Instances held in a buffer of their own instead of the program's ring. The
   * run's word range is then relative to that buffer. `bounds` is the
   * device-pixel box the instances touch, `[minX, minY, maxX, maxY]`.
   */
  instances?: { buffer: import('./GfxDevice').VBuffer; bounds: Float64Array }
  /** The quad and params slice a `'shaderQuad'` run draws. */
  shaderQuad?: ShaderQuadDraw
  /** The surface and parameters a `'composite'` run draws. */
  composite?: CompositeDraw
  /**
   * Which row of the stencil recipe table (see `stencilRecipe.ts`) this run
   * draws with, or `null` for an ordinary draw. A `coloredTri` run with a row
   * selects that row's pipeline variant and takes its reference from the row
   * and `stencilDepth`.
   */
  stencilRow?: StencilRow | null
  /** The clip depth the run was recorded at, input to its stencil reference. */
  stencilDepth?: number
  /**
   * Byte offsets of the run's slices in the staged uniform rings, written by
   * the replay's prepare step and read by `drawRun`.
   */
  paramsOffset?: number
  clipOffset?: number
}

/**
 * The programs that read their clip from the param table. Their primitives
 * carry a record index, so a change of clip does not end a run.
 */
export const TABLE_CLIPPED: ReadonlySet<BatchKind> = new Set<BatchKind>([
  'shape',
  'coloredTri',
  'stencilFan',
])

/** Runs a later run may look back over for one to join. */
const MERGE_LOOKBACK = 32
/** Device pixels added to every run's box, for edge antialiasing and filtering. */
const MERGE_PAD = 2

/**
 * The stencil rows of a path fill. Their runs join when the paths they draw do
 * not touch, because each path counts winding only in its own pixels and its
 * cover clears them again.
 */
const PATH_FILL_ROWS: ReadonlySet<StencilRow> = new Set<StencilRow>([
  'fanNonzero',
  'fanEvenOdd',
  'coverNonzero',
  'coverEvenOdd',
])

/** Whether `run` is a plain streamed range that may join an earlier run. */
function isMergeable(run: DrawRun): boolean {
  if (run.geometry || run.instances || run.shaderQuad || run.composite)
    return false
  const row = run.stencilRow
  if (!row) return true
  // A clip's own fan shares its rows but never joins, because the quad after
  // it changes the clip depth the next run is tested against.
  return (
    PATH_FILL_ROWS.has(row) &&
    (run.kind === 'stencilFan' || row.startsWith('cover'))
  )
}

/** Whether `run` can extend `earlier` into one draw. */
function canJoin(earlier: DrawRun, run: DrawRun): boolean {
  return (
    isMergeable(earlier) &&
    earlier.kind === run.kind &&
    earlier.endWord === run.startWord &&
    earlier.blend === run.blend &&
    earlier.clipMask === run.clipMask &&
    earlier.texture === run.texture &&
    earlier.lut === run.lut &&
    earlier.debugMode === run.debugMode &&
    earlier.stencilDepth === run.stencilDepth &&
    (earlier.stencilRow ?? null) === (run.stencilRow ?? null) &&
    earlier.strokePass === run.strokePass &&
    clipEquals(earlier.clip, run.clip) &&
    paintEquals(earlier.paint, run.paint)
  )
}

/** A pass boundary in the command list, `at` the index of the run after it. */
export interface PassMark {
  at: number
  type: 'begin' | 'end'
  surface: Surface
}

/**
 * Pass control the batch context calls during replay. Every surface is replayed
 * in a pass of its own before the main target's pass, so the main pass is never
 * interrupted. `null` names the main target.
 */
export interface PassHooks {
  open(surface: Surface | null): void
  close(surface: Surface | null): void
}

/** One pass of the replay: a surface or the main target, and its run ranges. */
interface ReplayPass {
  surface: Surface | null
  ranges: number[]
}

/** Per-frame stats surfaced to the debug HUD. */
export interface GpuGfxStats {
  drawCalls: number
  programSwitches: number
  textureBinds: number
  blendSwitches: number
  /** Per-draw uniform slices written this frame, across all rings. */
  uboSlices: number
  /** Runs joined into an earlier one this frame, so draws it did not issue. */
  runsMerged: number
  /**
   * Shapes, glyph quads, strokes and polygons written this frame, which is the
   * renderer's per-frame work however the content got there (drawn directly or
   * replayed from a picture).
   */
  primitives: number
  /** Render passes begun this frame, main and offscreen. */
  passCount: number
  /**
   * Device work over the whole frame, shadow, AO, main and post passes
   * included. Filled by `GpuGfx.captureFrameCounters`.
   */
  framePasses: number
  frameSubmits: number
  frameBindGroupsCreated: number
  frameBindGroupSwitches: number
  frameUniformWrites: number
  /** Offscreen surfaces claimed this frame. */
  surfaces: number
  /** Bytes of offscreen surface storage currently allocated. */
  offscreenBytes: number
  /** Vertex and instance bytes uploaded this frame. */
  bytesUploaded: number
  /** {@link GpuGfxStats.bytesUploaded}, by the program that streamed them. */
  streamedBytes: Partial<Record<BatchKind, number>>
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
  /** Label bitmaps rasterized and uploaded. */
  labelRasters: number
  /** Bytes of label bitmap uploaded. */
  labelUploadBytes: number
  /** Labels that took their own texture, oversized or with no page room. */
  labelDedicated: number
  /** Label draws served by a neighbouring scale's raster instead of a new one. */
  labelHolds: number
  /** Times the label page was reset. */
  labelPageWipes: number
  /** Entries in the label cache now, text and small images together. */
  labelEntries: number
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
 * `coloredTri`'s resolved per-run inset-shadow mask paint: the affine map from
 * a device position to the cached mask's uv, `u = ux·x + uy·y + uOffset` and `v
 * = vx·x + vy·y + vOffset`, plus the mask texture itself. The map carries the
 * draw's rotation and skew, so the mask follows the path under any transform. A
 * run's mask texture also joins the batch key like a gradient's ramp row does,
 * so two different inset shadows drawn back to back each get their own
 * `DrawParams` slice and their own bound texture.
 */
export interface ResolvedMaskPaint {
  kind: 'mask'
  ux: number
  uy: number
  uOffset: number
  vx: number
  vy: number
  vOffset: number
  maskTex: Texture
}

/**
 * `coloredTri`'s resolved per-run radial gradient, in the gradient's own space
 * scaled so its circle has radius 1 and its focal point sits at the origin. A
 * device position maps there by `x' = xx·x + xy·y + offsetX` and `y' = yx·x +
 * yy·y + offsetY`, which carries the draw's full transform, so a rotated or
 * unevenly scaled gradient is an ellipse on screen as it is in CSS. `(ex, ey)`
 * is the vector from the focal point to the center in that space. Also the ramp
 * row and the draw's own alpha. Compared by value like
 * {@link ResolvedGradientPaint}.
 */
export interface ResolvedRadialPaint {
  kind: 'radial'
  xx: number
  xy: number
  yx: number
  yy: number
  offsetX: number
  offsetY: number
  ex: number
  ey: number
  rampRow: number
  opacity: number
}

export type ResolvedRunPaint =
  ResolvedGradientPaint | ResolvedRadialPaint | ResolvedMaskPaint

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
  if (a.kind === 'radial') {
    const bb = b as ResolvedRadialPaint
    return (
      a.xx === bb.xx &&
      a.xy === bb.xy &&
      a.yx === bb.yx &&
      a.yy === bb.yy &&
      a.offsetX === bb.offsetX &&
      a.offsetY === bb.offsetY &&
      a.ex === bb.ex &&
      a.ey === bb.ey &&
      a.rampRow === bb.rampRow &&
      a.opacity === bb.opacity
    )
  }
  const bb = b as ResolvedMaskPaint
  return (
    a.ux === bb.ux &&
    a.uy === bb.uy &&
    a.uOffset === bb.uOffset &&
    a.vx === bb.vx &&
    a.vy === bb.vy &&
    a.vOffset === bb.vOffset &&
    a.maskTex === bb.maskTex
  )
}

/** Batch key fields a program's flush needs to bind before drawing. */
export interface BatchKey {
  texture?: import('./GfxDevice').Texture | null
  lut?: import('./GfxDevice').Texture | null
  clipMask?: BitmapMask | null
  paint?: ResolvedRunPaint | null
  /**
   * A fresh object per draw, so two shader-quad draws never share a run: each
   * carries its own params slice.
   */
  shaderQuad?: ShaderQuadDraw | null
  /** A fresh object per composite, so each is its own run. */
  composite?: CompositeDraw | null
  /** The stencil recipe row the run draws with. Absent means `null`. */
  stencilRow?: StencilRow | null
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

  /**
   * The sample count of the pass being recorded into, or replayed into during
   * submit. A program's {@link SampledPipelines} read it to pick the pipeline
   * set that matches.
   */
  passSamples = 1

  /** Every program's pipeline set at the target's sample count. */
  readonly pipelineSets: {
    options: BlendPipelineOptions
    map: SampledPipelines
  }[] = []
  /** Whether every program has its single-sample pipelines. */
  singleSampleReady = false
  #singleSampleWarm: Promise<void> | null = null

  /**
   * Start building every program's single-sample pipelines, once. Until they
   * exist, a surface that wants a single sample takes the target's count.
   */
  warmSingleSample(): void {
    if (this.singleSampleReady || this.#singleSampleWarm) return
    if (this.targetFormat.samples === 1) {
      this.singleSampleReady = true
      return
    }
    const sets = this.pipelineSets.slice()
    const warm = Promise.all(
      sets.map((set) =>
        buildBlendPipelines(this.device, this, set.options, 1, set.map.single),
      ),
    ).then(
      () => {
        // A retarget while building leaves these for a target that is gone.
        if (this.#singleSampleWarm === warm) this.singleSampleReady = true
      },
      (err: unknown) => {
        console.error('GpuBatchContext: single-sample pipelines failed', err)
      },
    )
    this.#singleSampleWarm = warm
  }

  /** Forget the pipeline sets, before a warmup builds them for a new target. */
  resetPipelineSets(): void {
    this.pipelineSets.length = 0
    this.singleSampleReady = false
    this.#singleSampleWarm = null
  }

  /** Column-major 3×3 for `u_proj`. Updated once per frame. */
  readonly projMat = new Float32Array(9)

  #frameUbo: UBuffer | null = null
  /** One Frame UBO and bind group per pass of a frame, slot 0 the main pass. */
  readonly #frameSlots: Array<{
    ubo: UBuffer
    bg: BindGroup | null
    gen: number
    /** The param table generation the bind group was made against. */
    paramGen: number
  }> = []
  #slotCount = 1
  #curSlot = 0
  #frameLayout: BindGroupLayout | null = null
  /**
   * Std140 staging for the `Frame` block: the `mat3` is 3 vec4-aligned columns
   * (12 floats), so `projMat`'s 3 columns are copied with a padding float after
   * each.
   */
  readonly #frameStaging = new Float32Array(FRAME_UBO_FLOATS)
  /** Per-run analytic clip params, bound through the frame group at binding 8. */
  #clipRing: UboRing | null = null
  #clipGen = 0
  /**
   * The per-primitive records of the frame, read by the programs in
   * {@link TABLE_CLIPPED} through the frame group at
   * {@link PARAM_TABLE_BINDING}.
   */
  readonly params = new ParamTable()
  readonly #clipStaging = new Float32Array(CLIP_UBO_BYTES / 4)

  readonly txStack = new TransformStack(64)
  readonly stateStack = new StateStack(64)
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
  /**
   * The param record of the clip a table-clipped program writes into its
   * primitives. Valid after `beginBatch` for those programs.
   */
  curClipIndex = 0
  curShaderQuad: ShaderQuadDraw | null = null
  curComposite: CompositeDraw | null = null
  /** The recipe row of the open batch, `null` for an ordinary draw. */
  curStencilRow: StencilRow | null = null
  /**
   * Current clip-path depth, the `D` of the stencil layout. Zero while no clip
   * path is active.
   */
  clipDepth = 0
  /** The clip depth of the open batch. */
  curDepth = 0

  readonly #programs = new Map<BatchKind, GpuProgram>()

  readonly #drawRuns: DrawRun[] = []
  readonly #marks: PassMark[] = []
  /** Scratch for a run's box, and the boxes of the runs kept by the merge. */
  readonly #box = new Float64Array(4)
  #bounds = new Float64Array(0)

  /**
   * Whether `submitFrame` joins runs that can be drawn together. On by default.
   * Turn it off to compare against one draw per run.
   */
  mergeRuns = true
  /** Index into `#drawRuns` where the open stencil group began, or -1. */
  #stencilGroupStart = -1

  constructor(device: GfxDevice, stats: GpuGfxStats) {
    this.device = device
    this.stats = stats
  }

  /** Number of draw runs recorded so far this frame. */
  get runCount(): number {
    return this.#drawRuns.length
  }

  /**
   * Record the start or end of an offscreen pass at the current position in the
   * command list. Runs recorded after a `'begin'` and before its `'end'` replay
   * into the surface.
   */
  pushPassMark(type: 'begin' | 'end', surface: Surface): void {
    this.#recordActiveRun()
    this.#marks.push({ at: this.#drawRuns.length, type, surface })
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
    this.#clipRing = new UboRing(
      this.device,
      CLIP_UBO_BYTES,
      2048,
      'clip',
      true,
      true,
    )
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
      { binding: PARAM_TABLE_BINDING, type: 'data-table' },
    ])
    this.params.dropGpu()
    this.params.reset()
    this.#clipGen = this.#clipRing.generation
    this.#frameSlots.length = 0
    this.#frameSlots.push({
      ubo: this.#frameUbo,
      bg: this.#createFrameBindGroup(this.#frameUbo),
      gen: this.#clipGen,
      paramGen: this.params.generation,
    })
    this.#slotCount = 1
    this.#curSlot = 0
  }

  #createFrameBindGroup(ubo: UBuffer): BindGroup {
    return this.device.createBindGroup(this.#frameLayout!, [
      {
        binding: FRAME_UBO_BINDING,
        resource: { uniformBuffer: ubo },
      },
      {
        binding: CLIP_UBO_BINDING,
        resource: {
          uniformBuffer: this.#clipRing!.buffer,
          size: CLIP_UBO_BYTES,
        },
      },
      {
        binding: PARAM_TABLE_BINDING,
        resource: { dataTable: this.params.ensure(this.device) },
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
    const slot = this.#frameSlots[this.#curSlot]
    if (!slot || !this.#frameLayout) {
      throw new Error('GpuBatchContext: frame UBO not initialized')
    }
    const ring = this.#clipRing
    if (
      (ring && slot.gen !== ring.generation) ||
      slot.paramGen !== this.params.generation
    ) {
      if (ring) slot.gen = ring.generation
      slot.paramGen = this.params.generation
      slot.bg = this.#createFrameBindGroup(slot.ubo)
    }
    return {
      group: GROUP_FRAME,
      bindGroup: slot.bg as BindGroup,
      dynamicOffsets: [clipOffset],
    }
  }

  /**
   * Reserve the Frame data of another pass in this frame: a projection mapping
   * `w × h` device pixels to clip space, with its own UBO so passes recorded
   * into one command buffer do not overwrite each other. Returns the slot to
   * hand to {@link GpuBatchContext.useFrameSlot}.
   */
  acquireFrameSlot(w: number, h: number): number {
    const i = this.#slotCount++
    if (!this.#frameSlots[i]) {
      this.#frameSlots.push({
        ubo: this.device.createUniformBuffer(FRAME_UBO_FLOATS * 4),
        bg: null,
        gen: -1,
        paramGen: -1,
      })
    }
    const p = this.#slotProj
    p[0] = 2 / w
    p[1] = 0
    p[2] = 0
    p[3] = 0
    p[4] = -2 / h
    p[5] = 0
    p[6] = -1
    p[7] = 1
    p[8] = 1
    this.#writeFrame(this.#frameSlots[i].ubo, p)
    return i
  }

  /** Make `slot`'s Frame data the one draws bind. */
  useFrameSlot(slot: number): void {
    this.#curSlot = slot
  }

  readonly #slotProj = new Float32Array(9)

  /**
   * Reset the clip ring and reserve slot 0 as the "no clip" slice. Once per
   * submit.
   */
  resetClipRing(): void {
    const ring = this.#clipRing
    if (!ring) return
    ring.reset(this.device)
    this.#clipStaging.fill(0) // kind 0 -> clipCoverage returns 1
    ring.push(this.device, this.#clipStaging) // offset 0 = no clip
  }

  /**
   * Dynamic offset of a run's clip slice: 0 (the no-clip slot) or a freshly
   * pushed slice. On ring overflow it returns 0, so the run draws unclipped
   * rather than being dropped.
   */
  clipOffsetForRun(run: DrawRun): number {
    return run.clipOffset ?? 0
  }

  /** Stage a run's clip slice, called by the replay before any draw. */
  #stageClip(run: DrawRun): void {
    const ring = this.#clipRing
    const clip = run.clip
    if (!ring || !clip) {
      run.clipOffset = 0
      return
    }
    const s = this.#clipStaging
    s[0] = clip.kind
    s[1] = clip.cx
    s[2] = clip.cy
    s[3] = clip.r
    s[4] = clip.halfW
    s[5] = clip.halfH
    s[6] = 0
    s[7] = 0
    s[8] = clip.radii[0]
    s[9] = clip.radii[1]
    s[10] = clip.radii[2]
    s[11] = clip.radii[3]
    const off = ring.push(this.device, s)
    run.clipOffset = off < 0 ? 0 : off
  }

  #writeFrame(ubo: UBuffer, p: Float32Array): void {
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
    this.device.updateUniformBuffer(ubo, s)
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
    const samePaint =
      !('paint' in key) || paintEquals(this.curPaint, key.paint ?? null)
    const sameQuad =
      !('shaderQuad' in key) || this.curShaderQuad === key.shaderQuad
    const sameComposite =
      !('composite' in key) || this.curComposite === key.composite
    const wantRow = key.stencilRow ?? null
    const sameRow =
      this.curStencilRow === wantRow && this.curDepth === this.clipDepth
    // Clip is global like blend, pulled from the state stack. A program that
    // reads its clip from the param table writes the clip's record index into
    // each primitive, so the clip never breaks its batch. Every other program
    // breaks its batch when the analytic clip changes.
    let wantClip: ResolvedClip | null = null
    if (TABLE_CLIPPED.has(kind)) {
      this.curClipIndex = this.params.clipIndex(this.stateStack.getClip())
    } else {
      wantClip = this.stateStack.getClip()
    }
    const sameClip = clipEquals(this.curClip, wantClip)
    if (
      sameBatch &&
      sameBlend &&
      sameTexture &&
      sameLut &&
      sameMask &&
      samePaint &&
      sameQuad &&
      sameComposite &&
      sameRow &&
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
    if ('shaderQuad' in key) this.curShaderQuad = key.shaderQuad ?? null
    if ('composite' in key) this.curComposite = key.composite ?? null
    this.curStencilRow = wantRow
    this.curDepth = this.clipDepth
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
    paint: ResolvedRunPaint | null = null,
  ): void {
    this.#recordActiveRun()
    this.#drawRuns.push({
      kind: 'coloredTri',
      startWord: 0,
      endWord: 0,
      blend: this.stateStack.getBlend(),
      clipMask: null,
      clip: this.stateStack.getClip(),
      texture: null,
      lut: null,
      paint,
      debugMode: this.curDebugMode,
      debugBatchIndex: this.debugBatchCounter++,
      geometry,
      model,
      colorRgba,
      stencilDepth: this.clipDepth,
    })
  }

  /** Words every program has streamed so far this frame. */
  streamedWords(): number {
    let words = 0
    for (const program of this.#programs.values()) {
      words += program.stream.pendingWords[this.curSlot]
    }
    return words
  }

  /** Close the run being filled, so what is recorded next starts a new one. */
  closeRun(): void {
    this.#recordActiveRun()
  }

  /** The run recorded at `index`. */
  runAt(index: number): DrawRun {
    return this.#drawRuns[index]
  }

  /**
   * Record a stroke whose instances already sit in `buffer`, as one run in the
   * current state, or as the three passes of a stencil group.
   */
  recordInstanced(
    buffer: import('./GfxDevice').VBuffer,
    words: number,
    bounds: Float64Array,
    stencil: boolean,
  ): void {
    this.#recordActiveRun()
    this.beginBatch('stroke')
    const start = this.#drawRuns.length
    this.#drawRuns.push({
      kind: 'stroke',
      startWord: 0,
      endWord: words,
      blend: this.curBlend,
      clipMask: this.curClipMask,
      clip: this.curClip,
      texture: null,
      lut: null,
      paint: null,
      debugMode: this.curDebugMode,
      debugBatchIndex: this.debugBatchCounter++,
      stencilRow: null,
      stencilDepth: this.curDepth,
      instances: { buffer, bounds },
    })
    this.curBatch = 'none'
    this.curStencilRow = null
    if (stencil) this.#sealStencilGroup(start)
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
        stencilRow: this.curStencilRow,
        stencilDepth: this.curDepth,
        ...(this.curBatch === 'shaderQuad' && this.curShaderQuad
          ? { shaderQuad: this.curShaderQuad }
          : {}),
        ...(this.curBatch === 'composite' && this.curComposite
          ? { composite: this.curComposite }
          : {}),
      })
    }
    this.curBatch = 'none'
    this.curStencilRow = null
  }

  /**
   * Frame end: record the last pending run, upload the Frame UBO + each stream
   * once, then replay the command list in painter order (inside the open render
   * pass). The only place mid-frame-recorded draws reach the GPU.
   */
  submitFrame(hooks: PassHooks | null = null): void {
    this.#recordActiveRun()
    this.#mergeRuns()
    if (this.#frameUbo) this.#writeFrame(this.#frameUbo, this.projMat)
    this.#slotCount = 1
    this.#curSlot = 0
    this.resetClipRing()
    let bytes = 0
    const byProgram = this.stats.streamedBytes
    for (const [kind, program] of this.#programs) {
      const words = program.stream.pendingWords[this.curSlot]
      byProgram[kind] = words * 4
      bytes += words * 4
      program.stream.upload(this.device, this.curSlot)
    }
    this.stats.bytesUploaded = bytes
    // Every per-run uniform slice is written into CPU staging first and sent in
    // one upload per ring, so no draw is interleaved with a buffer write.
    const runList = this.#drawRuns
    for (let i = 0; i < runList.length; i++) {
      const run = runList[i]
      this.#stageClip(run)
      this.#programs.get(run.kind)?.prepareRun?.(this, run)
    }
    this.#clipRing?.flush(this.device)
    this.params.upload(this.device)
    for (const program of this.#programs.values()) {
      program.flushRings?.(this.device)
    }
    // The frame starts at source-over, so only a run whose blend differs from
    // the running value is a real switch (a new blend-variant pipeline bind).
    let prevBlend: GfxBlend = 'source-over'
    let blendSwitches = 0
    const runs = this.#drawRuns
    const drawRange = (from: number, to: number): void => {
      for (let i = from; i < to; i++) {
        const run = runs[i]
        if (run.blend !== prevBlend) {
          blendSwitches++
          prevBlend = run.blend
        }
        this.#programs.get(run.kind)?.drawRun(this, run)
      }
    }
    if (hooks) {
      for (const pass of this.#replayPasses(runs.length)) {
        hooks.open(pass.surface)
        for (let r = 0; r < pass.ranges.length; r += 2) {
          drawRange(pass.ranges[r], pass.ranges[r + 1])
        }
        hooks.close(pass.surface)
      }
    } else {
      drawRange(0, runs.length)
    }
    this.#marks.length = 0
    this.stats.blendSwitches = blendSwitches
    let slices = this.#clipRing?.pushes ?? 0
    for (const program of this.#programs.values()) {
      slices += program.uboSlices?.() ?? 0
    }
    this.stats.uboSlices = slices
    this.#drawRuns.length = 0
    // Every record written so far has been drawn from.
    this.params.reset()
    this.curClipIndex = 0
    // Every run queued before this call has now been replayed, so a ramp row
    // pinned earlier this frame is safe to reuse now.
    this.textureManager.flushRampRowPins()
    // Indices into the list are meaningless once it is emptied.
    this.#stencilGroupStart = -1
  }

  /**
   * Split the run list into passes. A surface's runs are those between its
   * begin and end marks, minus its nested surfaces. Passes come out in the
   * order their surfaces end, so a nested surface precedes its parent and a
   * retained surface precedes whatever composites it. The main target comes
   * last.
   */
  #replayPasses(runCount: number): ReplayPass[] {
    const out: ReplayPass[] = []
    const stack: Array<{ pass: ReplayPass; from: number }> = []
    let current: { pass: ReplayPass; from: number } = {
      pass: { surface: null, ranges: [] },
      from: 0,
    }
    const cut = (to: number): void => {
      if (to > current.from) current.pass.ranges.push(current.from, to)
    }
    const finish = (at: number): void => {
      cut(at)
      out.push(current.pass)
      const parent = stack.pop()
      if (parent) {
        parent.from = at
        current = parent
      }
    }
    for (const mark of this.#marks) {
      if (mark.type === 'begin') {
        cut(mark.at)
        stack.push(current)
        current = {
          pass: { surface: mark.surface, ranges: [] },
          from: mark.at,
        }
      } else if (stack.length > 0) {
        finish(mark.at)
      }
    }
    // A surface left open by an unbalanced call ends with the list.
    while (stack.length > 0) finish(runCount)
    cut(runCount)
    out.push(current.pass)
    return out
  }

  /**
   * Reserve `words`/`verts` for a vertex batch. Returns the word offset, or
   * `-1` if the stream is at its size limit.
   */
  reserveVerts(stream: RingStream, words: number, verts: number): number {
    this.stats.primitives++
    return stream.reserve(this.curSlot, words, verts)
  }

  /** Instanced counterpart to {@link GpuBatchContext.reserveVerts}. */
  reserveInstance(stream: RingStream): number {
    this.stats.primitives++
    return stream.reserveInstance(this.curSlot)
  }

  /**
   * Join runs the replay would otherwise issue as separate draws. A run moves
   * ahead of the runs between it and an earlier run of the same kind, state and
   * stream position, as long as its pixels overlap none of them, so painter
   * order holds wherever pixels are shared. The runs are one list per pass, so
   * the search never crosses an offscreen pass boundary.
   */
  #mergeRuns(): void {
    const runs = this.#drawRuns
    this.stats.runsMerged = 0
    if (!this.mergeRuns || runs.length < 2) return
    const marks = this.#marks
    const box = this.#box
    const programs = this.#programs
    if (this.#bounds.length < runs.length * 4) {
      this.#bounds = new Float64Array(runs.length * 8)
    }
    const bounds = this.#bounds
    const noBounds = (i: number): void => {
      bounds[i * 4] = -Infinity
      bounds[i * 4 + 1] = -Infinity
      bounds[i * 4 + 2] = Infinity
      bounds[i * 4 + 3] = Infinity
    }
    let outLen = 0
    let segStart = 0
    let mark = 0
    for (let i = 0; i <= runs.length; i++) {
      while (mark < marks.length && marks[mark].at <= i) {
        marks[mark].at = outLen
        segStart = outLen
        mark++
      }
      if (i === runs.length) break
      const run = runs[i]
      // Where `run` would be written if nothing joins it.
      const slot = outLen
      const known = !!programs.get(run.kind)?.runBounds
      if (
        known &&
        programs.get(run.kind)!.runBounds!(run, box) &&
        box[0] <= box[2] &&
        box[1] <= box[3]
      ) {
        bounds[slot * 4] = box[0] - MERGE_PAD
        bounds[slot * 4 + 1] = box[1] - MERGE_PAD
        bounds[slot * 4 + 2] = box[2] + MERGE_PAD
        bounds[slot * 4 + 3] = box[3] + MERGE_PAD
      } else {
        noBounds(slot)
      }
      let joined = false
      if (isMergeable(run) && bounds[slot * 4] > -Infinity) {
        const floor = Math.max(segStart, outLen - MERGE_LOOKBACK)
        for (let j = outLen - 1; j >= floor; j--) {
          const earlier = runs[j]
          if (canJoin(earlier, run)) {
            earlier.endWord = run.endWord
            bounds[j * 4] = Math.min(bounds[j * 4], bounds[slot * 4])
            bounds[j * 4 + 1] = Math.min(
              bounds[j * 4 + 1],
              bounds[slot * 4 + 1],
            )
            bounds[j * 4 + 2] = Math.max(
              bounds[j * 4 + 2],
              bounds[slot * 4 + 2],
            )
            bounds[j * 4 + 3] = Math.max(
              bounds[j * 4 + 3],
              bounds[slot * 4 + 3],
            )
            joined = true
            break
          }
          // Not joinable, so `run` would move ahead of it. That needs the two
          // to share no pixel.
          if (
            bounds[j * 4] <= bounds[slot * 4 + 2] &&
            bounds[j * 4 + 2] >= bounds[slot * 4] &&
            bounds[j * 4 + 1] <= bounds[slot * 4 + 3] &&
            bounds[j * 4 + 3] >= bounds[slot * 4 + 1]
          ) {
            break
          }
        }
      }
      if (!joined) runs[outLen++] = run
    }
    this.stats.runsMerged = runs.length - outLen
    runs.length = outLen
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
    this.curClipIndex = 0
    this.curShaderQuad = null
    this.curComposite = null
    this.curStencilRow = null
    this.clipDepth = 0
    this.curDepth = 0
    this.debugBatchCounter = 0
    this.#drawRuns.length = 0
    this.#marks.length = 0
  }
}
