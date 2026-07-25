/**
 * Flex containers: {@link Row} and {@link Column}, plus the flex children
 * {@link Expanded}, {@link Flexible}, and {@link Spacer}. A flex lays its children
 * out along one axis, sizing inflexible children to their content and dividing
 * the leftover space among the flexible ones.
 *
 * @module
 * @category Layout
 */
import type { SceneNode } from '../../scene/SceneNode'
import { BoxConstraints, type Size } from '../constraints'
import { LayoutNode, isMeasurable, type MeasurableNode } from '../LayoutNode'

/** Layout direction of a {@link Flex}. */
export type Axis = 'row' | 'column'

/** How leftover main-axis space is distributed in a {@link Flex}. */
export type MainAxisAlign =
  'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly'

/** How children are placed on the cross axis of a {@link Flex}. */
export type CrossAxisAlign = 'start' | 'center' | 'end' | 'stretch'

/** Options shared by {@link Row} and {@link Column}. */
export interface FlexOptions {
  /** Children in main-axis order. Wrap one in {@link Expanded} to make it grow. */
  children?: MeasurableNode[]
  /** Gap between adjacent children, in world units. Default 0. */
  gap?: number
  /** Distribution of leftover main-axis space. Default `'start'`. */
  mainAxisAlign?: MainAxisAlign
  /** Cross-axis placement of each child. Default `'start'`. */
  crossAxisAlign?: CrossAxisAlign
}

/**
 * A child that grows to fill leftover main-axis space in a {@link Row} or
 * {@link Column}, in proportion to its `flex` weight. `fit: 'tight'` (the
 * default, and what {@link Expanded} uses) forces the child to exactly its
 * share; `'loose'` lets the child be smaller.
 *
 * @category Layout
 * @example
 *   new Row({
 *     children: [icon, new Flexible({ child: label, flex: 1 }), badge],
 *   })
 */
export class Flexible extends LayoutNode {
  flex: number
  fit: 'tight' | 'loose'
  readonly #child: MeasurableNode

  constructor(opts: {
    child: MeasurableNode
    flex?: number
    fit?: 'tight' | 'loose'
  }) {
    super()
    this.flex = opts.flex ?? 1
    this.fit = opts.fit ?? 'loose'
    this.#child = opts.child
    this.add(opts.child)
  }

  measure(c: BoxConstraints): Size {
    const s = this.#child.measure(c)
    this.measuredSize.w = c.constrainW(s.w)
    this.measuredSize.h = c.constrainH(s.h)
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
    this.#child.arrange(0, 0, w, h)
  }
}

/**
 * A {@link Flexible} that fills its whole share of the leftover space (`fit:
 * 'tight'`). The common case: `new Expanded({ child })` makes `child` take all
 * remaining room on the main axis.
 *
 * @category Layout
 */
export class Expanded extends Flexible {
  constructor(opts: { child: MeasurableNode; flex?: number }) {
    super({ ...opts, fit: 'tight' })
  }
}

/** Internal empty leaf: measures to the constrained minimum, draws nothing. */
class EmptyBox extends LayoutNode {
  measure(c: BoxConstraints): Size {
    this.measuredSize.w = c.constrainW(0)
    this.measuredSize.h = c.constrainH(0)
    return this.measuredSize
  }
  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }
  }
}

/**
 * Flexible empty space in a {@link Row} or {@link Column}. Use it to push
 * siblings apart or toward an edge.
 *
 * @category Layout
 * @example
 *   new Row({ children: [title, new Spacer(), closeButton] })
 */
export class Spacer extends Flexible {
  constructor(opts: { flex?: number } = {}) {
    super({ child: new EmptyBox(), flex: opts.flex ?? 1, fit: 'tight' })
  }
}

function flexOf(node: SceneNode): number {
  return node instanceof Flexible ? node.flex : 0
}

/**
 * Lays children out along one axis. Prefer {@link Row} and {@link Column}; this
 * base carries the shared two-pass algorithm and the child-mutation API.
 *
 * Add or remove children after construction with {@link Flex.add},
 * {@link Flex.remove}, {@link Flex.insert}, or {@link Flex.setChildren}; each
 * reuses the existing node instances (so running tweens and state survive) and
 * schedules a relayout.
 *
 * @category Layout
 */
export class Flex extends LayoutNode {
  readonly direction: Axis
  gap: number
  mainAxisAlign: MainAxisAlign
  crossAxisAlign: CrossAxisAlign

  // Reused across passes so a layout does not allocate. `#items` is the ordered
  // measurable children snapshotted at measure time; `#main`/`#cross` are their
  // resolved extents, read back in arrange.
  readonly #cc = new BoxConstraints()
  #items: MeasurableNode[] = []
  #main: number[] = []
  #cross: number[] = []

  constructor(direction: Axis, opts: FlexOptions = {}) {
    super()
    this.direction = direction
    this.gap = opts.gap ?? 0
    this.mainAxisAlign = opts.mainAxisAlign ?? 'start'
    this.crossAxisAlign = opts.crossAxisAlign ?? 'start'
    if (opts.children) this.add(...opts.children)
  }

  /** Append one or more children and schedule a relayout. */
  override add(...children: SceneNode[]): this {
    super.add(...children)
    this.markLayoutDirty()
    return this
  }

  /** Remove one or more children (not destroyed) and schedule a relayout. */
  override remove(...children: SceneNode[]): this {
    super.remove(...children)
    this.markLayoutDirty()
    return this
  }

  /** Insert a child at `index` in main-axis order and schedule a relayout. */
  insert(index: number, child: SceneNode): this {
    super.add(child)
    const arr = this._children
    const from = arr.indexOf(child)
    const to = Math.max(0, Math.min(index, arr.length - 1))
    if (from !== to) {
      arr.splice(from, 1)
      arr.splice(to, 0, child)
      this.scene?.invalidatePainterOrder()
    }
    this.markLayoutDirty()
    return this
  }

  /** Replace all children with `children`, reusing node identities. */
  setChildren(children: MeasurableNode[]): this {
    super.remove(...this._children)
    super.add(...children)
    this.markLayoutDirty()
    return this
  }

  measure(constraints: BoxConstraints): Size {
    const isRow = this.direction === 'row'
    const items = (this.#items = this._children.filter(
      isMeasurable,
    ) as MeasurableNode[])
    const n = items.length
    if (this.#main.length < n) {
      this.#main = new Array<number>(n)
      this.#cross = new Array<number>(n)
    }
    const main = this.#main
    const cross = this.#cross
    const gap = this.gap
    const totalGap = n > 1 ? gap * (n - 1) : 0
    const mainMax = isRow ? constraints.maxW : constraints.maxH
    const crossMax = isRow ? constraints.maxH : constraints.maxW
    const stretch = this.crossAxisAlign === 'stretch'

    let usedMain = 0
    let maxCross = 0
    let totalFlex = 0

    // Pass 1: inflexible children take their natural main size.
    for (let i = 0; i < n; i++) {
      const f = flexOf(items[i])
      if (f > 0) {
        totalFlex += f
        main[i] = 0
        cross[i] = 0
        continue
      }
      const remain = Number.isFinite(mainMax)
        ? Math.max(0, mainMax - usedMain - totalGap)
        : Infinity
      this.#setChildC(isRow, 0, remain, crossMax, stretch)
      const s = items[i].measure(this.#cc)
      main[i] = isRow ? s.w : s.h
      cross[i] = isRow ? s.h : s.w
      usedMain += main[i]
      if (cross[i] > maxCross) maxCross = cross[i]
    }

    // Pass 2: divide the leftover main space among flex children.
    if (totalFlex > 0) {
      if (!Number.isFinite(mainMax)) {
        throw new Error(
          `[stargazer] layout: ${this.direction} has flex children under an ` +
            `unbounded main axis. Give it a bounded size (or remove the flex).`,
        )
      }
      const free = Math.max(0, mainMax - usedMain - totalGap)
      for (let i = 0; i < n; i++) {
        const f = flexOf(items[i])
        if (f <= 0) continue
        const allot = (free * f) / totalFlex
        this.#setChildC(isRow, allot, allot, crossMax, stretch)
        const s = items[i].measure(this.#cc)
        main[i] = isRow ? s.w : s.h
        cross[i] = isRow ? s.h : s.w
        usedMain += main[i]
        if (cross[i] > maxCross) maxCross = cross[i]
      }
    }

    const mainSize =
      totalFlex > 0 && Number.isFinite(mainMax) ? mainMax : usedMain + totalGap
    const crossSize = stretch && Number.isFinite(crossMax) ? crossMax : maxCross
    this.measuredSize.w = constraints.constrainW(isRow ? mainSize : crossSize)
    this.measuredSize.h = constraints.constrainH(isRow ? crossSize : mainSize)
    return this.measuredSize
  }

  arrange(x: number, y: number, w: number, h: number): void {
    this.transform.x = x
    this.transform.y = y
    this.debugBounds = { x: 0, y: 0, width: w, height: h }

    const isRow = this.direction === 'row'
    const items = this.#items
    const main = this.#main
    const cross = this.#cross
    const n = items.length
    const gap = this.gap
    const mainSize = isRow ? w : h
    const crossSize = isRow ? h : w

    let sumMain = 0
    for (let i = 0; i < n; i++) sumMain += main[i]
    const leftover = Math.max(
      0,
      mainSize - sumMain - (n > 1 ? gap * (n - 1) : 0),
    )

    let offset = 0
    let between = gap
    switch (this.mainAxisAlign) {
      case 'center':
        offset = leftover / 2
        break
      case 'end':
        offset = leftover
        break
      case 'spaceBetween':
        if (n > 1) between = gap + leftover / (n - 1)
        break
      case 'spaceAround': {
        const each = n > 0 ? leftover / n : 0
        offset = each / 2
        between = gap + each
        break
      }
      case 'spaceEvenly': {
        const each = leftover / (n + 1)
        offset = each
        between = gap + each
        break
      }
      default:
        break
    }

    let cur = offset
    for (let i = 0; i < n; i++) {
      const cm = main[i]
      let cc = cross[i]
      let crossOff = 0
      switch (this.crossAxisAlign) {
        case 'center':
          crossOff = (crossSize - cc) / 2
          break
        case 'end':
          crossOff = crossSize - cc
          break
        case 'stretch':
          cc = crossSize
          break
        default:
          break
      }
      const childX = isRow ? cur : crossOff
      const childY = isRow ? crossOff : cur
      const childW = isRow ? cm : cc
      const childH = isRow ? cc : cm
      items[i].arrange(childX, childY, childW, childH)
      cur += cm + between
    }
  }

  #setChildC(
    isRow: boolean,
    mainMin: number,
    mainMax: number,
    crossMax: number,
    stretch: boolean,
  ): void {
    const crossMin = stretch && Number.isFinite(crossMax) ? crossMax : 0
    if (isRow) this.#cc.set(mainMin, mainMax, crossMin, crossMax)
    else this.#cc.set(crossMin, crossMax, mainMin, mainMax)
  }
}

/**
 * A horizontal {@link Flex}: children are laid out left to right.
 *
 * @category Layout
 * @example
 *   new Row({
 *     gap: 16,
 *     crossAxisAlign: 'center',
 *     children: [avatar, new Expanded({ child: name }), menuButton],
 *   })
 */
export class Row extends Flex {
  constructor(opts: FlexOptions = {}) {
    super('row', opts)
  }
}

/**
 * A vertical {@link Flex}: children are laid out top to bottom.
 *
 * @category Layout
 * @example
 *   new Column({
 *     gap: 8,
 *     children: [title, subtitle, new Spacer(), actions],
 *   })
 */
export class Column extends Flex {
  constructor(opts: FlexOptions = {}) {
    super('column', opts)
  }
}
