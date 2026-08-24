/**
 * Owns every GPU texture `GpuGfx` uses:
 *
 * - 1024×1024 particle sprite atlas, 66×66 tiles (64 core + 1 px pad). All
 *   particles share it so cross-color draws coalesce into one instance batch.
 * - 2048×2048 label atlas page: rasterized text labels shelf-packed into one
 *   texture (see {@link ShelfPacker}) so a screen of distinct labels draws in a
 *   single batch instead of one texture-bound draw each. Oversized labels keep
 *   a dedicated texture.
 * - `textureBySource` cache for non-sprite images.
 * - Gradient-radial LUT cache, one 256×1 texture per `stops` reference.
 *
 * On context loss, `rebuild(device)` recreates the atlas + label page from
 * their CPU-side backing canvases (which survive loss) and drops the other
 * caches, they repopulate lazily.
 */

import type { GfxDevice, Texture } from './GfxDevice'
import type { GfxGradientStop } from './Gfx2D'
import type { BitmapMask } from '../../assets/BitmapMask'
import {
  rasterizeLabel,
  type LabelStyle,
  type RasterizedLabel,
} from './rasterizeLabel'
import { ShelfPacker } from './ShelfPacker'

/** Sprite tile size = 64 core + 1 px transparent padding on all sides. */
export const ATLAS_TILE_CORE = 64
export const ATLAS_TILE_PADDING = 1
export const ATLAS_TILE_SIZE = ATLAS_TILE_CORE + 2 * ATLAS_TILE_PADDING // 66

/**
 * Why the shelf-packed pages here are never mipmapped, unlike the per-source
 * textures in `getOrCreateEntry`.
 *
 * One texel of padding only isolates a tile at level 0. At level N the gutter
 * is `1 / 2**N` texels, so neighbouring tiles average into each other and a
 * minified sprite picks up its neighbour's color. A mipmapped atlas needs
 * `2**maxLevel` texels of padding or a per-tile LOD clamp, and WebGL2 can
 * express neither per draw on a shared texture.
 *
 * Nothing is lost by skipping it. A 64px tile draws at roughly 64px, and the
 * label page, gradient LUTs and clip masks are all sampled at or above 1:1.
 */

/** Atlas texture dimensions. 1024×1024 → 15×15 = 225 tiles capacity. */
export const ATLAS_WIDTH = 1024
export const ATLAS_HEIGHT = 1024

/** Radial-gradient LUT: 256 texels smooth enough for every stop the game uses. */
const GRADIENT_LUT_WIDTH = 256
/** Max distinct gradient LUTs cached before LRU eviction. */
const STOPS_LUT_CACHE_MAX = 64

/** Marker property `getParticleSprite` sets on returned canvases. */
export const PARTICLE_ATLAS_MARKER = '__isParticleAtlasCandidate' as const

/** Per-tile atlas record. `srcRect` is normalized `[u0, v0, u1, v1]`. */
export interface AtlasEntry {
  tex: Texture
  srcRect: readonly [number, number, number, number]
}

/**
 * A cached rasterized text label: the texture to bind, the normalized sub-rect
 * to sample within it, and the local-space (CSS px) geometry `GpuGfx.fillText`
 * needs to place the quad. `srcRect` is `[u0, v0, u1, v1]`. For a page-backed
 * label it names the label's region in the shared page, and for an oversized
 * label with its own texture it's the full `[0, 0, 1, 1]`. Either way
 * `fillText` reads the same fields with no branch. See `rasterizeLabel`.
 */
export interface LabelTexture {
  tex: Texture
  srcRect: readonly [number, number, number, number]
  localW: number
  localH: number
  anchorOffsetX: number
  anchorOffsetY: number
}

/** Placement of a page-backed label within the label atlas page (page px). */
interface LabelBox {
  x: number
  y: number
  /** Packed width/height, including the inter-entry spacing pad. */
  w: number
  h: number
}

/**
 * A label-cache record: the public {@link LabelTexture} plus its page placement.
 * `atlasBox` is `null` for an oversized label that owns a dedicated texture
 * (deleted on eviction) instead of a page region (whose span is freed).
 */
interface LabelCacheEntry extends LabelTexture {
  atlasBox: LabelBox | null
}

/**
 * Max distinct labels held before LRU eviction. Sized to hold two full
 * scale-bucket sets of a text-heavy scene (e.g. Full Stack's 24 fully lettered
 * cards) at once, so a zoom or resize tween that drifts every label across a
 * bucket boundary does not evict labels still on screen this frame.
 */
const LABEL_CACHE_MAX = 768
/** Shared label atlas page dimensions (matches `MAX_LABEL_TEXTURE_PX`). */
export const LABEL_PAGE_SIZE = 2048
/**
 * A label whose bitmap exceeds this on either side keeps its own dedicated
 * texture rather than a page slot, so one big title can't monopolize the shared
 * page. Costs one batch break.
 */
const LABEL_ATLAS_MAX_SIDE = 512
/**
 * Transparent pad reserved to the right/bottom of each packed label, so a
 * neighbor's linear-filter half-texel read can't bleed across the seam. Label
 * bitmaps already bake their own 2px content pad (`LABEL_PAD`). This is the gap
 * between packed slots.
 */
const LABEL_ENTRY_SPACING = 1
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
const LABEL_MAX_REGENS_PER_FRAME = 24
/**
 * Cap on page-backed labels evicted while hunting for a slot. Past this the
 * page is fragmented rather than merely full, and wiping it costs less than
 * walking the rest of the cache dropping labels that are still on screen.
 */
const LABEL_PACK_EVICT_LIMIT = 32

/**
 * Read-only snapshot of the texture caches for the debug inspector. Built on
 * demand by {@link TextureManager.snapshot}, so nothing here runs unless the
 * inspector panel asks for it. Covers the three enumerable caches (atlas,
 * per-source, labels). The gradient-LUT and clip-mask caches are `WeakMap`s and
 * not enumerable, so they're omitted.
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
    /** One entry per bound sprite. `srcRect` is normalized `[u0, v0, u1, v1]`. */
    bindings: { srcRect: readonly [number, number, number, number] }[]
  }
  /**
   * Non-atlas images: 2D textures keyed by their own source in the live cache,
   * or the 3D material textures of a model source. `label` names a model
   * texture's role (`baseColor`, `normal`, …), and it's absent for 2D
   * per-source images. `source` is `null` for a model texture whose preview
   * thumbnail has not decoded yet (the entry still lists its role + uploaded
   * size).
   */
  perSource: {
    width: number
    height: number
    source: CanvasImageSource | null
    label?: string
  }[]
  /** One entry per cached label texture, with its style recovered from the key. */
  labels: TextureInspectorLabel[]
  labelCount: number
  labelCap: number
  labelRegensThisFrame: number
  labelMaxRegensPerFrame: number
  /** The shared page the labels pack into, and how fragmented it has become. */
  labelPage: {
    size: number
    /** Page rows consumed by open shelves. Shelves are never retired. */
    usedHeight: number
    /** Open shelves. Many, against little used height, means many text sizes. */
    shelfCount: number
    /** Freed interior spans waiting to be reused. */
    freeSpanCount: number
    /** CPU backing, draw it directly for a preview. `null` until first used. */
    canvas: CanvasImageSource | null
  }
  /**
   * Cumulative since startup, so a burst between two samples of the polling
   * panel still shows. `pageWipes` is the expensive one: it drops every
   * page-backed label and re-rasterizes the whole scene in one frame.
   */
  labelEvictions: number
  labelPackWalk: number
  labelPageWipes: number
  labelScaleClamps: number
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
 * hand this out and {@link TextureManager} implements it. Every method builds
 * its result on demand, so there is no standing cost when the panel is closed.
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

/**
 * One inspectable render target on a stage: the screen, or a `Viewport2DNode`'s
 * offscreen surface. Each has its own {@link TextureManager}, so the debug HUD
 * lists them as separate labeled sources. Produced by `Stage.textureSources`.
 */
export interface TextureSource {
  /** Stable id: `'screen'`, or the `Viewport2DNode`'s node id. */
  id: string
  /** Human-readable label for the source dropdown. */
  label: string
  inspector: TextureInspector
}

export class TextureManager implements TextureInspector {
  #device: GfxDevice

  // Atlas ---------------------------------------------------------------
  #atlasTex: Texture | null = null
  #atlasCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  #atlasCtx: CanvasRenderingContext2D | null = null
  /**
   * One tile's worth of scratch, reused for every tile upload.
   *
   * A sub-upload's written region comes from the SOURCE extent on both
   * backends, so the source has to be tile-sized. Handing over the whole page
   * canvas asks for a page-sized write at the tile's offset, which is out of
   * bounds for every tile but the first.
   */
  #atlasTileCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  #atlasTileCtx: CanvasRenderingContext2D | null = null
  /**
   * Scratch sized to a label's reserved slot, reused for every label upload.
   *
   * A label's bitmap is `texW x texH` but its slot reserves a
   * {@link LABEL_ENTRY_SPACING} gutter on the right and bottom. Uploading the
   * bitmap alone leaves that gutter holding whatever the previous occupant of
   * the slot left behind, and a label's edge samples half of the texel just
   * outside its own rect. Compositing onto a slot-sized source writes the
   * gutter transparent in the same upload.
   */
  #labelSlotCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  #labelSlotCtx: CanvasRenderingContext2D | null = null
  #atlasNextX = ATLAS_TILE_PADDING
  #atlasNextY = ATLAS_TILE_PADDING
  #atlasBindings = new Map<CanvasImageSource, AtlasEntry>()
  #atlasFull = false
  #warnedAtlasFull = false

  // Per-source (fallback) ----------------------------------------------
  #textureBySource = new Map<CanvasImageSource, Texture>()

  // Gradient LUTs ------------------------------------------------------
  // Content-keyed LRU is the sole texture owner, deleting on eviction so a new
  // stops array built each frame can't leak a texture per frame. A ref→key
  // WeakMap in front skips the key rebuild for module-constant stops arrays.
  #stopsKeyByRef = new WeakMap<readonly GfxGradientStop[], string>()
  #stopsLutByKey = new Map<string, Texture>()

  // Bitmap-mask clip textures, keyed by BitmapMask instance so a swap
  // (mask disposed / rebuilt) drops the stale texture with the mask.
  #maskTextureCache = new WeakMap<BitmapMask, Texture>()

  // Text-label textures. LRU (insertion-ordered Map) keyed by
  // `${baseKey}-${scaleBucket}`. Most labels share the atlas page below. An
  // oversized label owns a dedicated texture (deleted on eviction).
  #labelCache = new Map<string, LabelCacheEntry>()
  #labelRegensThisFrame = 0
  // Cumulative, because the per-frame counter is sampled by a polling panel and
  // a burst between two samples is otherwise invisible.
  #labelEvictions = 0
  #labelPackWalk = 0
  #labelPageWipes = 0
  #labelScaleClamps = 0

  // Shared label atlas page: one texture holding every non-oversized label so
  // text draws don't break the batch on a per-label texture bind. The backing
  // canvas mirrors the page so a context-loss `rebuild` re-uploads it once.
  #labelPageTex: Texture | null = null
  #labelPageCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  #labelPageCtx: CanvasRenderingContext2D | null = null
  #labelPacker = new ShelfPacker(LABEL_PAGE_SIZE, LABEL_PAGE_SIZE)

  constructor(device: GfxDevice) {
    this.#device = device
  }

  /**
   * The particle atlas texture, or `null` until first use. Exposed so the shape
   * program can bind it at a fixed unit. May be `null` even after use in a
   * headless env with no 2D context.
   */
  getAtlasTexture(): Texture | null {
    return this.#atlasTex
  }

  /** The shared label page texture, or `null` until the first label. */
  getLabelPageTexture(): Texture | null {
    return this.#labelPageTex
  }

  // --- lifecycle -------------------------------------------------------

  /**
   * After a context loss the device textures are dead but the JS-side state
   * (atlas canvas, srcRect map) survives. Recreate the atlas texture from the
   * backing canvas, then drop per-source + gradient-LUT caches so they
   * repopulate lazily on next draw.
   */
  rebuild(device: GfxDevice): void {
    this.#device = device
    this.#atlasTex = null
    // Re-create the atlas texture from the surviving CPU backing.
    if (this.#atlasCanvas) {
      const tex = this.#device.createTexture2D({
        width: ATLAS_WIDTH,
        height: ATLAS_HEIGHT,
        filter: 'linear',
        wrap: 'clamp',
      })
      this.#device.updateTexture2D(tex, this.#atlasCanvas as TexImageSource, {
        // Orientation must match `#registerAtlasSprite`'s tile sub-uploads.
        flipY: false,
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
    // Drop per-source + gradient + mask caches, cheap to regenerate. The GL
    // textures died with the context, so don't call deleteTexture.
    this.#textureBySource = new Map()
    this.#stopsKeyByRef = new WeakMap()
    this.#stopsLutByKey = new Map()
    this.#maskTextureCache = new WeakMap()

    // Label page: recreate the texture from the surviving backing canvas in
    // one upload and keep the packed layout, so on-screen text doesn't have to
    // trickle back through the per-frame regen budget (visible popping). Rewrite
    // page-backed entries to the new page texture. Oversized labels, whose
    // dedicated textures died, are dropped and re-rasterize lazily.
    this.#labelPageTex = null
    if (this.#labelPageCanvas) {
      const pageTex = this.#device.createTexture2D({
        width: LABEL_PAGE_SIZE,
        height: LABEL_PAGE_SIZE,
        filter: 'linear',
        wrap: 'clamp',
      })
      this.#device.updateTexture2D(
        pageTex,
        this.#labelPageCanvas as TexImageSource,
        { flipY: false, premultiply: true },
      )
      this.#labelPageTex = pageTex
      for (const [key, entry] of this.#labelCache) {
        if (entry.atlasBox) entry.tex = pageTex
        else this.#labelCache.delete(key)
      }
    } else {
      this.#labelCache = new Map()
    }
    this.#labelRegensThisFrame = 0
  }

  // --- atlas -----------------------------------------------------------

  /**
   * Look up a source in the atlas + per-source cache. A source tagged as a
   * particle sprite registers into the atlas on first sight. Anything else gets
   * a per-source texture.
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
      // A standalone source draws at whatever size the caller asks for, often
      // a fraction of its own, and one bilinear tap then throws away most of
      // the texels it covers. No anisotropy: these are screen-aligned quads
      // under an orthographic camera, so the UV gradients are isotropic and
      // trilinear is exact. The shelf-packed pages stay unmipped, for the
      // reason given at `ATLAS_TILE_SIZE`.
      mipmap: true,
    })
    this.#device.updateTexture2D(tex, source as TexImageSource, {
      // No flipY: sources are top-left origin and the textQuad UV convention
      // samples them upright. WebGL ignores the pixel-store unpack parameters
      // for an `ImageBitmap` source, so a flip here reaches WebGPU only.
      flipY: false,
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

    // Upload one tile's worth, from a tile-sized source. Assigning `width`
    // resets the scratch bitmap to transparent, so a sprite smaller than the
    // tile cannot inherit the previous tile's pixels, and it avoids depending on
    // `clearRect`.
    const tileSource = this.#atlasTileCanvas
    if (tileSource && this.#atlasTileCtx) {
      tileSource.width = ATLAS_TILE_SIZE
      this.#atlasTileCtx.drawImage(
        canvas,
        ATLAS_TILE_PADDING,
        ATLAS_TILE_PADDING,
      )
      this.#device.updateTextureSubImage2D(
        this.#atlasTex,
        tileX - ATLAS_TILE_PADDING,
        tileY - ATLAS_TILE_PADDING,
        tileSource as TexImageSource,
        { flipY: false, premultiply: true },
      )
    }
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
      // No 2D context available (happy-dom without canvas polyfill), so the
      // atlas simply won't be used and per-source textures cover the gap.
      // Not a hard error.
      this.#atlasFull = true
      return
    }
    // Initialize with fully-transparent pixels so padding samples are
    // (0,0,0,0), avoids halos when texture sampling reaches into the
    // padding under linear filtering.
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
    this.#atlasCanvas = canvas
    this.#atlasCtx = ctx

    const tile =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(ATLAS_TILE_SIZE, ATLAS_TILE_SIZE)
        : document.createElement('canvas')
    tile.width = ATLAS_TILE_SIZE
    tile.height = ATLAS_TILE_SIZE
    const tileCtx = tile.getContext('2d') as CanvasRenderingContext2D | null
    if (tileCtx) {
      this.#atlasTileCanvas = tile
      this.#atlasTileCtx = tileCtx
    }
    // Allocate the texture and upload the initial (empty) canvas so any
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
    // Fast path: reuse the key for a constant stops array (skips the join).
    let key = this.#stopsKeyByRef.get(stops)
    if (key === undefined) {
      key = stops.map((s) => `${s.offset}:${s.color}`).join('|')
      this.#stopsKeyByRef.set(stops, key)
    }
    const hit = this.#stopsLutByKey.get(key)
    if (hit) {
      // LRU touch.
      this.#stopsLutByKey.delete(key)
      this.#stopsLutByKey.set(key, hit)
      return hit
    }
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
    this.#stopsLutByKey.set(key, tex)
    // Evict the least-recently-used LUT (Map iterates in insertion order).
    if (this.#stopsLutByKey.size > STOPS_LUT_CACHE_MAX) {
      const oldest = this.#stopsLutByKey.keys().next().value as
        string | undefined
      if (oldest !== undefined) {
        const victim = this.#stopsLutByKey.get(oldest)
        this.#stopsLutByKey.delete(oldest)
        if (victim) this.#device.deleteTexture(victim)
      }
    }
    return tex
  }

  // --- bitmap-mask clip texture ---------------------------------------

  /**
   * Look up (or upload) the GPU texture backing `mask`. `mask.imageData` is an
   * `ImageData` (RGBA8), already inside the `TexImageSource` union, so it
   * uploads via the `updateTexture2D` path. Cached per mask instance and
   * dropped on context loss via `rebuild`.
   *
   * Linear filter + clamp wrap: linear gives the fragment shader a smooth 0→1
   * alpha ramp along the coast (bilinear coverage AA). Clamp maps out-of-bounds
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
    // No `premultiply` / `flipY`: the mask is a straight alpha channel
    // with RGB = white inside / 0 outside. Premultiplying by alpha would
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
   * align, baseline, color), and the scale bucket is appended internally.
   *
   * `deviceScale` is rounded UP to a bucket so the texture is always ≥
   * on-screen size (crisp minification). When the per-frame regen budget is
   * exhausted, a neighbouring-bucket texture is reused if present
   * (ride-previous) so a mass bucket-crossing during a zoom can't spike. A
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
      // Larger buckets first. The whole design is to rasterize at or above the
      // on-screen size and only ever minify, so borrowing a bigger bitmap costs
      // sharpness the sampler can recover and borrowing a smaller one does not.
      const near =
        this.#labelCache.get(`${baseKey}-${k + 1}`) ??
        this.#labelCache.get(`${baseKey}-${k + 2}`) ??
        this.#labelCache.get(`${baseKey}-${k - 1}`) ??
        this.#labelCache.get(`${baseKey}-${k - 2}`)
      if (near) return near
    }

    const rasterScale = LABEL_SCALE_BUCKET_RATIO ** k
    const ras = rasterizeLabel(text, style, rasterScale)
    if (!ras) return null
    if (ras.clamped) this.#labelScaleClamps++

    const entry = this.#uploadLabel(ras)
    this.#labelCache.set(key, entry)
    this.#labelRegensThisFrame++

    // Evict the least-recently-used entry (Map iterates in insertion order).
    if (this.#labelCache.size > LABEL_CACHE_MAX) {
      const oldest = this.#labelCache.keys().next().value as string | undefined
      if (oldest !== undefined) {
        const victim = this.#labelCache.get(oldest)
        this.#labelCache.delete(oldest)
        this.#labelEvictions++
        if (victim) this.#releaseLabel(victim)
      }
    }
    return entry
  }

  /**
   * Upload a freshly rasterized label. Non-oversized labels pack into the
   * shared page (sub-image upload + backing-canvas blit). Oversized labels, or
   * any label when no page is available, get a dedicated texture.
   */
  #uploadLabel(ras: RasterizedLabel): LabelCacheEntry {
    const oversized =
      ras.texW > LABEL_ATLAS_MAX_SIDE || ras.texH > LABEL_ATLAS_MAX_SIDE
    if (!oversized) {
      this.#ensureLabelPage()
      if (this.#labelPageTex) {
        const box = this.#packLabel(
          ras.texW + LABEL_ENTRY_SPACING,
          ras.texH + LABEL_ENTRY_SPACING,
        )
        if (box) {
          // Mirror into the backing canvas (survives context loss) when one is
          // available, then poke the label's own bitmap into the GL page. No
          // flipY: canvas is top-left origin and the text-quad UV convention
          // samples it upright.
          if (this.#labelPageCtx) {
            this.#labelPageCtx.clearRect(box.x, box.y, box.w, box.h)
            this.#labelPageCtx.drawImage(
              ras.canvas as CanvasImageSource,
              box.x,
              box.y,
            )
          }
          // Upload the whole reserved slot, gutter included, so the gutter is
          // written transparent rather than left holding the previous
          // occupant's ink. `#slotSource` resets the scratch by assigning
          // `width`, which clears it without needing `clearRect`.
          const slot = this.#slotSource(ras, box.w, box.h)
          this.#device.updateTextureSubImage2D(
            this.#labelPageTex,
            box.x,
            box.y,
            slot,
            { flipY: false, premultiply: true },
          )
          const s = LABEL_PAGE_SIZE
          return {
            tex: this.#labelPageTex,
            srcRect: [
              box.x / s,
              box.y / s,
              (box.x + ras.texW) / s,
              (box.y + ras.texH) / s,
            ],
            localW: ras.localW,
            localH: ras.localH,
            anchorOffsetX: ras.anchorOffsetX,
            anchorOffsetY: ras.anchorOffsetY,
            atlasBox: { x: box.x, y: box.y, w: box.w, h: box.h },
          }
        }
      }
    }
    // Dedicated texture: oversized label, or no page (no 2D context available).
    const tex = this.#device.createTexture2D({
      width: ras.texW,
      height: ras.texH,
      filter: 'linear',
      wrap: 'clamp',
    })
    this.#device.updateTexture2D(tex, ras.canvas as TexImageSource, {
      premultiply: true,
    })
    return {
      tex,
      srcRect: [0, 0, 1, 1],
      localW: ras.localW,
      localH: ras.localH,
      anchorOffsetX: ras.anchorOffsetX,
      anchorOffsetY: ras.anchorOffsetY,
      atlasBox: null,
    }
  }

  /**
   * The upload source for a label occupying a `w × h` slot: the bitmap
   * composited onto a slot-sized transparent surface, so one upload covers the
   * gutter too.
   *
   * Falls back to the bitmap itself when no 2D context is available. That
   * cannot coexist with real labels, since `rasterizeLabel` needs a shared
   * context and returns null without one, but the fallback keeps this total.
   */
  #slotSource(ras: RasterizedLabel, w: number, h: number): TexImageSource {
    this.#ensureLabelSlotSurface()
    const canvas = this.#labelSlotCanvas
    const ctx = this.#labelSlotCtx
    if (!canvas || !ctx) return ras.canvas as TexImageSource
    // Assigning width resets the bitmap to transparent and resizes in one step.
    canvas.width = w
    canvas.height = h
    ctx.drawImage(ras.canvas as CanvasImageSource, 0, 0)
    return canvas as TexImageSource
  }

  /** Create the reusable label scratch surface on first use. */
  #ensureLabelSlotSurface(): void {
    if (this.#labelSlotCanvas !== null) return
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : null
    const ctx =
      (canvas?.getContext('2d') as CanvasRenderingContext2D | null) ?? null
    if (canvas && ctx) {
      this.#labelSlotCanvas = canvas
      this.#labelSlotCtx = ctx
    }
  }

  /**
   * Reserve a `w × h` slot in the page, evicting least-recently-used
   * page-backed labels (freeing their spans) if the page is full, and resetting
   * the page as a last resort. Returns the slot, or `null` only if no 2D page
   * exists.
   */
  #packLabel(w: number, h: number): LabelBox | null {
    let box = this.#labelPacker.pack(w, h)
    if (box) return { x: box.x, y: box.y, w, h }

    // Page full or fragmented: evict LRU page-backed labels and retry. Freeing
    // an unrelated label only helps when its span lands on a shelf of the right
    // height, so this can walk a long way for nothing. Bounded, because both
    // the free and the retry cost a scan and this runs inside one `fillText`.
    let walked = 0
    for (const [key, entry] of this.#labelCache) {
      if (!entry.atlasBox) continue
      if (++walked > LABEL_PACK_EVICT_LIMIT) break
      this.#labelPacker.free(
        entry.atlasBox.x,
        entry.atlasBox.y,
        entry.atlasBox.w,
      )
      this.#labelCache.delete(key)
      this.#labelEvictions++
      box = this.#labelPacker.pack(w, h)
      if (box) {
        this.#labelPackWalk += walked
        return { x: box.x, y: box.y, w, h }
      }
    }
    this.#labelPackWalk += walked

    // Still no room (fragmentation): reset the page and drop what it held. A
    // single slot no larger than the oversized threshold always fits a fresh
    // page, so this terminates. The re-adds this frame bypass the regen budget
    // naturally, because the dropped labels are cache misses that rasterize on
    // demand, so this is the worst frame the text path has.
    this.#labelPageWipes++
    this.#labelPacker.reset()
    // Mirror only, deliberately. Draws are recorded and replayed at
    // `submitFrame`, while this runs mid-frame from inside `fillText`, so
    // instances already recorded this frame still point at slots this wipe just
    // invalidated. Their texels hold the old ink and draw wrong. Zeroing the
    // page would make them draw nothing at all. That frame is lost either way.
    // TODO: deferring the wipe to the end of the frame, after `submitFrame`
    // has replayed the runs that still reference the old slots, would let this
    // zero the page the way `clearLabelCache` does.
    this.#clearLabelPage()
    for (const [key, entry] of this.#labelCache) {
      if (entry.atlasBox) this.#labelCache.delete(key)
    }
    box = this.#labelPacker.pack(w, h)
    return box ? { x: box.x, y: box.y, w, h } : null
  }

  /**
   * Drop every cached label raster and reset the atlas page.
   *
   * Labels are keyed by their font STRING, not by whether that font had loaded,
   * so text rasterized before a webfont arrived keeps its fallback glyphs
   * forever. This is the escape hatch for that: after a late font load, throw
   * the bitmaps away and let the next frame re-rasterize against the real
   * face.
   *
   * `Stage.invalidateText` is the usual entry point, since a caller almost
   * always wants the measurement caches dropped in the same breath.
   */
  clearLabelCache(): void {
    // Read before the reset, or there is nothing left to say how much of the
    // page was inked.
    const inkedRows = this.#labelPacker.usedHeight
    for (const entry of this.#labelCache.values()) this.#releaseLabel(entry)
    this.#labelCache = new Map()
    this.#labelPacker.reset()
    this.#clearLabelPage(inkedRows)
    this.#labelRegensThisFrame = 0
  }

  /** Free a page span or delete a dedicated texture when a label is evicted. */
  #releaseLabel(entry: LabelCacheEntry): void {
    if (entry.atlasBox) {
      this.#labelPacker.free(
        entry.atlasBox.x,
        entry.atlasBox.y,
        entry.atlasBox.w,
      )
    } else {
      this.#device.deleteTexture(entry.tex)
    }
  }

  /**
   * Lazily create the label page on first label. The texture always exists (its
   * storage is allocated at creation, so sub-uploads work). The backing canvas
   * that mirrors it for context-loss rebuild is optional, so a headless host
   * with no 2D canvas skips it and a lost context re-rasterizes lazily.
   */
  #ensureLabelPage(): void {
    if (this.#labelPageTex !== null) return
    let canvas: HTMLCanvasElement | OffscreenCanvas | null = null
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(LABEL_PAGE_SIZE, LABEL_PAGE_SIZE)
    } else if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas')
      canvas.width = LABEL_PAGE_SIZE
      canvas.height = LABEL_PAGE_SIZE
    }
    const ctx =
      (canvas?.getContext('2d') as CanvasRenderingContext2D | null) ?? null
    if (canvas && ctx) {
      ctx.clearRect(0, 0, LABEL_PAGE_SIZE, LABEL_PAGE_SIZE)
      this.#labelPageCanvas = canvas
      this.#labelPageCtx = ctx
    }
    const tex = this.#device.createTexture2D({
      width: LABEL_PAGE_SIZE,
      height: LABEL_PAGE_SIZE,
      filter: 'linear',
      wrap: 'clamp',
    })
    if (this.#labelPageCanvas) {
      this.#device.updateTexture2D(
        tex,
        this.#labelPageCanvas as TexImageSource,
        { flipY: false, premultiply: true },
      )
    }
    this.#labelPageTex = tex
  }

  /** Clear the whole backing canvas (page reset). */
  /**
   * Drop the page's contents.
   *
   * `gpuRows` zeroes that many rows of the texture as well as the mirror. The
   * two are separate because the mirror is only read on a context-loss rebuild,
   * whereas the texture is what gets sampled: leaving stale ink there is what
   * lets a dropped label bleed into the edge of whatever takes its slot.
   *
   * The texture write does not go through the mirror, because a page can be
   * inked without one. `#uploadLabel` writes the texture unconditionally and
   * guards only the mirror, so "no mirror" does not mean "nothing on the
   * page".
   */
  #clearLabelPage(gpuRows = 0): void {
    this.#labelPageCtx?.clearRect(0, 0, LABEL_PAGE_SIZE, LABEL_PAGE_SIZE)
    if (gpuRows <= 0 || this.#labelPageTex === null) return
    const blank = this.#blankBlock(
      LABEL_PAGE_SIZE,
      Math.min(gpuRows, LABEL_PAGE_SIZE),
    )
    if (!blank) return
    this.#device.updateTextureSubImage2D(this.#labelPageTex, 0, 0, blank, {
      flipY: false,
      premultiply: true,
    })
  }

  /**
   * A transparent `w × h` upload source, for zeroing a region of a page.
   *
   * Resizing a canvas resets its bitmap to transparent, so this needs no
   * drawing calls and no `clearRect`. Shares the label slot scratch, which is
   * resized per label anyway.
   */
  #blankBlock(w: number, h: number): TexImageSource | null {
    this.#ensureLabelSlotSurface()
    const canvas = this.#labelSlotCanvas
    if (!canvas) return null
    canvas.width = w
    canvas.height = h
    return canvas as TexImageSource
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
      // Page-backed labels share the page texture, so report the label's own
      // bitmap size from its `srcRect`. Dedicated (oversized) labels use their
      // texture's dimensions directly.
      const texW = lt.atlasBox
        ? Math.round((lt.srcRect[2] - lt.srcRect[0]) * LABEL_PAGE_SIZE)
        : lt.tex.width
      const texH = lt.atlasBox
        ? Math.round((lt.srcRect[3] - lt.srcRect[1]) * LABEL_PAGE_SIZE)
        : lt.tex.height
      labels.push({
        key,
        text: parsed.text,
        font: parsed.font,
        align: parsed.align,
        baseline: parsed.baseline,
        color: parsed.color,
        bucket: parsed.bucket,
        texW,
        texH,
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
      labelPage: {
        size: LABEL_PAGE_SIZE,
        usedHeight: this.#labelPacker.usedHeight,
        shelfCount: this.#labelPacker.shelfCount,
        freeSpanCount: this.#labelPacker.freeSpanCount,
        canvas: this.#labelPageCanvas,
      },
      labelEvictions: this.#labelEvictions,
      labelPackWalk: this.#labelPackWalk,
      labelPageWipes: this.#labelPageWipes,
      labelScaleClamps: this.#labelScaleClamps,
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
