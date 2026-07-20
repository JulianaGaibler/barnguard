/**
 * `Gfx2D`, the renderer-agnostic drawing facade. The backend is `GpuGfx`
 * (WebGL2). `Canvas2DGfx` implements the same facade as a visual-parity oracle
 * for debugging and as the `?renderer=canvas2d` opt-out.
 *
 * Conventions:
 *
 * - Style passes per call, no sticky state. Cleaner batching, matches Canvas.
 * - `setAlpha` is absolute (`globalAlpha` semantics). Stage sets a per-node
 *   baseline before `draw`, nodes may overwrite.
 * - Stroke width and dash are pre-resolved to the current transform space by the
 *   caller (e.g. `lineWidth * camera.strokeSpaceScale()`).
 * - `fillPath2D` / `strokePath2D` are escape hatches for SVG geometry. GPU
 *   requires a pre-registered tessellation from `PathTessellationRegistry`.
 */

import type { BitmapMask } from '../../assets/BitmapMask'

/**
 * Compositing mode. Maps to `ctx.globalCompositeOperation`. The GPU backend
 * implements `'source-over'` and `'lighter'`; the Canvas backend accepts the
 * full set.
 *
 * @category Advanced
 */
export type GfxBlend = GlobalCompositeOperation

/**
 * A single radial/linear gradient stop. `offset` in `[0, 1]`.
 *
 * @category Advanced
 */
export interface GfxGradientStop {
  offset: number
  color: string
}

/**
 * Per-call text style for `fillText`. Mirrors the Canvas text properties.
 *
 * On the GPU backend `color` is baked into the rasterized glyph bitmap (so
 * multi-color emoji and any CSS color render correctly); `setAlpha` still
 * applies on top via the quad tint. Because the color is baked, animating
 * `color` re-rasterizes each frame it changes — prefer alpha fades (free) or a
 * static color.
 *
 * @category Advanced
 */
export interface GfxTextStyle {
  /**
   * CSS font shorthand, e.g. `700 40px "Inter", sans-serif`. Default `10px
   * sans-serif`.
   */
  font?: string
  /** Horizontal anchor for `(x, y)`. Default `'left'`. */
  align?: CanvasTextAlign
  /** Vertical anchor for `(x, y)`. Default `'alphabetic'`. */
  baseline?: CanvasTextBaseline
  /** CSS color, baked into the bitmap. Default `'#000'`. */
  color?: string
}

/**
 * Per-call stroke style. Everything is resolved to the current transform space
 * by the caller (see the `width`/`dash` note on `Gfx2D`).
 *
 * @category Advanced
 */
export interface GfxStrokeStyle {
  /** CSS color string. */
  color: string
  /** Width in the current transform space (what `ctx.lineWidth` expects). */
  width: number
  /** Line cap. Default `'butt'`. */
  cap?: CanvasLineCap
  /** Line join. Default `'miter'`. */
  join?: CanvasLineJoin
  /** Dash pattern in the current transform space. Omit/empty = solid. */
  dash?: readonly number[]
  /** `strokePolyline` only, midpoint smoothing mode. Default `'none'`. */
  smoothing?: 'none' | 'quadratic'
  /** `strokePolyline` only, close the path back to the first point. */
  closed?: boolean
}

/**
 * Immediate-mode 2D drawing facade. Coordinates are in the node's LOCAL space;
 * the Stage installs the `(DPR × camera × world)` base transform via
 * `setBaseTransform` before calling `draw`, and nodes may push nested local
 * transforms with `save`/`translate`/`rotate`/`scale`/`restore`.
 *
 * @category Advanced
 */
export interface Gfx2D {
  // --- transform + state ---------------------------------------------------

  /**
   * Install the absolute base transform for the node about to draw (the
   * 6-element 2D affine `a,b,c,d,e,f`). Replaces the current transform, like
   * `ctx.setTransform`. Called by the Stage once per node.
   */
  setBaseTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void

  /** Push the current transform + alpha + blend onto a stack. */
  save(): void
  /** Restore the transform + alpha + blend saved by the matching `save`. */
  restore(): void

  /** Post-multiply a translation onto the current transform. */
  translate(x: number, y: number): void
  /** Post-multiply a rotation (radians) onto the current transform. */
  rotate(rad: number): void
  /** Post-multiply a scale onto the current transform. */
  scale(sx: number, sy: number): void

  /** Set the absolute draw alpha in `[0, 1]` (like `ctx.globalAlpha`). */
  setAlpha(alpha: number): void
  /** Set the compositing mode for subsequent draws. */
  setBlend(mode: GfxBlend): void
  /**
   * Set or clear a bitmap clip mask. `fill*` draws are masked to pixels where
   * the mask's alpha is non-zero. `worldRect` maps mask UV to world.
   * Snapshotted by `save`/`restore`.
   *
   * GPU: uploads mask as texture (cached per instance), modulates fragment
   * alpha. Currently only wired through the `coloredTri` program. Canvas2D:
   * no-op. GridOverlayNode is the only user and runs on GPU.
   */
  setClipMask(mask: BitmapMask | null): void

  // --- fills ---------------------------------------------------------------

  /** Filled axis-aligned rectangle. */
  fillRect(x: number, y: number, w: number, h: number, color: string): void
  /** Filled circle. */
  fillCircle(cx: number, cy: number, r: number, color: string): void
  /**
   * Filled convex polygon from interleaved `[x0,y0,x1,y1,…]` points. `count` is
   * the number of POINTS (so `pts` holds `2*count` numbers). Closes
   * automatically.
   */
  fillConvexPoly(pts: ArrayLike<number>, count: number, color: string): void
  /** Fill an opaque `Path2D` (SVG-derived geometry). */
  fillPath2D(path: Path2D, color: string): void
  /**
   * Filled circle whose interior is a radial gradient from centre (`offset 0`)
   * to rim (`offset 1`).
   */
  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: readonly GfxGradientStop[],
  ): void
  /**
   * Fill the rect `(dx,dy,dw,dh)` with a **world-fixed** radial gradient
   * (centered at `gcx,gcy` with radius `gr`, `stops` sampled by distance),
   * masked by the alpha of `mask` sampled across the rect. Moving the rect
   * slides the mask silhouette across the stationary gradient — used for the
   * arcade launcher's drifting clouds. Coordinates are in the current transform
   * space (like `drawImage` / `fillCircleRadialGradient`); the transform must
   * be axis-aligned.
   */
  fillMaskedRadialGradient(
    mask: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    gcx: number,
    gcy: number,
    gr: number,
    stops: readonly GfxGradientStop[],
  ): void
  /**
   * Filled polygon (interleaved points, auto-closed) whose interior is a 2-stop
   * linear gradient from `(x0,y0)`→`colorStart` to `(x1,y1)`→`colorEnd`. Used
   * for gradient-filled ribbons such as a motion trail.
   */
  fillPolyLinearGradient(
    pts: ArrayLike<number>,
    count: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorStart: string,
    colorEnd: string,
  ): void

  // --- strokes -------------------------------------------------------------

  /** Stroked circle (supports `dash` for the epicenter capture ring). */
  strokeCircle(cx: number, cy: number, r: number, style: GfxStrokeStyle): void
  /** Stroked straight segment. */
  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void
  /** Stroked quadratic Bézier segment (control `cx,cy`). */
  strokeQuadratic(
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void
  /**
   * Stroked polyline from interleaved points. `style.smoothing === 'quadratic'`
   * reproduces `PolylineNode`'s midpoint smoothing; `style.closed` closes it.
   */
  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void
  /** Stroke an opaque `Path2D`. */
  strokePath2D(path: Path2D, style: GfxStrokeStyle): void

  // --- images --------------------------------------------------------------

  /** Draw an image (particle sprite / baked bitmap) at `dst` rect. */
  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void

  // --- text ----------------------------------------------------------------

  /**
   * Draw a single line of text with its anchor at `(x, y)` (interpreted per
   * `style.align` / `style.baseline`), in the node's LOCAL space. No wrapping.
   *
   * Both backends use the platform text engine (Canvas2D `fillText`) for
   * correct shaping, kerning, ligatures, and emoji. The GPU backend rasterizes
   * the string to a cached texture at device-pixel resolution derived from the
   * live transform, so text stays crisp and cheap under rotation and zoom (see
   * `GfxTextStyle` for the color-animation caveat).
   */
  fillText(text: string, x: number, y: number, style?: GfxTextStyle): void
}
