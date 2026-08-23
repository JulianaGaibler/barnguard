/**
 * Rasterizes a single line of text onto an offscreen canvas using the platform
 * Canvas2D text engine (correct shaping / kerning / ligatures / emoji), ready
 * to be uploaded as a GPU texture. The GPU backend draws the result as a
 * textured quad. The caller supplies the target device-pixel scale so the
 * bitmap is rasterized at the on-screen resolution and stays crisp.
 *
 * `measureLabel`, `fontMetrics` and `clampLabelScale` are pure (or memoized)
 * and exported for unit testing.
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
  /**
   * Pen advance in local px: how far the origin moves after drawing this text.
   *
   * This, not {@link localW}, is what positions one run after another on a line.
   * `localW` is the bitmap's box, so it carries the transparent padding and any
   * ink that overhangs the advance, and stepping by it opens a visible gap
   * between neighbouring runs.
   */
  advance: number
  /** Total bitmap height in local px. */
  localH: number
  /**
   * Ink height above the style's baseline, in local px. Unpadded, and specific
   * to this string: "acme" and "Ajax" report different ascents in the same
   * font. Use it to fit one known string into a box, and {@link FontMetrics} to
   * space lines, which must not shift as the text changes.
   */
  ascent: number
  /** Ink depth below the style's baseline, in local px. Unpadded. */
  descent: number
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
  /** The offscreen canvas holding the glyphs, a valid `TexImageSource`. */
  canvas: HTMLCanvasElement | OffscreenCanvas
  /** Device-pixel dimensions actually rasterized. */
  texW: number
  texH: number
  /**
   * The requested scale exceeded the texture cap and was reduced, so the label
   * is magnified on screen and reads soft. Nothing else signals this.
   */
  clamped: boolean
}

/**
 * Font-wide vertical metrics, in local px, measured from the alphabetic
 * baseline.
 *
 * These do not depend on the string, which is what makes them the right basis
 * for line spacing and optical centring: a block laid out from
 * {@link LabelMetrics.ascent} would shift every time its text changed.
 *
 * @example
 *   const fm = fontMetrics('600 16px Inter, sans-serif')
 *   // Centre a single line on `cy` by its capitals rather than its em box.
 *   gfx.fillText(label, x, cy + fm.capHeight / 2, {
 *     font,
 *     baseline: 'alphabetic',
 *   })
 */
export interface FontMetrics {
  /** Baseline to the font's highest ascender. */
  ascent: number
  /** Baseline down to the font's lowest descender. */
  descent: number
  /** Baseline to the top of a capital letter. */
  capHeight: number
  /** Natural distance between consecutive baselines, `ascent + descent`. */
  lineHeight: number
}

/**
 * Padding around glyphs in local px, so bilinear minification finds a clean
 * transparent border.
 */
const LABEL_PAD = 2

/**
 * Conservative max texture dimension. WebGL2 guarantees `MAX_TEXTURE_SIZE >=
 * 2048`. Staying at or under it avoids a GL error on the lowest-end devices.
 */
export const MAX_LABEL_TEXTURE_PX = 2048

/** Default font when a style omits it (matches the Canvas2D context default). */
export const DEFAULT_LABEL_FONT = '10px sans-serif'

/**
 * Parse the `px` size out of a CSS font shorthand, fallback `10`.
 *
 * Exported for `textLayout`, which sizes inline boxes in em and so needs the
 * size back out of a font string it was handed.
 */
export function parseFontSizePx(font: string): number {
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
    advance: isFiniteNum(m.width) ? m.width : left + right,
    ascent,
    descent,
    anchorOffsetX: left + LABEL_PAD,
    anchorOffsetY: ascent + LABEL_PAD,
  }
}

/** Font-wide metrics are a property of the font string, so cache them by it. */
const fontMetricsCache = new Map<string, FontMetrics>()
/**
 * Distinct font strings in a scene are few. This only bounds a pathological
 * one.
 */
const FONT_METRICS_CACHE_MAX = 128

/**
 * The vertical metrics of `font`, measured once and cached.
 *
 * Falls back to a proportion of the font's px size where the platform does not
 * report `fontBoundingBox*`, which reached the spec long after
 * `actualBoundingBox*` and is still absent from some headless DOMs. An
 * unguarded read there yields `NaN`, which propagates silently into every
 * position derived from the line height.
 *
 * @example
 *   const { lineHeight } = fontMetrics(font)
 *   for (let i = 0; i < lines.length; i++) {
 *     gfx.fillText(lines[i], x, firstBaselineY + i * lineHeight, { font })
 *   }
 */
export function fontMetrics(font: string): FontMetrics {
  const hit = fontMetricsCache.get(font)
  if (hit) return hit

  const size = parseFontSizePx(font)
  let ascent = size * 0.8
  let descent = size * 0.2
  let capHeight = size * 0.7

  const shared = getSharedCtx()
  if (shared) {
    const { ctx } = shared
    ctx.font = font
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    // A capital carries the cap height in its ink ascent, and the same call
    // carries the font-wide box, so one measurement answers both.
    const m = ctx.measureText('H')
    if (isFiniteNum(m.fontBoundingBoxAscent)) ascent = m.fontBoundingBoxAscent
    if (isFiniteNum(m.fontBoundingBoxDescent))
      descent = m.fontBoundingBoxDescent
    if (isFiniteNum(m.actualBoundingBoxAscent)) {
      capHeight = m.actualBoundingBoxAscent
    }
  }

  const out: FontMetrics = {
    ascent,
    descent,
    capHeight,
    lineHeight: ascent + descent,
  }
  if (fontMetricsCache.size >= FONT_METRICS_CACHE_MAX) fontMetricsCache.clear()
  fontMetricsCache.set(font, out)
  return out
}

/**
 * Drop the memoized per-font vertical metrics.
 *
 * The metrics are keyed by font string, not by whether that font had loaded, so
 * ascent/descent measured against a fallback face survive a late webfont load.
 * Pair with `clearTextLayoutCaches()` and `Engine.invalidateText()`.
 */
export function clearFontMetricsCache(): void {
  fontMetricsCache.clear()
}

/** @deprecated Use {@link clearFontMetricsCache}. */
export const _resetFontMetricsCacheForTests = clearFontMetricsCache

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
let warnedNoContext = false

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
 * Install a stub canvas and context, or pass `null` to restore lazy
 * acquisition. Tests only: the shared canvas is module state, so this is the
 * only way to exercise `rasterizeLabel` where no real text engine exists.
 */
export function _setSharedLabelCanvasForTests(
  canvas: AnyCanvas | null,
  ctx: AnyCtx | null,
): void {
  sharedCanvas = canvas
  sharedCtx = ctx
  acquireFailed = false
}

/**
 * Measure a label's local-space box using the shared offscreen canvas. The
 * public counterpart to `measureLabel` for callers that don't have a
 * `LabelMeasureCtx` of their own (custom `Node2D`s sizing text, or `TextNode`'s
 * own `measure()`).
 *
 * @remarks
 *   Returns an all-zero box where no 2D canvas context is available, so a
 *   headless caller lays out rather than throwing. Every string then measures
 *   as zero and therefore fits, which is worth knowing when a layout assertion
 *   passes unexpectedly, so the first such call warns.
 * @example
 *   const m = measureText('Ready', {
 *     font,
 *     align: 'left',
 *     baseline: 'alphabetic',
 *     color: '#000',
 *   })
 *   gfx.fillRoundRect(
 *     x,
 *     y,
 *     m.advance + pad * 2,
 *     m.ascent + m.descent + pad * 2,
 *     r,
 *     chip,
 *   )
 */
export function measureText(text: string, style: LabelStyle): LabelMetrics {
  const shared = getSharedCtx()
  if (!shared) {
    if (!warnedNoContext) {
      warnedNoContext = true
      console.warn(
        '[stargazer] no 2D context to measure text, every string will report a zero box',
      )
    }
    return {
      localW: 0,
      localH: 0,
      advance: 0,
      ascent: 0,
      descent: 0,
      anchorOffsetX: 0,
      anchorOffsetY: 0,
    }
  }
  return measureLabel(shared.ctx, text, style)
}

/**
 * Rasterize `text` at `deviceScale` device px per local px. Returns `null` if
 * no 2D canvas context is available (e.g. headless without a canvas polyfill),
 * in which case the caller draws nothing.
 *
 * Two details here decide how sharp the result is on screen.
 *
 * The pen is placed on a whole device texel. Canvas2D reports the ink box as
 * floats, so drawing at the raw offset puts every baseline and stem across a
 * texel boundary, where the rasterizer greys it out. That blur is baked into
 * the bitmap and no amount of snapping at draw time recovers it.
 *
 * The returned `localW`/`localH` are the texture's own size in local px rather
 * than the measured box. `Gfx2D.fillText` builds its quad from them, so when
 * the device scale matches the raster scale the quad covers exactly `texW ×
 * texH` device px and the blit is 1:1. Reporting the fractional measured box
 * instead leaves the two grids permanently out of step.
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
  const penX = Math.round(met.anchorOffsetX * eff)
  const penY = Math.round(met.anchorOffsetY * eff)
  // One texel of headroom: moving the pen to the grid shifts the ink by up to
  // half a texel, which the `LABEL_PAD` border only absorbs while the label is
  // not heavily minified.
  const texW = Math.max(1, Math.ceil(met.localW * eff) + 1)
  const texH = Math.max(1, Math.ceil(met.localH * eff) + 1)

  // Assigning width or height resets the context, including its transform, so
  // everything below has to be set after and nothing needs clearing first.
  canvas.width = texW
  canvas.height = texH
  ctx.setTransform(eff, 0, 0, eff, penX, penY)
  ctx.font = style.font
  ctx.textAlign = style.align
  ctx.textBaseline = style.baseline
  ctx.fillStyle = style.color
  ctx.fillText(text, 0, 0)

  return {
    canvas,
    texW,
    texH,
    clamped: eff < Math.max(deviceScale, 1e-3) - 1e-9,
    localW: texW / eff,
    localH: texH / eff,
    advance: met.advance,
    ascent: met.ascent,
    descent: met.descent,
    anchorOffsetX: penX / eff,
    anchorOffsetY: penY / eff,
  }
}
