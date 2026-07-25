import { SceneNode } from '../scene/SceneNode'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import { measureText } from '../render/gfx/rasterizeLabel'
import { BoxConstraints, type Size } from '../layout/constraints'
import { alignOffset, type Align1D } from '../layout/align'
import type { Measurable } from '../layout/LayoutNode'

/**
 * Constructor options for {@link TextNode}.
 *
 * @category Nodes
 */
export interface TextNodeOptions {
  id?: string
  /** The string to draw. Split on `\n` into separate lines; no word-wrap. */
  text: string
  /** Anchor X in local space. Default `0`. */
  x?: number
  /** Anchor Y in local space. Default `0`. */
  y?: number
  /** Font family / stack. Default `'sans-serif'`. */
  fontFamily?: string
  /** CSS font weight (`400`, `'700'`, `'bold'`, …). Default `'normal'`. */
  fontWeight?: string | number
  /**
   * Font size in `sizeSpace` units. Default `16`.
   *
   * - `'screen'`: CSS px, visually constant across camera zoom.
   * - `'world'`: world units, scales with the camera.
   */
  fontSize?: number
  /**
   * `'screen'` (default) keeps the text a constant on-screen size (like
   * `ShapeNode`'s screen-space stroke); `'world'` makes it scale with the
   * camera. Screen-space text is also the always-free path on the GPU backend
   * (constant device resolution ⇒ one cached texture, no zoom churn).
   */
  sizeSpace?: 'screen' | 'world'
  /** CSS color. Default `'#000'`. */
  color?: string
  /** Horizontal anchor. Default `'left'`. */
  align?: CanvasTextAlign
  /** Vertical anchor. Default `'alphabetic'`. */
  baseline?: CanvasTextBaseline
  /**
   * Line spacing for multi-line text, as a multiple of the effective pixel font
   * size. Default `1.2`. Ignored for single-line text.
   */
  lineHeight?: number
}

/** Map a horizontal `CanvasTextAlign` to the box-anchor axis it corresponds to. */
function alignAxis(align: CanvasTextAlign): Align1D {
  if (align === 'center') return 'center'
  if (align === 'right' || align === 'end') return 'end'
  return 'start'
}

/** Map a vertical `CanvasTextBaseline` to the box-anchor axis it corresponds to. */
function baselineAxis(baseline: CanvasTextBaseline): Align1D {
  if (baseline === 'middle') return 'center'
  if (baseline === 'bottom' || baseline === 'ideographic') return 'end'
  return 'start' // top | hanging | alphabetic
}

/**
 * Draws text through {@link Gfx2D.fillText}, one call per `\n`-delimited line —
 * no word-wrap; use HTML for long-form copy. The node's transform positions and
 * rotates the label in world space (rotation is free on the GPU backend);
 * `fontSize` + `sizeSpace` control on-screen size the same way `ShapeNode`
 * handles `lineWidth` + `strokeSpace`. Every option is a plain public field, so
 * reassigning `text` or `color` shows on the next frame.
 *
 * Also implements {@link Measurable}, so a `TextNode` can be placed directly
 * inside a layout container (`Box`, `Row`, `Column`, `Stack`, `Align`,
 * `Center`, ...) — the container measures its natural size and arranges it
 * within the box it's given, honoring `align`/`baseline` as the anchor point
 * within that box. Outside a layout tree, `align`/`baseline` anchor `(x, y)`
 * exactly as before.
 *
 * @category Nodes
 * @example
 *   const label = new TextNode({
 *     text: 'Score: 0',
 *     x: 24,
 *     y: 24,
 *     fontSize: 32,
 *     fontWeight: 700,
 *     color: '#fff',
 *     baseline: 'top',
 *   })
 *   scene.root.add(label)
 *   label.text = 'Score: 10' // picked up next frame
 *
 * @example
 *   // Multi-line, centered as a block on (x, y):
 *   new TextNode({ text: 'Game\nOver', align: 'center', baseline: 'middle' })
 */
export class TextNode extends SceneNode implements Measurable {
  text: string
  x: number
  y: number
  fontFamily: string
  fontWeight: string | number
  fontSize: number
  sizeSpace: 'screen' | 'world'
  color: string
  align: CanvasTextAlign
  baseline: CanvasTextBaseline
  lineHeight: number

  readonly measuredSize: Size = { w: 0, h: 0 }

  constructor(opts: TextNodeOptions) {
    super(opts.id)
    this.text = opts.text
    this.x = opts.x ?? 0
    this.y = opts.y ?? 0
    this.fontFamily = opts.fontFamily ?? 'sans-serif'
    this.fontWeight = opts.fontWeight ?? 'normal'
    this.fontSize = opts.fontSize ?? 16
    this.sizeSpace = opts.sizeSpace ?? 'screen'
    this.color = opts.color ?? '#000'
    this.align = opts.align ?? 'left'
    this.baseline = opts.baseline ?? 'alphabetic'
    this.lineHeight = opts.lineHeight ?? 1.2
  }

  /** The CSS `font` shorthand for the given effective pixel size. */
  fontString(px: number): string {
    return `${this.fontWeight} ${px}px ${this.fontFamily}`
  }

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    if (this.text.length === 0) return
    // Screen-space: divide by the camera scale so the text nets to a constant
    // on-screen size after the engine's per-node transform (the "1 CSS px"
    // invariant, mirroring ShapeNode's stroke handling).
    const s = this.sizeSpace === 'world' ? 1 : camera.strokeSpaceScale()
    const px = this.fontSize * s
    const font = this.fontString(px)

    const lines = this.text.split('\n')
    if (lines.length === 1) {
      gfx.fillText(this.text, this.x, this.y, {
        font,
        align: this.align,
        baseline: this.baseline,
        color: this.color,
      })
      return
    }

    // Multi-line: every line is drawn with baseline 'top' at a fixed line
    // spacing, and the whole block is anchored on (x, y) per `baseline`
    // ('alphabetic'/'hanging' collapse to the block's top — a single per-line
    // baseline can't mean much once there's more than one line).
    const lineHeightPx = px * this.lineHeight
    const totalHeight = lineHeightPx * lines.length
    const blockTop =
      this.y - alignOffset(baselineAxis(this.baseline), totalHeight)
    for (let i = 0; i < lines.length; i++) {
      gfx.fillText(lines[i], this.x, blockTop + i * lineHeightPx, {
        font,
        align: this.align,
        baseline: 'top',
        color: this.color,
      })
    }
  }

  measure(constraints: BoxConstraints): Size {
    const px = this.fontSize
    const lines = this.text.split('\n')
    const font = this.fontString(px)
    let w = 0
    for (const line of lines) {
      w = Math.max(
        w,
        measureText(line, {
          font,
          align: 'left',
          baseline: 'alphabetic',
          color: this.color,
        }).localW,
      )
    }
    const h = px * this.lineHeight * lines.length
    this.measuredSize.w = constraints.constrainW(w)
    this.measuredSize.h = constraints.constrainH(h)
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.x = alignOffset(alignAxis(this.align), w)
    this.y = alignOffset(baselineAxis(this.baseline), h)
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
  }
}
