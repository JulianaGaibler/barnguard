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

import { evictOldest } from './evictOldest'
import type { GfxDevice, Texture } from './GfxDevice'
import type { GfxGradientStop } from './Gfx2D'
import type { BitmapMask } from '../../assets/BitmapMask'
import {
  rasterizeLabel,
  type LabelStyle,
  type RasterizedLabel,
} from './rasterizeLabel'
import { ShelfPacker } from './ShelfPacker'
import { FIELD_HEIGHT, FIELD_WIDTH, loadField } from './squircleField'

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

/** A side length rounded up to the next scale bucket, in whole pixels. */
function bucketSide(px: number): number {
  const k = Math.ceil(Math.log(Math.max(px, 1)) / LOG_LABEL_BUCKET_RATIO)
  return Math.max(1, Math.round(LABEL_SCALE_BUCKET_RATIO ** k))
}

/** Atlas texture dimensions. 1024×1024 -> 15×15 = 225 tiles capacity. */
export const ATLAS_WIDTH = 1024
export const ATLAS_HEIGHT = 1024

/** Ramp width: 256 texels smooth enough for every stop any caller uses. */
const GRADIENT_LUT_WIDTH = 256
/**
 * Ramp atlas row count. One `256 x ATLAS_ROWS` texture holds every distinct
 * gradient in use; beyond this many simultaneously live ramps, the
 * least-recently-touched row is recycled.
 */
export const ATLAS_ROWS = 64

/** A fresh free-row list, high index first so `.pop()` yields row 0 first. */
function initialFreeRampRows(): number[] {
  const rows: number[] = []
  for (let r = ATLAS_ROWS - 1; r >= 0; r--) rows.push(r)
  return rows
}

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
  /**
   * The font size in px a text label was rasterized at, by
   * {@link TextureManager.ensureTextLabel}, at a scale of 1. Its sizes are in px
   * of that font.
   */
  px?: number
}

/** A font split around its px size, so it can be written at any size. */
export interface LabelFontTemplate {
  head: string
  tail: string
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
  /** The `#labelFrame` that last returned this entry. */
  usedFrame: number
  /** The `#labelFrame` it was cached at, or last spared from eviction at. */
  addedFrame: number
}

/**
 * Max distinct labels held before LRU eviction. Sized to hold two full
 * scale-bucket sets of a text-heavy scene (e.g. Full Stack's 24 fully lettered
 * cards) at once, so a zoom or resize tween that drifts every label across a
 * bucket boundary does not evict labels still on screen this frame.
 */
/**
 * Entries the label cache holds before it evicts, text and small images
 * together.
 */
export const LABEL_CACHE_MAX = 768
/** Frames within which a label counts as in use and is spared from eviction. */
const LABEL_RECENT_FRAMES = 2
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
 * the texture is always ≥ on-screen size (only ever minified -> crisp). A
 * bucket spans `(ratio**(k-1), ratio**k]`, giving ~`ratio`× hysteresis: small
 * scale jitter within a bucket reuses the same texture. ~1.26× ≈ 3
 * buckets/octave.
 */
const LABEL_SCALE_BUCKET_RATIO = 2 ** (1 / 3)
const LOG_LABEL_BUCKET_RATIO = Math.log(LABEL_SCALE_BUCKET_RATIO)
/**
 * Cap on new label rasterizations+uploads per frame, prevents zoom-tween
 * spikes.
 */
const LABEL_MAX_REGENS_PER_FRAME = 24
/**
 * Frames a label's scale must hold still before a raster at its exact bucket is
 * made. While the scale keeps changing (a zoom, a tween), the label keeps
 * drawing from a raster of a nearby bucket instead.
 */
const LABEL_SETTLE_FRAMES = 8
/** A scale change smaller than this ratio counts as still. */
const LABEL_SCALE_EPSILON = 0.002
/**
 * Buckets to look through for a raster to borrow, larger first. Larger ones
 * only minify. The reach is 3 buckets of minification (2x) and 2 of
 * magnification (about 1.6x, slightly soft).
 */
const LABEL_BORROW_OFFSETS = [1, 2, 3, -1, -2] as const
/** Most labels whose scale motion is tracked at once. */
const LABEL_MOTION_MAX = 2048

/** How a label's requested scale has moved over recent frames. */
interface LabelMotion {
  /** The px size a text label was last rasterized at, or 0. */
  lastPx?: number
  scale: number
  /** The `#labelFrame` when the scale last changed. */
  since: number
  /** The `#labelFrame` of the latest request that missed the cache. */
  last: number
}
/**
 * Cap on page-backed labels evicted while hunting for a slot. Past this the
 * page is fragmented rather than merely full, and wiping it costs less than
 * walking the rest of the cache dropping labels that are still on screen.
 */
const LABEL_PACK_EVICT_LIMIT = 32

/**
 * Read-only snapshot of the texture caches for the debug inspector. Built on
 * demand by {@link TextureManager.snapshot}, so nothing here runs unless the
 * inspector panel asks for it. Covers the four enumerable caches (atlas, ramp
 * atlas, per-source, labels). The clip-mask cache is a `WeakMap` and not
 * enumerable, so it's omitted.
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
   * The shared gradient ramp atlas (see `ensureStopsRow`). No `canvas` preview:
   * unlike the sprite atlas and label page, a row paints from a transient
   * scratch canvas that is discarded immediately, so there is no CPU-side
   * backing to draw without a GPU readback.
   */
  rampAtlas: {
    width: number
    rows: number
    /** Rows currently holding a live gradient. */
    used: number
    /** Cumulative since startup. */
    rowsWritten: number
  }
  /**
   * Live path-shadow masks (`PathShadowCache`). Always empty from
   * `TextureManager` itself, which has no reference to that cache; `GpuGfx`'s
   * `textureInspector` getter fills this in from its own `PathShadowCache`
   * before handing the snapshot to the debug HUD. No `canvas` preview, same
   * reason as the ramp atlas, plus a mask is GPU-only to begin with.
   */
  shadowMasks: {
    width: number
    height: number
    bytes: number
    bucket: number
    lastUsedFrame: number
    bakedFrame: number
  }[]
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
  /** How many of {@link labelCount} are small images rather than text. */
  labelImages: number
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
 * One inspectable texture source on a stage: the screen or the loaded 3D
 * models. The debug HUD lists them as separate labeled sources. Produced by
 * `Stage.textureSources`.
 */
export interface TextureSource {
  /** Stable id: `'screen'` or `'models'`. */
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

  // Gradient ramp atlas --------------------------------------------------
  // One shared `256 x ATLAS_ROWS` texture: every distinct stops array gets a
  // row instead of a dedicated texture, so a draw that samples a ramp never
  // changes which texture is bound (no batch break in or out). A ref->key
  // WeakMap in front skips the key rebuild for a module-constant stops array.
  #rampKeyByRef = new WeakMap<readonly GfxGradientStop[], string>()
  // Row LRU, in insertion order (re-inserted on touch, same as the atlas/label
  // caches elsewhere in this file). Value is the row index.
  #rampRowByKey = new Map<string, number>()
  #rampAtlasTex: Texture | null = null
  /** The smooth-corner field, see `squircleField.ts`, once uploaded. */
  #squircleField: Texture | null = null
  /** Its texels, kept so a lost context can upload them again. */
  #squircleFieldData: Uint16Array | null = null
  #squircleFieldLoad: Promise<void> | null = null
  // All rows start free, popped low-to-high. The atlas texture itself is
  // allocated lazily (on first paint), independent of this list.
  #rampFreeRows: number[] = initialFreeRampRows()
  // Rows allocated or touched this frame are pinned: a `DrawRun` already
  // recorded this frame may carry one of these rows, and it is not replayed
  // until `GpuBatchContext.submitFrame` runs. Recycling a pinned row would
  // overwrite the ramp a pending draw still reads. `flushRampRowPins` is
  // called once that replay has happened, which is also the point it becomes
  // safe to recycle a pinned row (see `#evictRampRow`).
  #rampPinnedRows = new Set<number>()
  #rampExhaustedWarned = false
  /** 256x1 scratch canvas, reused across `ensureStopsRow` calls. */
  #rampRowCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  #rampRowCtx: CanvasRenderingContext2D | null = null
  /** Cumulative since startup: rows actually (re)painted, not LRU-touched. */
  #rampRowsWritten = 0

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
  #labelRasters = 0
  #labelMotion = new Map<string, LabelMotion>()
  #labelUploadBytes = 0
  #labelDedicated = 0
  #labelHolds = 0
  /** Counts `resetLabelBudget` calls, one per frame. */
  #labelFrame = 0
  /** A page reset that waits for the next frame, see `#packLabel`. */
  #labelWipePending = false
  #labelScaleClamps = 0

  // Shared label atlas page: one texture holding every non-oversized label so
  // text draws don't break the batch on a per-label texture bind. The backing
  // canvas mirrors the page so a context-loss `rebuild` re-uploads it once.
  #labelPageTex: Texture | null = null
  #labelPageCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  #labelPageCtx: CanvasRenderingContext2D | null = null
  #labelPacker = new ShelfPacker(LABEL_PAGE_SIZE, LABEL_PAGE_SIZE)

  /**
   * Whether a label whose scale is still changing, or that is over the
   * per-frame raster budget, draws from a nearby raster instead of being
   * rasterized at its exact size. Off for a surface whose frames are stills
   * rather than an animation, where every label should come out exact.
   */
  holdLabels = true

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

  /**
   * The gradient ramp atlas texture, or `null` until the first gradient.
   * Exposed so `coloredTri`, `shape`, `gradientRadial` and `maskedGradient` can
   * bind it at a fixed unit, the same way `getAtlasTexture` exposes the sprite
   * atlas.
   */
  getRampAtlasTexture(): Texture | null {
    return this.#rampAtlasTex
  }

  /**
   * The smooth-corner distance field the shape program samples, or `null` until
   * {@link loadSquircleField} has uploaded it. A shape drawn while it is `null`
   * falls back to circular corners.
   */
  getSquircleFieldTexture(): Texture | null {
    return this.#squircleField
  }

  /**
   * Fetch and upload the smooth-corner field, once. Never rejects: where the
   * file can't be fetched, as in a test environment, the field stays `null`.
   */
  loadSquircleField(): Promise<void> {
    this.#squircleFieldLoad ??= this.#fetchSquircleField()
    return this.#squircleFieldLoad
  }

  async #fetchSquircleField(): Promise<void> {
    try {
      const field = await loadField()
      if (field) this.setSquircleField(field)
    } catch (err) {
      console.warn(
        '[stargazer] smooth corners unavailable, drawing circular corners:',
        err,
      )
    }
  }

  /**
   * Upload `data` as the smooth-corner field, in the layout `squircleField.ts`
   * describes. {@link loadSquircleField} calls this with the shipped field.
   */
  setSquircleField(data: Uint16Array): void {
    this.#squircleFieldData = data
    this.#uploadSquircleField()
  }

  #uploadSquircleField(): void {
    if (!this.#squircleFieldData) return
    const tex = this.#device.createTexture2D({
      width: FIELD_WIDTH,
      height: FIELD_HEIGHT,
      filter: 'linear',
      wrap: 'clamp',
      pixelFormat: 'rgba16f',
    })
    this.#device.updateTexture2DData(tex, this.#squircleFieldData)
    this.#squircleField = tex
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
    this.#maskTextureCache = new WeakMap()
    // The ramp atlas has no CPU-side backing (each row paints from a
    // transient canvas and is discarded), unlike the particle atlas above, so
    // it cannot be rebuilt in place. Drop it; rows repopulate lazily as each
    // stops array is next requested.
    this.#rampKeyByRef = new WeakMap()
    this.#rampRowByKey = new Map()
    this.#rampAtlasTex = null
    // The smooth-corner field keeps its texels, so it is uploaded again now.
    this.#squircleField = null
    this.#uploadSquircleField()
    this.#rampFreeRows = initialFreeRampRows()
    this.#rampPinnedRows = new Set()

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

  // --- gradient ramp atlas ----------------------------------------------

  /**
   * Look up (or build) the atlas row holding `stops`'s premultiplied ramp.
   * Returns the row index, or `-1` if a 2D context isn't available (a headless
   * environment). The row is pinned until `flushRampRowPins` runs, so the
   * caller's own draw and every draw already recorded this frame may read it
   * safely.
   *
   * Also returns `-1` when every row is pinned by draws recorded this frame,
   * which needs `ATLAS_ROWS` distinct ramps alive within one frame. The first
   * such frame warns. Callers fall back to a solid fill so the draw still
   * appears. No submit happens mid-frame to free a row.
   */
  ensureStopsRow(stops: readonly GfxGradientStop[]): number {
    // Fast path: reuse the key for a constant stops array (skips the join).
    let key = this.#rampKeyByRef.get(stops)
    if (key === undefined) {
      key = stops.map((s) => `${s.offset}:${s.color}`).join('|')
      this.#rampKeyByRef.set(stops, key)
    }
    const hit = this.#rampRowByKey.get(key)
    if (hit !== undefined) {
      // LRU touch.
      this.#rampRowByKey.delete(key)
      this.#rampRowByKey.set(key, hit)
      this.#rampPinnedRows.add(hit)
      return hit
    }
    const row = this.#allocRampRow()
    if (row < 0) {
      if (!this.#rampExhaustedWarned) {
        this.#rampExhaustedWarned = true
        console.warn(
          `GpuGfx: more than ${ATLAS_ROWS} distinct gradients in one frame, extra gradients draw as a solid color`,
        )
      }
      return -1
    }
    if (!this.#paintRampRow(row, stops)) return -1
    this.#rampRowsWritten++
    this.#rampRowByKey.set(key, row)
    this.#rampPinnedRows.add(row)
    return row
  }

  /**
   * Ramp atlas rows actually painted since startup (an LRU touch doesn't
   * count).
   */
  get rampRowsWritten(): number {
    return this.#rampRowsWritten
  }

  /** Cumulative label counters, see {@link GpuGfxStats}. */
  get labelCounters(): {
    rasters: number
    uploadBytes: number
    dedicated: number
    holds: number
    pageWipes: number
    /** Entries in the cache now. */
    entries: number
  } {
    return {
      entries: this.#labelCache.size,
      rasters: this.#labelRasters,
      uploadBytes: this.#labelUploadBytes,
      dedicated: this.#labelDedicated,
      holds: this.#labelHolds,
      pageWipes: this.#labelPageWipes,
    }
  }

  /**
   * A free row, or the least-recently-touched unpinned row, recycled. `-1` when
   * every row is pinned.
   */
  #allocRampRow(): number {
    if (this.#rampFreeRows.length > 0) return this.#rampFreeRows.pop() as number
    return this.#evictLruRampRow()
  }

  /** The oldest unpinned row (Map iterates in insertion order), or `-1`. */
  #evictLruRampRow(): number {
    for (const [key, row] of this.#rampRowByKey) {
      if (this.#rampPinnedRows.has(row)) continue
      this.#rampRowByKey.delete(key)
      return row
    }
    return -1
  }

  /**
   * Rasterize `stops` into a reused 256x1 scratch canvas and sub-upload it into
   * atlas row `row`, allocating the atlas texture itself on first use.
   */
  #paintRampRow(row: number, stops: readonly GfxGradientStop[]): boolean {
    if (!this.#rampRowCanvas) {
      if (typeof OffscreenCanvas !== 'undefined') {
        this.#rampRowCanvas = new OffscreenCanvas(GRADIENT_LUT_WIDTH, 1)
      } else {
        this.#rampRowCanvas = document.createElement('canvas')
        this.#rampRowCanvas.width = GRADIENT_LUT_WIDTH
        this.#rampRowCanvas.height = 1
      }
      this.#rampRowCtx = this.#rampRowCanvas.getContext(
        '2d',
      ) as CanvasRenderingContext2D | null
    }
    const ctx = this.#rampRowCtx
    if (!ctx) return false
    // Texel i is rasterized at pixel center i + 0.5. Building the gradient
    // line from texel-center to texel-center (0.5 to WIDTH - 0.5) maps texel
    // 0 to stop(0) and the last texel to stop(1) exactly, instead of stopping
    // just short of both ends. The full-width `fillRect` below still covers
    // every texel; canvas clamps the gradient past its own line.
    const grad = ctx.createLinearGradient(0.5, 0, GRADIENT_LUT_WIDTH - 0.5, 0)
    for (const stop of stops) {
      grad.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color)
    }
    // The scratch canvas still holds the previous row, and `fillRect`
    // composites over it, so a translucent stop would show that row through.
    ctx.clearRect(0, 0, GRADIENT_LUT_WIDTH, 1)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, GRADIENT_LUT_WIDTH, 1)
    if (!this.#rampAtlasTex) {
      this.#rampAtlasTex = this.#device.createTexture2D({
        width: GRADIENT_LUT_WIDTH,
        height: ATLAS_ROWS,
        filter: 'linear',
        wrap: 'clamp',
      })
      // Rows are painted one at a time, so zero the rest up front. Sampling a
      // row that was never written would otherwise force a lazy clear.
      if (typeof ImageData !== 'undefined') {
        this.#device.updateTexture2D(
          this.#rampAtlasTex,
          new ImageData(GRADIENT_LUT_WIDTH, ATLAS_ROWS),
        )
      }
    }
    this.#device.updateTextureSubImage2D(
      this.#rampAtlasTex,
      0,
      row,
      this.#rampRowCanvas as TexImageSource,
      { flipY: false, premultiply: true },
    )
    return true
  }

  /**
   * Unpin every row touched this frame. Safe once the draw runs recorded
   * against this frame's slot have been replayed (after
   * `GpuBatchContext.submitFrame`), never before.
   */
  flushRampRowPins(): void {
    this.#rampPinnedRows.clear()
  }

  // --- bitmap-mask clip texture ---------------------------------------

  /**
   * Look up (or upload) the GPU texture backing `mask`. `mask.imageData` is an
   * `ImageData` (RGBA8), already inside the `TexImageSource` union, so it
   * uploads via the `updateTexture2D` path. Cached per mask instance and
   * dropped on context loss via `rebuild`.
   *
   * Linear filter + clamp wrap: linear gives the fragment shader a smooth 0->1
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

  /**
   * Start a frame. Resets the label-regeneration budget and applies a page
   * reset that `#packLabel` asked for. Called from `beginFrame`.
   */
  resetLabelBudget(): void {
    this.#labelRegensThisFrame = 0
    this.#labelFrame++
    if (this.#labelWipePending) {
      this.#labelWipePending = false
      this.#labelPageWipes++
      this.#labelPacker.reset()
      this.#clearLabelPage()
      for (const [key, entry] of this.#labelCache) {
        if (entry.atlasBox) this.#labelCache.delete(key)
      }
    }
  }

  /**
   * Look up (or rasterize + upload) the texture for a text label at the given
   * device scale. `baseKey` identifies the scale-independent style (text, font,
   * align, baseline, color), and the scale bucket is appended internally.
   *
   * `deviceScale` is rounded UP to a bucket so the texture is always ≥
   * on-screen size (crisp minification). While a label's scale is changing, or
   * when the per-frame regen budget is exhausted, a neighbouring-bucket texture
   * is reused if present, so a zoom can't rebuild every label at every bucket
   * crossing. A label with no raster nearby still rasterizes at once, so it
   * never flickers in.
   */
  ensureLabelTexture(
    baseKey: string,
    text: string,
    style: LabelStyle,
    deviceScale: number,
  ): LabelTexture | null {
    const k =
      deviceScale > 0
        ? Math.ceil(Math.log(deviceScale) / LOG_LABEL_BUCKET_RATIO)
        : 0
    const key = `${baseKey}-${k}`

    // A hit only stamps the frame. Eviction reads the stamp, so the map is not
    // reordered on every draw.
    const hit = this.#labelCache.get(key)
    if (hit) {
      hit.usedFrame = this.#labelFrame
      return hit
    }

    // A label whose scale is still changing keeps its old raster, and one that
    // cannot be rasterized this frame borrows a neighbour's. Both defer the
    // exact-size raster, so a zoom of many labels does not rebuild them all at
    // every bucket crossing.
    const settled = this.#noteLabelScale(baseKey, deviceScale)
    if (
      this.holdLabels &&
      (!settled || this.#labelRegensThisFrame >= LABEL_MAX_REGENS_PER_FRAME)
    ) {
      const near = this.#borrowLabel(baseKey, k)
      if (near) {
        this.#labelHolds++
        return near
      }
    }

    const rasterScale = LABEL_SCALE_BUCKET_RATIO ** k
    const ras = rasterizeLabel(text, style, rasterScale)
    if (!ras) return null
    if (ras.clamped) this.#labelScaleClamps++

    this.#labelRasters++
    this.#labelUploadBytes += ras.texW * ras.texH * 4
    const entry = this.#uploadLabel(ras)
    if (!entry.atlasBox) this.#labelDedicated++
    entry.usedFrame = this.#labelFrame
    entry.addedFrame = this.#labelFrame
    this.#labelCache.set(key, entry)
    this.#labelRegensThisFrame++

    if (this.#labelCache.size > LABEL_CACHE_MAX) this.#evictLabel()
    return entry
  }

  /**
   * The label for `text` in a font of `fontPx` drawn at `deviceScale`. It is
   * keyed by the font without its size (`familyKey`) and the size in device px,
   * and rasterized at exactly that size, so text at rest is drawn texel for
   * pixel. Text whose font grows while its scale shrinks keeps one raster.
   * While the device size keeps changing, the label draws from the raster it
   * last made, up to 2x larger or 1.6x smaller, and a new one is made at the
   * exact size once it settles or leaves that range.
   */
  ensureTextLabel(
    familyKey: string,
    text: string,
    style: LabelStyle,
    font: LabelFontTemplate,
    fontPx: number,
    deviceScale: number,
  ): LabelTexture | null {
    const device = fontPx * deviceScale
    if (!(device > 0)) return null
    const px = Math.round(device * 16) / 16 || 1 / 16
    const key = `${familyKey}@${px}`
    const hit = this.#labelCache.get(key)
    if (hit) {
      hit.usedFrame = this.#labelFrame
      return hit
    }
    const settled = this.#noteLabelScale(familyKey, device)
    const motion = this.#labelMotion.get(familyKey)
    if (
      this.holdLabels &&
      (!settled || this.#labelRegensThisFrame >= LABEL_MAX_REGENS_PER_FRAME)
    ) {
      const last = motion?.lastPx ?? 0
      const near =
        last > 0 && last <= device * 2 && last * 1.6 >= device
          ? this.#labelCache.get(`${familyKey}@${last}`)
          : undefined
      if (near) {
        near.usedFrame = this.#labelFrame
        this.#labelHolds++
        return near
      }
    }
    style.font = `${font.head}${px}px${font.tail}`
    const ras = rasterizeLabel(text, style, 1)
    if (!ras) return null
    if (ras.clamped) this.#labelScaleClamps++
    this.#labelRasters++
    this.#labelUploadBytes += ras.texW * ras.texH * 4
    const entry = this.#uploadLabel(ras)
    if (!entry.atlasBox) this.#labelDedicated++
    entry.px = px
    entry.usedFrame = this.#labelFrame
    entry.addedFrame = this.#labelFrame
    this.#labelCache.set(key, entry)
    this.#labelRegensThisFrame++
    if (motion) motion.lastPx = px
    if (this.#labelCache.size > LABEL_CACHE_MAX) this.#evictLabel()
    return entry
  }

  /** Ids for image sources, so a raster's cache key can name its source. */
  readonly #sourceIds = new WeakMap<object, number>()
  /** The cache key of the raster last returned for each image and filter. */
  readonly #imageLast = new Map<string, string>()
  #nextSourceId = 1

  /**
   * Whether `drawImage` of `source` should keep to the sprite atlas and the
   * per-source texture path. Particle sprites live in the atlas.
   */
  isAtlasSource(source: CanvasImageSource): boolean {
    return this.#atlasBindings.has(source) || this.#isParticleSprite(source)
  }

  /**
   * The source drawn at `dw × dh` device pixels into the shared label page, so
   * a small image samples the same texture as text and joins its draws. Returns
   * `null` when the raster would not fit a page slot, for the caller to draw
   * the image from its own texture instead.
   *
   * With `smooth` off the source is scaled with nearest filtering, which keeps
   * pixel art hard-edged. A size within a hair of a whole multiple of the
   * source is rasterized at exactly that multiple, so every source pixel comes
   * out the same size. Any other size is rasterized at the next scale bucket
   * up, the way labels are, so a zoom does not build a raster per frame.
   */
  ensureImageRaster(
    source: CanvasImageSource,
    dw: number,
    dh: number,
    smooth: boolean,
  ): LabelTexture | null {
    const sw = (source as { width?: number }).width ?? 0
    const sh = (source as { height?: number }).height ?? 0
    if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return null
    let w: number
    let h: number
    const mx = Math.round(dw / sw)
    const my = Math.round(dh / sh)
    if (
      !smooth &&
      mx >= 1 &&
      my >= 1 &&
      Math.abs(dw / sw - mx) < 0.02 &&
      Math.abs(dh / sh - my) < 0.02
    ) {
      w = sw * mx
      h = sh * my
    } else {
      // Each axis steps through the buckets alone, so squashing an image along
      // one axis does not resize its raster along the other.
      w = bucketSide(dw)
      h = bucketSide(dh)
    }
    if (w > LABEL_ATLAS_MAX_SIDE || h > LABEL_ATLAS_MAX_SIDE) return null

    let id = this.#sourceIds.get(source as object)
    if (id === undefined) {
      id = this.#nextSourceId++
      this.#sourceIds.set(source as object, id)
    }
    const baseKey = `img:${id}:${smooth ? 1 : 0}`
    const key = `${baseKey}:${w}x${h}`
    const hit = this.#labelCache.get(key)
    if (hit) {
      hit.usedFrame = this.#labelFrame
      this.#imageLast.set(baseKey, key)
      return hit
    }
    // Past the per-frame raster budget an image keeps the raster it last drew
    // with, so a burst of new sizes (many images flipping at once) is spread
    // over frames instead of stalling one.
    if (this.#labelRegensThisFrame >= LABEL_MAX_REGENS_PER_FRAME) {
      const lastKey = this.#imageLast.get(baseKey)
      const last = lastKey ? this.#labelCache.get(lastKey) : undefined
      if (last) {
        last.usedFrame = this.#labelFrame
        this.#labelHolds++
        return last
      }
    }
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : typeof document !== 'undefined'
          ? Object.assign(document.createElement('canvas'), {
              width: w,
              height: h,
            })
          : null
    const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D | null
    if (!canvas || !ctx) return null
    ctx.imageSmoothingEnabled = smooth
    if (smooth) ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, w, h)
    const entry = this.#uploadLabel({
      canvas,
      texW: w,
      texH: h,
      clamped: false,
      localW: w,
      localH: h,
      advance: w,
      ascent: h,
      descent: 0,
      anchorOffsetX: 0,
      anchorOffsetY: 0,
    })
    this.#labelRasters++
    this.#labelUploadBytes += w * h * 4
    entry.usedFrame = this.#labelFrame
    entry.addedFrame = this.#labelFrame
    this.#labelCache.set(key, entry)
    this.#imageLast.set(baseKey, key)
    this.#labelRegensThisFrame++
    if (this.#labelCache.size > LABEL_CACHE_MAX) this.#evictLabel()
    return entry
  }

  /**
   * Evict one label, oldest first in insertion order. An entry drawn again in
   * the last {@link LABEL_RECENT_FRAMES} frames since it was cached gets a
   * second chance: it moves to the back and counts as cached now, so it is
   * spared once per use and an eviction stays cheap.
   */
  #evictLabel(): void {
    const cache = this.#labelCache
    const frame = this.#labelFrame
    for (let tries = cache.size; tries > 0; tries--) {
      const victim = evictOldest(cache)
      if (!victim) return
      const entry = victim[1]
      if (
        tries > 1 &&
        entry.usedFrame > entry.addedFrame &&
        entry.usedFrame >= frame - LABEL_RECENT_FRAMES
      ) {
        entry.addedFrame = frame
        cache.set(victim[0], entry)
        continue
      }
      this.#labelEvictions++
      this.#releaseLabel(victim[1])
      return
    }
  }

  /**
   * Record a cache miss for the label's scale and report whether the scale has
   * held still for {@link LABEL_SETTLE_FRAMES}.
   */
  #noteLabelScale(baseKey: string, scale: number): boolean {
    const frame = this.#labelFrame
    let m = this.#labelMotion.get(baseKey)
    if (!m || frame - m.last > 1) {
      m = { scale, since: frame, last: frame }
      this.#labelMotion.set(baseKey, m)
      if (this.#labelMotion.size > LABEL_MOTION_MAX) {
        evictOldest(this.#labelMotion)
      }
    } else {
      if (Math.abs(scale / m.scale - 1) > LABEL_SCALE_EPSILON) {
        m.scale = scale
        m.since = frame
      }
      m.last = frame
    }
    return frame - m.since >= LABEL_SETTLE_FRAMES
  }

  /** A cached raster of a nearby bucket, touched so it stays resident. */
  #borrowLabel(baseKey: string, k: number): LabelCacheEntry | null {
    for (const offset of LABEL_BORROW_OFFSETS) {
      const key = `${baseKey}-${k + offset}`
      const entry = this.#labelCache.get(key)
      if (entry) {
        entry.usedFrame = this.#labelFrame
        return entry
      }
    }
    return null
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
            usedFrame: 0,
            addedFrame: 0,
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
      usedFrame: 0,
      addedFrame: 0,
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
   * page-backed labels (freeing their spans) if the page is full. Returns the
   * slot, or `null` when there is no 2D page or no room is left. The caller
   * then gives the label its own texture.
   *
   * @remarks
   *   Draws are recorded and replayed at `submitFrame`, while this runs mid-frame
   *   from inside `fillText`. A slot that a label returned this frame is
   *   therefore never freed, because its recorded draws still sample it. When
   *   only such labels are left, or fragmentation defeats the eviction walk,
   *   the page is reset at the start of the next frame and this label takes a
   *   dedicated texture for now.
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
      if (!entry.atlasBox || entry.usedFrame === this.#labelFrame) continue
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
    this.#labelWipePending = true
    return null
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
      rampAtlas: {
        width: GRADIENT_LUT_WIDTH,
        rows: ATLAS_ROWS,
        used: this.#rampRowByKey.size,
        rowsWritten: this.#rampRowsWritten,
      },
      shadowMasks: [],
      perSource,
      labels,
      labelCount: this.#labelCache.size,
      labelImages: [...this.#labelCache.keys()].filter((k) =>
        k.startsWith('img:'),
      ).length,
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
