/**
 * Rasterizes a single line of text onto an offscreen canvas using the platform
 * Canvas2D text engine (correct shaping / kerning / ligatures / emoji), ready
 * to be uploaded as a GPU texture. The GPU backend draws the result as a
 * textured quad; the caller supplies the target device-pixel scale so the
 * bitmap is rasterized at the on-screen resolution and stays crisp.
 *
 * `measureLabel` and `clampLabelScale` are pure and exported for unit testing.
 */

/** Fully-resolved text style (no undefined fields). */
export interface LabelStyle {
  font: string
  align: CanvasTextAlign
  baseline: CanvasTextBaseline
  color: string
}

/** Local-space (CSS px) geometry of a rasterized label, transform-independent. */
export interface LabelMetrics {
  /** Total bitmap width in local px (content + padding). */
  localW: number
  /** Total bitmap height in local px. */
  localH: number
  /**
   * Local-px distance from the requested `(x, y)` anchor to the bitmap's
   * top-left corner. The bitmap is drawn at `(x - anchorOffsetX, y -
   * anchorOffsetY)`. Also the local-px coordinate of the text origin within the
   * bitmap, so `fillText` is called at `(anchorOffsetX, anchorOffsetY)`.
   */
  anchorOffsetX: number
  anchorOffsetY: number
}

export interface RasterizedLabel extends LabelMetrics {
  /** The offscreen canvas holding the glyphs; a valid `TexImageSource`. */
  canvas: HTMLCanvasElement | OffscreenCanvas
  /** Device-pixel dimensions actually rasterized (`localW/H × effectiveScale`). */
  texW: number
  texH: number
}

/**
 * Padding around glyphs in local px, so bilinear minification finds a clean
 * transparent border.
 */
const LABEL_PAD = 2

/**
 * Conservative max texture dimension. WebGL2 guarantees `MAX_TEXTURE_SIZE >=
 * 2048`; staying at or under it avoids a GL error on the lowest-end devices.
 */
export const MAX_LABEL_TEXTURE_PX = 2048

/** Default font when a style omits it (matches the Canvas2D context default). */
export const DEFAULT_LABEL_FONT = '10px sans-serif'

/** Parse the `px` size out of a CSS font shorthand; fallback `10`. */
function parseFontSizePx(font: string): number {
  const m = /(\d*\.?\d+)px/.exec(font)
  const v = m ? Number(m[1]) : NaN
  return Number.isFinite(v) && v > 0 ? v : 10
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Minimal subset of the 2D context we touch, so `measureLabel` can be tested
 * with a lightweight stub.
 */
export interface LabelMeasureCtx {
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  measureText(text: string): TextMetrics
}

/**
 * Measure a label's local-space box. Sets `font`/`textAlign`/`textBaseline` on
 * `ctx` first (they affect `measureText`'s bounding box), then derives the box
 * from `TextMetrics`. Falls back to `width` + a `fontSize` heuristic on
 * environments (old browsers, headless test DOMs) that don't populate the
 * `actualBoundingBox*` fields.
 */
export function measureLabel(
  ctx: LabelMeasureCtx,
  text: string,
  style: LabelStyle,
): LabelMetrics {
  ctx.font = style.font
  ctx.textAlign = style.align
  ctx.textBaseline = style.baseline
  const m = ctx.measureText(text)

  let left = m.actualBoundingBoxLeft
  let right = m.actualBoundingBoxRight
  let ascent = m.actualBoundingBoxAscent
  let descent = m.actualBoundingBoxDescent

  if (
    !isFiniteNum(left) ||
    !isFiniteNum(right) ||
    !isFiniteNum(ascent) ||
    !isFiniteNum(descent)
  ) {
    // Fallback: no bounding-box metrics available.
    const width = isFiniteNum(m.width) ? m.width : 0
    const size = parseFontSizePx(style.font)
    switch (style.align) {
      case 'center':
        left = width / 2
        right = width / 2
        break
      case 'right':
      case 'end':
        left = width
        right = 0
        break
      default: // 'left' | 'start'
        left = 0
        right = width
    }
    switch (style.baseline) {
      case 'top':
      case 'hanging':
        ascent = 0
        descent = size
        break
      case 'middle':
        ascent = size * 0.5
        descent = size * 0.5
        break
      case 'bottom':
      case 'ideographic':
        ascent = size
        descent = 0
        break
      default: // 'alphabetic'
        ascent = size * 0.8
        descent = size * 0.2
    }
  }

  return {
    localW: left + right + 2 * LABEL_PAD,
    localH: ascent + descent + 2 * LABEL_PAD,
    anchorOffsetX: left + LABEL_PAD,
    anchorOffsetY: ascent + LABEL_PAD,
  }
}

/**
 * Reduce `deviceScale` if rasterizing at it would exceed `maxPx` in either
 * dimension, so the texture always fits. Degrades to a softer (magnified) label
 * rather than a GL error on an extreme string length or zoom.
 */
export function clampLabelScale(
  localW: number,
  localH: number,
  deviceScale: number,
  maxPx = MAX_LABEL_TEXTURE_PX,
): number {
  let eff = deviceScale
  if (localW > 0) eff = Math.min(eff, maxPx / localW)
  if (localH > 0) eff = Math.min(eff, maxPx / localH)
  return Math.max(eff, 1e-3)
}

// --- shared offscreen canvas -------------------------------------------------

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

let sharedCanvas: AnyCanvas | null = null
let sharedCtx: AnyCtx | null = null
let acquireFailed = false

function getSharedCtx(): { canvas: AnyCanvas; ctx: AnyCtx } | null {
  if (sharedCtx && sharedCanvas) return { canvas: sharedCanvas, ctx: sharedCtx }
  if (acquireFailed) return null
  let canvas: AnyCanvas
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(1, 1)
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
  } else {
    acquireFailed = true
    return null
  }
  const ctx = canvas.getContext('2d') as AnyCtx | null
  if (!ctx) {
    acquireFailed = true
    return null
  }
  sharedCanvas = canvas
  sharedCtx = ctx
  return { canvas, ctx }
}

/**
 * Rasterize `text` at `deviceScale` device px per local px. Returns `null` if
 * no 2D canvas context is available (e.g. headless without a canvas polyfill),
 * in which case the caller draws nothing.
 */
export function rasterizeLabel(
  text: string,
  style: LabelStyle,
  deviceScale: number,
): RasterizedLabel | null {
  const shared = getSharedCtx()
  if (!shared) return null
  const { canvas, ctx } = shared

  const met = measureLabel(ctx, text, style)
  const eff = clampLabelScale(
    met.localW,
    met.localH,
    Math.max(deviceScale, 1e-3),
  )
  const texW = Math.max(1, Math.ceil(met.localW * eff))
  const texH = Math.max(1, Math.ceil(met.localH * eff))

  // Resizing the canvas resets its context state; re-apply everything after.
  canvas.width = texW
  canvas.height = texH
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, texW, texH)
  ctx.scale(eff, eff)
  ctx.font = style.font
  ctx.textAlign = style.align
  ctx.textBaseline = style.baseline
  ctx.fillStyle = style.color
  ctx.fillText(text, met.anchorOffsetX, met.anchorOffsetY)

  return {
    canvas,
    texW,
    texH,
    localW: met.localW,
    localH: met.localH,
    anchorOffsetX: met.anchorOffsetX,
    anchorOffsetY: met.anchorOffsetY,
  }
}
