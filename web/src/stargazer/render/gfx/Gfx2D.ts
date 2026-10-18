/**
 * `Gfx2D`, the drawing facade nodes draw through. The backend is `GpuGfx`,
 * which batches draws through the `GfxDevice` seam. WebGL2 and WebGPU both
 * implement that seam, so facade-level code is backend-agnostic.
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
import type { RoundRectRadii } from './roundRectRadii'
import type { StrokeAlign } from './strokeOutline'
import type { ShaderQuad } from './ShaderQuad'
import type { GfxPath } from './GfxPath'
import type { FillRule } from './stencilRecipe'
import type { PostEffect } from '../postfx/PostEffect'

/**
 * Compositing mode. Maps to `ctx.globalCompositeOperation`. The GPU backend
 * implements `'source-over'` and `'lighter'`.
 */
export type GfxBlend = GlobalCompositeOperation

/**
 * An analytic clip region for {@link Gfx2D.setClip}, in the current transform's
 * local coords. A rounded rect's corners are `radii`, in the CSS shorthand of
 * {@link Gfx2D.fillRoundRect}, or one `radius` for all four.
 */
export type GfxClipShape =
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | {
      kind: 'roundRect'
      x: number
      y: number
      w: number
      h: number
      radius?: number
      radii?: RoundRectRadii
    }

/** How a matte surface scales the content it is composited with. */
export type GfxMatteMode = 'alpha' | 'inverted-alpha' | 'luma' | 'inverted-luma'

/** A finished offscreen surface, valid until the end of the frame. */
export interface GfxOffscreenHandle {
  readonly __gfxOffscreen: unique symbol
}

/**
 * What a layer hands the renderer to decide whether its last processed render
 * still stands.
 *
 * @remarks
 *   Engine developers: the caller builds `signature` each frame, a list of every
 *   value the subtree's output depends on. The renderer keeps the last render
 *   and the signature it was made from. When the next frame's signature is
 *   equal, the region is the same, and the effects write the same parameters,
 *   it composites the kept render and sets `hit`, and the caller skips drawing
 *   the subtree.
 */
export interface GfxSurfaceCache {
  /** The values describing what the subtree would draw. */
  signature: Float64Array
  /** How many values of `signature` are in use. */
  length: number
  /** Set to drop the kept render, which the renderer clears after using it. */
  invalidated: boolean
  /**
   * Output. True when the kept render stands and was composited, so the subtree
   * must not be drawn.
   */
  hit: boolean
}

/**
 * Post-processing effects to run over an offscreen surface before it is
 * composited, and where to report whether they ran.
 *
 * @remarks
 *   Engine developers: `owner` keys the state that has to outlive a frame (the
 *   effects' params buffers and accumulated time), so pass the same object
 *   every frame. `effects` is read each frame, so the list and the effects can
 *   change freely. The renderer sets `applied` when it opens the surface.
 */
export interface GfxSurfaceEffects {
  /** What the per-owner state is kept under. */
  readonly owner: object
  /**
   * Keep the processed result between frames, and draw it again without drawing
   * the subtree while it still stands.
   */
  cache?: GfxSurfaceCache
  /** The effects to run, in order. Disabled ones are skipped. */
  effects: readonly PostEffect[]
  /** Seconds since the last frame, for effects that animate. */
  dt: number
  /**
   * The owner's local space in device pixels, as an affine matrix in the layout
   * of `Affine2x3`. Passes read it through their context's `source`, to size a
   * pattern in the owner's units and to anchor it to the owner's origin. Left
   * out, a unit is one device pixel and the origin is the surface's corner.
   */
  units?: { a: number; b: number; c: number; d: number; e: number; f: number }
  /**
   * Output. True when the surface will have the effects applied, false while a
   * pass is still compiling and the surface composites unprocessed.
   */
  applied: boolean
}

/** Options for {@link Gfx2D.beginOffscreen}. */
export interface GfxOffscreenOptions {
  /**
   * The region to capture, in the current local space. Default the whole
   * target.
   */
  bounds?: { x: number; y: number; width: number; height: number }
  /** Opacity of the composite. Default 1. */
  opacity?: number
  /** Blend mode of the composite. Default the current blend. */
  blend?: GfxBlend
  /**
   * A retained surface to use as a track matte. It must have been captured with
   * the same bounds as this one, or it is ignored.
   */
  matte?: GfxOffscreenHandle
  /** How the matte scales the content. Default `'alpha'`. */
  matteMode?: GfxMatteMode
  /** Keep the surface instead of compositing it. */
  retain?: boolean
  /**
   * Run these effects over the surface before it composites. The surface is
   * allocated at exactly the captured size, so the effects measure the region
   * itself, and the effects run in a pass of their own before the main pass.
   * Ignored with `retain`.
   */
  effects?: GfxSurfaceEffects
  /**
   * The color the surface is cleared to, as CSS. Default transparent. A surface
   * with effects sees this color too, so it takes part in a blur.
   */
  clearColor?: string
}

/** A single radial/linear gradient stop. `offset` in `[0, 1]`. */
export interface GfxGradientStop {
  offset: number
  color: string
}

/**
 * A linear gradient paint for a fill or a border. The axis runs from `(x0, y0)`
 * to `(x1, y1)` in the current transform's local space; a point on that line
 * reads `stops[0]`, a point past the far end reads the last stop, same as CSS
 * `linear-gradient`'s clamped ends.
 *
 * @example
 *   gfx.fillRect(0, 0, 200, 80, {
 *     kind: 'linear',
 *     x0: 0,
 *     y0: 0,
 *     x1: 0,
 *     y1: 80,
 *     stops: [
 *       { offset: 0, color: '#1d1d2b' },
 *       { offset: 1, color: '#3a2d5c' },
 *     ],
 *   })
 */
export interface GfxLinearGradient {
  kind: 'linear'
  x0: number
  y0: number
  x1: number
  y1: number
  stops: readonly GfxGradientStop[]
}

/**
 * A radial gradient paint. Stop offset 0 is at the focal point and offset 1 is
 * on the circle of radius `r` around `(cx, cy)`, in the current transform's
 * local space. Without `fx` and `fy` the focal point is the center, which gives
 * the usual concentric rings. A focal point inside the circle shifts the rings
 * toward it. A focal point on or outside the circle is pulled just inside.
 *
 * @remarks
 *   Engine developers: the shader solves for the circle through the point whose
 *   center slides from the focal point to `(cx, cy)` while its radius grows
 *   from 0 to `r`. It assumes the transform scales both axes alike, and a
 *   skewed or non-uniformly scaled transform distorts the rings.
 * @example
 *   gfx.fillCircle(100, 100, 80, {
 *     kind: 'radial',
 *     cx: 100,
 *     cy: 100,
 *     r: 80,
 *     fx: 70,
 *     fy: 70,
 *     stops: [
 *       { offset: 0, color: '#ffffff' },
 *       { offset: 1, color: '#2255ff' },
 *     ],
 *   })
 */
export interface GfxRadialGradient {
  kind: 'radial'
  cx: number
  cy: number
  r: number
  fx?: number
  fy?: number
  stops: readonly GfxGradientStop[]
}

/**
 * Anything that can fill a shape beyond a flat color: a linear or a radial
 * gradient. Declared as its own union rather than folded directly into
 * {@link GfxFill}.
 */
export type GfxPaint = GfxLinearGradient | GfxRadialGradient

/** Anything that can fill or stroke a shape: a CSS color, or a {@link GfxPaint}. */
export type GfxFill = string | GfxPaint

/**
 * Per-call text style for `fillText`. Mirrors the Canvas text properties.
 *
 * On the GPU backend `color` is baked into the rasterized glyph bitmap (so
 * multi-color emoji and any CSS color render correctly). `setAlpha` still
 * applies on top via the quad tint. Because the color is baked, animating
 * `color` re-rasterizes each frame it changes, so prefer alpha fades (free) or
 * a static color.
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
 */
export interface GfxStrokeStyle {
  /** CSS color, or a gradient paint. */
  color: GfxFill
  /** Width in the current transform space (what `ctx.lineWidth` expects). */
  width: number
  /**
   * Line cap. Default `'butt'`.
   *
   * @remarks
   *   Only the outline path (see {@link GfxStrokeStyle.align} /
   *   {@link GfxStrokeStyle.exactJoins}) honours this. The default segment
   *   stroker draws every cap round, unconditionally, whatever this says.
   */
  cap?: CanvasLineCap
  /**
   * Line join. Default `'miter'`.
   *
   * @remarks
   *   Only the outline path honours this (see {@link GfxStrokeStyle.cap}'s
   *   remark). The default segment stroker emits no join geometry at all: a
   *   `'miter'` request (the default) draws no join, relying on adjacent
   *   segment quads to cover a gentle corner.
   */
  join?: CanvasLineJoin
  /** Dash pattern in the current transform space. Omit/empty = solid. */
  dash?: readonly number[]
  /**
   * Distance into the dash pattern where the stroke starts, in the same units
   * as `dash`. May be negative. Honored by `strokePath`, which cuts dashes of
   * any pattern length. The other stroke calls use the first `[on, off]` pair
   * and ignore the offset.
   */
  dashOffset?: number
  /** `strokePolyline` only, midpoint smoothing mode. Default `'none'`. */
  smoothing?: 'none' | 'quadratic'
  /** `strokePolyline` only, close the path back to the first point. */
  closed?: boolean
  /**
   * Border position relative to the path. Default `'center'`.
   *
   * @remarks
   *   A non-center value routes the stroke through the outline tessellator (see
   *   {@link GfxStrokeStyle.exactJoins}), which is a filled shape with exact
   *   joins and no overlapping geometry, rather than the default per-segment
   *   stroker. Needs a closed path with a well-defined winding; on an open
   *   contour or a zero-area closed one it falls back to `'center'` with a
   *   one-time console warning.
   * @example
   *   gfx.strokeRoundRect(0, 0, 240, 140, 16, {
   *     color: '#1d1d2b',
   *     width: 3,
   *     align: 'outside',
   *   })
   */
  align?: StrokeAlign
  /**
   * Opt into the outline tessellator for a centered stroke, to get exact joins
   * and caps (honouring {@link GfxStrokeStyle.cap} / {@link GfxStrokeStyle.join})
   * instead of the default per-segment stroker's round caps and join-free
   * corners. Default `false`.
   */
  exactJoins?: boolean
  /**
   * Miter length limit before falling back to a bevel, as a multiple of the
   * stroke's half-width. Only read on the outline path. Default `4` (SVG's
   * `stroke-miterlimit` default, not `CanvasRenderingContext2D.miterLimit`'s
   * default of `10`).
   */
  miterLimit?: number
}

/**
 * A {@link GfxStrokeStyle} whose color has been confirmed to be a flat CSS
 * color, never a gradient. The segment stroker (`programs/stroke.ts`) has no
 * paint slot, so it can only ever draw this narrowed style; the routing
 * decision that produces one lives in `GpuGfx`.
 */
export type SolidStrokeStyle = GfxStrokeStyle & { color: string }

/**
 * A CSS `box-shadow`-like drop shadow. A rect, rounded rect, or circle (via
 * `ShapeNode`) draws this analytically, no render target. An arbitrary path
 * (via `Path2DNode`) draws it from a cached blurred-coverage mask instead: see
 * the path-shadows guide for what that costs and what is free to animate.
 *
 * @example
 *   gfx.shadowRoundRect(0, 0, 240, 140, 16, {
 *     color: 'rgba(20, 16, 40, 0.35)',
 *     offsetY: 8,
 *     blur: 32,
 *   })
 *   gfx.fillRoundRect(0, 0, 240, 140, 16, '#1c1c22')
 */
export interface GfxShadowStyle {
  /** CSS color. A gradient shadow is a follow-up: see the open-points list. */
  color: string
  /** Offset, in the same space as `lineWidth` (see `strokeSpace`). Default 0. */
  offsetX?: number
  offsetY?: number
  /** CSS `box-shadow` blur. Sigma is half this. Default 0. */
  blur?: number
  /** Grow (or shrink, when negative) the shadow shape. Default 0. */
  spread?: number
  /** Draw inside the shape instead of behind it. Default false. */
  inset?: boolean
}

/**
 * Immediate-mode 2D drawing facade. Coordinates are in the node's LOCAL space.
 * The Stage installs the `(DPR × camera × world)` base transform via
 * `setBaseTransform` before calling `draw`, and nodes may push nested local
 * transforms with `save`/`translate`/`rotate`/`scale`/`restore`.
 */
/** Options for {@link Gfx2D.drawImage}. */
export interface GfxImageOptions {
  /** Filter when scaling. Defaults to `true`. */
  smoothing?: boolean
}

export interface Gfx2D {
  // --- transform + state ---------------------------------------------------

  /**
   * Name the recorded call about to be replayed, or `null` once it is done. The
   * token stays the same object while the recording is unchanged, so the
   * renderer can keep what it builds for the call between frames.
   *
   * @internal
   */
  replaySource?(token: object | null): void

  /**
   * Vertex and instance bytes streamed to the GPU so far this frame.
   *
   * @internal
   */
  streamedBytes?(): number

  /**
   * Install the absolute base transform for the node about to draw (the
   * 6-element 2D affine `a,b,c,d,e,f`). Replaces the current transform, like
   * `ctx.setTransform`. Called by the Stage once per node. Inside an offscreen
   * surface the matrix is still in target pixels, and the surface's origin is
   * taken off.
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
  /**
   * Post-multiply an arbitrary 2D affine matrix onto the current transform. The
   * six values are the `a, b, c, d, e, f` of a `DOMMatrix`: a point maps to
   * `(a*x + c*y + e, b*x + d*y + f)`. Use it for skew and for matrices that
   * come from outside the engine.
   */
  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void

  /** Set the absolute draw alpha in `[0, 1]` (like `ctx.globalAlpha`). */
  setAlpha(alpha: number): void
  /**
   * The draw alpha in effect now. The compose walk sets it to the node's own
   * alpha times its ancestors' before each `draw`, so a draw that sets an
   * opacity of its own multiplies this in instead of replacing it.
   */
  getAlpha(): number
  /**
   * Set the compositing mode for subsequent draws. `'source-over'` and
   * `'lighter'` (additive) are supported. Any other value draws as
   * `'source-over'` and warns once per mode.
   */
  setBlend(mode: GfxBlend): void
  /**
   * Set or clear a bitmap clip mask for an arbitrary shape. `fill*` draws are
   * masked to pixels where the mask's alpha is non-zero, `worldRect` maps mask
   * UV to world. Snapshotted by `save`/`restore`.
   *
   * For a circle or rounded-rect prefer {@link Gfx2D.setClip} (analytic, no
   * texture). Uploads the mask as a texture (cached per instance) and modulates
   * fragment alpha, only the `coloredTri` program (fills) reads it.
   */
  setClipMask(mask: BitmapMask | null): void

  /**
   * Set or clear an analytic clip. Subsequent 2D draws (fills, strokes, text,
   * images) are cropped to the shape with a crisp anti-aliased edge, with no
   * texture or CPU raster. Coords are in the current transform's local space,
   * snapshotted to device px when set, so the clip composes with
   * `save`/`translate`/`scale`. Snapshotted by `save`/`restore`, clear with
   * `null`.
   *
   * @remarks
   *   A circle is rotation-safe. A rounded-rect assumes an axis-aligned
   *   transform. For an arbitrary shape use {@link Gfx2D.setClipMask}.
   * @example
   *   gfx.save()
   *   gfx.setClip({ kind: 'circle', cx, cy, r })
   *   for (const px of pixels) gfx.fillRect(px.x, px.y, px.w, px.h, px.color)
   *   gfx.restore() // The clip reverts.
   */
  setClip(shape: GfxClipShape | null): void

  // --- device pixel grid ----------------------------------------------------

  /**
   * Device pixels per unit of the current transform, camera scale and device
   * pixel ratio included. Returns `1` when there is no transform to read.
   *
   * Prefer {@link Gfx2D.snapSize} for the common case of holding a length on the
   * pixel grid.
   */
  deviceScale(): number

  /**
   * Round `v` to a whole number of device pixels, in local units.
   *
   * Quantise sizes, not positions. Equal-sized repeated cells lose the
   * neighbour-to-neighbour width variance that reads as aliasing, and the block
   * keeps one shared subpixel offset so it still slides smoothly. Rounding the
   * position too is crisper at rest but crawls under continuous motion, because
   * each edge crosses its threshold on a different frame.
   *
   * Never returns less than one device pixel. Passes `v` through unchanged when
   * the device scale is unknown.
   *
   * @example
   *   // A 16x16 pixel-art grid whose cells stay equal at any zoom.
   *   const cell = gfx.snapSize(box.width / 16)
   *   for (const run of runs) {
   *     gfx.fillRect(
   *       originX + run.x * cell,
   *       originY + run.row * cell,
   *       run.len * cell,
   *       cell,
   *       run.color,
   *     )
   *   }
   */
  snapSize(v: number): number

  // --- fills ---------------------------------------------------------------

  /** Filled axis-aligned rectangle. `fill` is a CSS color or a gradient paint. */
  fillRect(x: number, y: number, w: number, h: number, fill: GfxFill): void

  /**
   * Filled axis-aligned rounded rectangle. `radii` is the CSS `border-radius`
   * shorthand: a single number, or 1 to 4 numbers (`[all]`, `[tl&br, tr&bl]`,
   * `[tl, tr&bl, br]`, `[tl, tr, br, bl]`). Over-large radii are clamped
   * proportionally, matching `CanvasRenderingContext2D.roundRect`. `fill` is a
   * CSS color or a gradient paint.
   *
   * `smoothing` is Figma's corner smoothing, from 0 for circular corners (the
   * default) to 1. {@link IOS_CORNER_SMOOTHING} matches the iOS app icon shape.
   * With smoothing, radii that don't fit are fitted the way Figma does (see
   * {@link fitSquircleCorners}) instead of by the CSS rule.
   *
   * @example
   *   gfx.fillRoundRect(0, 0, 480, 320, 24, '#1c1c22') // uniform corners
   *   gfx.fillRoundRect(0, 0, 200, 40, 20, '#8f74e7') // radius ≥ h/2 -> capsule
   *   gfx.fillRoundRect(0, 0, w, h, [0, 32, 0, 0], fill) // only top-right rounded
   *   gfx.fillRoundRect(0, 0, 120, 120, 27, '#fff', 0.6) // an iOS icon shape
   */
  fillRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    fill: GfxFill,
    smoothing?: number,
  ): void

  /**
   * Stroked axis-aligned rounded rectangle. The stroke straddles the edge (half
   * inside, half out), like `CanvasRenderingContext2D.stroke`. `radii` and
   * `smoothing` are as for {@link Gfx2D.fillRoundRect}.
   */
  strokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    style: GfxStrokeStyle,
    smoothing?: number,
  ): void
  /**
   * `fillRoundRect` + `strokeRoundRect` in one call: both paint into the same
   * instance record, so a translucent stroke's antialiased edge composites
   * against the fill in one fragment instead of double-blending against a
   * separately drawn one underneath it. Prefer this over calling both
   * separately whenever a shape has both.
   */
  fillAndStrokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    fill: GfxFill,
    style: GfxStrokeStyle,
    smoothing?: number,
  ): void
  /** Filled circle. `fill` is a CSS color or a gradient paint. */
  fillCircle(cx: number, cy: number, r: number, fill: GfxFill): void
  /**
   * `fillCircle` + `strokeCircle` in one call. See
   * {@link Gfx2D.fillAndStrokeRoundRect}.
   */
  fillAndStrokeCircle(
    cx: number,
    cy: number,
    r: number,
    fill: GfxFill,
    style: GfxStrokeStyle,
  ): void
  /**
   * Filled axis-aligned ellipse centered on `cx`, `cy` with radii `rx`, `ry`.
   * `fill` is a CSS color or a gradient paint. A rotated ellipse is drawn under
   * a rotated transform.
   *
   * @example
   *   gfx.fillEllipse(100, 60, 80, 40, '#8f74e7')
   */
  fillEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: GfxFill,
  ): void
  /**
   * Stroked ellipse. `style.align` places the stroke inside, centered on, or
   * outside the outline, as for {@link Gfx2D.strokeRoundRect}.
   */
  strokeEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    style: GfxStrokeStyle,
  ): void
  /**
   * `fillEllipse` + `strokeEllipse` in one call. See
   * {@link Gfx2D.fillAndStrokeRoundRect}.
   */
  fillAndStrokeEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: GfxFill,
    style: GfxStrokeStyle,
  ): void
  /**
   * Filled convex polygon from interleaved `[x0,y0,x1,y1,…]` points. `count` is
   * the number of POINTS (so `pts` holds `2*count` numbers). Closes
   * automatically. `fill` is a CSS color or a gradient paint.
   */
  fillConvexPoly(pts: ArrayLike<number>, count: number, fill: GfxFill): void
  /**
   * Fill an opaque `Path2D` (SVG-derived geometry). `fill` is a CSS color or a
   * gradient paint; a gradient fill always takes the slower streamed path (see
   * {@link Gfx2D.fillPath2D}'s guide entry), never the retained one a solid
   * color on a registered path can.
   */
  fillPath2D(path: Path2D, fill: GfxFill): void
  /**
   * Fill a {@link GfxPath}. `rule` is `'nonzero'` (default) or `'evenodd'`, the
   * same as Canvas 2D. Self-overlapping outlines and holes follow the rule.
   * `fill` is a CSS color or a gradient paint.
   *
   * Needs a stencil buffer (the stage's main surface has one). On a surface
   * without one the path fills even-odd and warns once. Unlike `fillPath2D`,
   * the path may change between frames.
   *
   * @example
   *   gfx.fillPath(star, '#f5c542', 'evenodd')
   */
  fillPath(path: GfxPath, fill: GfxFill, rule?: FillRule): void
  /**
   * Start drawing into an offscreen surface covering `opts.bounds` (a rectangle
   * in the current local space, or the whole target). Everything drawn until
   * {@link Gfx2D.endOffscreen} goes into the surface, which then composites into
   * the enclosing target as one unit with `opacity`, `blend` and optionally a
   * track matte. Returns `false` when the bounds fall outside the target or
   * offscreen surfaces are unavailable, in which case nothing was started and
   * the caller should skip the content or draw it directly.
   *
   * @remarks
   *   The surface has the main target's format and starts from a clean state:
   *   alpha 1, normal blend, no clip. Clips set inside do not leak out.
   *
   *   Engine developers: surfaces are pooled and claimed for one frame. Every
   *   surface renders in a pass of its own before the main pass, nested
   *   surfaces before the surface that contains them, and composites replay in
   *   painter order.
   */
  beginOffscreen(opts?: GfxOffscreenOptions): boolean
  /**
   * Finish the surface started by the matching {@link Gfx2D.beginOffscreen}.
   * Composites it into the enclosing target, or with `retain: true` returns a
   * handle without compositing. A handle works until the end of the frame.
   */
  endOffscreen(): GfxOffscreenHandle | null
  /**
   * Compile the pipelines `fx` needs ahead of time, so the first frame that
   * uses them is not composited unprocessed. Call it while a stall is masked.
   * Idempotent, an already compiled pass is skipped.
   */
  warmEffects(fx: GfxSurfaceEffects): void
  /**
   * Composite a retained surface into the current target, with an opacity, a
   * blend, and optionally a matte captured over the same bounds.
   */
  drawOffscreen(
    handle: GfxOffscreenHandle,
    opts?: {
      opacity?: number
      blend?: GfxBlend
      matte?: GfxOffscreenHandle
      matteMode?: GfxMatteMode
    },
  ): void
  /**
   * Intersect the clip with the inside of a {@link GfxPath}, by the fill `rule`
   * (default `'nonzero'`). Everything drawn afterwards is limited to the clip
   * until the enclosing `restore()`, which undoes it. Clips nest, each one
   * narrowing the last, up to 7 deep. A deeper one is ignored with a warning.
   *
   * The clip is exact per pixel under any transform, unlike
   * {@link Gfx2D.setClip}, and it combines with it. It needs a stencil buffer
   * and is ignored without one. `drawShaderQuad` does not respect it.
   *
   * @example
   *   gfx.save()
   *   gfx.clipPath(blob)
   *   gfx.fillRect(0, 0, 400, 400, '#7cc4ff') // only the part inside `blob`
   *   gfx.restore()
   */
  clipPath(path: GfxPath, rule?: FillRule): void
  /**
   * Stroke a {@link GfxPath}, one polyline per contour. A contour closed with
   * `close()` is stroked closed. A `dash` pattern of any length is cut on the
   * CPU, starting `dashOffset` into the pattern, and each dash is stroked with
   * the style's caps.
   */
  strokePath(path: GfxPath, style: GfxStrokeStyle): void
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
   * slides the mask silhouette across the stationary gradient, used for the
   * arcade launcher's drifting clouds. Coordinates are in the current transform
   * space (like `drawImage` / `fillCircleRadialGradient`). The transform must
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
   * linear gradient from `(x0,y0)`->`colorStart` to `(x1,y1)`->`colorEnd`. Used
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

  /**
   * Draw `quad`'s shader over the local rectangle `(x, y, w, h)`. The shader
   * sees the rectangle as `uv` in `0..1` and decides every pixel, so one draw
   * can cover what would otherwise be thousands of shapes.
   *
   * The current transform (rotation included), `setAlpha`, `setBlend` and the
   * analytic `setClip` apply. `setClipMask` does not, so a shader that needs a
   * bitmap outline samples it itself. Each call snapshots `quad.params`.
   *
   * Nothing draws on the frames before the quad's pipelines finish compiling.
   *
   * @example
   *   quad.params[0] = performance.now() / 1000
   *   gfx.drawShaderQuad(quad, 0, 0, 400, 300)
   */
  drawShaderQuad(
    quad: ShaderQuad,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void

  // --- shadows ---------------------------------------------------------------

  /**
   * A drop shadow for a rounded rect's border box, drawn analytically (no
   * render target). `radii` and `smoothing` are as for
   * {@link Gfx2D.fillRoundRect}.
   *
   * The shadow's corners are circular. A smoothed corner's shadow uses the
   * circular radius that cuts the same area off the corner. That stays within
   * about 2/255 of a blurred smooth corner once the blur is at least 0.2 of the
   * radius at smoothing 0.3, 0.6 of it at the iOS smoothing, and the whole
   * radius at full smoothing. Below that, the shadow's corners read rounder
   * than the shape.
   */
  shadowRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    style: GfxShadowStyle,
    smoothing?: number,
  ): void
  /** A drop shadow for a circle, drawn analytically (no render target). */
  shadowCircle(cx: number, cy: number, r: number, style: GfxShadowStyle): void
  /**
   * A drop shadow for an arbitrary `Path2D`, from a cached blurred-coverage
   * mask. `style.inset` composes with the path's own fill geometry (no stencil,
   * no extra pass): draw it after the fill and before the border. Below
   * `PathShadowCache`'s hard-shadow threshold, or while `quality.vector
   * .pathShadowsEnabled` is off, falls back to the path's own fill translated
   * by `offsetX`/`offsetY` with no blur; an inset shadow has no such fallback
   * (there is nothing to approximate it with) and is silently skipped in that
   * case. A path needs a registered tessellation, same as
   * {@link Gfx2D.fillPath2D}.
   *
   * @example
   *   gfx.shadowPath2D(logoPath, {
   *     color: 'rgba(20, 16, 40, 0.35)',
   *     offsetY: 8,
   *     blur: 32,
   *   })
   *   gfx.fillPath2D(logoPath, '#1c1c22')
   */
  shadowPath2D(path: Path2D, style: GfxShadowStyle): void

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
   * reproduces `PolylineNode`'s midpoint smoothing. `style.closed` closes it.
   */
  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void
  /** Stroke an opaque `Path2D`. */
  strokePath2D(path: Path2D, style: GfxStrokeStyle): void

  // --- images --------------------------------------------------------------

  /**
   * Draw an image (particle sprite / baked bitmap) at `dst` rect. A small image
   * is scaled to its on-screen size once and shares a texture with text, so it
   * costs no extra draw. Pass `{ smoothing: false }` for pixel art, which then
   * scales with nearest filtering.
   */
  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts?: GfxImageOptions,
  ): void

  // --- text ----------------------------------------------------------------

  /**
   * Draw a single line of text with its anchor at `(x, y)` (interpreted per
   * `style.align` / `style.baseline`), in the node's LOCAL space. No wrapping.
   *
   * Uses the platform text engine (Canvas2D `fillText`) for correct shaping,
   * kerning, ligatures, and emoji, rasterizing the string to a cached texture
   * at device-pixel resolution derived from the live transform, so text stays
   * crisp and cheap under rotation and zoom (see `GfxTextStyle` for the
   * color-animation caveat).
   */
  fillText(text: string, x: number, y: number, style?: GfxTextStyle): void

  /**
   * Rasterize and upload `text` now, so the frame that first draws it does not
   * have to.
   *
   * @remarks
   *   A label is otherwise shaped, rasterized and uploaded inside the `fillText`
   *   that first needs it, on the render thread. The per-frame regen budget
   *   does not soften a first paint: it falls back to a neighbouring scale
   *   bucket, and on the first frame no bucket is populated. Warming a
   *   text-heavy scene ahead of time moves that work somewhere a stall is
   *   invisible.
   *
   *   Uses the transform in force when it is called, so warm under the same
   *   camera the text will be drawn with, or the bucket will not match and the
   *   work is repeated.
   * @example
   *   // On a loading screen, before the board is built.
   *   for (const card of deck) gfx.warmText(card.name, { font: nameFont })
   */
  warmText(text: string, style?: GfxTextStyle): void
}
