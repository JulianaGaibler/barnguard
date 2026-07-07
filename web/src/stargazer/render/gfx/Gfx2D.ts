/**
 * `Gfx2D`, the renderer-agnostic drawing facade scene nodes draw through.
 *
 * Two backends implement it:
 *
 * - `GpuGfx`. WebGL2, default. Batches calls into a small set of programs and
 *   flushes through a `GfxDevice`.
 * - `Canvas2DGfx`, wraps a `CanvasRenderingContext2D`. Kept as the visual parity
 *   oracle, the tutorial mini-stage fallback (avoids the WebGL2
 *   context-acquisition jank on state-tap), and the `?renderer=canvas2d`
 *   opt-out.
 *
 * Surface conventions:
 *
 * - **Style is passed per call**, not held as sticky state, cleaner batching
 *   contract for the GPU backend, faithful to Canvas's per-call
 *   `fillStyle`/`lineWidth` assignments.
 * - **`setAlpha` is absolute** (Canvas `globalAlpha` semantics). Stage sets the
 *   per-node baseline before `draw`; nodes may overwrite.
 * - **Stroke `width` / `dash` are pre-resolved** to the current transform space
 *   by the caller (e.g. `lineWidth * camera.strokeSpaceScale()`).
 * - **`fillPath2D` / `strokePath2D`** are escape hatches for SVG-derived geometry
 *   (map, hand, eye). Canvas draws them natively; GPU consumes a pre-registered
 *   tessellation from `PathTessellationRegistry`.
 */

import type { BitmapMask } from '../../assets/BitmapMask'

/**
 * Compositing mode. Maps to `ctx.globalCompositeOperation`. The Canvas backend
 * supports the full set; the GPU backend implements the subset the game uses
 * (`'source-over'`, `'lighter'`).
 */
export type GfxBlend = GlobalCompositeOperation

/** A single radial/linear gradient stop. `offset` in `[0, 1]`. */
export interface GfxGradientStop {
  offset: number
  color: string
}

/**
 * Per-call stroke style. Everything is resolved to the current transform space
 * by the caller (see the `width`/`dash` note on `Gfx2D`).
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
   * Set (or clear) a bitmap clip mask. When set, subsequent `fill*` draws are
   * masked to pixels where the mask's alpha channel is non-zero, the mask's
   * `worldRect` maps mask UV space to world coordinates. Pass `null` to clear.
   *
   * State is snapshotted by `save`/`restore` (same semantics as `setAlpha` /
   * `setBlend`), so nodes can push a mask inside a save-scope without an
   * explicit unset.
   *
   * Backend notes:
   *
   * - GPU: uploads the mask as a texture (cached per mask instance) and modulates
   *   fragment output by the sampled mask alpha. MSAA-friendly. Currently
   *   plumbed through the `coloredTri` program only, masking the
   *   stroke/SDF/gradient programs would need their own uniform.
   * - Canvas2D: no-op today. The only in-tree user (`GridOverlayNode`) runs on
   *   the GPU stage; if a Canvas2D consumer needs real clipping later, swap in
   *   `ctx.save(); ctx.clip(mask.path); ...; ctx.restore()`.
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
   * Filled polygon (interleaved points, auto-closed) whose interior is a 2-stop
   * linear gradient from `(x0,y0)`→`colorStart` to `(x1,y1)`→`colorEnd`. Used
   * for the packet motion-trail ribbon.
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
}
