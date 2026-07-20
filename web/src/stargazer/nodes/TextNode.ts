import { SceneNode } from '../scene/SceneNode'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'

/**
 * Constructor options for {@link TextNode}.
 *
 * @category Nodes
 */
export interface TextNodeOptions {
  id?: string
  /** The string to draw (single line). */
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
}

/**
 * Draws a single line of text through {@link Gfx2D.fillText}. The node's
 * transform positions and rotates the label in world space (rotation is free on
 * the GPU backend); `fontSize` + `sizeSpace` control on-screen size the same
 * way `ShapeNode` handles `lineWidth` + `strokeSpace`. Every option is a plain
 * public field, so reassigning `text` or `color` shows on the next frame. No
 * wrapping, one line per node.
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
 */
export class TextNode extends SceneNode {
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
    gfx.fillText(this.text, this.x, this.y, {
      font: this.fontString(px),
      align: this.align,
      baseline: this.baseline,
      color: this.color,
    })
  }
}
