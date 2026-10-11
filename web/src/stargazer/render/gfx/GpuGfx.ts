/**
 * `Gfx2D` implementation that batches draws through a `GfxDevice`.
 *
 * Batch-break conditions: program change, texture bind, blend mode, analytic
 * clip change, ring-slot overflow, an explicit `flush()` at a layer boundary,
 * and `endFrame`. Alpha, color, and transform fold into the per-vertex or
 * per-instance record and never break a batch.
 *
 * Coordinator: this class holds the `Gfx2D` public surface and the frame
 * lifecycle. Each draw program (coloredTri, stroke, shape, gradientRadial,
 * maskedGradient, textQuad) lives in `./programs/*.ts` and owns its shader,
 * vertex layout, ring-buffered stream, and pipeline variants. Shared batch
 * state (transform/state stacks, the active-batch key, the texture manager)
 * lives on `GpuBatchContext`, so a program module never needs a `GpuGfx`
 * reference.
 */

import type {
  Gfx2D,
  GfxClipShape,
  GfxFill,
  GfxGradientStop,
  GfxShadowStyle,
  GfxStrokeStyle,
  GfxTextStyle,
  SolidStrokeStyle,
} from './Gfx2D'
import type { RenderTarget, TargetFormat, Texture, VBuffer } from './GfxDevice'
import type { GfxDevice } from './GfxDevice'
import { depthStencilFormatOf } from './depthStencil'
import { parseColor } from './parseColor'
import type { GeometryHandle } from './GeometryHandle'
import {
  getCachedOutline,
  getContourClosed,
  getPathContours,
  getPathTessellation,
  getRegistrationEpoch,
  registerPathTessellation,
  setCachedOutline,
} from './PathTessellationRegistry'
import {
  strokeOutline,
  scaleBucketCenter,
  scaleBucketIndex,
  StrokeOutlineBuffer,
  DEFAULT_MITER_LIMIT,
} from './strokeOutline'
import { flattenQuadratic } from '../../assets/SvgPathContours'
import { TextureManager, type TextureInspector } from './TextureManager'
import { VectorQuality } from '../VectorQuality'
import { DEFAULT_LABEL_FONT, type LabelStyle } from './rasterizeLabel'
import type { BitmapMask } from '../../assets/BitmapMask'
import { packColor, rgbaTuple } from './packing'
import {
  CURVE_FLATTEN_MAX_POINTS,
  CURVE_FLATTEN_TOL_PX,
  RING_SIZE,
} from './batchLayout'
import {
  GpuBatchContext,
  type DebugRenderMode,
  type GpuGfxStats,
} from './GpuBatchContext'
import type { GpuProgram } from './GpuProgram'
import { ColoredTriProgram } from './programs/coloredTri'
import { StrokeProgram } from './programs/stroke'
import { resolveRadii, type RoundRectRadii } from './roundRectRadii'
import { GradientRadialProgram } from './programs/gradientRadial'
import { MaskedGradientProgram } from './programs/maskedGradient'
import { TextQuadProgram } from './programs/textQuad'
import { ShapeProgram } from './programs/shape'
import { SHAPE_TEX_ATLAS, SHAPE_TEX_LABEL } from './batchLayout'
import { PathShadowCompositeProgram } from './programs/pathShadowComposite'
import {
  PathShadowCache,
  HARD_SHADOW_BLUR_PX,
  type PathShadowRequest,
} from './PathShadowCache'
import type { Rect } from '../../math/Rect'

/**
 * The scale-independent half of a label's cache key. `TextureManager` appends
 * the scale bucket. Newline separators cannot collide: labels are single-line,
 * so the text has none, and font/align/baseline/color never do.
 */
function labelBaseKey(text: string, style: LabelStyle): string {
  return `${text}\n${style.font}\n${style.align}\n${style.baseline}\n${style.color}\n`
}

export type { DebugRenderMode, GpuGfxStats }

/** Warn once when a clip is set under a transform its shape can't represent. */
let warnedClipTransform = false

/**
 * Counters for `Gfx2D` calls that hit a no-op path (e.g. `strokePath2D` on a
 * Path2D without a registered tessellation). Surfaced in the HUD.
 */
export interface UnimplementedCounts {
  fillCircle: number
  fillConvexPoly: number
  fillPath2D: number
  fillCircleRadialGradient: number
  fillPolyLinearGradient: number
  strokeCircle: number
  strokeLine: number
  strokeQuadratic: number
  strokePolyline: number
  strokePath2D: number
  shadowPath2D: number
  /**
   * An outset path shadow drew the hard (unblurred) silhouette because its
   * mask was cold (this frame's first request), starved (budget exhausted),
   * or disabled (`quality.vector.pathShadowsEnabled === false`). Does not
   * cover an inset shadow skipped for the same reason, since that has no
   * silent-degradation draw to count, it just doesn't draw.
   */
  pathShadowFallback: number
}

export class GpuGfx implements Gfx2D {
  readonly #device: GfxDevice
  readonly #canvas: HTMLCanvasElement

  // FBO target.
  #target: RenderTarget
  #targetWidth: number
  #targetHeight: number

  /**
   * Shared batch state: transform/state stacks, active-batch key, texture
   * manager.
   */
  readonly #ctx: GpuBatchContext

  readonly #coloredTri = new ColoredTriProgram()
  readonly #stroke = new StrokeProgram()
  readonly #gradientRadial = new GradientRadialProgram()
  readonly #maskedGradient = new MaskedGradientProgram()
  readonly #textQuad = new TextQuadProgram()
  readonly #shape = new ShapeProgram()
  readonly #pathShadowComposite = new PathShadowCompositeProgram()

  /**
   * Cached blurred-coverage masks for arbitrary-path drop shadows. Unlike the
   * other programs, not re-warmed on retarget: its raster/blur targets are
   * its own private r8/rg8 targets, independent of the screen target's
   * format, depth, stencil, or sample count.
   */
  #pathShadowCache!: PathShadowCache
  readonly #pathBoundsCache = new WeakMap<
    Path2D,
    { epoch: number; bounds: Rect }
  >()
  /**
   * This frame's distinct (path, style, scale-bucket) requests that missed
   * the cache, drained by `processPendingShadowBakes` in next frame's
   * pre-`beginFrame` window.
   */
  readonly #pendingShadowBakes = new Map<string, PathShadowRequest>()
  /** Warn once per surface for a rotated/skewed inset path shadow. */
  #warnedInsetShadowTransform = false

  /**
   * Every texture the GPU backend uses: atlas, per-source, gradient LUTs, clip
   * masks. Mirrored onto `ctx.textureManager` so program modules can reach it.
   */
  #textureManager!: TextureManager

  readonly stats: GpuGfxStats = {
    drawCalls: 0,
    programSwitches: 0,
    textureBinds: 0,
    blendSwitches: 0,
    overflowWarns: 0,
    sdfInstances: 0,
    strokeInstances: 0,
    roundRectInstances: 0,
    shadowInstances: 0,
    msaaSamples: 1,
    outlineTessellations: 0,
    outlineCacheHits: 0,
    rampRowsWritten: 0,
    maskBakes: 0,
    maskBakeWork: 0,
    maskBytes: 0,
    poolHits: 0,
    poolMisses: 0,
  }
  /** Tripwire counters. Ticked when a Gfx2D call reaches a no-op path. */
  readonly unimplemented: UnimplementedCounts = {
    fillCircle: 0,
    fillConvexPoly: 0,
    fillPath2D: 0,
    fillCircleRadialGradient: 0,
    fillPolyLinearGradient: 0,
    strokeCircle: 0,
    strokeLine: 0,
    strokeQuadratic: 0,
    strokePolyline: 0,
    strokePath2D: 0,
    shadowPath2D: 0,
    pathShadowFallback: 0,
  }

  /**
   * MSAA sample count. `1` = plain color texture. `>1` = multisample
   * renderbuffer resolved by `blitToDefault`. Persists across resize and
   * context restore.
   */
  #samples: number
  /**
   * Whether the offscreen target carries a depth attachment for the 3D pass.
   * Allocated once via {@link GpuGfx.enableDepth} and kept across resize and
   * context restore. A pure-2D stage never sets it.
   */
  #depthEnabled = false
  /**
   * Whether the offscreen target carries stencil bits, which the deduplicated
   * translucent-stroke path needs.
   *
   * Fixed at construction, and independent of depth: the attachment carries
   * both, so a 3D pass costs the stroke path nothing. Changing it later would
   * re-warm every pipeline, since each one bakes the format it draws into.
   */
  #stencilEnabled: boolean
  /**
   * Whether `endFrame` blits the target to the canvas. `false` for an offscreen
   * surface whose color texture is sampled elsewhere (a `Viewport2DNode`'s 2D
   * render).
   */
  #present: boolean
  /**
   * Single-sample resolve target, allocated only when the main target is MSAA.
   * The main pass resolves into it on `endRenderPass`. `present` blits it to
   * the canvas (single-sample, so scaling is allowed) and a post-process pass
   * or a `Viewport2DNode` samples it.
   */
  #resolveTarget: RenderTarget | null = null
  /**
   * Whether pipelines have finished their async pre-warm. The stage skips
   * rendering until this is true (WebGL2 resolves within a microtask, WebGPU
   * takes longer).
   */
  #ready = false
  #warmupSeq = 0
  /** Resolves when the current warm-up completes, awaited by tests. */
  #warmupPromise: Promise<void> = Promise.resolve()

  constructor(
    canvas: HTMLCanvasElement,
    device: GfxDevice,
    opts: {
      samples?: number
      present?: boolean
      stencil?: boolean
      vectorQuality?: VectorQuality
    } = {},
  ) {
    this.#canvas = canvas
    this.#device = device
    this.#samples = opts.samples ?? 4
    this.#present = opts.present ?? true
    this.#stencilEnabled = opts.stencil ?? false
    this.#targetWidth = canvas.width || 1
    this.#targetHeight = canvas.height || 1
    this.#target = null as unknown as RenderTarget
    this.#textureManager = null as unknown as TextureManager
    this.#ctx = new GpuBatchContext(device, this.stats)
    this.#ctx.vectorQuality = opts.vectorQuality ?? new VectorQuality()
    this.#ctx.registerProgram(this.#coloredTri)
    this.#ctx.registerProgram(this.#stroke)
    this.#ctx.registerProgram(this.#shape)
    this.#ctx.registerProgram(this.#gradientRadial)
    this.#ctx.registerProgram(this.#maskedGradient)
    this.#ctx.registerProgram(this.#textQuad)
    this.#ctx.registerProgram(this.#pathShadowComposite)
    this.#initGpuResources()
  }

  /** All draw programs, in construction/registration order. */
  get #programs(): GpuProgram[] {
    return [
      this.#coloredTri,
      this.#stroke,
      this.#shape,
      this.#gradientRadial,
      this.#maskedGradient,
      this.#textQuad,
      this.#pathShadowComposite,
    ]
  }

  /** Whether pipelines are warm and the surface can render this frame. */
  get ready(): boolean {
    return this.#ready
  }

  /**
   * Resolves once pipelines have warmed. Test hook (production polls
   * {@link ready}).
   */
  get whenReady(): Promise<void> {
    return this.#warmupPromise
  }

  /**
   * (Re)create every backend resource. Called from the constructor and from
   * `rebuildResources` on context restore. Kicks off the async pipeline
   * warm-up.
   */
  #initGpuResources(): void {
    const device = this.#device
    const unitQuadBuffer: VBuffer = device.createVertexBuffer(6 * 2 * 4)
    const unit = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
    device.updateBufferSubData(unitQuadBuffer, 0, unit)
    this.#ctx.unitQuadBuffer = unitQuadBuffer
    // 1×1 placeholder, bound to sampler slots a shader declares but doesn't
    // sample this draw (contents never read, so no upload needed).
    this.#ctx.placeholderTexture = device.createTexture2D({
      width: 1,
      height: 1,
      filter: 'nearest',
      wrap: 'clamp',
    })
    // Shared per-frame projection UBO and its bind group. Every 2D pipeline's
    // group 0 reads it.
    this.#ctx.initFrameUbo()

    for (const p of this.#programs) p.init(device, this.#ctx)

    this.#target = device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
      depth: this.#depthEnabled,
      stencil: this.#stencilEnabled,
    })
    this.stats.msaaSamples = this.#target.samples
    this.#publishTargetFormat()
    this.#ensureResolveTarget()

    if (this.#textureManager) {
      this.#textureManager.rebuild(device)
    } else {
      this.#textureManager = new TextureManager(device)
    }
    this.#ctx.textureManager = this.#textureManager

    // Old handles (if any) died with the previous context; no explicit
    // teardown call reaches them, same as every other GPU resource rebuilt
    // here. Its own pipelines are independent of the screen target's format,
    // so this is the only place it's (re)built, unlike `#programs`.
    this.#pathShadowCache = new PathShadowCache(device)
    void this.#pathShadowCache.warmup()

    this.#warmupPromise = this.#warmupPipelines()
  }

  /**
   * Create every program's pipeline variants for the current target color
   * format + sample count. Async, since WebGPU compiles pipelines
   * asynchronously. `#ready` gates rendering until it resolves. A `#warmupSeq`
   * guard drops a stale warm-up if the target changed again mid-flight (MSAA
   * swap, resize).
   */
  async #warmupPipelines(): Promise<void> {
    this.#ready = false
    const seq = ++this.#warmupSeq
    this.#publishTargetFormat()
    for (const p of this.#programs) {
      await p.warmup(this.#device, this.#ctx)
      if (seq !== this.#warmupSeq) return
    }
    if (seq === this.#warmupSeq) this.#ready = true
  }

  /**
   * Allocate (or reallocate) the single-sample resolve target when the main
   * target is MSAA. Drops it when it isn't. Matches the main target's size +
   * color space so the MSAA resolve blit is format- and bounds-compatible.
   */
  #ensureResolveTarget(): void {
    if (this.#target.samples > 1) {
      if (this.#resolveTarget)
        this.#device.deleteRenderTarget(this.#resolveTarget)
      this.#resolveTarget = this.#device.createRenderTarget({
        width: this.#targetWidth,
        height: this.#targetHeight,
        samples: 1,
        colorSpace: this.#target.colorSpace,
      })
    } else if (this.#resolveTarget) {
      this.#device.deleteRenderTarget(this.#resolveTarget)
      this.#resolveTarget = null
    }
  }

  /**
   * The sampleable / presentable target: the resolved one under MSAA, else the
   * target.
   */
  get #presentSource(): RenderTarget {
    return this.#resolveTarget ?? this.#target
  }

  /**
   * Read-only view of the texture caches for the debug inspector. Building the
   * snapshot has no standing cost, the debug panel calls it on demand.
   */
  get textureInspector(): TextureInspector {
    return this.#textureManager
  }

  /**
   * Drop every cached label raster, so the next frame re-rasterizes text. Used
   * after a webfont arrives late. See `TextureManager.clearLabelCache`.
   */
  clearLabelCache(): void {
    this.#textureManager.clearLabelCache()
  }

  /** The backend device, for the 3D pass to draw through the same frame/target. */
  get device(): GfxDevice {
    return this.#device
  }

  /**
   * The attachment signature of the offscreen target, so the 3D pass
   * (`MeshRenderer`, `DebugLine3DRenderer`) can build pipelines matching the
   * shared target it draws into.
   */
  get targetFormat(): TargetFormat {
    return { ...this.#ctx.targetFormat }
  }

  /**
   * Republish the live target's signature onto the batch context. Every path
   * that swaps `#target` calls this, so the format the programs build against
   * is the one the pass will actually open with.
   */
  #publishTargetFormat(): void {
    this.#ctx.targetFormat = {
      format: this.#target.colorSpace,
      samples: this.#target.samples,
      depthStencil: depthStencilFormatOf(this.#target),
    }
  }

  /**
   * Add a depth attachment to the offscreen target so a depth-tested 3D pass
   * can run before the 2D layers, and clear it each frame from then on.
   * Idempotent, and reversible through {@link GpuGfx.disableDepth}. The
   * attachment survives resize and context restore. No-op if already enabled.
   */
  enableDepth(): void {
    if (this.#depthEnabled) return
    this.#depthEnabled = true
    this.#retarget()
  }

  /**
   * Drop the depth attachment. No-op if depth is already off. Stencil bits the
   * stage was built with are unaffected either way.
   *
   * A host that shares one stage across several scenes calls this when a
   * depth-using scene goes away. A stage outlives the scenes drawn on it, so
   * without this the attachment stays allocated for the rest of the stage's
   * life.
   */
  disableDepth(): void {
    if (!this.#depthEnabled) return
    this.#depthEnabled = false
    this.#retarget()
  }

  /** Rebuild the offscreen target for the current depth and stencil flags. */
  #retarget(): void {
    const had = depthStencilFormatOf(this.#target)
    this.#ctx.flushActive()
    this.#device.deleteRenderTarget(this.#target)
    this.#target = this.#device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
      depth: this.#depthEnabled,
      stencil: this.#stencilEnabled,
    })
    this.stats.msaaSamples = this.#target.samples
    this.#publishTargetFormat()
    this.#ensureResolveTarget()

    // Every pipeline bakes the depth-stencil format of the attachment it draws
    // into, so changing which aspects the target carries invalidates all of
    // them, not just the stroke path. A stage that kept drawing with them would
    // render nothing at all.
    if (depthStencilFormatOf(this.#target) !== had) {
      this.#warmupPromise = this.#warmupPipelines()
    }
  }

  // --- frame lifecycle ------------------------------------------------------

  /**
   * Rotate ring slot, bind FBO, clear. `pixelW`/`pixelH` are ignored (FBO clear
   * covers the target), only present so backend implementations share a
   * `beginFrame` shape.
   */
  beginFrame(opts: {
    clearColor: string
    transparent: boolean
    pixelW: number
    pixelH: number
  }): void {
    void opts.pixelW
    void opts.pixelH
    // Rotate ring slot.
    this.#ctx.curSlot = (this.#ctx.curSlot + 1) % RING_SIZE
    this.#ctx.resetSlot(this.#ctx.curSlot)
    this.#textureManager.resetLabelBudget()
    this.#ctx.resetBatchMarkers()
    // Reset per-frame stats so the HUD reflects the frame just rendered.
    this.stats.drawCalls = 0
    this.stats.programSwitches = 0
    this.stats.textureBinds = 0
    this.stats.blendSwitches = 0
    this.stats.overflowWarns = 0
    this.stats.sdfInstances = 0
    this.stats.strokeInstances = 0
    this.stats.roundRectInstances = 0
    this.stats.shadowInstances = 0
    this.#updateProjection(this.#targetWidth, this.#targetHeight)
    this.#ctx.stateStack.resetBase()
    this.#ctx.txStack.setBase(1, 0, 0, 1, 0, 0)
    // Parse the CSS clear once. Fully transparent under `transparent: true`.
    const clear: readonly [number, number, number, number] = opts.transparent
      ? [0, 0, 0, 0]
      : rgbaTuple(parseColor(opts.clearColor))
    this.#device.beginFrame()
    // Open the main pass: clear color (+ depth when a 3D pass follows), and
    // resolve MSAA into the single-sample resolve target on pass end. The pass
    // stays open across the 3D immediate draws and the 2D command-list replay
    // (in `endFrame`), closing in `endFrame`.
    this.#device.beginRenderPass({
      color: {
        target: this.#target,
        loadOp: 'clear',
        clearColor: clear,
        resolveTarget: this.#resolveTarget ?? undefined,
      },
      // Both aspects come off the live target rather than the requested flags,
      // so the pass can never describe an attachment the target does not have.
      depth: this.#target.hasDepth
        ? {
            target: { renderTarget: this.#target },
            loadOp: 'clear',
          }
        : undefined,
      // Zeroed once per frame. Every stencil group resets its own bits after
      // drawing, so nothing carries from one stroke to the next within a frame.
      stencil: this.#target.hasStencil
        ? { target: this.#target, loadOp: 'clear', clearValue: 0 }
        : undefined,
    })
    this.#ctx.curBlend = 'source-over'
  }

  /**
   * Layer boundary (Stage calls this between drawLayer calls). Under
   * record/submit this only records the pending batch as a draw-run. The GPU
   * work is deferred to `submitFrame` in `endFrame`. Doesn't advance the slot.
   */
  flush(): void {
    this.#ctx.flushActive()
  }

  /**
   * End of frame: record the last pending run, upload each stream once, replay
   * the command list, then blit the FBO to the canvas. If the context was lost
   * mid-frame, skip it all. `beginFrame` resets state next frame.
   */
  endFrame(): void {
    if (this.#device.isContextLost()) {
      return
    }
    // Replay the recorded 2D command list into the still-open main pass, then
    // close it (resolving MSAA into the resolve target).
    this.#ctx.submitFrame()
    this.#device.endRenderPass()
    // Real GPU state-change counts come from the device (post-elision).
    // `blendSwitches` is derived from the run blend transitions in submitFrame
    // (blend is baked into pipeline variants now, not a standalone device call).
    const dc = this.#device.deviceStats
    this.stats.programSwitches = dc.pipelineSwitches
    this.stats.textureBinds = dc.textureBinds
    // Cumulative counters, copied from their owning cache/pool so a plain
    // `{...stats}` spread (the HUD's own read) picks them up: see
    // `GpuGfxStats`'s own fields for why these are cumulative, not per-frame.
    this.stats.rampRowsWritten = this.#textureManager.rampRowsWritten
    this.stats.maskBakes = this.#pathShadowCache.maskBakes
    this.stats.maskBakeWork = this.#pathShadowCache.maskBakeWork
    this.stats.maskBytes = this.#pathShadowCache.maskBytes
    this.stats.poolHits = this.#pathShadowCache.pool.hits
    this.stats.poolMisses = this.#pathShadowCache.pool.misses
    if (this.#present) {
      this.#device.present(
        this.#presentSource,
        this.#canvas.width,
        this.#canvas.height,
        { filter: 'linear' },
      )
    }
    this.#device.endFrame()
  }

  /**
   * Color texture backing this surface's target, for sampling elsewhere (a
   * non-presenting offscreen surface). `null` when the target is a multisample
   * renderbuffer (`samples > 1`), which cannot be sampled. Use `samples: 1`.
   */
  get colorTexture(): Texture | null {
    // The present source is always single-sample (the resolve target under
    // MSAA, else the target), so it's sampleable.
    return this.#device.colorTexture(this.#presentSource)
  }

  /**
   * The resolved, sampleable target a post-process pipeline reads (after
   * `setPresent(false)` + `endFrame` have submitted + resolved the frame).
   * Under MSAA this is the single-sample resolve target. Otherwise it is the
   * target itself.
   */
  get target(): RenderTarget {
    return this.#presentSource
  }

  /** Current target size in device pixels, for sizing downstream targets. */
  get targetSize(): { w: number; h: number } {
    return { w: this.#targetWidth, h: this.#targetHeight }
  }

  /**
   * Toggle whether `endFrame` blits the target to the canvas. A `Stage` sets
   * this false for the frames a post-process pipeline will present instead, and
   * true again when no effects are active. Pure state flag, touches no GL.
   */
  setPresent(present: boolean): void {
    this.#present = present
  }

  /**
   * Resize the offscreen render target and its resolve target. Idempotent, so a
   * `ResizeObserver` can call it on every observation.
   */
  setInternalSize(pixelW: number, pixelH: number): void {
    if (pixelW === this.#targetWidth && pixelH === this.#targetHeight) return
    this.#targetWidth = pixelW
    this.#targetHeight = pixelH
    this.#device.resizeRenderTarget(this.#target, pixelW, pixelH)
    if (this.#resolveTarget)
      this.#device.resizeRenderTarget(this.#resolveTarget, pixelW, pixelH)
  }

  /** No-op. `WebGL2Device.onRestored` drives reacquisition. */
  reacquireContext(): void {}

  /**
   * Rebuild every GL resource after `webglcontextrestored`. Programs, buffers,
   * VAOs, FBO, atlas texture. CPU-side state (batch flags, transform/state
   * stacks, stats, texture manager's backing canvases) survives the loss.
   */
  rebuildResources(): void {
    if (this.#device.isContextLost()) {
      console.warn(
        'GpuGfx.rebuildResources: called while context is still lost; skipping. Stage will retry on the next contextrestored event.',
      )
      return
    }
    // Clear batch state, old handles are dead.
    this.#ctx.resetBatchMarkers()
    // Reset ring cursors so the first new frame starts from a clean slot.
    this.#ctx.curSlot = 0
    this.#initGpuResources()
  }

  // --- Gfx2D: transform ----------------------------------------------------

  setBaseTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.#ctx.txStack.setBase(a, b, c, d, e, f)
  }

  save(): void {
    this.#ctx.txStack.push()
    this.#ctx.stateStack.push()
  }

  restore(): void {
    this.#ctx.txStack.pop()
    this.#ctx.stateStack.pop()
  }

  translate(x: number, y: number): void {
    this.#ctx.txStack.translate(x, y)
  }

  rotate(rad: number): void {
    this.#ctx.txStack.rotate(rad)
  }

  scale(sx: number, sy: number): void {
    this.#ctx.txStack.scale(sx, sy)
  }

  // --- Gfx2D: alpha + blend ------------------------------------------------

  setAlpha(alpha: number): void {
    // Absolute, matching Canvas globalAlpha (see Gfx2D docstring).
    this.#ctx.stateStack.setAlpha(alpha)
  }

  setBlend(mode: import('./Gfx2D').GfxBlend): void {
    this.#ctx.stateStack.setBlend(mode)
  }

  setClipMask(mask: BitmapMask | null): void {
    // Just stores on the state stack. The actual GPU state change (uniform
    // set + texture bind) happens lazily inside `ColoredTriProgram.begin` /
    // `flush` when the effective mask differs from the batch's baked-in
    // mask, matches how blend + texture flips force a flush.
    this.#ctx.stateStack.setClipMask(mask)
  }

  /**
   * The geometric mean of the transform's two axis scales, which is the
   * rotation-safe reading: exactly the scale factor when uniform, and the
   * area-preserving average when not.
   */
  deviceScale(): number {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const s = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))
    return s > 0 ? s : 1
  }

  snapSize(v: number): number {
    const s = this.deviceScale()
    if (!(s > 0) || !Number.isFinite(v)) return v
    return Math.max(1, Math.round(v * s)) / s
  }

  setClip(shape: GfxClipShape | null): void {
    if (!shape) {
      this.#ctx.stateStack.setClip(null)
      return
    }
    // Resolve local → device px through the current transform, like fillCircle.
    // The snapshot is taken now, so later transform changes don't move the clip.
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))
    const rotatedOrSkewed = Math.abs(t.b) > 1e-4 || Math.abs(t.c) > 1e-4
    const nonUniform = Math.abs(Math.abs(t.a) - Math.abs(t.d)) > 1e-3
    if (shape.kind === 'circle') {
      if (nonUniform && !warnedClipTransform) {
        warnedClipTransform = true
        console.warn(
          'GpuGfx.setClip: non-uniform scale approximates a circle clip as one averaged radius.',
        )
      }
      this.#ctx.stateStack.setClip({
        kind: 1,
        cx: t.a * shape.cx + t.c * shape.cy + t.e,
        cy: t.b * shape.cx + t.d * shape.cy + t.f,
        r: shape.r * scale,
        halfW: 0,
        halfH: 0,
        rrRadius: 0,
      })
    } else {
      if ((rotatedOrSkewed || nonUniform) && !warnedClipTransform) {
        warnedClipTransform = true
        console.warn(
          'GpuGfx.setClip: a rounded-rect clip assumes an axis-aligned transform; rotation/skew/non-uniform scale is unsupported.',
        )
      }
      const midX = shape.x + shape.w / 2
      const midY = shape.y + shape.h / 2
      this.#ctx.stateStack.setClip({
        kind: 2,
        cx: t.a * midX + t.c * midY + t.e,
        cy: t.b * midX + t.d * midY + t.f,
        r: 0,
        halfW: (shape.w / 2) * Math.abs(t.a),
        halfH: (shape.h / 2) * Math.abs(t.d),
        rrRadius: shape.radius * scale,
      })
    }
  }

  /**
   * Switch the debug render mode. Global state (not stack-scoped), the debug
   * HUD is the sole caller and it wants ALL draws affected until toggled off.
   * Flushes the current batch so old-mode pixels finish out before the new-mode
   * uniforms take effect.
   */
  setDebugRenderMode(mode: DebugRenderMode): void {
    if (this.#ctx.curDebugMode === mode) return
    this.#ctx.flushActive()
    this.#ctx.curDebugMode = mode
  }

  /** Current debug render mode. Read by the HUD to reflect state. */
  getDebugRenderMode(): DebugRenderMode {
    return this.#ctx.curDebugMode
  }

  /**
   * Live-swap MSAA sample count. Flushes, deletes the FBO, allocates a fresh
   * one. The device clamps to `[1, MAX_SAMPLES]`, `stats.msaaSamples` mirrors
   * the effective post-clamp count for the HUD.
   */
  setSamples(samples: number): void {
    const requested = Math.max(0, Math.floor(samples))
    // Store the request so a subsequent context-loss rebuild picks it up.
    // Actual clamp/effective count read from `this.target.samples`.
    if (this.#samples === requested) return
    this.#ctx.flushActive()
    this.#samples = requested
    this.#device.deleteRenderTarget(this.#target)
    this.#target = this.#device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
      depth: this.#depthEnabled,
      stencil: this.#stencilEnabled,
    })
    this.stats.msaaSamples = this.#target.samples
    this.#ensureResolveTarget()
    // Sample count changed, so pipelines must be rebuilt for the new count.
    this.#warmupPromise = this.#warmupPipelines()
  }

  /** Current effective MSAA sample count (post-clamp). */
  getSamples(): number {
    return this.#target.samples
  }

  /**
   * `'polygons'` debug mode: thin wireframe around a local-space polygon. Width
   * inverts the current transform's uniform scale so it stays ~1 device pixel
   * regardless of zoom.
   */
  #emitDebugPolygonOutline(
    pts: ArrayLike<number>,
    count: number,
    closed: boolean,
  ): void {
    if (count < 2) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = det > 1e-9 ? Math.sqrt(det) : 1
    const style: GfxStrokeStyle = {
      color: 'rgba(96, 165, 250, 0.75)',
      width: 1 / scale,
    }
    for (let i = 0; i < count - 1; i++) {
      this.strokeLine(
        pts[i * 2],
        pts[i * 2 + 1],
        pts[(i + 1) * 2],
        pts[(i + 1) * 2 + 1],
        style,
      )
    }
    if (closed && count >= 3) {
      const last = count - 1
      this.strokeLine(pts[last * 2], pts[last * 2 + 1], pts[0], pts[1], style)
    }
  }

  // --- Gfx2D: fills --------------------------------------------------------

  fillRect(x: number, y: number, w: number, h: number, fill: GfxFill): void {
    this.#coloredTri.fillRect(this.#ctx, x, y, w, h, fill)
    if (this.#ctx.curDebugMode === 'polygons') {
      // Rect corners CCW starting from A. `emitDebugPolygonOutline`
      // handles the closing edge.
      const rectPts = [x, y, x + w, y, x + w, y + h, x, y + h]
      this.#emitDebugPolygonOutline(rectPts, 4, true)
    }
  }

  fillCircle(cx: number, cy: number, r: number, fill: GfxFill): void {
    this.#shape.fillCircle(this.#ctx, cx, cy, r, fill)
  }

  fillRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    fill: GfxFill,
  ): void {
    const rr = resolveRadii(radii, w, h)
    this.#shape.fillRoundRect(this.#ctx, x, y, w, h, rr, fill)
  }

  strokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    style: GfxStrokeStyle,
  ): void {
    const rr = resolveRadii(radii, w, h)
    const color = this.#flattenStrokeColor(style.color)
    this.#shape.strokeRoundRect(this.#ctx, x, y, w, h, rr, { ...style, color })
  }

  fillAndStrokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    fill: GfxFill,
    style: GfxStrokeStyle,
  ): void {
    const rr = resolveRadii(radii, w, h)
    const color = this.#flattenStrokeColor(style.color)
    this.#shape.fillAndStrokeRoundRect(this.#ctx, x, y, w, h, rr, fill, {
      ...style,
      color,
    })
  }

  fillAndStrokeCircle(
    cx: number,
    cy: number,
    r: number,
    fill: GfxFill,
    style: GfxStrokeStyle,
  ): void {
    const color = this.#flattenStrokeColor(style.color)
    this.#shape.fillAndStrokeCircle(this.#ctx, cx, cy, r, fill, {
      ...style,
      color,
    })
  }

  fillConvexPoly(pts: ArrayLike<number>, count: number, fill: GfxFill): void {
    this.#coloredTri.fillConvexPoly(this.#ctx, pts, count, fill)
    if (this.#ctx.curDebugMode === 'polygons') {
      this.#emitDebugPolygonOutline(pts, count, true)
    }
  }

  fillPath2D(path: Path2D, fill: GfxFill): void {
    const geo = getPathTessellation(path)
    if (!geo) {
      // Direct-Path2D fallback. The triangulator needs the `d` string which
      // isn't recoverable from a Path2D at runtime, so nodes that construct
      // Path2Ds outside `SvgPathMap` must call `registerTessellation`
      // explicitly. Silent counter tick surfaces it in the HUD.
      this.unimplemented.fillPath2D++
      return
    }
    // Retained geometry GPU-transforms a once-uploaded static buffer, saving
    // the per-vertex CPU transform. The retained shader carries neither the
    // bitmap clip mask's sampler, the debug recolor, nor a paint slot, so a
    // bitmap clip, a non-normal debug mode, or a gradient fill all fall back
    // to the streamed path (identical pixels either way, just a repeated
    // per-vertex CPU transform). The analytic clip is not one of them: the
    // retained shader reads the same group-0 clip block, so `setClip`
    // composes without giving up the fast path.
    if (
      typeof fill === 'string' &&
      geo.retained &&
      this.#ctx.stateStack.getClipMask() === null &&
      this.#ctx.curDebugMode === 'normal'
    ) {
      this.#coloredTri.fillTessellationRetained(this.#ctx, geo, fill)
    } else {
      this.#coloredTri.fillTessellation(this.#ctx, geo, fill)
    }
    if (this.#ctx.curDebugMode === 'polygons') {
      // fillPath2D can render multiple sub-paths, walk the contour list
      // registered with the tessellation so the outline matches the fill.
      const contours = getPathContours(path)
      if (contours) {
        for (let i = 0; i < contours.length; i++) {
          const c = contours[i]
          this.#emitDebugPolygonOutline(
            c,
            c.length / 2,
            getContourClosed(path, i),
          )
        }
      }
    }
  }

  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: readonly GfxGradientStop[],
  ): void {
    if (r <= 0 || stops.length === 0) return
    const rampRow = this.#textureManager.ensureStopsRow(stops, () =>
      this.#ctx.forceMidFrameSubmit(),
    )
    if (rampRow < 0) return
    const off = this.#gradientRadial.beginInstance(this.#ctx)
    if (off < 0) return
    const slot = this.#ctx.curSlot
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = r * Math.sqrt(det)
    const alpha = this.#ctx.stateStack.getAlpha()
    const f = this.#gradientRadial.floatView
    f[off + 0] = dcx
    f[off + 1] = dcy
    f[off + 2] = dr
    f[off + 3] = alpha
    f[off + 4] = rampRow
    f[off + 5] = 0
    this.#gradientRadial.commitInstance(slot)
  }

  fillMaskedRadialGradient(
    mask: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    gcx: number,
    gcy: number,
    gr: number,
    stops: readonly GfxGradientStop[],
  ): void {
    if (gr <= 0 || dw <= 0 || dh <= 0 || stops.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // Axis-aligned assumption (same as drawImage): the background base
    // transform never rotates/skews.
    if (Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9) return
    const rampRow = this.#textureManager.ensureStopsRow(stops, () =>
      this.#ctx.forceMidFrameSubmit(),
    )
    if (rampRow < 0) return
    const entry = this.#textureManager.getOrCreateEntry(mask)
    if (entry === null) return
    let tex: Texture
    let u0: number, v0: number, u1: number, v1: number
    if ('srcRect' in entry) {
      tex = entry.tex
      const r = entry.srcRect
      u0 = r[0]
      v0 = r[1]
      u1 = r[2]
      v1 = r[3]
    } else {
      tex = entry
      u0 = 0
      v0 = 0
      u1 = 1
      v1 = 1
    }
    const off = this.#maskedGradient.beginInstance(this.#ctx, tex)
    if (off < 0) return
    const slot = this.#ctx.curSlot
    const dstX = t.a * dx + t.e
    const dstY = t.d * dy + t.f
    const dstW = t.a * dw
    const dstH = t.d * dh
    const dcx = t.a * gcx + t.c * gcy + t.e
    const dcy = t.b * gcx + t.d * gcy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = gr * Math.sqrt(det)
    const alpha = this.#ctx.stateStack.getAlpha()
    const f = this.#maskedGradient.floatView
    f[off + 0] = dstX
    f[off + 1] = dstY
    f[off + 2] = dstW
    f[off + 3] = dstH
    f[off + 4] = u0
    f[off + 5] = v0
    f[off + 6] = u1
    f[off + 7] = v1
    f[off + 8] = dcx
    f[off + 9] = dcy
    f[off + 10] = dr
    f[off + 11] = alpha
    f[off + 12] = rampRow
    this.#maskedGradient.commitInstance(slot)
  }

  fillPolyLinearGradient(
    pts: ArrayLike<number>,
    count: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorStart: string,
    colorEnd: string,
  ): void {
    this.#coloredTri.fillPolyLinearGradient(
      this.#ctx,
      pts,
      count,
      x0,
      y0,
      x1,
      y1,
      colorStart,
      colorEnd,
    )
    if (this.#ctx.curDebugMode === 'polygons') {
      this.#emitDebugPolygonOutline(pts, count, true)
    }
  }

  // --- Gfx2D: shadows --------------------------------------------------------

  shadowRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    style: GfxShadowStyle,
  ): void {
    const rr = resolveRadii(radii, w, h)
    this.#shape.shadowRoundRect(this.#ctx, x, y, w, h, rr, style)
  }

  shadowCircle(cx: number, cy: number, r: number, style: GfxShadowStyle): void {
    this.#shape.shadowCircle(this.#ctx, cx, cy, r, style)
  }

  /** Local-space AABB of `path`'s tessellation, cached per registration epoch. */
  #localBoundsFor(path: Path2D, geo: { vertices: Float32Array }, epoch: number): Rect {
    const cached = this.#pathBoundsCache.get(path)
    if (cached && cached.epoch === epoch) return cached.bounds
    const v = geo.vertices
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (let i = 0; i < v.length; i += 2) {
      const x = v[i]
      const y = v[i + 1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const bounds: Rect =
      v.length === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    this.#pathBoundsCache.set(path, { epoch, bounds })
    return bounds
  }

  /** The path's own fill, translated by the shadow's offset, no blur. */
  #hardPathShadow(path: Path2D, style: GfxShadowStyle): void {
    this.save()
    this.translate(style.offsetX ?? 0, style.offsetY ?? 0)
    this.fillPath2D(path, style.color)
    this.restore()
  }

  shadowPath2D(path: Path2D, style: GfxShadowStyle): void {
    const geo = getPathTessellation(path)
    if (!geo) {
      this.unimplemented.shadowPath2D++
      return
    }
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const scaleX = Math.hypot(t.a, t.b)
    const scaleY = Math.hypot(t.c, t.d)
    const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1e-4
    const blur = Math.max(0, style.blur ?? 0)
    const sigmaDevice = blur * 0.5 * scale
    const inset = style.inset === true

    if (sigmaDevice * 2 <= HARD_SHADOW_BLUR_PX) {
      if (!inset) this.#hardPathShadow(path, style)
      return
    }

    const epoch = getRegistrationEpoch(path)
    const req: PathShadowRequest = {
      path,
      geometry: geo,
      localBounds: this.#localBoundsFor(path, geo, epoch),
      registrationEpoch: epoch,
      blur,
      spread: style.spread ?? 0,
      scaleX,
      scaleY,
      scale,
      quality: this.#ctx.vectorQuality,
    }
    const mask = this.#pathShadowCache.peek(req)
    if (!mask) {
      this.#pendingShadowBakes.set(this.#pathShadowCache.requestKey(req), req)
      if (!inset) {
        this.unimplemented.pathShadowFallback++
        this.#hardPathShadow(path, style)
      }
      return
    }

    const alpha = this.#ctx.stateStack.getAlpha()
    const offsetX = style.offsetX ?? 0
    const offsetY = style.offsetY ?? 0
    const offDx = t.a * offsetX + t.c * offsetY
    const offDy = t.b * offsetX + t.d * offsetY

    if (inset) {
      const rotatedOrSkewed = Math.abs(t.b) > 1e-4 || Math.abs(t.c) > 1e-4
      if (rotatedOrSkewed && !this.#warnedInsetShadowTransform) {
        this.#warnedInsetShadowTransform = true
        console.warn(
          'GpuGfx.shadowPath2D: an inset path shadow assumes an axis-aligned transform; rotation/skew is unsupported.',
        )
      }
      const c0x = t.a * mask.localX + t.c * mask.localY + t.e + offDx
      const c0y = t.b * mask.localX + t.d * mask.localY + t.f + offDy
      const c1x =
        t.a * (mask.localX + mask.localW) +
        t.c * (mask.localY + mask.localH) +
        t.e +
        offDx
      const c1y =
        t.b * (mask.localX + mask.localW) +
        t.d * (mask.localY + mask.localH) +
        t.f +
        offDy
      const originX = Math.min(c0x, c1x)
      const originY = Math.min(c0y, c1y)
      const width = Math.abs(c1x - c0x)
      const height = Math.abs(c1y - c0y)
      this.#coloredTri.fillTessellationInsetShadow(this.#ctx, geo, style.color, alpha, {
        kind: 'mask',
        originX,
        originY,
        invW: width > 0 ? 1 / width : 0,
        invH: height > 0 ? 1 / height : 0,
        maskTex: mask.texture,
      })
      return
    }

    const col0x = t.a * mask.localW
    const col0y = t.b * mask.localW
    const col1x = t.c * mask.localH
    const col1y = t.d * mask.localH
    const tx = t.a * mask.localX + t.c * mask.localY + t.e + offDx
    const ty = t.b * mask.localX + t.d * mask.localY + t.f + offDy
    const off = this.#pathShadowComposite.beginInstance(this.#ctx, mask.texture)
    if (off < 0) return
    const slot = this.#ctx.curSlot
    const f = this.#pathShadowComposite.floatView
    const u = this.#pathShadowComposite.uintView
    f[off + 0] = col0x
    f[off + 1] = col0y
    f[off + 2] = col1x
    f[off + 3] = col1y
    f[off + 4] = tx
    f[off + 5] = ty
    f[off + 6] = 0
    f[off + 7] = 0
    f[off + 8] = 1
    f[off + 9] = 1
    u[off + 10] = packColor(style.color, alpha)
    f[off + 11] =
      this.#ctx.stateStack.getBlend() !== 'lighter' && this.#ctx.vectorQuality.dither
        ? 1
        : 0
    this.#pathShadowComposite.commitInstance(slot)
  }

  /**
   * Drain this frame's queued path-shadow bake requests. Must run outside
   * any open render pass (the bake opens and closes its own), so callers
   * run it in the pre-`beginFrame` window: `Stage` before `screen
   * .beginFrame()`, `Viewport2DNode.renderOffscreen` before its own
   * `gpu.beginFrame()`. A request queued this way bakes at the earliest in
   * the FOLLOWING frame's draw, one frame behind the draw call that queued
   * it; `shadowPath2D` draws the hard fallback in the meantime.
   */
  processPendingShadowBakes(): void {
    this.#pathShadowCache.beginFrame()
    if (this.#pendingShadowBakes.size > 0) {
      for (const req of this.#pendingShadowBakes.values()) {
        this.#pathShadowCache.getOrBake(req)
      }
      this.#pendingShadowBakes.clear()
    }
    this.#pathShadowCache.pool.endFrame()
  }

  // --- Gfx2D: strokes ------------------------------------------------------

  /**
   * A gradient stroke on a circle or round rect is not reachable in this
   * version: `shape`'s paint slot (see `ShapeProgram`) serves the fill, and
   * giving a second shape kind its own paint slot for the stroke is a
   * follow-up, not something any caller needs yet. Falls back to the
   * gradient's first stop as a flat color, which is a reasonable degraded
   * look rather than a crash or a silently dropped stroke.
   */
  #flattenStrokeColor(color: GfxFill): string {
    return typeof color === 'string' ? color : color.stops[0]?.color ?? '#000'
  }

  strokeCircle(cx: number, cy: number, r: number, style: GfxStrokeStyle): void {
    const color = this.#flattenStrokeColor(style.color)
    this.#shape.strokeCircle(this.#ctx, cx, cy, r, { ...style, color })
  }

  /** Whether `style` needs the outline tessellator rather than the segment stroker. */
  #needsOutline(style: GfxStrokeStyle): boolean {
    return (
      (style.align !== undefined && style.align !== 'center') ||
      style.exactJoins === true ||
      typeof style.color !== 'string'
    )
  }

  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    if (this.#needsOutline(style)) {
      this.#strokeOutlineUncached([x0, y0, x1, y1], 2, false, style)
      return
    }
    this.#stroke.line(this.#ctx, x0, y0, x1, y1, style as SolidStrokeStyle)
  }

  strokeQuadratic(
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    if (this.#needsOutline(style)) {
      this.#ctx.txStack.read(this.#ctx.txOut)
      const t = this.#ctx.txOut
      const det = Math.abs(t.a * t.d - t.b * t.c)
      const localTol = CURVE_FLATTEN_TOL_PX / (Math.sqrt(det) || 1)
      const buf = new Float32Array(CURVE_FLATTEN_MAX_POINTS * 2)
      buf[0] = x0
      buf[1] = y0
      const cursor = flattenQuadratic(x0, y0, cx, cy, x1, y1, localTol, buf, 2)
      this.#strokeOutlineUncached(buf, cursor / 2, false, style)
      return
    }
    // Flattening turns one curve into many collinear segments, so a translucent
    // quadratic beads at every one of them. Segment count is not known until
    // the flattener runs, and a curve always has more than one.
    if (!this.#strokeNeedsStencil(style as SolidStrokeStyle, 2)) {
      this.#stroke.quadratic(
        this.#ctx,
        x0,
        y0,
        cx,
        cy,
        x1,
        y1,
        style as SolidStrokeStyle,
      )
      return
    }
    this.#ctx.beginStencilGroup()
    this.#stroke.quadratic(
      this.#ctx,
      x0,
      y0,
      cx,
      cy,
      x1,
      y1,
      style as SolidStrokeStyle,
    )
    this.#ctx.endStencilGroup()
  }

  /**
   * Whether a stroke of `segments` segments needs the deduplicating stencil
   * path.
   *
   * Only translucent strokes can bead: an opaque one composites to the same
   * result however many times it covers a pixel, so it stays on the plain,
   * fully batched path. A single segment has no interior join and so cannot
   * overlap itself either.
   */
  #strokeNeedsStencil(style: SolidStrokeStyle, segments: number): boolean {
    if (segments < 2 || !this.#target.hasStencil) return false
    const alpha = this.#ctx.stateStack.getAlpha() * parseColor(style.color).a
    return alpha < 1
  }

  /** Current transform's per-axis device scale, for the outline tessellator. */
  #outlineScale(): { scaleX: number; scaleY: number; scale: number } {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const scaleX = Math.hypot(t.a, t.b)
    const scaleY = Math.hypot(t.c, t.d)
    return { scaleX, scaleY, scale: Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) }
  }

  /**
   * Tessellate and draw a stroke outline with no caching: `strokePolyline`'s
   * `pts` has no stable identity to key by (the caller mutates its buffer
   * every frame), and `strokeLine`/`strokeQuadratic` are cheap one-or-few
   * segment shapes where a cache would cost more than it saves.
   */
  #strokeOutlineUncached(
    pts: ArrayLike<number>,
    count: number,
    closed: boolean,
    style: GfxStrokeStyle,
  ): void {
    if (count < 2 || style.width <= 0) return
    const { scaleX, scaleY, scale } = this.#outlineScale()
    const buf = new StrokeOutlineBuffer()
    strokeOutline(
      pts,
      count,
      {
        width: style.width,
        align: style.align ?? 'center',
        join: style.join ?? 'miter',
        cap: style.cap ?? 'round',
        miterLimit: style.miterLimit ?? DEFAULT_MITER_LIMIT,
        closed,
        fringeScale: { x: scaleX, y: scaleY },
        scale,
      },
      buf,
    )
    this.#coloredTri.fillOutlineTessellation(this.#ctx, buf, style.color)
  }

  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    if (this.#needsOutline(style)) {
      this.#strokeOutlineUncached(pts, count, style.closed === true, style)
      return
    }
    // A closed polyline joins back to its first point, so it has one more
    // segment than an open one.
    const segments = style.closed === true ? count : count - 1
    const solidStyle = style as SolidStrokeStyle
    if (!this.#strokeNeedsStencil(solidStyle, segments)) {
      this.#stroke.polyline(this.#ctx, pts, count, solidStyle)
      return
    }
    this.#ctx.beginStencilGroup()
    this.#stroke.polyline(this.#ctx, pts, count, solidStyle)
    this.#ctx.endStencilGroup()
  }

  /**
   * Tessellate (or reuse the cached tessellation of) one contour's stroke
   * outline. Keyed by the style signature, the half-octave scale and
   * anisotropy buckets, and the path's registration epoch, so a re-parse at
   * a new tolerance can't serve triangles built from stale contours.
   * `dash` is not supported on the outline path and is ignored here: no
   * caller combines it with a gradient color, a non-center alignment, or
   * `exactJoins` today.
   */
  #strokeOutlineCached(
    path: Path2D,
    contourIndex: number,
    pts: Float32Array,
    closed: boolean,
    style: GfxStrokeStyle,
  ): void {
    if (pts.length < 4 || style.width <= 0) return
    const { scaleX, scaleY } = this.#outlineScale()
    const uniformScale = Math.sqrt(scaleX * scaleY)
    const anisotropy = scaleY > 0 ? scaleX / scaleY : 1
    const scaleBucket = scaleBucketIndex(uniformScale)
    const anisoBucket = scaleBucketIndex(anisotropy)
    const align = style.align ?? 'center'
    const join = style.join ?? 'miter'
    const cap = style.cap ?? 'round'
    const miterLimit = style.miterLimit ?? DEFAULT_MITER_LIMIT
    const key = `${style.width}|${align}|${join}|${cap}|${miterLimit}|${closed}|${scaleBucket}|${anisoBucket}|${getRegistrationEpoch(path)}|${contourIndex}`
    let buf = getCachedOutline(path, key)
    if (buf) {
      this.stats.outlineCacheHits++
    } else {
      this.stats.outlineTessellations++
      const uniformCenter = scaleBucketCenter(scaleBucket)
      const anisoCenter = scaleBucketCenter(anisoBucket)
      const bucketScaleX = uniformCenter * Math.sqrt(anisoCenter)
      const bucketScaleY = uniformCenter / Math.sqrt(anisoCenter)
      buf = new StrokeOutlineBuffer()
      strokeOutline(
        pts,
        pts.length / 2,
        {
          width: style.width,
          align,
          join,
          cap,
          miterLimit,
          closed,
          fringeScale: { x: bucketScaleX, y: bucketScaleY },
          scale: uniformCenter,
        },
        buf,
      )
      setCachedOutline(path, key, buf)
    }
    this.#coloredTri.fillOutlineTessellation(this.#ctx, buf, style.color)
  }

  strokePath2D(path: Path2D, style: GfxStrokeStyle): void {
    const contours = getPathContours(path)
    if (!contours) {
      // No cached contours for this Path2D. Callers that construct
      // Path2Ds outside SvgPathMap must call `registerTessellation`
      // (which also stashes contours), the counter surfaces missing
      // registrations in the HUD.
      this.unimplemented.strokePath2D++
      return
    }
    if (this.#needsOutline(style)) {
      for (let i = 0; i < contours.length; i++) {
        const c = contours[i]
        if (c.length / 2 < 2) continue
        this.#strokeOutlineCached(path, i, c, getContourClosed(path, i), style)
      }
      return
    }
    // Total across every contour, counted first: the whole path is one stroke
    // and so one stencil group, and a path holding a single segment needs no
    // group at all.
    let segments = 0
    for (let i = 0; i < contours.length; i++) {
      const count = contours[i].length / 2
      if (count < 2) continue
      segments += getContourClosed(path, i) ? count : count - 1
    }
    const solidStyle = style as SolidStrokeStyle
    const stencil = this.#strokeNeedsStencil(solidStyle, segments)
    if (stencil) this.#ctx.beginStencilGroup()
    for (let i = 0; i < contours.length; i++) {
      const c = contours[i]
      const count = c.length / 2
      if (count < 2) continue
      const closed = getContourClosed(path, i)
      const perContourStyle: SolidStrokeStyle = { ...solidStyle, closed }
      this.#stroke.polyline(this.#ctx, c, count, perContourStyle)
    }
    if (stencil) this.#ctx.endStencilGroup()
  }

  // --- Gfx2D: images -------------------------------------------------------

  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const entry = this.#textureManager.getOrCreateEntry(img)
    if (entry === null) return
    // Discriminate atlas entry vs standalone Texture. Atlas entries carry
    // a `srcRect` field, standalone Textures don't.
    let tex: Texture
    let u0: number, v0: number, u1: number, v1: number
    if ('srcRect' in entry) {
      tex = entry.tex
      const r = entry.srcRect
      u0 = r[0]
      v0 = r[1]
      u1 = r[2]
      v1 = r[3]
    } else {
      tex = entry
      u0 = 0
      v0 = 0
      u1 = 1
      v1 = 1
    }
    // Full affine (shares the shape/textQuad layout): the unit square [0,1]²
    // maps to device px via mCol0·u + mCol1·v + translate, so rotation/skew are
    // free, with no axis-aligned rejection.
    const col0x = t.a * dw
    const col0y = t.b * dw
    const col1x = t.c * dh
    const col1y = t.d * dh
    let tx = t.a * dx + t.c * dy + t.e
    let ty = t.b * dx + t.d * dy + t.f
    // Subpixel-snap only when axis-aligned (matches fillText): land 1:1 texels
    // on whole device pixels so blits don't smear. Skip when rotated/skewed.
    if (Math.abs(t.b) < 1e-6 && Math.abs(t.c) < 1e-6) {
      tx = Math.round(tx)
      ty = Math.round(ty)
    }
    const alpha = this.#ctx.stateStack.getAlpha()
    const tintByte = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    const packedTint =
      ((tintByte << 24) | (tintByte << 16) | (tintByte << 8) | tintByte) >>> 0
    // Shape routing: only atlas sprites (the particle atlas bound at the shape's
    // fixed atlas unit) go through it. A per-source image has its own texture,
    // which the shape doesn't bind, so it stays on the textQuad program.
    if (tex === this.#textureManager.getAtlasTexture()) {
      this.#shape.textured(
        this.#ctx,
        col0x,
        col0y,
        col1x,
        col1y,
        tx,
        ty,
        u0,
        v0,
        u1,
        v1,
        SHAPE_TEX_ATLAS,
        packedTint,
      )
      return
    }
    const words = this.#textQuad.beginInstance(this.#ctx, tex)
    if (words < 0) return
    const slot = this.#ctx.curSlot
    const fv = this.#textQuad.floatView
    const uv = this.#textQuad.uintView
    fv[words + 0] = col0x
    fv[words + 1] = col0y
    fv[words + 2] = col1x
    fv[words + 3] = col1y
    fv[words + 4] = tx
    fv[words + 5] = ty
    fv[words + 6] = u0
    fv[words + 7] = v0
    fv[words + 8] = u1
    fv[words + 9] = v1
    uv[words + 10] = packedTint >>> 0
    this.#textQuad.commitInstance(slot)
  }

  // --- Gfx2D: text ---------------------------------------------------------

  warmText(text: string, style: GfxTextStyle = {}): void {
    if (text.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const deviceScale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    if (!(deviceScale > 0)) return
    const resolved: LabelStyle = {
      font: style.font ?? DEFAULT_LABEL_FONT,
      align: style.align ?? 'left',
      baseline: style.baseline ?? 'alphabetic',
      color: style.color ?? '#000',
    }
    this.#textureManager.ensureLabelTexture(
      labelBaseKey(text, resolved),
      text,
      resolved,
      deviceScale,
    )
  }

  fillText(text: string, x: number, y: number, style: GfxTextStyle = {}): void {
    if (text.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // Net local→device scale, independent of rotation (columns of the linear
    // part). Drives how sharply the label is rasterized. Rotation is free.
    const deviceScale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    if (!(deviceScale > 0)) return

    const resolved: LabelStyle = {
      font: style.font ?? DEFAULT_LABEL_FONT,
      align: style.align ?? 'left',
      baseline: style.baseline ?? 'alphabetic',
      color: style.color ?? '#000',
    }
    const label = this.#textureManager.ensureLabelTexture(
      labelBaseKey(text, resolved),
      text,
      resolved,
      deviceScale,
    )
    if (label === null) return

    // Local-space dst rect: bitmap top-left relative to the (x, y) anchor.
    const dx = x - label.anchorOffsetX
    const dy = y - label.anchorOffsetY
    const w = label.localW
    const h = label.localH
    // Affine mapping the unit square [0,1]² → device px:
    //   pos = col0 * u + col1 * v + translate
    const col0x = t.a * w
    const col0y = t.b * w
    const col1x = t.c * h
    const col1y = t.d * h
    let tx = t.a * dx + t.c * dy + t.e
    let ty = t.b * dx + t.d * dy + t.f
    // Subpixel snap for axis-aligned draws (all screen-space labels, and any
    // non-rotated world label): land the 1:1 texels on whole device pixels so
    // they don't smear. Skip when rotated/skewed (snapping wouldn't align).
    if (Math.abs(t.b) < 1e-6 && Math.abs(t.c) < 1e-6) {
      tx = Math.round(tx)
      ty = Math.round(ty)
    }

    // Tint = white × alpha (premultiplied). Baked glyph color is preserved,
    // this only applies the current alpha (and keeps emoji multi-color).
    const alpha = this.#ctx.stateStack.getAlpha()
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    const packedTint = ((a << 24) | (a << 16) | (a << 8) | a) >>> 0

    // Sample the label's region in its texture: a sub-rect of the shared label
    // page, or the whole texture ([0,0,1,1]) for an oversized dedicated label.
    const sr = label.srcRect
    // Shape routing: only page-backed labels (the shared label page bound at the
    // shape's fixed label unit) can go through it. An oversized label has its own
    // texture, so it stays on the textQuad program.
    if (label.tex === this.#textureManager.getLabelPageTexture()) {
      this.#shape.textured(
        this.#ctx,
        col0x,
        col0y,
        col1x,
        col1y,
        tx,
        ty,
        sr[0],
        sr[1],
        sr[2],
        sr[3],
        SHAPE_TEX_LABEL,
        packedTint,
      )
      return
    }

    const words = this.#textQuad.beginInstance(this.#ctx, label.tex)
    if (words < 0) return
    const slot = this.#ctx.curSlot
    const fv = this.#textQuad.floatView
    const uv = this.#textQuad.uintView
    fv[words + 0] = col0x
    fv[words + 1] = col0y
    fv[words + 2] = col1x
    fv[words + 3] = col1y
    fv[words + 4] = tx
    fv[words + 5] = ty
    fv[words + 6] = sr[0] // u0
    fv[words + 7] = sr[1] // v0
    fv[words + 8] = sr[2] // u1
    fv[words + 9] = sr[3] // v1
    uv[words + 10] = packedTint
    this.#textQuad.commitInstance(slot)
  }

  // --- registration (called by asset loaders) -------------------------------

  /**
   * Install a tessellation for a given `Path2D` so subsequent `fillPath2D(path,
   * …)` and `strokePath2D(path, …)` calls resolve against a cached
   * triangulation / contour set. Delegates to the process-wide
   * `PathTessellationRegistry`. Nodes and asset loaders can also register there
   * directly.
   */
  registerTessellation(
    path: Path2D,
    geometry: GeometryHandle,
    contours?: Float32Array[],
  ): void {
    registerPathTessellation(path, geometry, contours)
  }

  #updateProjection(w: number, h: number): void {
    // Device-px → clip with Y-flip.
    // clip.x = 2 * x / w - 1
    // clip.y = 1 - 2 * y / h
    // As a column-major mat3:
    //   col 0: [2/w, 0, 0]
    //   col 1: [0, -2/h, 0]
    //   col 2: [-1, 1, 1]
    const p = this.#ctx.projMat
    p[0] = 2 / w
    p[1] = 0
    p[2] = 0
    p[3] = 0
    p[4] = -2 / h
    p[5] = 0
    p[6] = -1
    p[7] = 1
    p[8] = 1
  }
}
