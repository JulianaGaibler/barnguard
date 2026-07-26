/**
 * {@link Scaffold}: the classic page frame — an optional header, a content area
 * that takes the space left over, and an optional footer, stacked vertically.
 *
 * @module
 * @category Layout
 */
import { type BoxConstraints, type Size } from '../constraints'
import { LayoutNode, type MeasurableNode } from '../LayoutNode'
import { Column, Expanded } from './Flex'

/** Options for {@link Scaffold}. Slots are named by structural purpose. */
export interface ScaffoldOptions {
  /** Fixed-height bar at the top. Optional. */
  header?: MeasurableNode
  /** The main area; takes all height left after the header and footer. */
  content: MeasurableNode
  /** Fixed-height bar at the bottom. Optional. */
  footer?: MeasurableNode
  /** Gap between the header, content, and footer. Default 0. */
  gap?: number
}

/**
 * A vertical page frame with named slots: `header`, `content`, `footer`. The
 * header and footer size to their content; the content area is wrapped in an
 * {@link Expanded} so it fills the height between them. Give the scaffold a
 * bounded height (a {@link LayoutRoot} does this) so the content has room to
 * expand into.
 *
 * @category Layout
 * @example
 *   const root = new LayoutRoot()
 *   root.setContent(
 *     new Scaffold({
 *       header: titleBar,
 *       content: new Center({ child: board }),
 *       footer: toolbar,
 *     }),
 *   )
 *   host.engine.tree.root.add(root)
 */
export class Scaffold extends LayoutNode {
  readonly #column: Column

  constructor(opts: ScaffoldOptions) {
    super()
    const children: MeasurableNode[] = []
    if (opts.header) children.push(opts.header)
    children.push(new Expanded({ child: opts.content }))
    if (opts.footer) children.push(opts.footer)
    this.#column = new Column({ children, gap: opts.gap ?? 0 })
    this.add(this.#column)
  }

  measure(constraints: BoxConstraints): Size {
    const s = this.#column.measure(constraints)
    this.measuredSize.w = s.w
    this.measuredSize.h = s.h
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
    this.#column.arrange(0, 0, w, h)
  }
}
