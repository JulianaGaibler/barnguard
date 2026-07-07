/**
 * `TextureManager`, owns every GL texture `GpuGfx` uses:
 *
 * - A shared **1024×1024 particle sprite atlas**, shelf-packed with 66×66 tiles
 *   (64-px sprite core + 1-px transparent padding). All particles share the
 *   atlas texture so `drawImage(spriteA)` and `drawImage(spriteB)` from
 *   different colors coalesce into ONE instanced draw call.
 * - A per-source **`textureBySource` cache** for one-off images that aren't
 *   particle sprites (the TutorialHint hand assets, etc.).
 * - The **gradient-radial LUT cache**, one 256×1 texture per unique `stops`
 *   array, cached by reference identity.
 *
 * Under `webglcontextlost`/`webglcontextrestored`, `rebuild(device)` recreates
 * the atlas GL texture from its CPU-side `OffscreenCanvas` backing (the backing
 * survives context loss because it's a plain JS object), and drops the
 * per-source + gradient-LUT caches (they repopulate lazily on the next draw).
 */

import type { GfxDevice, Texture } from './GfxDevice'
import type { GfxGradientStop } from './Gfx2D'
import type { BitmapMask } from '../../assets/BitmapMask'

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

export class TextureManager {
  private device: GfxDevice

  // Atlas ---------------------------------------------------------------
  private atlasTex: Texture | null = null
  private atlasCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  private atlasCtx: CanvasRenderingContext2D | null = null
  private atlasNextX = ATLAS_TILE_PADDING
  private atlasNextY = ATLAS_TILE_PADDING
  private atlasRowH = 0
  private atlasBindings = new Map<CanvasImageSource, AtlasEntry>()
  private atlasFull = false
  private warnedAtlasFull = false

  // Per-source (fallback) ----------------------------------------------
  private textureBySource = new Map<CanvasImageSource, Texture>()

  // Gradient LUTs ------------------------------------------------------
  private stopsLutCache = new WeakMap<readonly GfxGradientStop[], Texture>()

  // Bitmap-mask clip textures, keyed by BitmapMask instance so a swap
  // (mask disposed / rebuilt) drops the stale texture with the mask.
  private maskTextureCache = new WeakMap<BitmapMask, Texture>()

  constructor(device: GfxDevice) {
    this.device = device
  }

  // --- lifecycle -------------------------------------------------------

  /**
   * On `webglcontextrestored`, the GL textures are dead but our JS-side state
   * (atlas canvas, srcRect map) survived. Recreate the atlas GL texture from
   * the backing canvas; drop per-source + gradient-LUT caches so they
   * repopulate lazily on next draw.
   */
  rebuild(device: GfxDevice): void {
    this.device = device
    this.atlasTex = null
    // Re-create the atlas GL texture from the surviving CPU backing.
    if (this.atlasCanvas) {
      const tex = this.device.createTexture2D({
        width: ATLAS_WIDTH,
        height: ATLAS_HEIGHT,
        filter: 'linear',
        wrap: 'clamp',
      })
      this.device.updateTexture2D(tex, this.atlasCanvas as TexImageSource, {
        flipY: true,
        premultiply: true,
      })
      this.atlasTex = tex
      // The atlas bindings must now point at the new tex. Rewrite them.
      const bindings = this.atlasBindings
      this.atlasBindings = new Map()
      for (const [source, entry] of bindings) {
        this.atlasBindings.set(source, { tex, srcRect: entry.srcRect })
      }
    }
    // Drop per-source + gradient + mask caches, cheap to regenerate.
    this.textureBySource = new Map()
    this.stopsLutCache = new WeakMap()
    this.maskTextureCache = new WeakMap()
  }

  // --- atlas -----------------------------------------------------------

  /**
   * Look up a source in the atlas + per-source cache; register into the atlas
   * on first sight if the source is tagged as a particle sprite; otherwise
   * create a per-source texture.
   */
  getOrCreateEntry(source: CanvasImageSource): AtlasEntry | Texture | null {
    // Atlas hit?
    const atlasHit = this.atlasBindings.get(source)
    if (atlasHit) return atlasHit
    // Tagged particle sprite? Register into the atlas.
    if (this.isParticleSprite(source)) {
      const entry = this.registerAtlasSprite(source as HTMLCanvasElement)
      if (entry) return entry
      // Overflow, fall through to per-source path.
    }
    // Per-source fallback.
    const cached = this.textureBySource.get(source)
    if (cached) return cached
    const w = (source as { width?: number }).width ?? 0
    const h = (source as { height?: number }).height ?? 0
    if (w === 0 || h === 0) return null
    const tex = this.device.createTexture2D({
      width: w,
      height: h,
      filter: 'linear',
      wrap: 'clamp',
    })
    this.device.updateTexture2D(tex, source as TexImageSource, {
      flipY: true,
      premultiply: true,
    })
    this.textureBySource.set(source, tex)
    return tex
  }

  private isParticleSprite(source: CanvasImageSource): boolean {
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
  private registerAtlasSprite(canvas: HTMLCanvasElement): AtlasEntry | null {
    if (this.atlasFull) return null
    // Lazy-create the atlas the first time.
    if (this.atlasTex === null) this.initAtlas()
    if (
      this.atlasTex === null ||
      this.atlasCanvas === null ||
      this.atlasCtx === null
    ) {
      return null
    }
    // Shelf-pack next tile.
    if (this.atlasNextX + ATLAS_TILE_SIZE > ATLAS_WIDTH) {
      // Wrap to next row.
      this.atlasNextX = ATLAS_TILE_PADDING
      this.atlasNextY += ATLAS_TILE_SIZE
    }
    if (this.atlasNextY + ATLAS_TILE_SIZE > ATLAS_HEIGHT) {
      this.atlasFull = true
      if (!this.warnedAtlasFull) {
        this.warnedAtlasFull = true
        console.warn(
          `TextureManager: particle atlas full (${ATLAS_WIDTH}×${ATLAS_HEIGHT}, ${Math.floor(ATLAS_WIDTH / ATLAS_TILE_SIZE) ** 2} tiles); further sprites use per-source textures.`,
        )
      }
      return null
    }
    const tileX = this.atlasNextX
    const tileY = this.atlasNextY
    // Composite the 64×64 sprite core into the atlas canvas, offset by
    // 1 px so a 1-px transparent border surrounds each tile.
    this.atlasCtx.clearRect(
      tileX - ATLAS_TILE_PADDING,
      tileY - ATLAS_TILE_PADDING,
      ATLAS_TILE_SIZE,
      ATLAS_TILE_SIZE,
    )
    this.atlasCtx.drawImage(canvas, tileX, tileY)
    // Poke the tile region into the GL texture.
    this.device.updateTextureSubImage2D(
      this.atlasTex,
      tileX - ATLAS_TILE_PADDING,
      tileY - ATLAS_TILE_PADDING,
      this.atlasCanvas as TexImageSource,
      { flipY: false, premultiply: true },
    )
    // Advance the shelf cursor.
    this.atlasNextX += ATLAS_TILE_SIZE
    this.atlasRowH = ATLAS_TILE_SIZE
    // Record the binding, sample only the 64×64 core (avoids padding bleed).
    const u0 = tileX / ATLAS_WIDTH
    const v0 = tileY / ATLAS_HEIGHT
    const u1 = (tileX + ATLAS_TILE_CORE) / ATLAS_WIDTH
    const v1 = (tileY + ATLAS_TILE_CORE) / ATLAS_HEIGHT
    const entry: AtlasEntry = { tex: this.atlasTex, srcRect: [u0, v0, u1, v1] }
    this.atlasBindings.set(canvas, entry)
    return entry
  }

  private initAtlas(): void {
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
      this.atlasFull = true
      return
    }
    // Initialize with fully-transparent pixels so padding samples are
    // (0,0,0,0), avoids halos when texture sampling reaches into the
    // padding under linear filtering.
    ctx.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
    this.atlasCanvas = canvas
    this.atlasCtx = ctx
    // Allocate the GL texture; upload the initial (empty) canvas so any
    // sub-uploads have valid storage to write into.
    const tex = this.device.createTexture2D({
      width: ATLAS_WIDTH,
      height: ATLAS_HEIGHT,
      filter: 'linear',
      wrap: 'clamp',
    })
    this.device.updateTexture2D(tex, canvas as TexImageSource, {
      flipY: false,
      premultiply: true,
    })
    this.atlasTex = tex
  }

  // --- gradient LUT ----------------------------------------------------

  ensureStopsLut(stops: readonly GfxGradientStop[]): Texture | null {
    const hit = this.stopsLutCache.get(stops)
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
    const tex = this.device.createTexture2D({
      width: GRADIENT_LUT_WIDTH,
      height: 1,
      filter: 'linear',
      wrap: 'clamp',
    })
    this.device.updateTexture2D(tex, lutCanvas as TexImageSource, {
      flipY: false,
      premultiply: true,
    })
    this.stopsLutCache.set(stops, tex)
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
    const hit = this.maskTextureCache.get(mask)
    if (hit) return hit
    const tex = this.device.createTexture2D({
      width: mask.resolution.w,
      height: mask.resolution.h,
      filter: 'linear',
      wrap: 'clamp',
    })
    // No `premultiply` / `flipY`, the mask is a straight alpha channel
    // with RGB = white inside / 0 outside; premultiplying by alpha would
    // be a no-op (255*1=255) but we skip the flag for clarity.
    this.device.updateTexture2D(tex, mask.imageData as TexImageSource)
    this.maskTextureCache.set(mask, tex)
    return tex
  }
}
