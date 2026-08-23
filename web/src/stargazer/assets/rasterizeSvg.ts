/**
 * Rasterise SVG source to a canvas that {@link Gfx2D.drawImage} can paint.
 *
 * {@link parseSvgPaths} is the other half of SVG support and answers a different
 * need: it returns geometry for `fillPath2D`, so the caller picks the paint.
 * Use that for silhouettes to recolour, animate or hit-test, and this for
 * artwork that carries its own fills and strokes.
 *
 * Decoding goes through an `<img>` on an object URL. `createImageBitmap` does
 * not accept SVG in every engine, and where it is unsupported it rejects, so a
 * caller with a fallback renders nothing at all, silently.
 *
 * Give the result a mip chain if it will be minified. A `drawImage` source is
 * sampled with one bilinear tap, so a canvas drawn at a third of its size
 * throws away most of its texels.
 *
 * @example
 *   const loader = new AssetLoader()
 *   const icon = await loader.load('badge', () =>
 *     rasterizeSvg(badgeSvgRaw, { scale: 4 }),
 *   )
 *   gfx.drawImage(icon, x, y, w, h)
 */

/** Options for {@link rasterizeSvg}. */
export interface RasterizeSvgOptions {
  /**
   * Multiple of the SVG's own `viewBox` size to rasterise at. Ignored when
   * `width`/`height` are given. Defaults to `1`.
   */
  scale?: number
  /** Explicit raster width in pixels. Overrides `scale`. */
  width?: number
  /** Explicit raster height in pixels. Overrides `scale`. */
  height?: number
  /**
   * How long to wait for the decode before giving up, in milliseconds. Defaults
   * to 3000. A real decode of inline SVG resolves in a frame or two, so this is
   * a backstop against an image that fires neither `load` nor `error`, which is
   * what a headless DOM stub does.
   */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 3000

/**
 * The `width`/`height` of an SVG's `viewBox`, or `null` when it has none.
 *
 * Exported because callers need the natural aspect to lay the raster out
 * without hard-coding it in a second place.
 */
export function svgViewBoxSize(svg: string): { w: number; h: number } | null {
  const m = /viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/.exec(svg)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return null
  return { w, h }
}

/**
 * Stamp `w` x `h` onto the root `<svg>` as its intrinsic size.
 *
 * An SVG with no width or height has no intrinsic size, and an `<img>` then
 * picks a default. Setting it to the raster target also makes the decode 1:1.
 */
export function sizeSvgSource(svg: string, w: number, h: number): string {
  const open = /<svg\b[^>]*>/i.exec(svg)
  if (!open) return svg
  const tag = open[0]
    .replace(/\swidth="[^"]*"/i, '')
    .replace(/\sheight="[^"]*"/i, '')
    .replace(/<svg\b/i, `<svg width="${w}" height="${h}"`)
  return svg.replace(open[0], tag)
}

function decode(url: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = setTimeout(
      () => reject(new Error('rasterizeSvg: decode timed out')),
      timeoutMs,
    )
    img.onload = (): void => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = (): void => {
      clearTimeout(timer)
      reject(new Error('rasterizeSvg: decode failed'))
    }
    img.src = url
  })
}

/**
 * Rasterise `svg` to a canvas sized from `opts`.
 *
 * Never rejects. With no 2D context or no object URLs it resolves to a
 * correctly sized blank canvas and warns, so a failed asset cannot take a
 * caller's startup down with it. {@link isBlankRaster} reports which happened.
 */
export async function rasterizeSvg(
  svg: string,
  opts: RasterizeSvgOptions = {},
): Promise<HTMLCanvasElement> {
  const box = svgViewBoxSize(svg) ?? { w: 64, h: 64 }
  const scale = opts.scale ?? 1
  const w = Math.max(1, Math.round(opts.width ?? box.w * scale))
  const h = Math.max(1, Math.round(opts.height ?? box.h * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof URL.createObjectURL !== 'function') {
    markBlank(canvas)
    return canvas
  }

  const url = URL.createObjectURL(
    new Blob([sizeSvgSource(svg, w, h)], { type: 'image/svg+xml' }),
  )
  try {
    ctx.drawImage(await decode(url, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS), 0, 0)
  } catch (err) {
    // A blank canvas keeps the caller safe, but reaching here in a browser
    // means the artwork is missing, so it must not pass in silence.
    markBlank(canvas)
    console.warn('[stargazer] rasterizeSvg failed, drawing nothing', err)
  } finally {
    URL.revokeObjectURL(url)
  }
  return canvas
}

const BLANK = Symbol.for('stargazer.blankRaster')

function markBlank(canvas: HTMLCanvasElement): void {
  ;(canvas as unknown as Record<symbol, boolean>)[BLANK] = true
}

/** Whether {@link rasterizeSvg} fell back to a blank canvas for this source. */
export function isBlankRaster(canvas: HTMLCanvasElement): boolean {
  return (canvas as unknown as Record<symbol, boolean>)[BLANK] === true
}
