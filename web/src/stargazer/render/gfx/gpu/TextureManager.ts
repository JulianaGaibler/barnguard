/**
 * Owns every GL texture `GpuGfx` uses:
 *
 * - 1024×1024 particle sprite atlas, 66×66 tiles (64 core + 1 px pad). All
 *   particles share it so cross-colour draws coalesce into one instance batch.
 * - `textureBySource` cache for non-sprite images.
 * - Gradient-radial LUT cache, one 256×1 texture per `stops` reference.
 *
 * On context loss, `rebuild(device)` recreates the atlas texture from its
 * CPU-side `OffscreenCanvas` backing (survives loss) and drops the other
 * caches, they repopulate lazily.
 */

import type { GfxDevice, Texture } from '../GfxDevice'
import type { GfxGradientStop } from '../Gfx2D'
import type { BitmapMask } from '../../../assets/BitmapMask'
import { rasterizeLabel, type LabelStyle } from '../rasterizeLabel'

/** Sprite tile size = 64 core + 1 px transparent padding on all sides. */
export const ATLAS_TILE_CORE = 64
export const ATLAS_TILE_PADDING = 1
export const ATLAS_TILE_SIZE = ATLAS_TILE_CORE + 2 * ATLAS_TILE_PADDING // 66

/** Atlas texture dimensions. 1024×1024 → 15×15 = 225 tiles capacity. */
export const ATLAS_WIDTH = 1024
export const ATLAS_HEIGHT = 1024

/** Radial-gradient LUT: 256 texels smooth enough for every stop the game uses. */
const GRADIENT_LUT_WIDTH = 256

/** Marker property `getParticleSprite` sets on returned canvases. */
export const PARTICLE_ATLAS_MARKER = '__isParticleAtlasCandidate' as const

/** Per-tile atlas record. `srcRect` is normalized `[u0, v0, u1, v1]`. */
export interface AtlasEntry {
  tex: Texture
  srcRect: readonly [number, number, number, number]
}

/**
 * A cached rasterized text label: its GL texture plus the local-space (CSS px)
 * geometry `GpuGfx.fillText` needs to place the quad. See `rasterizeLabel`.
 */
export interface LabelTexture {
  tex: Texture
  localW: number
  localH: number
  anchorOffsetX: number
  anchorOffsetY: number
}

/** Max distinct labels held before LRU eviction. */
const LABEL_CACHE_MAX = 256
/**
 * Scale-bucket ratio. `deviceScale` is rounded UP to the nearest `ratio**k`, so
 * the texture is always ≥ on-screen size (only ever minified → crisp). A bucket
 * spans `(ratio**(k-1), ratio**k]`, giving ~`ratio`× hysteresis: small scale
 * jitter within a bucket reuses the same texture. ~1.26× ≈ 3 buckets/octave.
 */
const LABEL_SCALE_BUCKET_RATIO = 2 ** (1 / 3)
/**
 * Cap on new label rasterizations+uploads per frame, prevents zoom-tween
 * spikes.
 */
const LABEL_MAX_REGENS_PER_FRAME = 8

/**
 * Read-only snapshot of the texture caches for the debug inspector. Built on
 * demand by {@link TextureManager.snapshot}; nothing here runs unless the
 * inspector panel asks for it. Covers the three enumerable caches (atlas,
 * per-source, labels); the gradient-LUT and clip-mask caches are `WeakMap`s and
 * not enumerable, so they're omitted.
 *
 * @category Debug
 */
export interface TextureInspectorSnapshot {
  atlas: {
    width: number
    height: number
    tileSize: number
    /** Tile slots the atlas can hold. */
    capacity: number
    /** Tiles currently bound. */
    used: number
    full: boolean
    /**
     * CPU backing, draw it directly for a preview (no GPU readback). `null`
     * until the atlas is first used.
     */
    canvas: CanvasImageSource | null
    /** One entry per bound sprite; `srcRect` is normalized `[u0, v0, u1, v1]`. */
    bindings: { srcRect: readonly [number, number, number, number] }[]
  }
  /** Non-atlas images, keyed by their own source in the live cache. */
  perSource: { width: number; height: number; source: CanvasImageSource }[]
  /** One entry per cached label texture, with its style recovered from the key. */
  labels: TextureInspectorLabel[]
  labelCount: number
  labelCap: number
  labelRegensThisFrame: number
  labelMaxRegensPerFrame: number
}

/** One label-cache entry, flattened for the inspector. */
export interface TextureInspectorLabel {
  key: string
  text: string
  font: string
  align: string
  baseline: string
  color: string
  /** Scale bucket `k` (can be negative for sub-1× device scale). */
  bucket: number
  texW: number
  texH: number
  localW: number
  localH: number
}

/**
 * Read-only inspection surface exposed to the debug HUD. `GpuGfx` and `Stage`
 * hand this out; {@link TextureManager} implements it. Every method builds its
 * result on demand, there is no standing cost when the panel is closed.
 *
 * @category Debug
 */
export interface TextureInspector {
  snapshot(): TextureInspectorSnapshot
  /**
   * Re-rasterize the label identified by `key` (from
   * {@link TextureInspectorSnapshot.labels}) to a fresh canvas for preview.
   * Returns `null` for an unparseable key or when no 2D context is available.
   */
  renderLabelPreview(key: string): HTMLCanvasElement | null
}

export class TextureManager implements TextureInspector {
  #device: GfxDevice

  // Atlas ---------------------------------------------------------------
  #atlasTex: Texture | null = null
  #atlasCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  #atlasCtx: CanvasRenderingContext2D | null = null
  #atlasNextX = ATLAS_TILE_PADDING
  #atlasNextY = ATLAS_TILE_PADDING
  #atlasBindings = new Map<CanvasImageSource, AtlasEntry>()
  #atlasFull = false
  #warnedAtlasFull = false

  // Per-source (fallback) ----------------------------------------------
  #textureBySource = new Map<CanvasImageSource, Texture>()

  // Gradient LUTs ------------------------------------------------------
  #stopsLutCache = new WeakMap<readonly GfxGradientStop[], Texture>()

  // Bitmap-mask clip textures, keyed by BitmapMask instance so a swap
  // (mask disposed / rebuilt) drops the stale texture with the mask.
  #maskTextureCache = new WeakMap<BitmapMask, Texture>()

  // Text-label textures. LRU (insertion-ordered Map) keyed by
  // `${baseKey}-${scaleBucket}`. Owns its GL textures, deletes on eviction.
  #labelCache = new Map<string, LabelTexture>()
  #labelRegensThisFrame = 0

  constructor(device: GfxDevice) {
    this.#device = device
  }

  // --- lifecycle -------------------------------------------------------

  /**
   * On `webglcontextrestored`, the GL textures are dead but our JS-side state
   * (atlas canvas, srcRect map) survived. Recreate the atlas GL texture from
   * the backing canvas; drop per-source + gradient-LUT caches so they
   * repopulate lazily on next draw.
   */
  rebuild(device: GfxDevice): void {
    this.#device = device
    this.#atlasTex = null
    // Re-create the atlas GL texture from the surviving CPU backing.
    if (this.#atlasCanvas) {
      const tex = this.#device.createTexture2D({
        width: ATLAS_WIDTH,
        height: ATLAS_HEIGHT,
        filter: 'linear',
        wrap: 'clamp',
      })
      this.#device.updateTexture2D(tex, this.#atlasCanvas as TexImageSource, {
        flipY: true,
        premultiply: true,
      })
      this.#atlasTex = tex
      // The atlas bindings must now point at the new tex. Rewrite them.
      const bindings = this.#atlasBindings
      this.#atlasBindings = new Map()
      for (const [source, entry] of bindings) {
        this.#atlasBindings.set(source, { tex, srcRect: entry.srcRect })
      }
    }
    // Drop per-source + gradient + mask + label caches, cheap to regenerate.
    // The GL textures died with the context; don't call deleteTexture.
    this.#textureBySource = new Map()
    this.#stopsLutCache = new WeakMap()
    this.#maskTextureCache = new WeakMap()
    this.#labelCache = new Map()
    this.#labelRegensThisFrame = 0
  }

  // --- atlas -----------------------------------------------------------

  /**
   * Look up a source in the atlas + per-source cache; register into the atlas
   * on first sight if the source is tagged as a particle sprite; otherwise
   * create a per-source texture.
   */
  getOrCreateEntry(source: CanvasImageSource): AtlasEntry | Texture | null {
    // Atlas hit?
    const atlasHit = this.#atlasBindings.get(source)
    if (atlasHit) return atlasHit
    // Tagged particle sprite? Register into the atlas.
    if (this.#isParticleSprite(source)) {
      const entry = this.#registerAtlasSprite(source as HTMLCanvasElement)
      if (entry) return entry
      // Overflow, fall through to per-source path.
    }
    // Per-source fallback.
    const cached = this.#textureBySource.get(source)
    if (cached) return cached
    const w = (source as { width?: number }).width ?? 0
    const h = (source as { height?: number }).height ?? 0
    if (w === 0 || h === 0) return null
    const tex = this.#device.createTexture2D({
      width: w,
      height: h,
      filter: 'linear',
      wrap: 'clamp',
    })
    this.#device.updateTexture2D(tex, source as TexImageSource, {
      flipY: true,
      premultiply: true,
    })
    this.#textureBySource.set(source, tex)
    return tex
  }

  #isParticleSprite(source: CanvasImageSource): boolean {
    return (
      (source as unknown as Record<string, unknown>)[PARTICLE_ATLAS_MARKER] ===
      true
    )
  }

  /**
   * Composite the sprite into the atlas backing canvas + upload the tile's
   * region via `updateTextureSubImage2D`. Returns the binding (`{tex,
   * srcRect}`) or `null` on overflow.
   */
  #registerAtlasSprite(canvas: HTMLCanvasElement): AtlasEntry | null {
    if (this.#atlasFull) return null
    // Lazy-create the atlas the first time.
    if (this.#atlasTex === null) this.#initAtlas()
    if (
      this.#atlasTex === null ||
      this.#atlasCanvas === null ||
      this.#atlasCtx === null
    ) {
      return null
    }
    // Shelf-pack next tile.
    if (this.#atlasNextX + ATLAS_TILE_SIZE > ATLAS_WIDTH) {
      // Wrap to next row.
      this.#atlasNextX = ATLAS_TILE_PADDING
      this.#atlasNextY += ATLAS_TILE_SIZE
    }
    if (this.#atlasNextY + ATLAS_TILE_SIZE > ATLAS_HEIGHT) {
      this.#atlasFull = true
      if (!this.#warnedAtlasFull) {
        this.#warnedAtlasFull = true
        console.warn(
          `TextureManager: particle atlas full (${ATLAS_WIDTH}×${ATLAS_HEIGHT}, ${Math.floor(ATLAS_WIDTH / ATLAS_TILE_SIZE) ** 2} tiles); further sprites use per-source textures.`,
        )
      }
      return null
    }
    const tileX = this.#atlasNextX
    const tileY = this.#atlasNextY
    // Composite the 64×64 sprite core into the atlas canvas, offset by
    // 1 px so a 1-px transparent border surrounds each tile.
    this.#atlasCtx.clearRect(
      tileX - ATLAS_TILE_PADDING,
      tileY - ATLAS_TILE_PADDING,
      ATLAS_TILE_SIZE,
      ATLAS_TILE_SIZE,
    )
    this.#atlasCtx.drawImage(canvas, tileX, tileY)
    // Poke the tile region into the GL texture.
    this.#device.updateTextureSubImage2D(
      this.#atlasTex,
      tileX - ATLAS_TILE_PADDING,
      tileY - ATLAS_TILE_PADDING,
      this.#atlasCanvas as TexImageSource,
      { flipY: false, premultiply: true },
    )
    // Advance the shelf cursor.
    this.#atlasNextX += ATLAS_TILE_SIZE
    // Record the binding, sample only the 64×64 core (avoids padding bleed).
    const u0 = tileX / ATLAS_WIDTH
    const v0 = tileY / ATLAS_HEIGHT
    const u1 = (tileX + ATLAS_TILE_CORE) / ATLAS_WIDTH
    const v1 = (tileY + ATLAS_TILE_CORE) / ATLAS_HEIGHT
    const entry: AtlasEntry = { tex: this.#atlasTex, srcRect: [u0, v0, u1, v1] }
    this.#atlasBindings.set(canvas, entry)
    return entry
  }

  #initAtlas(): void {
    // Prefer OffscreenCanvas so the atlas doesn't inflate DOM node count.
    let canvas: HTMLCanvasElement | OffscreenCanvas
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(ATLAS_WIDTH, ATLAS_HEIGHT)
    } else {
      canvas = document.createElement('canvas')
      canvas.width = ATLAS_WIDTH
      canvas.height = ATLAS_HEIGHT
    }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) {
      // No 2D context available (happy-dom without canvas polyfill); the
      // atlas simply won't be used, and per-source textures cover the
      // gap. Not a hard error.
      this.#atlasFull = true
      return
    }
    // Initialize with fully-transparent pixels so padding samples are
    // (0,0,0,0), avoids halos when texture sampling reaches into the
    // padding under linear filtering.
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
    this.#atlasCanvas = canvas
    this.#atlasCtx = ctx
    // Allocate the GL texture; upload the initial (empty) canvas so any
    // sub-uploads have valid storage to write into.
    const tex = this.#device.createTexture2D({
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
      filter: 'linear',
      wrap: 'clamp',
    })
    this.#device.updateTexture2D(tex, canvas as TexImageSource, {
      flipY: false,
      premultiply: true,
    })
    this.#atlasTex = tex
  }

  // --- gradient LUT ----------------------------------------------------

  ensureStopsLut(stops: readonly GfxGradientStop[]): Texture | null {
    const hit = this.#stopsLutCache.get(stops)
    if (hit) return hit
    let lutCanvas: HTMLCanvasElement | OffscreenCanvas
    if (typeof OffscreenCanvas !== 'undefined') {
      lutCanvas = new OffscreenCanvas(GRADIENT_LUT_WIDTH, 1)
    } else {
      lutCanvas = document.createElement('canvas')
      lutCanvas.width = GRADIENT_LUT_WIDTH
      lutCanvas.height = 1
    }
    const ctx = lutCanvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return null
    const grad = ctx.createLinearGradient(0, 0, GRADIENT_LUT_WIDTH, 0)
    for (const stop of stops) {
      grad.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color)
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, GRADIENT_LUT_WIDTH, 1)
    const tex = this.#device.createTexture2D({
      width: GRADIENT_LUT_WIDTH,
      height: 1,
      filter: 'linear',
      wrap: 'clamp',
    })
    this.#device.updateTexture2D(tex, lutCanvas as TexImageSource, {
      flipY: false,
      premultiply: true,
    })
    this.#stopsLutCache.set(stops, tex)
    return tex
  }

  // --- bitmap-mask clip texture ---------------------------------------

  /**
   * Look up (or upload) the GPU texture backing `mask`. `mask.imageData` is an
   * `ImageData` (RGBA8), already inside the `TexImageSource` union , uploads
   * via the existing `updateTexture2D` path. Cached per mask instance; dropped
   * on context loss via `rebuild`.
   *
   * Linear filter + clamp wrap: linear gives the fragment shader a smooth 0→1
   * alpha ramp along the coast (bilinear coverage AA); clamp maps out-of-bounds
   * UVs to the mask's zero-alpha border pixels so cells past the rect naturally
   * read as fully clipped.
   */
  ensureMaskTexture(mask: BitmapMask): Texture | null {
    const hit = this.#maskTextureCache.get(mask)
    if (hit) return hit
    const tex = this.#device.createTexture2D({
      width: mask.resolution.w,
      height: mask.resolution.h,
      filter: 'linear',
      wrap: 'clamp',
    })
    // No `premultiply` / `flipY`, the mask is a straight alpha channel
    // with RGB = white inside / 0 outside; premultiplying by alpha would
    // be a no-op (255*1=255) but we skip the flag for clarity.
    this.#device.updateTexture2D(tex, mask.imageData as TexImageSource)
    this.#maskTextureCache.set(mask, tex)
    return tex
  }

  // --- text labels -----------------------------------------------------------

  /** Reset the per-frame label-regeneration budget. Called from `beginFrame`. */
  resetLabelBudget(): void {
    this.#labelRegensThisFrame = 0
  }

  /**
   * Look up (or rasterize + upload) the texture for a text label at the given
   * device scale. `baseKey` identifies the scale-independent style (text, font,
   * align, baseline, color); the scale bucket is appended internally.
   *
   * `deviceScale` is rounded UP to a bucket so the texture is always ≥
   * on-screen size (crisp minification). When the per-frame regen budget is
   * exhausted, a neighbouring-bucket texture is reused if present
   * (ride-previous) so a mass bucket-crossing during a zoom can't spike; a
   * never-seen label still rasterizes so it never flickers in.
   */
  ensureLabelTexture(
    baseKey: string,
    text: string,
    style: LabelStyle,
    deviceScale: number,
  ): LabelTexture | null {
    const k =
      deviceScale > 0
        ? Math.ceil(Math.log(deviceScale) / Math.log(LABEL_SCALE_BUCKET_RATIO))
        : 0
    const key = `${baseKey}-${k}`

    const hit = this.#labelCache.get(key)
    if (hit) {
      // LRU touch: move to most-recent.
      this.#labelCache.delete(key)
      this.#labelCache.set(key, hit)
      return hit
    }

    // Over budget: ride a nearby bucket (defers the rescale a frame or two).
    if (this.#labelRegensThisFrame >= LABEL_MAX_REGENS_PER_FRAME) {
      const near =
        this.#labelCache.get(`${baseKey}-${k - 1}`) ??
        this.#labelCache.get(`${baseKey}-${k + 1}`) ??
        this.#labelCache.get(`${baseKey}-${k - 2}`) ??
        this.#labelCache.get(`${baseKey}-${k + 2}`)
      if (near) return near
    }

    const rasterScale = LABEL_SCALE_BUCKET_RATIO ** k
    const ras = rasterizeLabel(text, style, rasterScale)
    if (!ras) return null

    const tex = this.#device.createTexture2D({
      width: ras.texW,
      height: ras.texH,
      filter: 'linear',
      wrap: 'clamp',
    })
    // No flipY: the canvas is top-left origin and the text-quad's UV convention
    // (v = 0 at the quad's top edge, matching the y-down projection) samples it
    // upright — same as the mask path (`ensureMaskTexture`). flipY here would
    // render glyphs upside down.
    this.#device.updateTexture2D(tex, ras.canvas as TexImageSource, {
      premultiply: true,
    })
    const entry: LabelTexture = {
      tex,
      localW: ras.localW,
      localH: ras.localH,
      anchorOffsetX: ras.anchorOffsetX,
      anchorOffsetY: ras.anchorOffsetY,
    }
    this.#labelCache.set(key, entry)
    this.#labelRegensThisFrame++

    // Evict the least-recently-used entry (Map iterates in insertion order).
    if (this.#labelCache.size > LABEL_CACHE_MAX) {
      const oldest = this.#labelCache.keys().next().value as string | undefined
      if (oldest !== undefined) {
        const victim = this.#labelCache.get(oldest)
        this.#labelCache.delete(oldest)
        if (victim) this.#device.deleteTexture(victim.tex)
      }
    }
    return entry
  }

  // --- debug inspector (built on demand, no per-frame cost) ------------

  /** Live snapshot of the enumerable caches for the debug inspector. */
  snapshot(): TextureInspectorSnapshot {
    const perRow = ATLAS_WIDTH / ATLAS_TILE_SIZE
    const perCol = ATLAS_HEIGHT / ATLAS_TILE_SIZE
    const bindings: { srcRect: readonly [number, number, number, number] }[] =
      []
    for (const entry of this.#atlasBindings.values()) {
      bindings.push({ srcRect: entry.srcRect })
    }
    const perSource: {
      width: number
      height: number
      source: CanvasImageSource
    }[] = []
    for (const [source, tex] of this.#textureBySource) {
      perSource.push({ width: tex.width, height: tex.height, source })
    }
    const labels: TextureInspectorLabel[] = []
    for (const [key, lt] of this.#labelCache) {
      const parsed = parseLabelKey(key)
      if (!parsed) continue
      labels.push({
        key,
        text: parsed.text,
        font: parsed.font,
        align: parsed.align,
        baseline: parsed.baseline,
        color: parsed.color,
        bucket: parsed.bucket,
        texW: lt.tex.width,
        texH: lt.tex.height,
        localW: lt.localW,
        localH: lt.localH,
      })
    }
    return {
      atlas: {
        width: ATLAS_WIDTH,
        height: ATLAS_HEIGHT,
        tileSize: ATLAS_TILE_SIZE,
        capacity: Math.floor(perRow) * Math.floor(perCol),
        used: this.#atlasBindings.size,
        full: this.#atlasFull,
        canvas: this.#atlasCanvas,
        bindings,
      },
      perSource,
      labels,
      labelCount: this.#labelCache.size,
      labelCap: LABEL_CACHE_MAX,
      labelRegensThisFrame: this.#labelRegensThisFrame,
      labelMaxRegensPerFrame: LABEL_MAX_REGENS_PER_FRAME,
    }
  }

  /**
   * Re-rasterize a cached label to a fresh canvas for preview. Re-runs
   * `rasterizeLabel` (a CPU Canvas2D draw, no GPU readback) at the label's
   * bucket scale, then copies the shared rasterization canvas into an owned one
   * so a later rasterize can't overwrite the returned image.
   */
  renderLabelPreview(key: string): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null
    const parsed = parseLabelKey(key)
    if (!parsed) return null
    const style: LabelStyle = {
      font: parsed.font,
      align: parsed.align as CanvasTextAlign,
      baseline: parsed.baseline as CanvasTextBaseline,
      color: parsed.color,
    }
    const rasterScale = LABEL_SCALE_BUCKET_RATIO ** parsed.bucket
    const ras = rasterizeLabel(parsed.text, style, rasterScale)
    if (!ras) return null
    const out = document.createElement('canvas')
    out.width = ras.texW
    out.height = ras.texH
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(ras.canvas as CanvasImageSource, 0, 0)
    return out
  }
}

/**
 * Recover a label's text + style + scale bucket from its cache key. The key is
 * `${baseKey}-${k}` where `baseKey` is
 * `${text}\n${font}\n${align}\n${baseline}\n${color}\n` (built in
 * `GpuGfx.fillText`). Labels are single-line, so the text can't contain a
 * newline: split at the LAST `\n` to separate the style block from the `-${k}`
 * bucket suffix. Returns `null` if the key doesn't match the shape.
 */
function parseLabelKey(key: string): {
  text: string
  font: string
  align: string
  baseline: string
  color: string
  bucket: number
} | null {
  const lastNl = key.lastIndexOf('\n')
  if (lastNl < 0) return null
  const parts = key.slice(0, lastNl).split('\n')
  if (parts.length !== 5) return null
  // Suffix is the literal `-` separator followed by the (possibly negative)
  // bucket, e.g. `-3` or `--2`. Drop the separator, then parse.
  const bucket = Number(key.slice(lastNl + 1).slice(1))
  if (!Number.isFinite(bucket)) return null
  const [text, font, align, baseline, color] = parts
  return { text, font, align, baseline, color, bucket }
}
