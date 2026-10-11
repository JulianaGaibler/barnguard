/**
 * Cached blurred-coverage masks for arbitrary-path drop shadows. A path's own
 * triangles rasterize into a small offscreen target, then two separable
 * blur-and-downsample passes (see `shadowBlur.wgsl`) produce an `rg8` mask:
 * R is the blurred coverage, G is the unblurred silhouette (used to knock an
 * outset shadow out of the shape, and to invert an inset shadow's sample
 * outside the mask's own padded rect to "fully shadowed").
 *
 * Owned by `GpuGfx`, one per surface, alongside its `TextureManager`. Not a
 * `GpuProgram`: the bake runs immediately (no record/replay), the same style
 * `AmbientOcclusion` uses for its own multi-pass pipeline.
 *
 * Simplifications against the general case, each one documented at its own
 * site below: one uniform scale bucket (no separate anisotropy bucket, unlike
 * `strokeOutline`'s cache), a per-texel Gaussian loop rather than the
 * paired-linear-sample tap-halving trick, spread approximated as a uniform
 * scale about the path's own local-bounds center rather than true polygon
 * offsetting, and first-come-first-served per-frame bake budgeting rather
 * than a priority queue ordered by on-screen area with an aging term. None of
 * these affect correctness; they trade a documented amount of fidelity or
 * fairness for an implementation that fits in one file.
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
 * At or below this device-px blur, skip the mask entirely: the hard
 * silhouette through `coloredTri` (with whatever MSAA the stage carries) is
 * indistinguishable and free. Not `0`, so a quarter-pixel sigma doesn't pay
 * for a full bake.
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

/** A resolved mask: the texture, and the local-space rect it covers edge to edge. */
export interface PathShadowMask {
  texture: Texture
  localX: number
  localY: number
  localW: number
  localH: number
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
  lastUsedFrame: number
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

/** The unnormalized mass a kernel of `tapCount` taps and sigma `sigmaTexels` captures, as a fraction of the true infinite Gaussian's integral. */
export function kernelTruncatedMass(sigmaTexels: number, tapCount: number): number {
  if (sigmaTexels <= 1e-6) return 1
  let total = 0
  for (let i = 0; i < tapCount; i++) {
    const w = Math.exp(-(i * i) / (2 * sigmaTexels * sigmaTexels))
    total += i === 0 ? w : 2 * w
  }
  return total / (sigmaTexels * Math.sqrt(2 * Math.PI))
}

/** The resolution formula (§7.4): mask size and the per-axis device-px-per-texel scale. */
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
function tapWorkFor(maskW: number, maskH: number, kernelX: Kernel, kernelY: Kernel): number {
  const texels = maskW * maskH
  const tapsPerTexel = kernelX.tapCount + kernelY.tapCount
  return texels * (4 + 2 * tapsPerTexel)
}

const RASTER_UBO_BYTES = 48 // std140 mat3: 3 × vec4
const BLUR_UBO_BYTES = 32 + 10 * 16 // axis vec4 + flags vec4 + 10 weight vec4s

/**
 * Half-octave scale bucket, matching `strokeOutline.ts`'s scheme (kept as a
 * free function here rather than imported, to avoid coupling this module's
 * public surface to the stroke outline's). Bucket 0 covers roughly
 * `[2^-0.25, 2^0.25)`.
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

  #frame = 0
  #workDoneThisFrame = 0

  constructor(device: GfxDevice) {
    this.#device = device
    this.#pool = new RenderTargetPool(device)
    this.#createResources()
  }

  /** This cache's own render-target pool, for `Stage`/`Viewport2DNode` to prune once per frame. */
  get pool(): RenderTargetPool {
    return this.#pool
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

  /** `(styleKey, exactKey, bucket)` for `req`, shared by `peek` and `getOrBake`. */
  #keysFor(req: PathShadowRequest): { styleKey: string; exactKey: string; bucket: number } {
    const bucket = scaleBucketIndex(req.scale)
    const quality = req.quality
    const styleKey = `${pathId(req.path)}|${req.blur}|${req.spread}|${quality.shadowSigmaBudget}|${quality.shadowExtentSigmas}|${req.registrationEpoch}`
    return { styleKey, exactKey: `${styleKey}|${bucket}`, bucket }
  }

  /**
   * Read-only lookup: an exact-key hit, or a same-style adjacent-bucket
   * (stale) hit, or `null`. Never bakes, so it's safe to call at draw time,
   * including while a render pass the bake's own passes could not nest
   * inside is already open (see `GpuGfx.shadowPath2D`). Touches the entry's
   * LRU timestamp on a hit.
   */
  peek(req: PathShadowRequest): PathShadowMask | null {
    if (!req.quality.pathShadowsEnabled) return null
    const { styleKey, exactKey } = this.#keysFor(req)
    let entry = this.#entries.get(exactKey)
    if (!entry) {
      // A same-style entry one bucket away reads as "scaled to fit" close
      // enough to use while a fresh bake is attempted, per §7.6's stale
      // reading ("the scale bucket only", never a different blur/spread).
      const bucket = this.#keysFor(req).bucket
      entry =
        this.#entries.get(`${styleKey}|${bucket - 1}`) ??
        this.#entries.get(`${styleKey}|${bucket + 1}`)
    }
    if (!entry) return null
    entry.lastUsedFrame = this.#frame
    return {
      texture: entry.texture,
      localX: entry.localX,
      localY: entry.localY,
      localW: entry.localW,
      localH: entry.localH,
    }
  }

  /**
   * `peek`, and if there is no EXACT hit, also attempt a bake (budget
   * permitting). Opens and closes its own render passes, so it must only
   * ever run outside any other open pass: the pre-`beginFrame` window
   * `Stage`/`Viewport2DNode` drain `GpuGfx`'s queued requests in, never at
   * draw time.
   */
  getOrBake(req: PathShadowRequest): PathShadowMask | null {
    if (!req.quality.pathShadowsEnabled) return null
    if (!this.#rasterPipeline || !this.#blurPipeline) return null

    const { styleKey, exactKey, bucket } = this.#keysFor(req)
    let entry = this.#entries.get(exactKey)
    if (!entry) {
      entry =
        this.#entries.get(`${styleKey}|${bucket - 1}`) ??
        this.#entries.get(`${styleKey}|${bucket + 1}`)
      const baked = this.#tryBake(req, bucket, exactKey)
      if (baked) entry = baked
    }
    if (!entry) return null
    entry.lastUsedFrame = this.#frame
    return {
      texture: entry.texture,
      localX: entry.localX,
      localY: entry.localY,
      localW: entry.localW,
      localH: entry.localH,
    }
  }

  #tryBake(
    req: PathShadowRequest,
    bucket: number,
    exactKey: string,
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

    const rt = this.#pool.acquireRetained(size.maskW, size.maskH, 'linear', 'rg8', 1)
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
      lastUsedFrame: this.#frame,
      bakedFrame: this.#frame,
    }
    this.#entries.set(exactKey, entry)
    this.#workDoneThisFrame += work
    return entry
  }

  /**
   * Evict LRU entries, each one baked outside the hysteresis window, until
   * `bytes` more fits `budgetBytes`. Never evicts a fresh bake (the
   * hysteresis guard) and never evicts to make room for an entry that would
   * itself be the next eviction candidate (since every candidate here is
   * already past the window, only `lastUsedFrame` order decides, so the
   * entry just baked this frame is never among them).
   */
  #evictToFit(bytes: number, budgetBytes: number): boolean {
    let total = bytes
    for (const e of this.#entries.values()) total += e.bytes
    if (total <= budgetBytes) return true
    const candidates = Array.from(this.#entries.entries())
      .filter(([, e]) => this.#frame - e.bakedFrame > MASK_EVICT_FRAMES)
      .sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame)
    for (const [key, e] of candidates) {
      this.#pool.release(e.rt)
      this.#entries.delete(key)
      total -= e.bytes
      if (total <= budgetBytes) return true
    }
    return total <= budgetBytes
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
    const rasterRt = this.#pool.acquireTransient(rasterW, rasterH, 'linear', 'r8', 1)
    const passARt = this.#pool.acquireTransient(maskW, rasterH, 'linear', 'rg8', 1)

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
    this.#pool.destroy()
    if (this.#fullscreenTriBuf) this.#device.deleteBuffer(this.#fullscreenTriBuf)
    this.#device.deleteShaderModule(this.#rasterShader)
    this.#device.deleteShaderModule(this.#blurShader)
    this.#device.deleteUniformBuffer(this.#rasterUbo)
    this.#device.deleteUniformBuffer(this.#blurUboA)
    this.#device.deleteUniformBuffer(this.#blurUboB)
  }
}
