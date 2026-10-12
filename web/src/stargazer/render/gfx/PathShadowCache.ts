/**
 * Cached blurred-coverage masks for arbitrary-path drop shadows. A path's own
 * triangles rasterize into a small offscreen target, then two separable
 * blur-and-downsample passes (see `shadowBlur.wgsl`) produce an `rg8` mask: R
 * is the blurred coverage, G is the unblurred silhouette (used to knock an
 * outset shadow out of the shape, and to invert an inset shadow's sample
 * outside the mask's own padded rect to "fully shadowed").
 *
 * Owned by `GpuGfx`, one per surface, alongside its `TextureManager`. Not a
 * `GpuProgram`: the bake runs immediately (no record/replay), the same style
 * `AmbientOcclusion` uses for its own multi-pass pipeline.
 *
 * Simplifications against the general case, each one documented at its own site
 * below: one uniform scale bucket (no separate anisotropy bucket, unlike
 * `strokeOutline`'s cache), a per-texel Gaussian loop rather than the
 * paired-linear-sample tap-halving trick, spread approximated as a uniform
 * scale about the path's own local-bounds center rather than true polygon
 * offsetting, and first-come-first-served per-frame bake budgeting rather than
 * a priority queue ordered by on-screen area with an aging term. None of these
 * affect correctness; they trade a documented amount of fidelity or fairness
 * for an implementation that fits in one file.
 */

import type {
  BindGroup,
  BindGroupLayout,
  GfxDevice,
  IBuffer,
  Pipeline,
  RenderTarget,
  ShaderModule,
  ShaderReflection,
  Texture,
  UBuffer,
  VBuffer,
} from './GfxDevice'
import type { GeometryHandle } from './GeometryHandle'
import type { VectorQuality } from '../VectorQuality'
import { RenderTargetPool } from './RenderTargetPool'
import shadowMaskWgsl from './shaders/shadowMask.wgsl?raw'
import shadowMaskVertSrc from './shaders/shadowMask.gen.vert.glsl?raw'
import shadowMaskFragSrc from './shaders/shadowMask.gen.frag.glsl?raw'
import shadowMaskReflect from './shaders/shadowMask.reflect.json'
import shadowBlurWgsl from './shaders/shadowBlur.wgsl?raw'
import shadowBlurVertSrc from './shaders/shadowBlur.gen.vert.glsl?raw'
import shadowBlurFragSrc from './shaders/shadowBlur.gen.frag.glsl?raw'
import shadowBlurReflect from './shaders/shadowBlur.reflect.json'

/** Pool bin granularity for a mask's width/height. */
export const MASK_SIZE_QUANTUM = 32
/** Past this a mask softens, invisible on something already blurred. */
export const MASK_MAX_EDGE = 1024
/** Surface render frames a baked entry survives with nothing asking for it. */
export const MASK_EVICT_FRAMES = 240
/**
 * The same window for an entry no draw has asked for by its own key since it
 * baked. A request key that moves every frame bakes a mask that is dead the
 * frame after, and a backlog of those held for the full window fills the byte
 * budget with masks nothing can evict, which stops every later bake. Two frames
 * still covers the gap between a bake in the pre-pass and the draw it was
 * queued for.
 */
export const MASK_EVICT_FRAMES_UNUSED = 2
/**
 * How far, in octaves of blur radius, a same-shape mask may stand in for one
 * that is not cached. Half an octave is the scale bucket's own width, so a
 * substitution is the same order of approximation as the adjacent-bucket hit.
 */
export const MASK_SUBSTITUTE_BLUR_OCTAVES = 0.5
/**
 * Consecutive frames of substituting a nearby blur before warning once. Long
 * enough to sit out a short deliberate blur animation, short enough to catch a
 * camera tween.
 */
const BLUR_CHURN_WARN_FRAMES = 20
/**
 * At or below this device-px blur, skip the mask entirely: the hard silhouette
 * through `coloredTri` (with whatever MSAA the stage carries) is
 * indistinguishable and free. Not `0`, so a quarter-pixel sigma doesn't pay for
 * a full bake.
 */
export const HARD_SHADOW_BLUR_PX = 1
/** Taps beyond center a pass's kernel can hold (mirrors `shadowBlur.wgsl`). */
const MAX_TAPS = 40

function ceilToMultiple(v: number, q: number): number {
  return Math.max(q, Math.ceil(v / q) * q)
}

// Lazily assign a stable numeric id to a Path2D, the same pattern
// `pipelineKey.ts` uses for pipeline-descriptor handles: the cache's
// byte-budget eviction needs to iterate every live entry, which a `Path2D`
// identity alone (via a `WeakMap`) cannot support, so entries are keyed by a
// plain string instead and this is the path-identity half of that string.
const pathIdTag = Symbol('pathShadowPathId')
let nextPathId = 1
function pathId(path: Path2D): number {
  const rec = path as unknown as Record<symbol, number>
  if (!rec[pathIdTag]) rec[pathIdTag] = nextPathId++
  return rec[pathIdTag]
}

/** A request to resolve (and, if needed, bake) a path shadow's mask. */
export interface PathShadowRequest {
  path: Path2D
  geometry: GeometryHandle
  /** The path's own local-space AABB (unpadded). */
  localBounds: { x: number; y: number; width: number; height: number }
  registrationEpoch: number
  /** Local units, already strokeSpace-scaled by the caller. */
  blur: number
  spread: number
  /** Current transform's per-axis and uniform device scale. */
  scaleX: number
  scaleY: number
  scale: number
  quality: VectorQuality
}

/**
 * A resolved mask: the texture, and the local-space rect it covers edge to
 * edge.
 */
export interface PathShadowMask {
  texture: Texture
  localX: number
  localY: number
  localW: number
  localH: number
  /**
   * False when the request's own key had no entry and a neighbouring scale
   * bucket or nearby blur stood in. A caller that wants the real mask has to
   * queue the bake itself.
   */
  exact: boolean
}

/** One live mask entry, flattened for the debug texture inspector. */
export interface PathShadowMaskSummary {
  width: number
  height: number
  bytes: number
  /** Half-octave device-scale bucket this mask was baked for. */
  bucket: number
  lastUsedFrame: number
  bakedFrame: number
}

interface CacheEntry {
  rt: RenderTarget
  texture: Texture
  localX: number
  localY: number
  localW: number
  localH: number
  bytes: number
  bucket: number
  /** Blur this mask was baked for, in local units, for the nearby-blur search. */
  blur: number
  /** Index this entry is listed under in `#shapes`. */
  shapeKey: string
  /** Any hit, exact or substitute. Orders eviction. */
  lastUsedFrame: number
  /** Exact-key hits only. Decides which eviction window applies. */
  lastExactFrame: number
  bakedFrame: number
}

/** One pass's derived kernel: per-axis tap weights plus the loop bound. */
interface Kernel {
  weights: Float32Array // MAX_TAPS entries, index 0 = center
  tapCount: number
}

/** Gaussian kernel for a pass whose OWN source-texel sigma is `sigmaTexels`. */
function buildKernel(sigmaTexels: number): Kernel {
  const weights = new Float32Array(MAX_TAPS)
  if (sigmaTexels <= 1e-6) {
    weights[0] = 1
    return { weights, tapCount: 1 }
  }
  const tapsPerSide = Math.min(
    MAX_TAPS - 1,
    Math.max(0, Math.ceil(1.5 * sigmaTexels)),
  )
  const tapCount = tapsPerSide + 1
  const inv2SigmaSq = 1 / (2 * sigmaTexels * sigmaTexels)
  let total = 0
  for (let i = 0; i < tapCount; i++) {
    const w = Math.exp(-(i * i) * inv2SigmaSq)
    weights[i] = w
    total += i === 0 ? w : 2 * w
  }
  const invTotal = total > 0 ? 1 / total : 1
  for (let i = 0; i < tapCount; i++) weights[i] *= invTotal
  return { weights, tapCount }
}

/**
 * The unnormalized mass a kernel of `tapCount` taps and sigma `sigmaTexels`
 * captures, as a fraction of the true infinite Gaussian's integral.
 */
export function kernelTruncatedMass(
  sigmaTexels: number,
  tapCount: number,
): number {
  if (sigmaTexels <= 1e-6) return 1
  let total = 0
  for (let i = 0; i < tapCount; i++) {
    const w = Math.exp(-(i * i) / (2 * sigmaTexels * sigmaTexels))
    total += i === 0 ? w : 2 * w
  }
  return total / (sigmaTexels * Math.sqrt(2 * Math.PI))
}

/**
 * The resolution formula (§7.4): mask size and the per-axis device-px-per-texel
 * scale.
 */
export function resolveMaskSize(
  localBoundsW: number,
  localBoundsH: number,
  blurLocal: number,
  spreadLocal: number,
  bucketScale: number,
  sigmaBudget: number,
  extentSigmas: number,
): {
  maskW: number
  maskH: number
  kx: number
  ky: number
  extentDev: number
  sigmaDevice: number
} {
  const sigmaDevice = Math.max(0, blurLocal) * 0.5 * bucketScale
  const spreadDevice = spreadLocal * bucketScale
  const k0 = Math.max(1, sigmaDevice / sigmaBudget)
  const extentDev = extentSigmas * sigmaDevice + Math.max(0, spreadDevice)
  const rawDevW = Math.max(1, localBoundsW * bucketScale + 2 * extentDev)
  const rawDevH = Math.max(1, localBoundsH * bucketScale + 2 * extentDev)
  const maskW = Math.min(
    ceilToMultiple(rawDevW / k0, MASK_SIZE_QUANTUM),
    MASK_MAX_EDGE,
  )
  const maskH = Math.min(
    ceilToMultiple(rawDevH / k0, MASK_SIZE_QUANTUM),
    MASK_MAX_EDGE,
  )
  return {
    maskW,
    maskH,
    kx: rawDevW / maskW,
    ky: rawDevH / maskH,
    extentDev,
    sigmaDevice,
  }
}

/** Tap-work estimate (§7.6): texels × (2x raster + 2 passes' own tap cost). */
function tapWorkFor(
  maskW: number,
  maskH: number,
  kernelX: Kernel,
  kernelY: Kernel,
): number {
  const texels = maskW * maskH
  const tapsPerTexel = kernelX.tapCount + kernelY.tapCount
  return texels * (4 + 2 * tapsPerTexel)
}

const RASTER_UBO_BYTES = 48 // std140 mat3: 3 × vec4
const BLUR_UBO_BYTES = 32 + 10 * 16 // axis vec4 + flags vec4 + 10 weight vec4s

/**
 * Half-octave scale bucket, matching `strokeOutline.ts`'s scheme (kept as a
 * free function here rather than imported, to avoid coupling this module's
 * public surface to the stroke outline's). Bucket 0 covers roughly `[2^-0.25,
 * 2^0.25)`.
 */
function scaleBucketIndex(scale: number): number {
  return Math.round(Math.log2(Math.max(scale, 1e-6)) * 2)
}
function scaleBucketCenter(bucket: number): number {
  return Math.pow(2, bucket / 2)
}

export class PathShadowCache {
  readonly #device: GfxDevice
  readonly #pool: RenderTargetPool

  #rasterShader!: ShaderModule
  #rasterLayout!: BindGroupLayout
  #rasterPipeline: Pipeline | null = null
  #rasterUbo!: UBuffer
  readonly #rasterStaging = new Float32Array(RASTER_UBO_BYTES / 4)
  #rasterBindGroup!: BindGroup

  #blurShader!: ShaderModule
  #blurLayout!: BindGroupLayout
  #blurPipeline: Pipeline | null = null
  #blurUboA!: UBuffer // pass one
  #blurUboB!: UBuffer // pass two
  readonly #blurStaging = new Float32Array(BLUR_UBO_BYTES / 4)

  readonly #entries = new Map<string, CacheEntry>()
  /** Exact keys grouped by `#keysFor`'s `shapeKey`, for `#nearestBlur`. */
  readonly #shapes = new Map<string, Set<string>>()

  #frame = 0
  #workDoneThisFrame = 0
  /** Cumulative since startup, for the debug HUD. */
  #maskBakes = 0
  #maskBakeWork = 0
  /** Last frame `#nearestBlur` stood in, and the run length ending there. */
  #churnFrame = -1
  #churnFrames = 0
  #warnedBlurChurn = false

  constructor(device: GfxDevice) {
    this.#device = device
    this.#pool = new RenderTargetPool(device)
    this.#createResources()
  }

  /**
   * This cache's own render-target pool, for `Stage`/`Viewport2DNode` to prune
   * once per frame.
   */
  get pool(): RenderTargetPool {
    return this.#pool
  }

  /** Successful bakes since startup. */
  get maskBakes(): number {
    return this.#maskBakes
  }
  /** Total tap-work (§7.6) spent baking since startup. */
  get maskBakeWork(): number {
    return this.#maskBakeWork
  }
  /** Bytes currently held by live (retained) mask entries. */
  get maskBytes(): number {
    let total = 0
    for (const e of this.#entries.values()) total += e.bytes
    return total
  }

  /**
   * Every live mask entry, for the debug texture inspector. No pixel preview: a
   * mask has no CPU-side backing (unlike the sprite atlas or label page), and
   * reading one back would need a GPU readback this inspector otherwise never
   * pays for.
   */
  listMasks(): PathShadowMaskSummary[] {
    const out: PathShadowMaskSummary[] = []
    for (const e of this.#entries.values()) {
      out.push({
        width: e.rt.width,
        height: e.rt.height,
        bytes: e.bytes,
        bucket: e.bucket,
        lastUsedFrame: e.lastUsedFrame,
        bakedFrame: e.bakedFrame,
      })
    }
    return out
  }

  #createResources(): void {
    const device = this.#device
    this.#rasterShader = device.createShaderModule({
      glsl: { vertex: shadowMaskVertSrc, fragment: shadowMaskFragSrc },
      wgsl: {
        code: shadowMaskWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: shadowMaskReflect as ShaderReflection,
      label: 'shadowMask',
    })
    this.#rasterLayout = device.createBindGroupLayout([
      { binding: 0, type: 'uniform-buffer' },
    ])
    this.#rasterUbo = device.createUniformBuffer(RASTER_UBO_BYTES)
    this.#rasterBindGroup = device.createBindGroup(this.#rasterLayout, [
      { binding: 0, resource: { uniformBuffer: this.#rasterUbo } },
    ])

    this.#blurShader = device.createShaderModule({
      glsl: { vertex: shadowBlurVertSrc, fragment: shadowBlurFragSrc },
      wgsl: {
        code: shadowBlurWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: shadowBlurReflect as ShaderReflection,
      label: 'shadowBlur',
    })
    this.#blurLayout = device.createBindGroupLayout([
      { binding: 0, type: 'texture-2d' },
      { binding: 1, type: 'uniform-buffer' },
    ])
    this.#blurUboA = device.createUniformBuffer(BLUR_UBO_BYTES)
    this.#blurUboB = device.createUniformBuffer(BLUR_UBO_BYTES)
  }

  async warmup(): Promise<void> {
    const device = this.#device
    const pipelineOpts = {
      vertexLayout: [
        {
          arrayStride: 8,
          stepMode: 'vertex' as const,
          attributes: [
            { location: 0, format: 'float32x2' as const, offset: 0 },
          ],
        },
      ],
      depth: null,
      cull: 'none' as const,
      frontFace: 'ccw' as const,
      primitive: 'triangle-list' as const,
      samples: 1,
    }
    this.#rasterPipeline = await device.createPipeline({
      ...pipelineOpts,
      shader: this.#rasterShader,
      bindGroupLayouts: [this.#rasterLayout],
      color: { format: 'linear', pixelFormat: 'r8', blend: 'none' },
      label: 'shadowMask',
    })
    this.#blurPipeline = await device.createPipeline({
      ...pipelineOpts,
      vertexLayout: [
        {
          arrayStride: 8,
          stepMode: 'vertex' as const,
          attributes: [
            { location: 0, format: 'float32x2' as const, offset: 0 },
          ],
        },
      ],
      shader: this.#blurShader,
      bindGroupLayouts: [this.#blurLayout],
      color: { format: 'linear', pixelFormat: 'rg8', blend: 'none' },
      label: 'shadowBlur',
    })
  }

  /** Reset the per-frame bake-work budget and advance the eviction clock. */
  beginFrame(): void {
    this.#frame++
    this.#workDoneThisFrame = 0
  }

  /**
   * The cache key `req` resolves to, exposed so `GpuGfx` can dedupe its own
   * per-frame queue of bake requests (several draw calls for the same path,
   * style, and scale bucket in one frame should queue once).
   */
  requestKey(req: PathShadowRequest): string {
    return this.#keysFor(req).exactKey
  }

  /**
   * The three keys `req` resolves to. `shapeKey` omits the blur, so it groups
   * every cached blur of one path at one geometry and quality, which is what
   * `#nearestBlur` searches.
   */
  #keysFor(req: PathShadowRequest): {
    shapeKey: string
    styleKey: string
    exactKey: string
    bucket: number
  } {
    const bucket = scaleBucketIndex(req.scale)
    const quality = req.quality
    const shapeKey = `${pathId(req.path)}|${req.spread}|${quality.shadowSigmaBudget}|${quality.shadowExtentSigmas}|${req.registrationEpoch}`
    const styleKey = `${shapeKey}|${req.blur}`
    return { shapeKey, styleKey, exactKey: `${styleKey}|${bucket}`, bucket }
  }

  /**
   * Resolve `req` against the live entries, without baking. An exact-key hit
   * comes back `exact`. Failing that, a same-style mask one scale bucket away
   * or a same-shape mask at a nearby blur stands in, reported as inexact so the
   * caller can queue the bake that converges on the real one.
   */
  #lookup(
    req: PathShadowRequest,
  ): { entry: CacheEntry; exact: boolean } | null {
    const { shapeKey, styleKey, exactKey, bucket } = this.#keysFor(req)
    const hit = this.#entries.get(exactKey)
    if (hit) return { entry: hit, exact: true }
    // One bucket away reads as "scaled to fit" close enough to stand in, per
    // §7.6's stale reading. The blur and spread still match exactly, only the
    // resolution differs.
    const adjacent =
      this.#entries.get(`${styleKey}|${bucket - 1}`) ??
      this.#entries.get(`${styleKey}|${bucket + 1}`)
    if (adjacent) return { entry: adjacent, exact: false }
    const near = this.#nearestBlur(shapeKey, req.blur)
    return near ? { entry: near, exact: false } : null
  }

  /**
   * The same shape's cached mask at the closest blur within
   * `MASK_SUBSTITUTE_BLUR_OCTAVES`, or `null`. A mask a fraction of an octave
   * off beats an outset shadow dropping to a hard silhouette, and it is the
   * only thing an inset shadow has to draw at all.
   */
  #nearestBlur(shapeKey: string, blur: number): CacheEntry | null {
    const keys = this.#shapes.get(shapeKey)
    if (!keys || blur <= 0) return null
    let best: CacheEntry | null = null
    let bestDistance = MASK_SUBSTITUTE_BLUR_OCTAVES
    for (const key of keys) {
      const entry = this.#entries.get(key)
      if (!entry || entry.blur <= 0) continue
      const distance = Math.abs(Math.log2(entry.blur / blur))
      if (distance < bestDistance) {
        bestDistance = distance
        best = entry
      }
    }
    if (best) this.#noteBlurChurn()
    return best
  }

  /**
   * Warn once when a blur has been substituted on every one of the last
   * `BLUR_CHURN_WARN_FRAMES` frames, which means the caller is asking for a
   * radius the cache cannot keep up with.
   */
  #noteBlurChurn(): void {
    if (this.#warnedBlurChurn || this.#churnFrame === this.#frame) return
    this.#churnFrames =
      this.#churnFrame === this.#frame - 1 ? this.#churnFrames + 1 : 1
    this.#churnFrame = this.#frame
    if (this.#churnFrames < BLUR_CHURN_WARN_FRAMES) return
    this.#warnedBlurChurn = true
    console.warn(
      'PathShadowCache: a path shadow has asked for a new blur radius on ' +
        `each of the last ${BLUR_CHURN_WARN_FRAMES} frames, so its mask ` +
        'rebakes every frame and a nearby blur is standing in meanwhile. ' +
        'Past half an octave there is nothing to stand in and the shadow ' +
        "drops out. A `strokeSpace: 'screen'` blur does this under a camera " +
        'zoom, since the radius in local units tracks the camera scale. ' +
        "Switching that shadow to `strokeSpace: 'world'` holds the radius " +
        'still, which also means the shadow then scales with the geometry ' +
        'instead of staying a fixed size on screen.',
    )
  }

  /**
   * Read-only lookup. Never bakes, so it's safe to call at draw time, including
   * while a render pass the bake's own passes could not nest inside is already
   * open (see `GpuGfx.shadowPath2D`). Touches the entry's LRU timestamp on a
   * hit.
   */
  peek(req: PathShadowRequest): PathShadowMask | null {
    if (!req.quality.pathShadowsEnabled) return null
    const found = this.#lookup(req)
    if (!found) return null
    return this.#resolved(found.entry, found.exact)
  }

  /** A `PathShadowMask` view of `entry`, touching its LRU timestamp. */
  #resolved(entry: CacheEntry, exact: boolean): PathShadowMask {
    entry.lastUsedFrame = this.#frame
    if (exact) entry.lastExactFrame = this.#frame
    return {
      texture: entry.texture,
      localX: entry.localX,
      localY: entry.localY,
      localW: entry.localW,
      localH: entry.localH,
      exact,
    }
  }

  /**
   * `peek`, and if there is no EXACT hit, also attempt a bake (budget
   * permitting). Opens and closes its own render passes, so it must only ever
   * run outside any other open pass: the pre-`beginFrame` window
   * `Stage`/`Viewport2DNode` drain `GpuGfx`'s queued requests in, never at draw
   * time.
   */
  getOrBake(req: PathShadowRequest): PathShadowMask | null {
    if (!req.quality.pathShadowsEnabled) return null
    if (!this.#rasterPipeline || !this.#blurPipeline) return null

    const { shapeKey, exactKey, bucket } = this.#keysFor(req)
    const hit = this.#entries.get(exactKey)
    if (hit) return this.#resolved(hit, true)

    const baked = this.#tryBake(req, bucket, exactKey, shapeKey)
    if (baked) return this.#resolved(baked, true)

    const found = this.#lookup(req)
    return found ? this.#resolved(found.entry, found.exact) : null
  }

  #tryBake(
    req: PathShadowRequest,
    bucket: number,
    exactKey: string,
    shapeKey: string,
  ): CacheEntry | null {
    const bucketScale = scaleBucketCenter(bucket)
    const quality = req.quality
    const size = resolveMaskSize(
      req.localBounds.width,
      req.localBounds.height,
      req.blur,
      req.spread,
      bucketScale,
      quality.shadowSigmaBudget,
      quality.shadowExtentSigmas,
    )
    // Each pass's OWN source resolution is 2x the final resolution on the
    // axis it blurs (the 2x raster for pass one, pass one's still-2x-tall
    // output for pass two), so its sigma in ITS OWN texels is double the
    // final-resolution sigma.
    const sigmaFinalX = size.kx > 0 ? size.sigmaDevice / size.kx : 0
    const sigmaFinalY = size.ky > 0 ? size.sigmaDevice / size.ky : 0
    const kernelX = buildKernel(sigmaFinalX * 2)
    const kernelY = buildKernel(sigmaFinalY * 2)
    const work = tapWorkFor(size.maskW, size.maskH, kernelX, kernelY)

    // Always allow at least one bake per frame, even one whose own cost
    // exceeds the whole budget, so a single large shape can't starve
    // forever behind its own estimate.
    if (
      this.#workDoneThisFrame > 0 &&
      this.#workDoneThisFrame + work > quality.shadowBakeWorkPerFrame
    ) {
      return null
    }
    const bytes = size.maskW * size.maskH * 2 // rg8
    if (!this.#evictToFit(bytes, quality.shadowMaskBudgetBytes)) return null

    const rt = this.#pool.acquireRetained(
      size.maskW,
      size.maskH,
      'linear',
      'rg8',
      1,
    )
    const texture = this.#device.colorTexture(rt)
    const extentLocal = size.extentDev / bucketScale
    const localX = req.localBounds.x - extentLocal
    const localY = req.localBounds.y - extentLocal
    const localW = req.localBounds.width + 2 * extentLocal
    const localH = req.localBounds.height + 2 * extentLocal

    this.#bake(
      req,
      rt,
      size.maskW,
      size.maskH,
      localX,
      localY,
      localW,
      localH,
      kernelX,
      kernelY,
    )

    const entry: CacheEntry = {
      rt,
      texture,
      localX,
      localY,
      localW,
      localH,
      bytes,
      bucket,
      blur: req.blur,
      shapeKey,
      lastUsedFrame: this.#frame,
      lastExactFrame: -1,
      bakedFrame: this.#frame,
    }
    this.#entries.set(exactKey, entry)
    let shape = this.#shapes.get(shapeKey)
    if (!shape) {
      shape = new Set()
      this.#shapes.set(shapeKey, shape)
    }
    shape.add(exactKey)
    this.#workDoneThisFrame += work
    this.#maskBakes++
    this.#maskBakeWork += work
    return entry
  }

  /**
   * Evict LRU entries, each one baked outside its hysteresis window, until
   * `bytes` more fits `budgetBytes`. Never evicts a fresh bake, and never
   * evicts to make room for an entry that would itself be the next eviction
   * candidate (since every candidate here is already past the window, only
   * `lastUsedFrame` order decides, so the entry just baked this frame is never
   * among them).
   *
   * An entry no draw has asked for since its bake gets the much shorter
   * `MASK_EVICT_FRAMES_UNUSED` window, so a backlog of masks whose request key
   * moved on cannot hold the budget full.
   */
  #evictToFit(bytes: number, budgetBytes: number): boolean {
    let total = bytes
    for (const e of this.#entries.values()) total += e.bytes
    if (total <= budgetBytes) return true
    const candidates = Array.from(this.#entries.entries())
      .filter(([, e]) => this.#frame - e.bakedFrame > this.#evictWindow(e))
      .sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame)
    for (const [key, e] of candidates) {
      this.#pool.release(e.rt)
      this.#entries.delete(key)
      const shape = this.#shapes.get(e.shapeKey)
      if (shape) {
        shape.delete(key)
        if (shape.size === 0) this.#shapes.delete(e.shapeKey)
      }
      total -= e.bytes
      if (total <= budgetBytes) return true
    }
    return total <= budgetBytes
  }

  /**
   * Frames since its bake that `entry` is protected from eviction. Standing in
   * for another radius does not earn the long window: during churn every mask
   * stands in on the frame after its bake, which would re-protect the whole
   * backlog and fill the budget again. `lastUsedFrame` still orders eviction,
   * so the stand-in a glow is currently drawn from sorts last among the
   * short-window candidates.
   */
  #evictWindow(entry: CacheEntry): number {
    return entry.lastExactFrame > entry.bakedFrame
      ? MASK_EVICT_FRAMES
      : MASK_EVICT_FRAMES_UNUSED
  }

  #bake(
    req: PathShadowRequest,
    finalRt: RenderTarget,
    maskW: number,
    maskH: number,
    localX: number,
    localY: number,
    localW: number,
    localH: number,
    kernelX: Kernel,
    kernelY: Kernel,
  ): void {
    const rasterW = maskW * 2
    const rasterH = maskH * 2
    const rasterRt = this.#pool.acquireTransient(
      rasterW,
      rasterH,
      'linear',
      'r8',
      1,
    )
    const passARt = this.#pool.acquireTransient(
      maskW,
      rasterH,
      'linear',
      'rg8',
      1,
    )

    this.#rasterize(req, rasterRt, localX, localY, localW, localH)
    this.#blurPass(
      rasterRt,
      passARt,
      { x: 1, y: 0 },
      1 / rasterW,
      kernelX,
      false,
      this.#blurUboA,
    )
    this.#blurPass(
      passARt,
      finalRt,
      { x: 0, y: 1 },
      1 / rasterH,
      kernelY,
      true,
      this.#blurUboB,
    )

    this.#pool.release(rasterRt)
    this.#pool.release(passARt)
  }

  #rasterize(
    req: PathShadowRequest,
    rt: RenderTarget,
    localX: number,
    localY: number,
    localW: number,
    localH: number,
  ): void {
    const device = this.#device
    const geo = req.geometry
    if (geo.vertices.length === 0 || geo.indices.length === 0) {
      device.beginRenderPass({
        color: { target: rt, loadOp: 'clear', clearColor: [0, 0, 0, 0] },
      })
      device.endRenderPass()
      return
    }
    const vbo = device.createVertexBuffer(geo.vertices.byteLength)
    device.updateBufferSubData(vbo, 0, geo.vertices)
    const ibo: IBuffer = device.createIndexBuffer(geo.indices.byteLength)
    device.updateIndexBufferSubData(ibo, 0, geo.indices)

    // Spread approximates a uniform scale about the path's own (unpadded)
    // local-bounds center, not true polygon offsetting: cheap, and close
    // enough for the blob-like shapes a spread shadow is usually cast by.
    const b = req.localBounds
    const avgHalfExtent = Math.max(1e-4, (b.width + b.height) / 4)
    const spreadFactor = Math.max(0, 1 + req.spread / avgHalfExtent)
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2

    // Compose "scale about (cx,cy) by spreadFactor" with "map the padded
    // local rect [localX, localX+localW] × [localY, localY+localH] onto
    // clip space [-1,1]²" into one affine. The Y map flips on WebGPU, whose
    // sampled render-target row order is the opposite of WebGL's (see
    // `PostProcessPipeline.fullscreenTri`'s identical correction), so a
    // later `uv = (localY - originY) * invH` sample lands on the row this
    // pass actually wrote.
    const flip = device.ndc.textureTopDown ? -1 : 1
    const mapSx = 2 / localW
    const mapSy = (flip * 2) / localH
    const mapTx = -1 - mapSx * localX
    const mapTy = (device.ndc.textureTopDown ? 1 : -1) - mapSy * localY
    const a = mapSx * spreadFactor
    const d = mapSy * spreadFactor
    const e = mapSx * cx * (1 - spreadFactor) + mapTx
    const f = mapSy * cy * (1 - spreadFactor) + mapTy

    const s = this.#rasterStaging
    s[0] = a
    s[1] = 0
    s[2] = 0
    s[3] = 0
    s[4] = 0
    s[5] = d
    s[6] = 0
    s[7] = 0
    s[8] = e
    s[9] = f
    s[10] = 1
    s[11] = 0
    device.updateUniformBuffer(this.#rasterUbo, s)

    device.beginRenderPass({
      color: { target: rt, loadOp: 'clear', clearColor: [0, 0, 0, 0] },
    })
    device.draw({
      pipeline: this.#rasterPipeline!,
      vertexBuffers: [{ buffer: vbo, offset: 0 }],
      indexBuffer: ibo,
      bindGroups: [{ group: 0, bindGroup: this.#rasterBindGroup }],
      indexCount: geo.indices.length,
    })
    device.endRenderPass()

    device.deleteBuffer(vbo)
    device.deleteIndexBuffer(ibo)
  }

  #blurPass(
    src: RenderTarget,
    dst: RenderTarget,
    dir: { x: number; y: number },
    srcTexelSize: number,
    kernel: Kernel,
    hasG: boolean,
    ubo: UBuffer,
  ): void {
    const device = this.#device
    const s = this.#blurStaging
    s[0] = dir.x
    s[1] = dir.y
    s[2] = srcTexelSize
    s[3] = kernel.tapCount
    s[4] = hasG ? 1 : 0
    s[5] = 0
    s[6] = 0
    s[7] = 0
    for (let i = 0; i < MAX_TAPS; i++) s[8 + i] = kernel.weights[i] ?? 0
    device.updateUniformBuffer(ubo, s)

    const srcTex = device.colorTexture(src)
    const bindGroup = device.createBindGroup(this.#blurLayout, [
      { binding: 0, resource: { texture: srcTex } },
      { binding: 1, resource: { uniformBuffer: ubo } },
    ])
    device.beginRenderPass({
      color: { target: dst, loadOp: 'clear', clearColor: [0, 0, 0, 0] },
    })
    device.draw({
      pipeline: this.#blurPipeline!,
      vertexBuffers: [{ buffer: this.#fullscreenTri(), offset: 0 }],
      bindGroups: [{ group: 0, bindGroup }],
      vertexCount: 3,
    })
    device.endRenderPass()
    device.deleteBindGroup(bindGroup)
  }

  #fullscreenTriBuf: VBuffer | null = null
  #fullscreenTri(): VBuffer {
    if (!this.#fullscreenTriBuf) {
      const tri = new Float32Array([-1, -1, 3, -1, -1, 3])
      const vbo = this.#device.createVertexBuffer(tri.byteLength)
      this.#device.updateBufferSubData(vbo, 0, tri)
      this.#fullscreenTriBuf = vbo
    }
    return this.#fullscreenTriBuf
  }

  destroy(): void {
    this.#entries.clear()
    this.#shapes.clear()
    this.#pool.destroy()
    if (this.#fullscreenTriBuf)
      this.#device.deleteBuffer(this.#fullscreenTriBuf)
    this.#device.deleteShaderModule(this.#rasterShader)
    this.#device.deleteShaderModule(this.#blurShader)
    this.#device.deleteUniformBuffer(this.#rasterUbo)
    this.#device.deleteUniformBuffer(this.#blurUboA)
    this.#device.deleteUniformBuffer(this.#blurUboB)
  }
}
