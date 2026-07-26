/**
 * Constraints-based box layout: an opt-in way to size and place scene nodes so
 * a scene fills the window and reflows on resize, instead of positioning nodes
 * at fixed coordinates. Constraints flow down, sizes flow up, and each parent
 * places its children.
 *
 * Add a {@link LayoutRoot} to a scene, give it a content node built from the
 * containers ({@link Row}, {@link Column}, {@link Box}, ...) or any
 * {@link Measurable} leaf, and the engine measures and arranges it into the
 * visible area once, then again on every resize. Nothing here runs, or costs
 * anything, until you attach a `LayoutRoot`.
 *
 * See the Layout guide for the full API and worked examples. The rest of this
 * page is for engine developers extending the layout system.
 *
 * ## The model
 *
 * Layout is a two-step protocol on {@link Measurable} nodes. First
 * `measure(constraints)` computes a node's size within the min/max box its
 * parent allows and writes it into a preallocated `measuredSize`. Then
 * `arrange(x, y, w, h)` places the node by setting `transform.x`/`transform.y`
 * and positions its children.
 *
 * Constraints flow down, sizes flow up, and each parent places its children.
 *
 * ```ts
 * measure(c: BoxConstraints): Size {
 *   this.measuredSize.w = c.constrainW(this.contentWidth)
 *   this.measuredSize.h = c.constrainH(this.contentHeight)
 *   return this.measuredSize
 * }
 * ```
 *
 * Containers extend {@link LayoutNode}, which supplies the `measuredSize` field
 * and `markLayoutDirty`. Leaves implement {@link Measurable} directly;
 * `ShapeNode` does, so a shape drops into a `Row` or `Column` without a
 * wrapper.
 *
 * ## When the pass runs
 *
 * A {@link LayoutRoot} registers with the engine and owns one content subtree.
 * It fills a bounds rect, the camera's visible world rect by default, so the
 * tree tracks the canvas.
 *
 * The pass runs inside the engine frame, between the update walk and
 * world-transform propagation, so the positions `arrange` writes reach the
 * world matrices on the same frame.
 *
 * It is on demand rather than per frame. `markLayoutDirty` (bubbled up to the
 * owning root) and the engine `resize` event set a flag, and the root
 * re-measures once on the next frame. A frame that changed nothing pays a
 * single flag check, and an engine with no `LayoutRoot` pays an empty-set
 * walk.
 *
 * ## Design principles
 *
 * Layout nodes are ordinary persistent `Node2D`s. stargazer is retained mode:
 * you build the tree once and mutate it in place. Only the measure-and-place
 * algorithm is borrowed from declarative toolkits, not their rebuild-the-tree
 * step, which in a retained engine would throw away the state on a node (its
 * in-flight tweens, physics body, input capture).
 *
 * Animate transforms, not sizes. The pass runs before transform propagation and
 * never reads `transform` as an input, so animating `transform.x` or `scaleX`
 * does no layout work.
 *
 * ```ts
 * await card.tween({ scaleX: 1.1, scaleY: 1.1 }, { duration: 0.15 })
 * ```
 *
 * Changing a layout size instead marks the tree dirty and re-runs the pass, so
 * it is the slower path.
 *
 * A pass allocates nothing. A container reuses one {@link BoxConstraints}
 * scratch to build each child's constraints, and every node writes into its own
 * `measuredSize` rather than returning a fresh object. Read a child's
 * `measuredSize` into locals right after `measure`, since a later `measure`
 * overwrites it.
 *
 * Everything is in world units. Root constraints are the visible world rect
 * (`Camera.visibleWorldRect`), not CSS pixels; the camera's aspect fit applies
 * on top.
 *
 * Moving a static node stays correct. `arrange` moves nodes through their
 * transforms, which does not invalidate the static layer on its own, so the
 * pass invalidates it when a moved subtree holds static-layer content.
 *
 * The dirty flag is reentrancy-safe: it clears before measuring, so a
 * `markLayoutDirty` raised mid-pass re-arms it for the next frame rather than
 * looping within the current one.
 *
 * ## Adding a container
 *
 * Extend {@link LayoutNode} and implement the two methods. `measure` reads the
 * incoming constraints, sizes each child, and returns its own `measuredSize`;
 * `arrange` sets its position, records its box in `debugBounds`, and arranges
 * each child in local space.
 *
 * ```ts
 * class Frame extends LayoutNode {
 *   #child: MeasurableNode
 *   measure(c: BoxConstraints): Size {
 *     const s = this.#child.measure(c)
 *     this.measuredSize.w = c.constrainW(s.w)
 *     this.measuredSize.h = c.constrainH(s.h)
 *     return this.measuredSize
 *   }
 *   arrange(x: number, y: number, w: number, h: number): void {
 *     this.transform.x = x
 *     this.transform.y = y
 *     this.debugBounds = { x: 0, y: 0, width: w, height: h }
 *     this.#child.arrange(0, 0, w, h)
 *   }
 * }
 * ```
 *
 * Two rules keep a container well-behaved: write only
 * `transform.x`/`transform.y` in `arrange` (never scale), and route child
 * mutations through methods that call `markLayoutDirty`. {@link Flex} is the
 * reference for a two-pass container: it measures the inflexible children
 * first, then divides the remaining main-axis space among the flexible ones.
 *
 * ## Limitations
 *
 * Sizing is a single pass, so there is no intrinsic sizing (a container that
 * sizes to its widest child). Text is not measured; wrap a label in a
 * {@link SizedBox}. There is no clipping or scrolling.
 *
 * @module layout
 * @category Layout
 */
export { BoxConstraints, edgeInsets } from '../layout/constraints'
export type { Size, EdgeInsets } from '../layout/constraints'
export { LayoutNode, isMeasurable } from '../layout/LayoutNode'
export type { Measurable, MeasurableNode } from '../layout/LayoutNode'
export { LayoutRoot } from '../layout/LayoutRoot'
export type { LayoutRootOptions } from '../layout/LayoutRoot'
export { Box, SizedBox, Padding, Align, Center } from '../layout/nodes/Box'
export type { BoxOptions, AlignOptions, Align1D } from '../layout/nodes/Box'
export { alignOffset, alignWithin } from '../layout/align'
export {
  Flex,
  Row,
  Column,
  Flexible,
  Expanded,
  Spacer,
} from '../layout/nodes/Flex'
export type {
  FlexOptions,
  Axis,
  MainAxisAlign,
  CrossAxisAlign,
} from '../layout/nodes/Flex'
export { Stack } from '../layout/nodes/Stack'
export type { StackOptions } from '../layout/nodes/Stack'
export { Scaffold } from '../layout/nodes/Scaffold'
export type { ScaffoldOptions } from '../layout/nodes/Scaffold'
export { AspectRatio } from '../layout/nodes/AspectRatio'
export type { AspectRatioOptions } from '../layout/nodes/AspectRatio'
export { LayoutBuilder } from '../layout/nodes/LayoutBuilder'
export type { LayoutBuilderOptions } from '../layout/nodes/LayoutBuilder'
