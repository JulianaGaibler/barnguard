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
  GfxBlend,
  GfxClipShape,
  GfxMatteMode,
  GfxOffscreenHandle,
  GfxOffscreenOptions,
  GfxSurfaceCache,
  GfxSurfaceEffects,
  GfxFill,
  GfxLinearGradient,
  GfxGradientStop,
  GfxImageOptions,
  GfxShadowStyle,
  GfxStrokeStyle,
  GfxTextStyle,
  SolidStrokeStyle,
} from './Gfx2D'
import type { RenderTarget, TargetFormat, Texture, VBuffer } from './GfxDevice'
import type { GfxDevice } from './GfxDevice'
import { depthStencilFormatOf } from './depthStencil'
import { parseColor } from './parseColor'
import { RenderFailures } from './RenderFailures'
import type { GeometryHandle } from './GeometryHandle'
import {
  RetainedCache,
  type RetainedCacheStats,
  type RetainedEntry,
} from './RetainedCache'
import { copySignature, signaturesEqual } from '../layer/LayerSignature'
import {
  getContourClosed,
  getPathContours,
  getPathTessellation,
  getRegistrationEpoch,
  registerPathTessellation,
} from './PathTessellationRegistry'
import {
  strokeOutline,
  scaleBucketCenter,
  scaleBucketIndex,
  StrokeOutlineBuffer,
  DEFAULT_MITER_LIMIT,
  wouldFallBackToCenter,
} from './strokeOutline'
import {
  flattenQuadratic,
  tessellateContours,
} from '../../assets/SvgPathContours'
import { GfxPath, type FlatPath } from './GfxPath'
import { appendStrokeFill } from './pathStroke'
import { DashBuffer } from './dash'
import { SurfacePool, type Surface } from './OffscreenSurfaces'
import { RenderTargetPool } from './RenderTargetPool'
import { PostChain } from '../postfx/PostChain'
import type { PostEffect } from '../postfx/PostEffect'
import {
  PASS_GPU_GRACE_FRAMES,
  PostProgramCache,
} from '../postfx/PostProgramCache'
import {
  OffscreenCompositeProgram,
  type CompositeDraw,
} from './programs/offscreenComposite'
import type { PassHooks } from './GpuBatchContext'
import { MAX_CLIP_DEPTH } from './stencilRecipe'
import type { ClipBounds } from './programs/coloredTri'
import type { FillRule } from './stencilRecipe'
import {
  TextureManager,
  type LabelFontTemplate,
  type LabelTexture,
  type TextureInspector,
} from './TextureManager'
import { evictOldest } from './evictOldest'
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
  type ResolvedMaskPaint,
} from './GpuBatchContext'
import type { GpuProgram } from './GpuProgram'
import { ColoredTriProgram } from './programs/coloredTri'
import { StrokeProgram } from './programs/stroke'
import { resolveRadii, type RoundRectRadii } from './roundRectRadii'

const NO_CLIP_RADII = [0, 0, 0, 0] as const
import { fitSquircleCorners, squircleShadowRadiusScale } from './squircle'
import { GradientRadialProgram } from './programs/gradientRadial'
import { MaskedGradientProgram } from './programs/maskedGradient'
import { ShaderQuadProgram } from './programs/shaderQuad'
import type { ShaderQuad } from './ShaderQuad'
import { TextQuadProgram } from './programs/textQuad'
import { ShapeProgram } from './programs/shape'
import { SHAPE_TEX_ATLAS, SHAPE_TEX_LABEL } from './batchLayout'
import { PathShadowCompositeProgram } from './programs/pathShadowComposite'
import {
  PathShadowCache,
  HARD_SHADOW_BLUR_PX,
  insetMaskProjection,
  type PathShadowRequest,
} from './PathShadowCache'
import type { Rect } from '../../math/Rect'

/**
 * The scale-independent half of a label's cache key. `TextureManager` appends
 * the scale bucket. Newline separators cannot collide: labels are single-line,
 * so the text has none, and font/align/baseline/color never do.
 */
/**
 * `style` with a flat color, for the circle and round-rect strokes. A gradient
 * stroke on those shapes is not supported: the `shape` program's paint slot
 * serves the fill. It falls back to the gradient's first stop rather than
 * dropping the stroke. A style that already has a flat color is returned as is,
 * so the common case copies nothing.
 */
function solidStroke(style: GfxStrokeStyle): SolidStrokeStyle {
  const color = style.color
  if (typeof color === 'string') return style as SolidStrokeStyle
  return { ...style, color: color.stops[0]?.color ?? '#000' }
}

/** The style a `fillText` call without one draws with. */
const NO_TEXT_STYLE: GfxTextStyle = {}

const FONT_SIZE = /(\d*\.?\d+)px/
/** A font split around its px size, with that size, or `null` without one. */
interface LabelFont extends LabelFontTemplate {
  size: number
}
/** Fonts recently drawn, split around their size. */
const LABEL_FONTS = new Map<string, LabelFont | null>()

function labelFont(font: string): LabelFont | null {
  let hit = LABEL_FONTS.get(font)
  if (hit !== undefined) return hit
  const m = FONT_SIZE.exec(font)
  const size = m ? Number(m[1]) : NaN
  hit =
    m && Number.isFinite(size) && size > 0
      ? {
          head: font.slice(0, m.index),
          tail: font.slice(m.index + m[0].length),
          size,
        }
      : null
  if (LABEL_FONTS.size >= 256) evictOldest(LABEL_FONTS)
  LABEL_FONTS.set(font, hit)
  return hit
}

function labelBaseKey(text: string, style: LabelStyle): string {
  return `${text}\n${style.font}\n${style.align}\n${style.baseline}\n${style.color}\n`
}

export type { DebugRenderMode, GpuGfxStats }

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
   * An outset path shadow drew the hard (unblurred) silhouette because its mask
   * was cold (this frame's first request), starved (budget exhausted), or
   * disabled (`quality.vector.pathShadowsEnabled === false`), and the cache had
   * no nearby blur of the same path to stand in either. Does not cover an inset
   * shadow skipped for the same reason, since that has no silent-degradation
   * draw to count, it just doesn't draw.
   */
  pathShadowFallback: number
  /**
   * A non-center `align` (or an outline-routed stroke's alignment) was refused
   * on an open or zero-area contour and fell back to `'center'` (see
   * `strokeOutline.ts`'s `resolveAlign`). Ticked on every occurrence,
   * independent of the one-time console warning.
   */
  strokeAlignFallback: number
}

/**
 * Fewest segments a path stroke has before its packed instances are worth
 * keeping on the GPU between frames.
 */
const RETAIN_STROKE_SEGMENTS = 256

/**
 * Fewest indices a gradient or masked fill has before its tessellation is worth
 * keeping on the GPU between frames.
 */
const RETAIN_FILL_INDICES = 64

/** The blend modes an offscreen composite supports. */
const COMPOSITE_BLENDS = new Set<string>([
  'source-over',
  'lighter',
  'screen',
  'multiply',
  'destination-out',
  'destination-in',
  'xor',
])

/**
 * Effects to run over an offscreen surface, from `beginOffscreen` until the
 * surface's pass closes.
 */
interface SurfaceEffectsJob {
  chain: PostChain
  effects: readonly PostEffect[]
  /** Where the chain writes, a target the composite then samples. */
  out: RenderTarget | null
  /**
   * The cache entry the result is kept in, for a cached layer. It is valid once
   * the chain has run, and then holds `signature` and the region.
   */
  entry: LayerCacheEntry | null
  signature: Float64Array | null
  signatureLength: number
  x: number
  y: number
}

/**
 * The kept render of a cached layer: the processed result and what it was made
 * from. The target is the entry's own for as long as the region keeps its
 * size.
 */
interface LayerCacheEntry extends RetainedEntry {
  out: RenderTarget
  /** Where the region sat in the target, and its size. */
  x: number
  y: number
  w: number
  h: number
  colorSpace: string
  /** The signature of what was drawn, valid up to `signatureLength`. */
  signature: Float64Array
  signatureLength: number
  /** Whether `out` holds a finished render of `signature`. */
  valid: boolean
}

/** The rectangle of a texture a composite draws, a surface or an effects result. */
type CompositeSource = Pick<
  Surface,
  'tex' | 'texW' | 'texH' | 'x' | 'y' | 'w' | 'h'
>

/**
 * The state surface effects need on one device: the compiled passes shared by
 * every chain, a pool for the chains' targets, and a chain per owner.
 */
interface EffectState {
  programs: PostProgramCache
  pool: RenderTargetPool
  chains: Map<object, { chain: PostChain; unseen: number }>
  /** The kept renders of cached layers, one per layer. */
  layers: RetainedCache<LayerCacheEntry>
  /** Cached layers drawn from their kept render this frame. */
  layerHits: number
}

/** An open `beginOffscreen`, kept until its `endOffscreen`. */
interface OffFrame {
  /**
   * The surface being drawn into, `null` for a cached layer drawn from its kept
   * render.
   */
  surface: Surface | null
  /** The kept render composited in place of drawing, for a cache hit. */
  hit: LayerCacheEntry | null
  /** The effects to run over the surface, `null` for a plain surface. */
  fx: SurfaceEffectsJob | null
  alpha: number
  blend: GfxBlend
  retain: boolean
  matte: GfxOffscreenHandle | null
  matteMode: GfxMatteMode
  clipDepth: number
  clipPushes: ClipPush[]
  saveLevel: number
  passSamples: number
}

/** What a `GfxOffscreenHandle` holds. */
interface OffscreenHandle {
  surface: Surface
}

/** One clip path pushed by `clipPath`, undone by the `restore` of its level. */
interface ClipPush {
  level: number
  /** Device bounds to pop, `null` when the clip raised no pixels. */
  bounds: ClipBounds | null
  /** Whether the depth went up, `false` when the depth cap refused it. */
  raised: boolean
}

/** The segments a flattened path strokes, counting the closing one. */
function flatSegments(flat: FlatPath): number {
  let n = 0
  for (let c = 0; c < flat.contourCount; c++) {
    const len = flat.starts[c + 1] - flat.starts[c]
    if (len < 1) continue
    n += flat.closed[c] === 1 ? len : len - 1
  }
  return n
}

/** Whether the first enabled effect removes fine detail from its input. */
function firstEffectSmooths(effects: readonly PostEffect[]): boolean {
  for (const effect of effects) {
    if (effect.enabled) return effect.smoothsInput === true
  }
  return false
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
  readonly #shaderQuad = new ShaderQuadProgram()
  #warnedQuadClipMask = false
  readonly #textQuad = new TextQuadProgram()
  readonly #shape = new ShapeProgram()
  readonly #pathShadowComposite = new PathShadowCompositeProgram()
  readonly #composite = new OffscreenCompositeProgram()

  /**
   * Cached blurred-coverage masks for arbitrary-path drop shadows. Unlike the
   * other programs, not re-warmed on retarget: its raster/blur targets are its
   * own private r8/rg8 targets, independent of the screen target's format,
   * depth, stencil, or sample count.
   */
  #pathShadowCache!: PathShadowCache
  readonly #pathBoundsCache = new WeakMap<
    Path2D,
    { epoch: number; bounds: Rect }
  >()
  /**
   * This frame's distinct (path, style, scale-bucket) requests that missed the
   * cache, drained by `processPendingShadowBakes` in next frame's
   * pre-`beginFrame` window.
   */
  readonly #pendingShadowBakes = new Map<string, PathShadowRequest>()
  /**
   * Multiples of its own device scale that the next drawn frame's path shadows
   * also bake a mask for, and the requests collecting them produced. See
   * `warmPathShadows`.
   */
  #shadowWarmFactors: readonly number[] = []
  readonly #shadowWarmups = new Map<string, PathShadowRequest>()

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
    uboSlices: 0,
    runsMerged: 0,
    primitives: 0,
    bytesUploaded: 0,
    streamedBytes: {},
    passCount: 0,
    framePasses: 0,
    frameSubmits: 0,
    frameBindGroupsCreated: 0,
    frameBindGroupSwitches: 0,
    frameUniformWrites: 0,
    surfaces: 0,
    offscreenBytes: 0,
    sdfInstances: 0,
    strokeInstances: 0,
    roundRectInstances: 0,
    shadowInstances: 0,
    msaaSamples: 1,
    outlineTessellations: 0,
    outlineCacheHits: 0,
    rampRowsWritten: 0,
    labelRasters: 0,
    labelUploadBytes: 0,
    labelDedicated: 0,
    labelHolds: 0,
    labelPageWipes: 0,
    labelEntries: 0,
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
    strokeAlignFallback: 0,
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
   * Whether `endFrame` blits the target to the canvas. `false` when another
   * pass samples the resolved color texture instead.
   */
  #present: boolean
  /**
   * Single-sample resolve target, allocated only when the main target is MSAA.
   * The main pass resolves into it on `endRenderPass`. `present` blits it to
   * the canvas (single-sample, so scaling is allowed) and a post-process pass
   * samples it.
   */
  #resolveTarget: RenderTarget | null = null
  /**
   * Whether pipelines have finished their async pre-warm. The stage skips
   * rendering until this is true (WebGL2 resolves within a microtask, WebGPU
   * takes longer).
   */
  #ready = false
  /** Programs whose pipelines failed to build. They draw nothing. */
  readonly failures: RenderFailures
  #warmupSeq = 0
  /** Whether the target is drawn in the canvas's own format. */
  readonly #canvasFormat: boolean
  readonly #holdLabels: boolean
  /** Resolves when the current warm-up completes, awaited by tests. */
  #warmupPromise: Promise<void> = Promise.resolve()

  constructor(
    canvas: HTMLCanvasElement,
    device: GfxDevice,
    opts: {
      samples?: number
      present?: boolean
      /**
       * Draw in the canvas's own format, so the frame's last pass can resolve
       * straight into the canvas instead of into a target that is copied
       * there.
       */
      canvas?: boolean
      stencil?: boolean
      vectorQuality?: VectorQuality
      /** Where build failures are reported. Defaults to a private collector. */
      failures?: RenderFailures
      /** See {@link TextureManager.holdLabels}. Default `true`. */
      holdLabels?: boolean
    } = {},
  ) {
    this.failures = opts.failures ?? new RenderFailures()
    this.#canvas = canvas
    this.#device = device
    this.#samples = opts.samples ?? 4
    this.#present = opts.present ?? true
    this.#canvasFormat = opts.canvas ?? false
    this.#stencilEnabled = opts.stencil ?? false
    this.#holdLabels = opts.holdLabels ?? true
    this.#targetWidth = canvas.width || 1
    this.#targetHeight = canvas.height || 1
    this.#target = null as unknown as RenderTarget
    this.#textureManager = null as unknown as TextureManager
    this.#ctx = new GpuBatchContext(device, this.stats)
    this.#pool = new SurfacePool(device)
    this.#ctx.vectorQuality = opts.vectorQuality ?? new VectorQuality()
    this.#ctx.registerProgram(this.#coloredTri)
    this.#ctx.registerProgram(this.#coloredTri.fan)
    this.#ctx.registerProgram(this.#stroke)
    this.#ctx.registerProgram(this.#composite)
    this.#ctx.registerProgram(this.#shape)
    this.#ctx.registerProgram(this.#gradientRadial)
    this.#ctx.registerProgram(this.#maskedGradient)
    this.#ctx.registerProgram(this.#textQuad)
    this.#ctx.registerProgram(this.#pathShadowComposite)
    this.#ctx.registerProgram(this.#shaderQuad)
    this.#initGpuResources()
  }

  /** All draw programs, in construction/registration order. */
  get #programs(): GpuProgram[] {
    return [
      this.#coloredTri,
      this.#coloredTri.fan,
      this.#stroke,
      this.#shape,
      this.#gradientRadial,
      this.#maskedGradient,
      this.#textQuad,
      this.#pathShadowComposite,
      this.#shaderQuad,
      this.#composite,
    ]
  }

  /** Whether pipelines are warm and the surface can render this frame. */
  get ready(): boolean {
    return this.#ready
  }

  /** Resolves once pipelines have warmed, when {@link ready} turns true. */
  get whenReady(): Promise<void> {
    return this.#warmupPromise
  }

  /**
   * Whether a surface effect's pipeline is still compiling. A surface whose
   * effects are not compiled yet composites unprocessed.
   */
  get effectsCompiling(): boolean {
    return this.#fx?.programs.compiling ?? false
  }

  /** Resolves once the surface effect pipelines compiling now have finished. */
  whenEffectsCompiled(): Promise<void> {
    return this.#fx?.programs.whenCompiled() ?? Promise.resolve()
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
    // sample this draw. The contents are never read, but a texture bound while
    // still uninitialised makes the driver clear it on first use and warn, so
    // it gets one white texel.
    this.#ctx.placeholderTexture = device.createTexture2D({
      width: 1,
      height: 1,
      filter: 'nearest',
      wrap: 'clamp',
    })
    if (typeof ImageData !== 'undefined') {
      device.updateTexture2D(
        this.#ctx.placeholderTexture,
        new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1),
      )
    }
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
      colorSpace: this.#canvasFormat ? 'canvas' : undefined,
    })
    this.stats.msaaSamples = this.#target.samples
    this.#publishTargetFormat()
    this.#ensureResolveTarget()

    if (this.#textureManager) {
      this.#textureManager.rebuild(device)
    } else {
      this.#textureManager = new TextureManager(device)
      this.#textureManager.holdLabels = this.#holdLabels
    }
    this.#ctx.textureManager = this.#textureManager

    // Old handles (if any) died with the previous context; no explicit
    // teardown call reaches them, same as every other GPU resource rebuilt
    // here. Its own pipelines are independent of the screen target's format,
    // so this is the only place it's (re)built, unlike `#programs`.
    this.#pathShadowCache = new PathShadowCache(device)
    this.#pathShadowCache
      .warmup()
      .catch((err) => this.failures.report('path shadows', err))
    this.#pool.dispose()
    // Anything the effects held lived on the old context.
    this.#fx?.layers.clear(false)
    this.#fx = null
    this.#fxJobs.clear()

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
    this.#ctx.resetPipelineSets()
    for (const p of this.#programs) {
      try {
        await p.warmup(this.#device, this.#ctx)
      } catch (err) {
        // The program draws nothing. Everything else still renders.
        this.failures.report(`2D program '${p.kind}'`, err)
      }
      if (seq !== this.#warmupSeq) return
    }
    // The first frame waits for the smooth-corner field, so a smoothed shape
    // never draws with circular corners first.
    await this.#textureManager.loadSquircleField()
    if (seq === this.#warmupSeq) this.#ready = true
  }

  /**
   * Whether the frame resolves straight into the canvas: a canvas-format target
   * that presents, with samples to resolve.
   */
  get #resolvesToCanvas(): boolean {
    return this.#canvasFormat && this.#present && this.#target.samples > 1
  }

  /** Where the main pass resolves its samples, if anywhere. */
  #resolveDestination(): RenderTarget | undefined {
    if (this.#resolvesToCanvas) return this.#device.canvasTarget()
    return this.#resolveTarget ?? undefined
  }

  /**
   * Allocate (or reallocate) the single-sample resolve target when the main
   * target is MSAA and something samples the result. Drops it when not. Matches
   * the main target's size + color space so the MSAA resolve is format- and
   * bounds-compatible. A frame that resolves into the canvas has no use for
   * it.
   */
  #ensureResolveTarget(): void {
    if (this.#target.samples > 1 && !this.#resolvesToCanvas) {
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
   * `TextureManager`'s own snapshot carries an always-empty `shadowMasks` (it
   * has no reference to `PathShadowCache`), filled in here since this is the
   * one place both are reachable together.
   */
  get textureInspector(): TextureInspector {
    const textureManager = this.#textureManager
    const pathShadowCache = this.#pathShadowCache
    return {
      snapshot: () => ({
        ...textureManager.snapshot(),
        shadowMasks: pathShadowCache.listMasks(),
      }),
      renderLabelPreview: (key) => textureManager.renderLabelPreview(key),
    }
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
    this.#ctx.passSamples = this.#target.samples
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
    this.#pool.dispose()
    this.#device.deleteRenderTarget(this.#target)
    this.#target = this.#device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
      depth: this.#depthEnabled,
      stencil: this.#stencilEnabled,
      colorSpace: this.#canvasFormat ? 'canvas' : undefined,
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
    this.#frameNo++
    const used = this.#gradientUsePrev
    this.#gradientUsePrev = this.#gradientUse
    this.#gradientUse = used
    used.clear()
    this.#stroke.cache.sweep(this.#frameNo)
    this.#coloredTri.geometryCache.sweep(this.#frameNo)
    this.#strokePieces.sweep(this.#frameNo)
    this.#outlines.sweep(this.#frameNo)
    if (this.#fx) {
      this.#fx.layers.sweep(this.#frameNo)
      this.#fx.layerHits = 0
    }
    this.#clipPushes.length = 0
    this.#saveLevel = 0
    // Reset per-frame stats so the HUD reflects the frame just rendered.
    this.stats.drawCalls = 0
    this.stats.programSwitches = 0
    this.stats.textureBinds = 0
    this.stats.blendSwitches = 0
    this.stats.uboSlices = 0
    this.stats.bytesUploaded = 0
    this.stats.passCount = 0
    this.stats.surfaces = 0
    this.stats.sdfInstances = 0
    this.stats.primitives = 0
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
    this.#clear = clear
    this.#ctx.curBlend = 'source-over'
  }

  // --- offscreen surfaces and pass control ----------------------------------

  /**
   * Emit `performance.measure` spans around the frame's submit phases. The
   * stage mirrors `engine.perfMarks` into it.
   *
   * @internal
   */
  perfMarks = false
  #pool: SurfacePool
  /** The main pass's clear colour, set by `beginFrame`. */
  #clear: readonly [number, number, number, number] = [0, 0, 0, 0]
  #mainPrelude: (() => void) | null = null
  /** Record-time stack of open `beginOffscreen` calls. */
  readonly #offStack: OffFrame[] = []
  /** Surface effects state, created on first use and dropped on a restore. */
  #fx: EffectState | null = null
  /** Effects waiting for their surface's pass to close, by surface. */
  readonly #fxJobs = new Map<Surface, SurfaceEffectsJob>()

  /**
   * Run `draw` at the start of the main pass, before the recorded layers. The
   * callback issues draws straight to the device, so it runs while that pass is
   * open. It applies to the next submitted frame only.
   *
   * @internal
   */
  setMainPrelude(draw: (() => void) | null): void {
    this.#mainPrelude = draw
  }

  readonly #hooks: PassHooks = {
    open: (surface) => {
      if (surface) {
        if (this.perfMarks) performance.mark('gfx-surface:start')
        const slot = this.#ctx.acquireFrameSlot(surface.texW, surface.texH)
        this.#ctx.useFrameSlot(slot)
        this.#ctx.passSamples = surface.draw.samples
        this.#openSurface(surface)
      } else {
        this.#ctx.useFrameSlot(0)
        this.#ctx.passSamples = this.#target.samples
        this.#openMain()
        const prelude = this.#mainPrelude
        this.#mainPrelude = null
        prelude?.()
      }
    },
    close: (surface) => {
      this.#device.endRenderPass()
      if (surface) this.#runSurfaceEffects(surface)
      if (this.perfMarks && surface) {
        performance.measure(
          `gfx offscreen surface ${surface.w}x${surface.h}`,
          'gfx-surface:start',
        )
      }
    },
  }

  /** The pixel size of the target currently being recorded into. */
  #viewW(): number {
    return this.#topSurface()?.w ?? this.#targetWidth
  }
  #viewH(): number {
    return this.#topSurface()?.h ?? this.#targetHeight
  }

  /** The innermost open surface, skipping layers drawn from a kept render. */
  #topSurface(): Surface | null {
    for (let i = this.#offStack.length - 1; i >= 0; i--) {
      const s = this.#offStack[i].surface
      if (s) return s
    }
    return null
  }

  /**
   * Open the main target's pass. It is the frame's only pass over the target,
   * so it resolves multisampled colour and drops everything the next frame does
   * not read.
   */
  #openMain(): void {
    const resolve = this.#resolveDestination()
    this.stats.passCount++
    this.#device.beginRenderPass({
      color: {
        target: this.#target,
        loadOp: 'clear',
        clearColor: this.#clear,
        resolveTarget: resolve,
        // The resolve target holds the result, so the multisampled samples
        // never need to reach memory.
        storeOp: resolve ? 'discard' : 'store',
      },
      // Both aspects come off the live target rather than the requested flags,
      // so the pass can never describe an attachment the target does not have.
      depth: this.#target.hasDepth
        ? {
            target: { renderTarget: this.#target },
            loadOp: 'clear',
            // Nothing samples the main depth: 2D never tests it and AO draws
            // its own G-buffer.
            storeOp: 'discard',
          }
        : undefined,
      // Only clips and stroke de-duplication read it, and only within the
      // frame.
      stencil: this.#target.hasStencil
        ? {
            target: this.#target,
            loadOp: 'clear',
            clearValue: 0,
            storeOp: 'discard',
          }
        : undefined,
    })
  }

  /** Open a surface's pass. It resolves and drops its samples in the same pass. */
  #openSurface(surface: Surface): void {
    const resolve = surface.multisampled ? surface.resolve : undefined
    this.stats.passCount++
    this.#device.beginRenderPass({
      color: {
        target: surface.draw,
        loadOp: 'clear',
        clearColor: surface.clear,
        resolveTarget: resolve,
        storeOp: resolve ? 'discard' : 'store',
      },
      depth: surface.draw.hasDepth
        ? {
            target: { renderTarget: surface.draw },
            loadOp: 'clear',
            storeOp: 'discard',
          }
        : undefined,
      stencil: surface.draw.hasStencil
        ? {
            target: surface.draw,
            loadOp: 'clear',
            clearValue: 0,
            storeOp: 'discard',
          }
        : undefined,
    })
  }

  beginOffscreen(opts: GfxOffscreenOptions = {}): boolean {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    let x0 = 0
    let y0 = 0
    let x1 = this.#viewW()
    let y1 = this.#viewH()
    const b = opts.bounds
    if (b) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (let i = 0; i < 4; i++) {
        const lx = b.x + (i === 1 || i === 2 ? b.width : 0)
        const ly = b.y + (i >= 2 ? b.height : 0)
        const dx = t.a * lx + t.c * ly + t.e
        const dy = t.b * lx + t.d * ly + t.f
        if (dx < minX) minX = dx
        if (dx > maxX) maxX = dx
        if (dy < minY) minY = dy
        if (dy > maxY) maxY = dy
      }
      x0 = Math.max(x0, Math.floor(minX))
      y0 = Math.max(y0, Math.floor(minY))
      x1 = Math.min(x1, Math.ceil(maxX))
      y1 = Math.min(y1, Math.ceil(maxY))
    }
    const w = x1 - x0
    const h = y1 - y0
    if (w <= 0 || h <= 0) return false
    const requested = opts.retain === true ? null : opts.effects
    const fx =
      requested && PostChain.hasWork(requested.effects) ? requested : null
    if (requested?.cache) requested.cache.hit = false
    const job = fx ? this.#prepareSurfaceEffects(fx) : null
    if (opts.effects && !fx) opts.effects.applied = opts.retain !== true
    const alpha = this.#ctx.stateStack.getAlpha() * (opts.opacity ?? 1)
    const blend = opts.blend ?? this.#ctx.stateStack.getBlend()
    if (job && fx?.cache) {
      const kept = this.#checkLayerCache(fx, fx.cache, job, x0, y0, w, h)
      if (kept) {
        // The kept render stands, so nothing is drawn and the composite is the
        // whole cost. The frame only holds the alpha and blend for
        // `endOffscreen`.
        this.#offStack.push({
          surface: null,
          hit: kept,
          fx: null,
          alpha,
          blend,
          retain: false,
          matte: null,
          matteMode: 'alpha',
          clipDepth: this.#ctx.clipDepth,
          clipPushes: [],
          saveLevel: this.#saveLevel,
          passSamples: this.#ctx.passSamples,
        })
        return true
      }
    }
    // Effects position by the size of the texture they read, so the surface is
    // exactly the captured size. A layer whose first effect smooths its input
    // draws single-sample, once every program has pipelines for it.
    let samples = this.#target.samples
    if (fx && samples > 1 && firstEffectSmooths(fx.effects)) {
      if (this.#ctx.singleSampleReady) samples = 1
      else this.#ctx.warmSingleSample()
    }
    const surface = this.#pool.acquire(
      w,
      h,
      {
        colorSpace: this.#target.colorSpace,
        samples,
        depth: this.#target.hasDepth,
        stencil: this.#target.hasStencil,
      },
      fx !== null,
    )
    if (opts.clearColor !== undefined) {
      // A surface holds premultiplied color, so a translucent clear is too.
      const c = rgbaTuple(parseColor(opts.clearColor))
      surface.clear = [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]]
    }
    if (job) {
      job.x = x0
      job.y = y0
    }
    surface.x = x0
    surface.y = y0
    surface.w = w
    surface.h = h
    this.stats.surfaces++
    this.#ctx.pushPassMark('begin', surface)
    // The surface starts from a clean state, in its own pixel space.
    this.#ctx.txStack.push()
    this.#ctx.stateStack.push()
    this.#ctx.txStack.setTop(t.a, t.b, t.c, t.d, t.e - x0, t.f - y0)
    this.#ctx.stateStack.setAlpha(1)
    this.#ctx.stateStack.setBlend('source-over')
    this.#ctx.stateStack.setClip(null)
    this.#ctx.stateStack.setClipMask(null)
    this.#offStack.push({
      surface,
      hit: null,
      fx: job,
      alpha,
      blend,
      retain: opts.retain === true,
      matte: opts.matte ?? null,
      matteMode: opts.matteMode ?? 'alpha',
      clipDepth: this.#ctx.clipDepth,
      clipPushes: this.#clipPushes.slice(),
      saveLevel: this.#saveLevel,
      passSamples: this.#ctx.passSamples,
    })
    this.#ctx.clipDepth = 0
    this.#ctx.passSamples = samples
    this.#clipPushes.length = 0
    return true
  }

  endOffscreen(): GfxOffscreenHandle | null {
    const frame = this.#offStack.pop()
    if (!frame) return null
    const kept = frame.hit
    if (kept) {
      this.#compositeSurface(
        {
          tex: this.#device.colorTexture(kept.out),
          texW: kept.w,
          texH: kept.h,
          x: kept.x,
          y: kept.y,
          w: kept.w,
          h: kept.h,
        },
        frame.alpha,
        frame.blend,
        null,
        'alpha',
      )
      return null
    }
    const s = frame.surface!
    this.#ctx.pushPassMark('end', s)
    this.#ctx.txStack.pop()
    this.#ctx.stateStack.pop()
    this.#ctx.clipDepth = frame.clipDepth
    this.#clipPushes.length = 0
    this.#clipPushes.push(...frame.clipPushes)
    this.#saveLevel = frame.saveLevel
    this.#ctx.passSamples = frame.passSamples
    const handle: OffscreenHandle = { surface: s }
    if (frame.retain) return handle as unknown as GfxOffscreenHandle
    const matteHandle = frame.matte as unknown as OffscreenHandle | null
    let source: CompositeSource = s
    const job = frame.fx
    if (job) {
      // The effects run when the surface's pass closes and write `out`, which
      // the composite then draws in place of the surface. A cached layer writes
      // the target it keeps.
      const out =
        job.entry?.out ??
        this.#fx!.pool.acquireTransient(s.w, s.h, this.#target.colorSpace)
      job.out = out
      this.#fxJobs.set(s, job)
      source = {
        tex: this.#device.colorTexture(out),
        texW: s.w,
        texH: s.h,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
      }
    }
    this.#compositeSurface(
      source,
      frame.alpha,
      frame.blend,
      matteHandle?.surface ?? null,
      frame.matteMode,
    )
    return null
  }

  drawOffscreen(
    handle: GfxOffscreenHandle,
    opts: {
      opacity?: number
      blend?: GfxBlend
      matte?: GfxOffscreenHandle
      matteMode?: GfxMatteMode
    } = {},
  ): void {
    const surface = (handle as unknown as OffscreenHandle).surface
    const matte = opts.matte as unknown as OffscreenHandle | undefined
    this.#compositeSurface(
      surface,
      this.#ctx.stateStack.getAlpha() * (opts.opacity ?? 1),
      opts.blend ?? this.#ctx.stateStack.getBlend(),
      matte?.surface ?? null,
      opts.matteMode ?? 'alpha',
    )
  }

  /** The surface effects state, created on first use. */
  #effectState(): EffectState {
    return (this.#fx ??= {
      programs: new PostProgramCache(this.#device),
      pool: new RenderTargetPool(this.#device),
      chains: new Map(),
      layers: new RetainedCache<LayerCacheEntry>({
        name: 'Layer renders',
        idleFrames: 240,
        budgetBytes: 64 * 1024 * 1024,
      }),
      layerHits: 0,
    })
  }

  /**
   * Get ready to run `fx` over a surface: find or create the owner's chain, add
   * the frame's time, and make sure the pipelines are compiled for the target's
   * color space. Reports whether they are, in `fx.applied`. Returns the job for
   * the surface, or `null` when a pipeline is still compiling and the surface
   * composites as it is.
   */
  #prepareSurfaceEffects(fx: GfxSurfaceEffects): SurfaceEffectsJob | null {
    const state = this.#effectState()
    let entry = state.chains.get(fx.owner)
    if (!entry) {
      entry = {
        chain: new PostChain(this.#device, state.programs, state.pool),
        unseen: 0,
      }
      state.chains.set(fx.owner, entry)
    }
    entry.unseen = 0
    entry.chain.advance(fx.dt)
    const ready = entry.chain.prepare(fx.effects, this.#target.colorSpace)
    for (const effect of fx.effects) {
      for (const pass of effect.passes) state.programs.noteLive(pass)
    }
    fx.applied = ready
    return ready
      ? {
          chain: entry.chain,
          effects: fx.effects,
          out: null,
          entry: null,
          signature: null,
          signatureLength: 0,
          x: 0,
          y: 0,
        }
      : null
  }

  /**
   * Decide whether the kept render of a cached layer still stands. Returns it
   * when it does, with `cache.hit` set. Otherwise gets the layer's entry ready
   * to be drawn into (a new target when the region changed size) and records
   * the signature to keep once the render has run, and returns `null`.
   */
  #checkLayerCache(
    fx: GfxSurfaceEffects,
    cache: GfxSurfaceCache,
    job: SurfaceEffectsJob,
    x: number,
    y: number,
    w: number,
    h: number,
  ): LayerCacheEntry | null {
    const state = this.#fx!
    const colorSpace = this.#target.colorSpace
    // Asked every frame, even when the answer is a hit, so the effects' own
    // record of what they last wrote stays current.
    const paramsChanged = job.chain.paramsChanged(
      { width: w, height: h },
      fx.effects,
    )
    const key = state.layers.keyFor(fx.owner, 'layer')
    let entry = state.layers.get(key)
    const forced = cache.invalidated
    cache.invalidated = false
    if (
      entry &&
      entry.valid &&
      !forced &&
      !paramsChanged &&
      entry.colorSpace === colorSpace &&
      entry.x === x &&
      entry.y === y &&
      entry.w === w &&
      entry.h === h &&
      signaturesEqual(
        entry.signature,
        entry.signatureLength,
        cache.signature,
        cache.length,
      )
    ) {
      cache.hit = true
      state.layerHits++
      return entry
    }
    if (
      !entry ||
      entry.w !== w ||
      entry.h !== h ||
      entry.colorSpace !== colorSpace
    ) {
      const pool = state.pool
      const out = pool.acquireRetained(w, h, colorSpace)
      entry = {
        out,
        x,
        y,
        w,
        h,
        colorSpace,
        signature: new Float64Array(0),
        signatureLength: 0,
        valid: false,
        bytes: w * h * 4,
        release: () => pool.release(out),
      }
      // Replaces, and frees, the entry of the old size.
      state.layers.add(key, entry)
    }
    entry.valid = false
    job.entry = entry
    job.signature = copySignature(
      cache.signature,
      cache.length,
      new Float64Array(cache.length),
    )
    job.signatureLength = cache.length
    return null
  }

  /**
   * Run the effects queued for `surface`, now that its pass has closed and its
   * result texture is complete. They draw between that pass and the next one.
   */
  #runSurfaceEffects(surface: Surface): void {
    const job = this.#fxJobs.get(surface)
    if (!job) return
    this.#fxJobs.delete(surface)
    job.chain.run(
      { texture: surface.tex, width: surface.w, height: surface.h },
      job.effects,
      this.#target.colorSpace,
      job.out,
    )
    this.stats.passCount += PostChain.passCount(job.effects)
    const entry = job.entry
    if (entry && job.signature) {
      // The kept target now holds a finished render of this signature.
      entry.x = job.x
      entry.y = job.y
      entry.signature = copySignature(
        job.signature,
        job.signatureLength,
        entry.signature,
      )
      entry.signatureLength = job.signatureLength
      entry.valid = true
    }
  }

  /**
   * Compile the pipelines of `fx` ahead of time, for the target's color space,
   * so the first frame that uses them is not drawn unprocessed. Safe to call
   * every frame, an already compiled pass is skipped.
   */
  warmEffects(fx: GfxSurfaceEffects): void {
    const state = this.#effectState()
    const passes = fx.effects.flatMap((e) => e.passes)
    state.programs.warm(passes, [this.#target.colorSpace])
  }

  /**
   * End of frame for surface effects: return the pooled targets, free the
   * passes and chains no layer has used for a while.
   */
  #endEffectsFrame(): void {
    const state = this.#fx
    if (!state) return
    state.pool.endFrame()
    state.programs.endFrame()
    for (const [owner, entry] of state.chains) {
      if (++entry.unseen <= PASS_GPU_GRACE_FRAMES) continue
      entry.chain.destroy()
      state.chains.delete(owner)
    }
  }

  /** Record a quad of `s` at its rectangle in the current target. */
  #compositeSurface(
    s: CompositeSource,
    alpha: number,
    blend: GfxBlend,
    matte: Surface | null,
    matteMode: GfxMatteMode,
  ): void {
    // A matte surface must cover the same rectangle, which is how the shader
    // addresses both with one UV.
    if (
      matte &&
      (matte.x !== s.x || matte.y !== s.y || matte.w !== s.w || matte.h !== s.h)
    ) {
      matte = null
    }
    if (!COMPOSITE_BLENDS.has(blend)) {
      if (!this.#warnedBlends.has(blend)) {
        this.#warnedBlends.add(blend)
        console.warn(
          `GpuGfx: offscreen blend '${blend}' is not supported, compositing with 'source-over'`,
        )
      }
      blend = 'source-over'
    }
    const draw: CompositeDraw = {
      tex: s.tex,
      matte: matte ? matte.tex : null,
      matteMode: matte ? matteMode : 'none',
      opacity: alpha,
    }
    // The rectangle in the target now being recorded into.
    const x = s.x
    const quad = [x, s.y, x + s.w, s.y, x + s.w, s.y + s.h, x, s.y + s.h]
    const u1 = s.w / s.texW
    const topDown = this.#device.ndc.textureTopDown
    const v0 = topDown ? 0 : 1
    const v1 = topDown ? s.h / s.texH : 1 - s.h / s.texH
    const uv = [0, v0, u1, v0, u1, v1, 0, v1]
    this.#ctx.stateStack.push()
    this.#ctx.stateStack.setBlend(blend)
    this.#composite.record(this.#ctx, draw, quad, uv)
    this.#ctx.stateStack.pop()
  }

  /**
   * End of a draw pass (Stage calls this after the 2D walk). Under
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
    // One frame of collection per `warmPathShadows` call: every shadow this
    // frame drew has queued its warm requests by now, and leaving the factors
    // set would re-queue them for every frame after.
    this.#shadowWarmFactors = []
    // Replay the recorded 2D command list: every surface in a pass of its own,
    // then the main pass, which resolves MSAA into the resolve target.
    const marks = this.perfMarks
    if (marks) performance.mark('gfx-submit:start')
    this.#ctx.submitFrame(this.#hooks)
    this.#ctx.passSamples = this.#target.samples
    if (marks) {
      // The profiler drops a measure's `detail`, so the counters go in the name.
      const st = this.stats
      performance.measure(
        `gfx submit draws=${st.drawCalls} passes=${st.passCount} surfaces=${st.surfaces} uboSlices=${st.uboSlices} bytes=${st.bytesUploaded} target=${this.#targetWidth}x${this.#targetHeight}x${this.#samples}`,
        'gfx-submit:start',
      )
    }
    this.#pool.endFrame()
    this.#endEffectsFrame()
    this.stats.offscreenBytes = this.#pool.bytes
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
    const labels = this.#textureManager.labelCounters
    this.stats.labelRasters = labels.rasters
    this.stats.labelUploadBytes = labels.uploadBytes
    this.stats.labelDedicated = labels.dedicated
    this.stats.labelHolds = labels.holds
    this.stats.labelPageWipes = labels.pageWipes
    this.stats.labelEntries = labels.entries
    this.stats.maskBakes = this.#pathShadowCache.maskBakes
    this.stats.maskBakeWork = this.#pathShadowCache.maskBakeWork
    this.stats.maskBytes = this.#pathShadowCache.maskBytes
    this.stats.poolHits = this.#pathShadowCache.pool.hits
    this.stats.poolMisses = this.#pathShadowCache.pool.misses
    if (this.#present && !this.#resolvesToCanvas) {
      if (marks) performance.mark('gfx-present:start')
      this.#device.present(
        this.#presentSource,
        this.#canvas.width,
        this.#canvas.height,
        { filter: 'linear' },
      )
      if (marks) performance.measure('gfx present', 'gfx-present:start')
    }
    // A frame handed to post-processing is submitted once that has run.
    if (this.#present) this.#device.endFrame()
  }

  #counted = { passes: 0, submits: 0, groups: 0, switches: 0, writes: 0 }

  /**
   * Publish the device work done since the last call as the frame's counters.
   * The stage calls it once its frame is complete, so passes that run before
   * `beginFrame` and after `endFrame` (shadows, AO, post-processing) count.
   */
  captureFrameCounters(): void {
    const d = this.#device.deviceStats
    const c = this.#counted
    const s = this.stats
    s.framePasses = d.passes - c.passes
    s.frameSubmits = d.submits - c.submits
    s.frameBindGroupsCreated = d.bindGroupsCreated - c.groups
    s.frameBindGroupSwitches = d.bindGroupSwitches - c.switches
    s.frameUniformWrites = d.uniformWrites - c.writes
    c.passes = d.passes
    c.submits = d.submits
    c.groups = d.bindGroupsCreated
    c.switches = d.bindGroupSwitches
    c.writes = d.uniformWrites
  }

  /**
   * Color texture backing this surface's target, for sampling elsewhere (a
   * non-presenting offscreen surface). `null` when the target is a multisample
   * renderbuffer (`samples > 1`), which cannot be sampled. Use `samples: 1`.
   */
  get colorTexture(): Texture | null {
    // The present source is single-sample unless the frame resolves straight
    // into the canvas, which leaves nothing to sample.
    const source = this.#presentSource
    return source.samples > 1 ? null : this.#device.colorTexture(source)
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
    if (present === this.#present) return
    this.#present = present
    this.#ensureResolveTarget()
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
    const stack = this.#offStack
    if (stack.length === 0) {
      this.#ctx.txStack.setBase(a, b, c, d, e, f)
      return
    }
    // Inside a surface the matrix is still given in target pixels. A surface's
    // origin is in the pixels of the one around it, so the matrix moves by the
    // origins of every open surface, and keeps the stack's depth.
    let ox = 0
    let oy = 0
    for (let i = 0; i < stack.length; i++) {
      ox += stack[i].surface?.x ?? 0
      oy += stack[i].surface?.y ?? 0
    }
    this.#ctx.txStack.setTop(a, b, c, d, e - ox, f - oy)
  }

  save(): void {
    this.#ctx.txStack.push()
    this.#ctx.stateStack.push()
    this.#saveLevel++
  }

  restore(): void {
    // Undo the clip paths pushed at this level before the matrix goes.
    const pushes = this.#clipPushes
    while (
      pushes.length > 0 &&
      pushes[pushes.length - 1].level >= this.#saveLevel
    ) {
      const push = pushes.pop() as ClipPush
      if (!push.raised) continue
      if (push.bounds) this.#coloredTri.clipPop(this.#ctx, push.bounds)
      this.#ctx.clipDepth--
    }
    if (this.#saveLevel > 0) this.#saveLevel--
    this.#ctx.txStack.pop()
    this.#ctx.stateStack.pop()
  }

  clipPath(path: GfxPath, rule: FillRule = 'nonzero'): void {
    if (path.released || path.isEmpty) return
    if (!this.#stencilEnabled) {
      if (!this.#warnedNoStencil) {
        this.#warnedNoStencil = true
        console.warn(
          'GpuGfx: this surface has no stencil buffer, so clipPath is ignored',
        )
      }
      return
    }
    if (this.#ctx.clipDepth >= MAX_CLIP_DEPTH) {
      if (!this.#warnedClipDepth) {
        this.#warnedClipDepth = true
        console.warn(
          `GpuGfx: clip paths nest at most ${MAX_CLIP_DEPTH} deep, extra clips are ignored`,
        )
      }
      // Keep restore balanced.
      this.#clipPushes.push({
        level: this.#saveLevel,
        bounds: null,
        raised: false,
      })
      return
    }
    const flat = path.flatten(this.#flattenTolerance())
    const bounds = this.#coloredTri.clipPush(
      this.#ctx,
      flat,
      rule,
      this.#viewW(),
      this.#viewH(),
    )
    // An empty or off-screen clip still raises the depth, over no pixels, so
    // nothing drawn inside it passes the test.
    this.#clipPushes.push({ level: this.#saveLevel, bounds, raised: true })
    this.#ctx.clipDepth++
  }

  translate(x: number, y: number): void {
    this.#ctx.txStack.translate(x, y)
  }

  rotate(rad: number): void {
    this.#ctx.txStack.rotate(rad)
  }

  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.#ctx.txStack.postMultiply(a, b, c, d, e, f)
  }
  scale(sx: number, sy: number): void {
    this.#ctx.txStack.scale(sx, sy)
  }

  // --- Gfx2D: alpha + blend ------------------------------------------------

  getAlpha(): number {
    return this.#ctx.stateStack.getAlpha()
  }

  setAlpha(alpha: number): void {
    // Absolute, matching Canvas globalAlpha (see Gfx2D docstring).
    this.#ctx.stateStack.setAlpha(alpha)
  }

  readonly #warnedBlends = new Set<string>()
  readonly #dashBuffer = new DashBuffer()
  /** Scratch for the filled form of a stroke. */
  readonly #strokeFill = new GfxPath()
  #saveLevel = 0
  readonly #clipPushes: ClipPush[] = []
  #warnedClipDepth = false
  #warnedWinding = false
  #warnedNoStencil = false

  setBlend(mode: import('./Gfx2D').GfxBlend): void {
    if (mode !== 'source-over' && mode !== 'lighter') {
      if (!this.#warnedBlends.has(mode)) {
        this.#warnedBlends.add(mode)
        console.warn(
          `GpuGfx: blend '${mode}' is not supported, drawing with 'source-over'`,
        )
      }
      mode = 'source-over'
    }
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
    // Resolve local -> device px through the current transform, like fillCircle.
    // The snapshot is taken now, so later transform changes don't move the clip.
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))
    // The inverse maps a device pixel back into the space the shape was given
    // in. A transform with no inverse clips everything: the shape is moved out
    // of reach.
    const det = t.a * t.d - t.b * t.c
    const singular = !(Math.abs(det) > 1e-12)
    const inv = singular ? 0 : 1 / det
    const ia = singular ? 0 : t.d * inv
    const ib = singular ? 0 : -t.b * inv
    const ic = singular ? 0 : -t.c * inv
    const id = singular ? 0 : t.a * inv
    const ie = singular ? 0 : (t.c * t.f - t.d * t.e) * inv
    const iff = singular ? 0 : (t.b * t.e - t.a * t.f) * inv
    const far = 1e9
    if (shape.kind === 'circle') {
      this.#ctx.stateStack.setClip({
        kind: 1,
        cx: t.a * shape.cx + t.c * shape.cy + t.e,
        cy: t.b * shape.cx + t.d * shape.cy + t.f,
        r: shape.r * scale,
        halfW: 0,
        halfH: 0,
        radii: NO_CLIP_RADII,
        lcx: singular ? far : shape.cx,
        lcy: shape.cy,
        lr: shape.r,
        lhalfW: 0,
        lhalfH: 0,
        lradii: NO_CLIP_RADII,
        ia,
        ib,
        ic,
        id,
        ie,
        if: iff,
      })
    } else {
      const midX = shape.x + shape.w / 2
      const midY = shape.y + shape.h / 2
      // A fresh tuple, since the stack keeps the clip after this call returns.
      const lradii = resolveRadii(
        shape.radii ?? shape.radius ?? 0,
        shape.w,
        shape.h,
      )
      this.#ctx.stateStack.setClip({
        kind: 2,
        cx: t.a * midX + t.c * midY + t.e,
        cy: t.b * midX + t.d * midY + t.f,
        r: 0,
        halfW: (shape.w / 2) * Math.abs(t.a),
        halfH: (shape.h / 2) * Math.abs(t.d),
        radii: [
          lradii[0] * scale,
          lradii[1] * scale,
          lradii[2] * scale,
          lradii[3] * scale,
        ],
        lcx: singular ? far : midX,
        lcy: midY,
        lr: 0,
        lhalfW: shape.w / 2,
        lhalfH: shape.h / 2,
        lradii,
        ia,
        ib,
        ic,
        id,
        ie,
        if: iff,
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
      colorSpace: this.#canvasFormat ? 'canvas' : undefined,
    })
    this.stats.msaaSamples = this.#target.samples
    this.#ensureResolveTarget()
    // Sample count changed, so pipelines must be rebuilt for the new count.
    this.#warmupPromise = this.#warmupPipelines()
  }

  /**
   * Whether draws that can be drawn together are joined, even across draws that
   * share no pixels. On by default. Turn it off to compare against one draw per
   * run.
   */
  get mergeRuns(): boolean {
    return this.#ctx.mergeRuns
  }
  set mergeRuns(on: boolean) {
    this.#ctx.mergeRuns = on
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

  /**
   * `'polygons'` debug mode for a stroke that routed through the outline
   * tessellator: every triangle edge of its actual output (core, joins, and
   * fringe ring), not the source contour `#emitDebugPolygonOutline` draws for a
   * fill. Deliberately not just the outer boundary: the join tessellation, the
   * fringe ring, and a short-segment overlap (see `strokeOutline.ts`) are
   * exactly what this mode exists to let you see.
   */
  #emitDebugOutlineMesh(outline: {
    positions: readonly number[]
    indices: readonly number[]
  }): void {
    const idx = outline.indices
    if (idx.length < 3) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = det > 1e-9 ? Math.sqrt(det) : 1
    const style: GfxStrokeStyle = {
      color: 'rgba(96, 165, 250, 0.75)',
      width: 1 / scale,
    }
    const pos = outline.positions
    const triCount = idx.length / 3
    for (let i = 0; i < triCount; i++) {
      const i0 = idx[i * 3]
      const i1 = idx[i * 3 + 1]
      const i2 = idx[i * 3 + 2]
      const x0 = pos[i0 * 2]
      const y0 = pos[i0 * 2 + 1]
      const x1 = pos[i1 * 2]
      const y1 = pos[i1 * 2 + 1]
      const x2 = pos[i2 * 2]
      const y2 = pos[i2 * 2 + 1]
      this.strokeLine(x0, y0, x1, y1, style)
      this.strokeLine(x1, y1, x2, y2, style)
      this.strokeLine(x2, y2, x0, y0, style)
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
    smoothing = 0,
  ): void {
    this.#resolveCorners(radii, w, h, smoothing)
    this.#shape.fillRoundRect(
      this.#ctx,
      x,
      y,
      w,
      h,
      this.#radii,
      fill,
      this.#cornerSmoothing,
    )
  }

  strokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    style: GfxStrokeStyle,
    smoothing = 0,
  ): void {
    this.#resolveCorners(radii, w, h, smoothing)
    this.#shape.strokeRoundRect(
      this.#ctx,
      x,
      y,
      w,
      h,
      this.#radii,
      solidStroke(style),
      this.#cornerSmoothing,
    )
  }

  fillAndStrokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    fill: GfxFill,
    style: GfxStrokeStyle,
    smoothing = 0,
  ): void {
    this.#resolveCorners(radii, w, h, smoothing)
    this.#shape.fillAndStrokeRoundRect(
      this.#ctx,
      x,
      y,
      w,
      h,
      this.#radii,
      fill,
      solidStroke(style),
      this.#cornerSmoothing,
    )
  }

  /**
   * Resolve a round rect's corners into `#radii` and `#cornerSmoothing`. With
   * smoothing they are fitted as Figma does (see `fitSquircleCorners`). Without
   * it, or before the smooth-corner field has loaded, they follow the CSS
   * radius rules and are circular.
   */
  #resolveCorners(
    radii: RoundRectRadii,
    w: number,
    h: number,
    smoothing: number,
  ): void {
    if (smoothing > 0 && this.#textureManager.getSquircleFieldTexture()) {
      fitSquircleCorners(
        w,
        h,
        radii,
        smoothing,
        this.#radii,
        this.#cornerSmoothing,
      )
    } else {
      resolveRadii(radii, w, h, this.#radii)
      this.#cornerSmoothing.fill(0)
    }
  }

  fillAndStrokeCircle(
    cx: number,
    cy: number,
    r: number,
    fill: GfxFill,
    style: GfxStrokeStyle,
  ): void {
    this.#shape.fillAndStrokeCircle(
      this.#ctx,
      cx,
      cy,
      r,
      fill,
      solidStroke(style),
    )
  }

  fillEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: GfxFill,
  ): void {
    this.#shape.fillEllipse(this.#ctx, cx, cy, rx, ry, fill)
  }

  strokeEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    style: GfxStrokeStyle,
  ): void {
    this.#shape.strokeEllipse(this.#ctx, cx, cy, rx, ry, solidStroke(style))
  }

  fillAndStrokeEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: GfxFill,
    style: GfxStrokeStyle,
  ): void {
    this.#shape.fillAndStrokeEllipse(
      this.#ctx,
      cx,
      cy,
      rx,
      ry,
      fill,
      solidStroke(style),
    )
  }

  fillConvexPoly(pts: ArrayLike<number>, count: number, fill: GfxFill): void {
    this.#coloredTri.fillConvexPoly(this.#ctx, pts, count, fill)
    if (this.#ctx.curDebugMode === 'polygons') {
      this.#emitDebugPolygonOutline(pts, count, true)
    }
  }

  /**
   * Whether `geo` can draw through the retained `coloredTri` pipeline right
   * now: the geometry opted into a static GPU upload, no bitmap clip mask is
   * active (the retained shader has no mask sampler), and the debug mode is
   * normal (the retained shader has no debug recolor). Shared by `fillPath2D`
   * and `shadowPath2D`'s inset branch, the two callers that have both a
   * retained and a streamed `coloredTri` path to choose between.
   */
  #canDrawRetained(geo: GeometryHandle, ownRun: boolean): boolean {
    if (
      this.#ctx.stateStack.getClipMask() !== null ||
      this.#ctx.curDebugMode !== 'normal'
    ) {
      return false
    }
    // Geometry not registered to be kept is kept only where its draw is a run
    // of its own anyway, so keeping it costs no extra draw call.
    if (geo.retained !== true && !ownRun) return false
    return this.#coloredTri.retains(geo)
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
    // the per-vertex CPU transform, for a flat fill, a linear gradient, or an
    // inset path-shadow mask alike. The retained shader carries neither the
    // bitmap clip mask's sampler nor the debug recolor, so a bitmap clip or a
    // non-normal debug mode falls back to the streamed path (identical pixels
    // either way, just a repeated per-vertex CPU transform). The analytic
    // clip is not one of them: the retained shader reads the same group-0
    // clip block, so `setClip` composes without giving up the fast path.
    // The retained shader has no radial mode.
    const radial = typeof fill !== 'string' && fill.kind === 'radial'
    // A flat fill joins its neighbours, and so does a gradient fill another
    // fill drew with the frame before, so only an unshared gradient is a run of
    // its own.
    const ownRun =
      typeof fill !== 'string' &&
      fill.kind === 'linear' &&
      geo.indices.length >= RETAIN_FILL_INDICES &&
      !this.#gradientShared(fill)
    if (!radial && this.#canDrawRetained(geo, ownRun)) {
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

  fillPath(path: GfxPath, fill: GfxFill, rule: FillRule = 'nonzero'): void {
    if (path.released || path.isEmpty) return
    const flat = path.flatten(this.#flattenTolerance())
    if (flat.pointCount < 3) return
    // A convex outline has no overlap to resolve, so it skips the stencil.
    if (flat.convex) {
      this.fillConvexPoly(flat.points, flat.pointCount, fill)
      return
    }
    if (!this.#stencilEnabled) {
      this.#fillPathWithoutStencil(flat, fill)
      return
    }
    if (rule === 'nonzero' && flat.contourCount >= 16 && !this.#warnedWinding) {
      this.#warnedWinding = true
      console.warn(
        'GpuGfx: a nonzero fill with 16 or more contours can lose coverage where 16 contours wind the same way over one point',
      )
    }
    this.#coloredTri.fillStencilPath(
      this.#ctx,
      flat,
      rule,
      fill,
      this.#viewW(),
      this.#viewH(),
    )
  }

  strokePath(path: GfxPath, style: GfxStrokeStyle): void {
    if (path.released || path.isEmpty) return
    const tol = this.#flattenTolerance()
    const dash = style.dash
    const dashed = dash !== undefined && dash.length > 0
    // A gradient, or caps and joins the default stroker cannot draw, are drawn
    // as the filled union of the stroke's pieces.
    const geometric =
      (style.align === undefined || style.align === 'center') &&
      (typeof style.color !== 'string' || style.exactJoins === true)
    // The pieces depend on the path and the stroke's shape, not on its paint or
    // transform, so a path stroked the same way frame after frame builds them
    // once.
    let pieceKey: string | null = null
    if (geometric) {
      pieceKey = this.#strokePieces.keyFor(
        path,
        `${path.version}|${Math.round(-2 * Math.log2(tol))}|${style.width}|${style.cap}|${style.join}|${style.miterLimit}|${style.dash?.join(',')}|${style.dashOffset}`,
      )
      const hit = this.#strokePieces.get(pieceKey)
      if (hit) {
        this.fillPath(hit.path, style.color, 'nonzero')
        return
      }
      if (!this.#strokePieces.admit(pieceKey)) pieceKey = null
    }
    const flat = path.flatten(tol)
    const fillPieces = pieceKey !== null ? new GfxPath() : this.#strokeFill
    if (geometric) fillPieces.clear()
    let closedStyle: GfxStrokeStyle | null = null
    const openStyle: GfxStrokeStyle = dashed
      ? { ...style, dash: undefined, closed: false }
      : style
    const emit = (
      pts: Float32Array,
      first: number,
      len: number,
      closed: boolean,
    ): void => {
      if (geometric) {
        appendStrokeFill(
          fillPieces,
          pts,
          first,
          len,
          closed,
          style.width,
          style.cap ?? 'butt',
          style.join ?? 'miter',
          style.miterLimit ?? DEFAULT_MITER_LIMIT,
          tol,
        )
      } else {
        const sub = pts.subarray(first * 2, (first + len) * 2)
        this.strokePolyline(
          sub,
          len,
          closed ? (closedStyle ??= { ...style, closed: true }) : openStyle,
        )
      }
    }
    // One group for the whole path, so contours that cross each other do not
    // blend twice where they overlap.
    let grouped = false
    if (
      !geometric &&
      !this.#needsOutline(style) &&
      this.#strokeNeedsStencil(
        style as SolidStrokeStyle,
        dashed ? 2 : flatSegments(flat),
      )
    ) {
      grouped = true
      this.#pathGroup = true
      this.#ctx.beginStencilGroup()
    }
    for (let c = 0; c < flat.contourCount; c++) {
      const s0 = flat.starts[c]
      const len = flat.starts[c + 1] - s0
      if (len < 1) continue
      const closed = flat.closed[c] === 1
      if (dashed) {
        const buf = this.#dashBuffer
        buf.clear()
        buf.cut(flat.points, s0, len, closed, dash, style.dashOffset ?? 0)
        for (let d = 0; d < buf.dashCount; d++) {
          const a = buf.starts[d]
          const n = buf.starts[d + 1] - a
          if (n >= 1) emit(buf.points, a, n, false)
        }
        continue
      }
      emit(flat.points, s0, len, closed)
    }
    if (grouped) {
      this.#ctx.endStencilGroup()
      this.#pathGroup = false
    }
    if (geometric && !fillPieces.isEmpty) {
      this.fillPath(fillPieces, style.color, 'nonzero')
      if (pieceKey !== null) {
        this.#strokePieces.add(pieceKey, {
          path: fillPieces,
          bytes: fillPieces.flatten(tol).pointCount * 8,
          release: () => fillPieces.release(),
        })
      }
    }
  }

  /** Curve flattening tolerance in path units: a quarter device pixel. */
  #flattenTolerance(): number {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // The larger axis scale, so a curve stretched along one axis still stays
    // within a quarter pixel there.
    const scale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    return 0.25 / Math.max(scale, 1e-4)
  }

  /**
   * Fill for a target without stencil bits: earcut, which fills even-odd and
   * cannot honor the nonzero rule. Warns once.
   */
  #fillPathWithoutStencil(flat: FlatPath, fill: GfxFill): void {
    if (!this.#warnedNoStencil) {
      this.#warnedNoStencil = true
      console.warn(
        'GpuGfx: this surface has no stencil buffer, so fillPath fills even-odd and ignores the nonzero rule',
      )
    }
    const contours: Float32Array[] = []
    for (let c = 0; c < flat.contourCount; c++) {
      const s0 = flat.starts[c]
      const len = flat.starts[c + 1] - s0
      if (len >= 3) contours.push(flat.points.slice(s0 * 2, (s0 + len) * 2))
    }
    if (contours.length === 0) return
    this.#coloredTri.fillTessellation(
      this.#ctx,
      tessellateContours(contours),
      fill,
    )
  }

  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: readonly GfxGradientStop[],
  ): void {
    if (r <= 0 || stops.length === 0) return
    const rampRow = this.#textureManager.ensureStopsRow(stops)
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

  drawShaderQuad(
    quad: ShaderQuad,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (w <= 0 || h <= 0) return
    if (!this.#warnedQuadClipMask && this.#ctx.stateStack.getClipMask()) {
      this.#warnedQuadClipMask = true
      console.warn(
        'drawShaderQuad ignores setClipMask. Sample a mask inside the shader, or use setClip.',
      )
    }
    this.#shaderQuad.record(this.#ctx, quad, x, y, w, h)
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
    const rampRow = this.#textureManager.ensureStopsRow(stops)
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
    smoothing = 0,
  ): void {
    this.#resolveCorners(radii, w, h, smoothing)
    // The analytic shadow has circular corners. A smoothed corner's shadow
    // uses the circular radius that cuts the same area off the corner.
    for (let i = 0; i < 4; i++) {
      if (this.#cornerSmoothing[i] > 0) {
        this.#radii[i] *= squircleShadowRadiusScale(this.#cornerSmoothing[i])
      }
    }
    this.#shape.shadowRoundRect(this.#ctx, x, y, w, h, this.#radii, style)
  }

  shadowCircle(cx: number, cy: number, r: number, style: GfxShadowStyle): void {
    this.#shape.shadowCircle(this.#ctx, cx, cy, r, style)
  }

  /** Local-space AABB of `path`'s tessellation, cached per registration epoch. */
  #localBoundsFor(
    path: Path2D,
    geo: { vertices: Float32Array },
    epoch: number,
  ): Rect {
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
    // A substitute mask gets drawn but still queues the bake, otherwise a
    // stand-in is never replaced by the mask this request actually asked for.
    if (!mask || !mask.exact) {
      this.#pendingShadowBakes.set(this.#pathShadowCache.requestKey(req), req)
    }
    if (this.#shadowWarmFactors.length > 0) this.#collectShadowWarmups(req)
    if (!mask) {
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
      const maskPaint: ResolvedMaskPaint = {
        ...insetMaskProjection(t, offDx, offDy, mask),
        kind: 'mask',
        maskTex: mask.texture,
      }
      // Each path's mask is its own texture, so an inset shadow is a run of
      // its own.
      if (
        this.#canDrawRetained(geo, geo.indices.length >= RETAIN_FILL_INDICES)
      ) {
        this.#coloredTri.fillTessellationInsetShadowRetained(
          this.#ctx,
          geo,
          style.color,
          alpha,
          maskPaint,
        )
      } else {
        this.#coloredTri.fillTessellationInsetShadow(
          this.#ctx,
          geo,
          style.color,
          alpha,
          maskPaint,
        )
      }
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
      this.#ctx.stateStack.getBlend() !== 'lighter' &&
      this.#ctx.vectorQuality.dither
        ? 1
        : 0
    this.#pathShadowComposite.commitInstance(slot)
  }

  /**
   * Bake the masks the next drawn frame's path shadows would need at other
   * device scales, so a camera that reaches one of them finds them cached
   * instead of baking a few per frame as it arrives.
   *
   * `factors` are multiples of each shadow's own current device scale, which is
   * one number per target framing however each shadow's own transform differs:
   * pass `2` for a camera about to zoom to twice the scale it is at now. Only
   * the half-octave scale bucket of the product is keyed, so a factor landing
   * inside the current bucket warms nothing.
   *
   * Collection runs once, on the next frame that draws. Those requests then
   * bake behind that frame's own, as many per frame as the bake budget allows,
   * and `pendingPathShadowWarmups` reports what is left. Warming is best effort
   * in two ways: no draw has asked for a warmed mask, so it is also the first
   * entry evicted when live masks need the byte budget, and a shadow small
   * enough to draw as a hard silhouette at the current scale asks the cache for
   * nothing and so warms nothing.
   *
   * @example
   *   // A tap is about to zoom the map in. Bake what that framing needs now.
   *   stage.warmPathShadows([playScale / idleScale])
   */
  warmPathShadows(factors: readonly number[]): void {
    this.#shadowWarmFactors = factors.filter((f) => f > 0)
  }

  /** Warm-up bake requests still waiting on the per-frame bake budget. */
  get pendingPathShadowWarmups(): number {
    return this.#shadowWarmups.size
  }

  /**
   * Queue `req` again at each warm factor's device scale. Blur and spread stay
   * in local units, so a warm request differs from the live one only in its
   * scale bucket, which is exactly what a camera zoom changes.
   */
  #collectShadowWarmups(req: PathShadowRequest): void {
    const liveKey = this.#pathShadowCache.requestKey(req)
    for (const factor of this.#shadowWarmFactors) {
      const warm: PathShadowRequest = {
        ...req,
        scaleX: req.scaleX * factor,
        scaleY: req.scaleY * factor,
        scale: req.scale * factor,
      }
      const key = this.#pathShadowCache.requestKey(warm)
      if (key !== liveKey) this.#shadowWarmups.set(key, warm)
    }
  }

  /**
   * Drain this frame's queued path-shadow bake requests. Must run outside any
   * open render pass (the bake opens and closes its own), so callers run it in
   * the pre-`beginFrame` window, which `Stage` runs before
   * `screen.beginFrame()`. A request queued this way bakes at the earliest in
   * the FOLLOWING frame's draw, one frame behind the draw call that queued it.
   * `shadowPath2D` draws a substitute mask or the hard fallback in the
   * meantime.
   */
  processPendingShadowBakes(): void {
    this.#pathShadowCache.beginFrame()
    if (this.#pendingShadowBakes.size > 0) {
      for (const req of this.#pendingShadowBakes.values()) {
        this.#pathShadowCache.getOrBake(req)
      }
      this.#pendingShadowBakes.clear()
    }
    // Warm-ups go after the live requests, so the frame on screen converges
    // before a framing nothing has reached yet. The first request the budget
    // turns down ends the drain, which keeps a starved frame from costing a
    // size and kernel estimate per queued request.
    for (const [key, req] of this.#shadowWarmups) {
      if (this.#pathShadowCache.getOrBake(req)?.exact !== true) break
      this.#shadowWarmups.delete(key)
    }
    this.#pathShadowCache.pool.endFrame()
  }

  // --- Gfx2D: strokes ------------------------------------------------------

  strokeCircle(cx: number, cy: number, r: number, style: GfxStrokeStyle): void {
    this.#shape.strokeCircle(this.#ctx, cx, cy, r, solidStroke(style))
  }

  /**
   * Whether `style` needs the outline tessellator rather than the segment
   * stroker.
   */
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
      const pts = this.#linePoints
      pts[0] = x0
      pts[1] = y0
      pts[2] = x1
      pts[3] = y1
      this.#strokeOutlineUncached(pts, 2, false, style)
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
      const buf = this.#curvePoints
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
  /** Tessellated stroke outlines of registered paths, by style and scale. */
  readonly #outlines = new RetainedCache<{
    buffer: StrokeOutlineBuffer
    bytes: number
    release(): void
  }>({
    name: 'Stroke outlines',
    idleFrames: 120,
    budgetBytes: 8 * 1024 * 1024,
  })

  /** The convex pieces of strokes drawn as a filled union, by path and shape. */
  readonly #strokePieces = new RetainedCache<{
    path: GfxPath
    bytes: number
    release(): void
  }>({
    name: 'Stroke pieces',
    idleFrames: 120,
    budgetBytes: 8 * 1024 * 1024,
  })

  /** Set while `strokePath` holds one stencil group over all its contours. */
  #pathGroup = false

  #strokeNeedsStencil(style: SolidStrokeStyle, segments: number): boolean {
    if (this.#pathGroup || segments < 2 || !this.#target.hasStencil) {
      return false
    }
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
   * `pts` has no stable identity to key by (the caller mutates its buffer every
   * frame), and `strokeLine`/`strokeQuadratic` are cheap one-or-few segment
   * shapes where a cache would cost more than it saves.
   */
  #strokeOutlineUncached(
    pts: ArrayLike<number>,
    count: number,
    closed: boolean,
    style: GfxStrokeStyle,
  ): void {
    if (count < 2 || style.width <= 0) return
    const align = style.align ?? 'center'
    if (wouldFallBackToCenter(pts, count, closed, align)) {
      this.unimplemented.strokeAlignFallback++
    }
    const { scaleX, scaleY, scale } = this.#outlineScale()
    const buf = new StrokeOutlineBuffer()
    strokeOutline(
      pts,
      count,
      {
        width: style.width,
        align,
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
    if (this.#ctx.curDebugMode === 'polygons') {
      this.#emitDebugOutlineMesh(buf)
    }
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
    this.#strokeRetained(
      this.#replaySource,
      'polyline',
      segments,
      solidStyle,
      this.#strokeNeedsStencil(solidStyle, segments),
      () => this.#stroke.polyline(this.#ctx, pts, count, solidStyle),
    )
  }

  /**
   * Tessellate (or reuse the cached tessellation of) one contour's stroke
   * outline. Keyed by the style signature, the half-octave scale and anisotropy
   * buckets, and the path's registration epoch, so a re-parse at a new
   * tolerance can't serve triangles built from stale contours. `dash` is not
   * supported on the outline path and is ignored here: no caller combines it
   * with a gradient color, a non-center alignment, or `exactJoins` today.
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
    if (wouldFallBackToCenter(pts, pts.length / 2, closed, align)) {
      this.unimplemented.strokeAlignFallback++
    }
    const key = `${style.width}|${align}|${join}|${cap}|${miterLimit}|${closed}|${scaleBucket}|${anisoBucket}|${getRegistrationEpoch(path)}|${contourIndex}`
    const cacheKey = this.#outlines.keyFor(path, key)
    let buf = this.#outlines.get(cacheKey)?.buffer
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
      this.#outlines.add(cacheKey, {
        buffer: buf,
        bytes:
          (buf.positions.length + buf.coverage.length + buf.indices.length) * 8,
        release: () => {},
      })
    }
    this.#coloredTri.fillOutlineTessellation(this.#ctx, buf, style.color)
    if (this.#ctx.curDebugMode === 'polygons') {
      this.#emitDebugOutlineMesh(buf)
    }
  }

  /** What the caches that keep drawing work between frames hold and did. */
  cacheStats(): RetainedCacheStats[] {
    const stats = [
      this.#stroke.cache.stats,
      this.#coloredTri.geometryCache.stats,
      this.#strokePieces.stats,
      this.#outlines.stats,
    ]
    const layers = this.#fx
    // A lookup that ends in a re-render is not a hit, so the count is the
    // layers drawn from their kept render.
    if (layers) stats.push({ ...layers.layers.stats, hits: layers.layerHits })
    return stats
  }

  /**
   * How many fills drew with each gradient this frame and the frame before,
   * keyed by the gradient's device-space axis and stops. Two fills with the
   * same key share a paint and can draw as one run.
   */
  #gradientUse = new Map<string, number>()
  #gradientUsePrev = new Map<string, number>()

  /**
   * Count `fill` as drawn this frame, and report whether another fill drew with
   * the same gradient the frame before.
   */
  #gradientShared(fill: GfxLinearGradient): boolean {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const x0 = t.a * fill.x0 + t.c * fill.y0 + t.e
    const y0 = t.b * fill.x0 + t.d * fill.y0 + t.f
    const x1 = t.a * fill.x1 + t.c * fill.y1 + t.e
    const y1 = t.b * fill.x1 + t.d * fill.y1 + t.f
    let key = `${x0},${y0},${x1},${y1},${this.#ctx.stateStack.getAlpha()}`
    for (const s of fill.stops) key += `|${s.offset}:${s.color}`
    this.#gradientUse.set(key, (this.#gradientUse.get(key) ?? 0) + 1)
    return (this.#gradientUsePrev.get(key) ?? 0) > 1
  }

  /** Frames begun so far, for the retained caches. */
  #frameNo = 0

  /**
   * The recorded call being replayed, a stable identity for as long as the
   * picture that holds it is unchanged. `null` outside a replay.
   */
  #replaySource: object | null = null

  replaySource(token: object | null): void {
    this.#replaySource = token
  }

  streamedBytes(): number {
    return this.#ctx.streamedWords() * 4
  }

  /**
   * Stroke through `emit`, from the stroke cache when the same stroke was drawn
   * the frame before. `source` is what the points belong to, and `kind` tells
   * apart several strokes made from one source. Strokes with no stable source,
   * too few segments to be worth a run of their own, or a dash are drawn
   * directly.
   */
  #strokeRetained(
    source: object | null,
    kind: string,
    segments: number,
    style: SolidStrokeStyle,
    stencil: boolean,
    emit: () => void,
  ): void {
    const cache = this.#stroke.cache
    let key: string | null = null
    if (
      source !== null &&
      segments >= RETAIN_STROKE_SEGMENTS &&
      style.dash === undefined
    ) {
      key = cache.keyFor(source, `${kind}|${this.#strokeSignature(style)}`)
      const hit = cache.get(key)
      if (hit) {
        this.#ctx.recordInstanced(hit.buffer, hit.words, hit.bounds, stencil)
        return
      }
      if (!cache.admit(key)) key = null
    }
    if (key !== null) this.#ctx.closeRun()
    const firstRun = this.#ctx.runCount
    if (stencil) this.#ctx.beginStencilGroup()
    emit()
    if (stencil) this.#ctx.endStencilGroup()
    if (key !== null) this.#keepStroke(key, firstRun)
  }

  /**
   * What packed stroke instances depend on besides their points: the transform,
   * the alpha, and the style that shapes them.
   */
  #strokeSignature(style: SolidStrokeStyle): string {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const alpha = this.#ctx.stateStack.getAlpha()
    return `${t.a},${t.b},${t.c},${t.d},${t.e},${t.f}|${alpha}|${style.color}|${style.width}|${style.join}|${style.cap}|${style.miterLimit}|${style.closed}`
  }

  /**
   * Move the instances the runs from `firstRun` on were just packed into out of
   * the ring and into a buffer the cache keeps, and draw from it from now on.
   */
  #keepStroke(key: string, firstRun: number): void {
    const ctx = this.#ctx
    ctx.closeRun()
    const end = ctx.runCount
    if (end === firstRun) return
    let start = Infinity
    let stop = -Infinity
    for (let i = firstRun; i < end; i++) {
      const run = ctx.runAt(i)
      if (run.kind !== 'stroke' || run.instances) return
      start = Math.min(start, run.startWord)
      stop = Math.max(stop, run.endWord)
    }
    if (!(stop > start)) return
    const bounds = new Float64Array(4)
    if (!this.#stroke.runBounds(ctx.runAt(firstRun), bounds)) return
    const entry = this.#stroke.keep(
      key,
      this.#stroke.stream.floatView.subarray(start, stop),
      bounds,
    )
    for (let i = firstRun; i < end; i++) {
      const run = ctx.runAt(i)
      run.startWord -= start
      run.endWord -= start
      run.instances = { buffer: entry.buffer, bounds }
    }
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
    // A registered path's points change only with a new registration, so the
    // path and its epoch identify them.
    this.#strokeRetained(
      path,
      `path${getRegistrationEpoch(path)}`,
      segments,
      solidStyle,
      stencil,
      () => {
        for (let i = 0; i < contours.length; i++) {
          const c = contours[i]
          const count = c.length / 2
          if (count < 2) continue
          const closed = getContourClosed(path, i)
          const perContourStyle: SolidStrokeStyle = { ...solidStyle, closed }
          this.#stroke.polyline(this.#ctx, c, count, perContourStyle)
        }
      },
    )
  }

  // --- Gfx2D: images -------------------------------------------------------

  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts?: GfxImageOptions,
  ): void {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    if (
      !this.#textureManager.isAtlasSource(img) &&
      this.#drawImageRaster(img, dx, dy, dw, dh, opts)
    ) {
      return
    }
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

  /**
   * Draw a small image from the shared label page, so it joins the draws of the
   * text and shapes around it. False when the image is too large for a page
   * slot, and the caller draws it from its own texture.
   */
  #drawImageRaster(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts: GfxImageOptions | undefined,
  ): boolean {
    const t = this.#ctx.txOut
    const devW = Math.hypot(t.a, t.b) * dw
    const devH = Math.hypot(t.c, t.d) * dh
    const label = this.#textureManager.ensureImageRaster(
      img,
      devW,
      devH,
      opts?.smoothing !== false,
    )
    if (label === null) return false
    if (label.tex !== this.#textureManager.getLabelPageTexture()) return false
    const col0x = t.a * dw
    const col0y = t.b * dw
    const col1x = t.c * dh
    const col1y = t.d * dh
    let tx = t.a * dx + t.c * dy + t.e
    let ty = t.b * dx + t.d * dy + t.f
    if (Math.abs(t.b) < 1e-6 && Math.abs(t.c) < 1e-6) {
      tx = Math.round(tx)
      ty = Math.round(ty)
    }
    const alpha = this.#ctx.stateStack.getAlpha()
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    const packedTint = ((a << 24) | (a << 16) | (a << 8) | a) >>> 0
    const sr = label.srcRect
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
    return true
  }

  // --- Gfx2D: text ---------------------------------------------------------

  warmText(text: string, style: GfxTextStyle = NO_TEXT_STYLE): void {
    if (text.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const deviceScale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    if (!(deviceScale > 0)) return
    this.#label(text, style, deviceScale)
  }

  /**
   * The label for `text`. A font with a px size is keyed without it and
   * rasterized at its size in device px, so `labelScale` is what the label's
   * sizes are multiplied by to reach local units. Any other font is keyed whole
   * and rasterized at the scale.
   */
  #label(
    text: string,
    style: GfxTextStyle,
    deviceScale: number,
  ): LabelTexture | null {
    const resolved = this.#labelStyle
    const fontName = style.font ?? DEFAULT_LABEL_FONT
    resolved.font = fontName
    resolved.align = style.align ?? 'left'
    resolved.baseline = style.baseline ?? 'alphabetic'
    resolved.color = style.color ?? '#000'
    const font = labelFont(fontName)
    if (!font) {
      this.#labelScale = 1
      return this.#textureManager.ensureLabelTexture(
        labelBaseKey(text, resolved),
        text,
        resolved,
        deviceScale,
      )
    }
    const label = this.#textureManager.ensureTextLabel(
      `${text}\n${font.head}\u0000${font.tail}\n${resolved.align}\n${resolved.baseline}\n${resolved.color}\n`,
      text,
      resolved,
      font,
      font.size,
      deviceScale,
    )
    this.#labelScale = label?.px ? font.size / label.px : 1
    return label
  }
  #labelScale = 1

  /**
   * The resolved style of the label being drawn, reused across calls. The
   * texture cache reads it only while rasterizing and keeps no reference.
   */
  /** Points of an outline-stroked line or curve, reused across calls. */
  readonly #linePoints = new Float32Array(4)
  readonly #curvePoints = new Float32Array(CURVE_FLATTEN_MAX_POINTS * 2)
  /** Resolved corner radii of the round rect being drawn, reused across calls. */
  readonly #radii: [number, number, number, number] = [0, 0, 0, 0]
  /** Each corner's fitted smoothing for the round rect being drawn. */
  readonly #cornerSmoothing: [number, number, number, number] = [0, 0, 0, 0]

  readonly #labelStyle: LabelStyle = {
    font: DEFAULT_LABEL_FONT,
    align: 'left',
    baseline: 'alphabetic',
    color: '#000',
  }

  fillText(
    text: string,
    x: number,
    y: number,
    style: GfxTextStyle = NO_TEXT_STYLE,
  ): void {
    if (text.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // Net local->device scale, independent of rotation (columns of the linear
    // part). Drives how sharply the label is rasterized. Rotation is free.
    const deviceScale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    if (!(deviceScale > 0)) return

    const label = this.#label(text, style, deviceScale)
    if (label === null) return

    // Local-space dst rect: bitmap top-left relative to the (x, y) anchor. A
    // label's sizes are in px of the font size it was rasterized at.
    const ls = this.#labelScale
    const dx = x - label.anchorOffsetX * ls
    const dy = y - label.anchorOffsetY * ls
    const w = label.localW * ls
    const h = label.localH * ls
    // Affine mapping the unit square [0,1]² -> device px:
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
    // Device-px -> clip with Y-flip.
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
