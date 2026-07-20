import type { Rect } from '../math/Rect'

/**
 * Options for {@link buildBitmapMask}.
 *
 * @category Assets
 */
export interface BitmapMaskOptions {
  /** The shape filled to produce the mask. */
  path: Path2D
  /** World-space rect the path fills. Used to map world → pixel. */
  worldRect: Rect
  /** Longest edge of the mask in pixels. Default 1024. */
  resolution?: number
  /**
   * Alpha threshold (0..255) above which a pixel counts as inside. Default 128.
   * Anti-aliased edges just outside the fitted path have low alpha. * a strict
   * threshold trims them off.
   */
  alphaThreshold?: number
}

/**
 * A rasterized fill mask with O(1) `contains()` lookups. Build one with
 * {@link buildBitmapMask}.
 *
 * @category Assets
 */
export interface BitmapMask {
  readonly worldRect: Rect
  readonly resolution: { w: number; h: number }
  /**
   * The rasterised mask as `ImageData`. Alpha channel encodes the mask (≈255
   * inside the fill, 0 outside, anti-aliased along the boundary). Kept
   * accessible so the GPU backend can upload it verbatim as a clipping texture
   * via the existing `TexImageSource` path, no extra copy or format conversion
   * needed.
   */
  readonly imageData: ImageData
  /**
   * Is `(worldX, worldY)` inside the filled path? O(1), a single
   * `Uint8ClampedArray` lookup.
   *
   * `insetWorld > 0` samples an extra 4 cardinal offsets at that world-space
   * distance and requires ALL points inside, a cheap "grace band" that prevents
   * alias-edge false positives (e.g., a packet dying the instant its center
   * touches the 1-pixel-wide border).
   */
  contains(worldX: number, worldY: number, insetWorld?: number): boolean
  dispose(): void
}

/**
 * Rasterise a Path2D to a 1-bit mask and expose O(1) `contains()` lookups for
 * boundary checks. Async because the readback (`getImageData`) can be expensive
 * on GPU-backed canvases, we yield around it so a stalled readback doesn't
 * freeze the page.
 *
 * @category Assets
 */
export async function buildBitmapMask(
  opts: BitmapMaskOptions,
): Promise<BitmapMask> {
  const worldRect = { ...opts.worldRect }
  const target = opts.resolution ?? 1024
  const alphaThreshold = opts.alphaThreshold ?? 128
  if (worldRect.width <= 0 || worldRect.height <= 0) {
    throw new Error('buildBitmapMask: worldRect must have positive size')
  }
  const longest = Math.max(worldRect.width, worldRect.height)
  const w = Math.max(1, Math.round((worldRect.width / longest) * target))
  const h = Math.max(1, Math.round((worldRect.height / longest) * target))

  const canvas = createOffscreen(w, h)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('buildBitmapMask: no 2D context')

  const scaleX = w / worldRect.width
  const scaleY = h / worldRect.height
  ctx.setTransform(
    scaleX,
    0,
    0,
    scaleY,
    -worldRect.x * scaleX,
    -worldRect.y * scaleY,
  )
  ctx.fillStyle = '#fff'
  ctx.fill(opts.path)

  // Yield so the browser can paint whatever else is queued before the
  // (potentially GPU→CPU) readback stall.
  await new Promise((resolve) => setTimeout(resolve, 0))

  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data

  await new Promise((resolve) => setTimeout(resolve, 0))

  const invScaleX = w / worldRect.width
  const invScaleY = h / worldRect.height

  const sample = (worldX: number, worldY: number): boolean => {
    const px = Math.floor((worldX - worldRect.x) * invScaleX)
    const py = Math.floor((worldY - worldRect.y) * invScaleY)
    if (px < 0 || py < 0 || px >= w || py >= h) return false
    // Alpha channel, the fill of a Path2D with fill='#fff' onto a
    // transparent canvas gives us alpha≈255 inside, 0 outside, with
    // anti-aliased edges in between.
    return data[(py * w + px) * 4 + 3] >= alphaThreshold
  }

  const contains = (
    worldX: number,
    worldY: number,
    insetWorld = 0,
  ): boolean => {
    if (insetWorld <= 0) return sample(worldX, worldY)
    return (
      sample(worldX, worldY) &&
      sample(worldX - insetWorld, worldY) &&
      sample(worldX + insetWorld, worldY) &&
      sample(worldX, worldY - insetWorld) &&
      sample(worldX, worldY + insetWorld)
    )
  }

  return {
    worldRect,
    resolution: { w, h },
    imageData,
    contains,
    dispose() {
      // No explicit teardown, closure holds `data` which the GC frees when
      // this mask is no longer referenced. Kept as an API for future
      // Worker-backed masks that would need explicit transfer disposal.
    },
  }
}

interface OffscreenLike {
  width: number
  height: number
  getContext(id: '2d'): CanvasRenderingContext2D | null
}

function createOffscreen(w: number, h: number): OffscreenLike {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h) as unknown as OffscreenLike
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c as OffscreenLike
}
