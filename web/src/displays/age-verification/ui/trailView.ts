import {
  AbortScope,
  GfxPath,
  Node2D,
  ShapeNode,
  definePaintProps,
  easings,
  ignoreAbort,
  withAlpha,
  type Canvas,
  type Engine,
} from '@src/stargazer'
import type { ProgressMark } from '../story/run'
import { PALETTE } from '../theme'
import { MOTION } from './motion'
import {
  LINK_LENGTH,
  MARK_SIZE,
  MARK_STEP,
  trailGeometry,
} from './progressTrail'
import { planTrail } from './trailPlan'

/** The stroke sits inside each mark's box. */
const STROKE = 3
/** The link between two marks is faint. */
const LINK_ALPHA = 0.1

/** A four-point star filling a `MARK_SIZE` box. */
const STAR = new GfxPath()
  .moveTo(18, 0)
  .lineTo(24.364, 11.636)
  .lineTo(36, 18)
  .lineTo(24.364, 24.364)
  .lineTo(18, 36)
  .lineTo(11.636, 24.364)
  .lineTo(0, 18)
  .lineTo(11.636, 11.636)
  .close()

/**
 * One mark in the progress row: a ring for a screen and a star for a moment,
 * with a solid fill that fades in for the current one. The node pivots on its
 * center, so scaling it pops it from the middle.
 */
export class MarkNode extends Node2D {
  /** `'step'` draws a ring, `'moment'` a star. */
  declare shape: ProgressMark['kind']
  /** How much of the solid fill shows, from 0 (a ring) to 1 (filled). */
  declare filled: number

  constructor(shape: ProgressMark['kind'], filled: number) {
    super('mark')
    definePaintProps(this, { shape, filled })
    this.transform.originX = MARK_SIZE / 2
    this.transform.originY = MARK_SIZE / 2
  }

  override paint(gfx: Canvas): void {
    const fill = withAlpha(PALETTE.red, this.filled)
    if (this.shape === 'moment') {
      if (this.filled > 0.001) gfx.fillPath(STAR, fill)
      gfx.strokePath(STAR, {
        color: PALETTE.red,
        width: STROKE,
        align: 'inside',
        join: 'miter',
      })
      return
    }
    const inner = MARK_SIZE - STROKE
    if (this.filled > 0.001) {
      gfx.fillRoundRect(0, 0, MARK_SIZE, MARK_SIZE, MARK_SIZE / 2, fill)
    }
    gfx.strokeRoundRect(STROKE / 2, STROKE / 2, inner, inner, inner / 2, {
      color: PALETTE.red,
      width: STROKE,
    })
  }
}

/** The pieces of tweening the row needs, so a test can stand in for the engine. */
export type Tweener = Pick<Engine, 'tween'>

/**
 * The row of progress marks, drawn by the engine and animated as the visitor
 * moves. It shows one mark per screen shown so far and never how many are
 * left.
 *
 * The node sits at the row's top left. It scales as a whole when the row
 * outgrows its width, which tweens, so a long path shrinks smoothly.
 */
export class TrailView extends Node2D {
  readonly #engine: Tweener
  readonly #scope = new AbortScope()
  #shown: ProgressMark[] = []
  #marks: MarkNode[] = []
  /** `#links[i]` joins mark `i` to mark `i + 1`. */
  #links: ShapeNode[] = []

  constructor(engine: Tweener) {
    super('trail')
    this.#engine = engine
  }

  /** How many marks the row shows. */
  get count(): number {
    return this.#marks.length
  }

  /** The mark at `index`, for the director and the tests. */
  markAt(index: number): MarkNode | undefined {
    return this.#marks[index]
  }

  /**
   * Shows `marks`. The change from the marks shown before decides the motion: a
   * mark pops in at the end when the visitor moves on, the last one shrinks
   * away when they go back, and anything else is rebuilt without motion.
   *
   * With `holdLast`, a mark added at the end stays hidden until
   * {@link TrailView.reveal}, so a flying circle can land in its place. Returns
   * that mark, or `null`.
   */
  sync(
    marks: readonly ProgressMark[],
    maxWidth: number,
    opts: { animate?: boolean; holdLast?: boolean } = {},
  ): MarkNode | null {
    const animate = opts.animate ?? true
    const change = planTrail(this.#shown, marks)
    let held: MarkNode | null = null
    if (change === 'reset') {
      this.#clear()
      marks.forEach((mark, i) => this.#append(mark, i, false, false))
    } else if (change === 'same') {
      marks.forEach((mark, i) => this.#fillTo(i, mark.current, animate))
    } else if (change === 'add') {
      const last = marks.length - 1
      this.#fillTo(last - 1, false, animate)
      held = this.#append(marks[last], last, animate, opts.holdLast ?? false)
    } else {
      this.#removeLast(animate)
      this.#fillTo(marks.length - 1, true, animate)
    }
    this.#shown = marks.map((mark) => ({ ...mark }))
    this.#fitTo(marks, maxWidth, animate && change !== 'reset')
    return opts.holdLast ? held : null
  }

  /** Pops in a mark that `sync` held back. */
  reveal(mark: MarkNode): void {
    mark.visible = true
    this.#play(
      mark.transform,
      { scaleX: 1, scaleY: 1 },
      { duration: 0.12, easing: easings.outCubic },
    )
  }

  override destroy(): void {
    this.#scope.dispose()
    super.destroy()
  }

  #append(
    mark: ProgressMark,
    index: number,
    animate: boolean,
    hold: boolean,
  ): MarkNode {
    const node = new MarkNode(mark.kind, mark.current ? 1 : 0)
    node.transform.x = index * MARK_STEP + MARK_SIZE / 2
    node.transform.y = MARK_SIZE / 2
    this.add(node)
    this.#marks[index] = node
    if (index > 0) {
      const link = new ShapeNode({
        geometry: {
          kind: 'rect',
          width: LINK_LENGTH,
          height: STROKE,
          centered: false,
        },
        fill: withAlpha(PALETTE.red, LINK_ALPHA),
      })
      link.transform.x = (index - 1) * MARK_STEP + MARK_SIZE
      link.transform.y = (MARK_SIZE - STROKE) / 2
      this.add(link)
      this.#links[index - 1] = link
      if (animate) {
        link.transform.scaleX = 0
        this.#play(
          link.transform,
          { scaleX: 1 },
          { duration: MOTION.linkGrow, easing: easings.outCubic },
        )
      }
    }
    if (hold) {
      node.visible = false
      node.transform.scaleX = 0
      node.transform.scaleY = 0
    } else if (animate) {
      node.transform.scaleX = 0
      node.transform.scaleY = 0
      this.#play(
        node.transform,
        { scaleX: 1, scaleY: 1 },
        {
          duration: MOTION.markPop,
          delay: MOTION.linkGrow * 0.5,
          easing: easings.outBack,
        },
      )
    }
    return node
  }

  /** Shrinks the last mark and its link away. */
  #removeLast(animate: boolean): void {
    const node = this.#marks.pop()
    const link = this.#links.pop()
    const done = (): void => {
      node?.destroy()
      link?.destroy()
    }
    if (!animate || !node) {
      done()
      return
    }
    const options = { duration: 0.25, easing: easings.inCubic }
    void Promise.all([
      this.#play(node.transform, { scaleX: 0, scaleY: 0 }, options),
      link
        ? this.#play(link.transform, { scaleX: 0 }, options)
        : Promise.resolve(),
    ]).then(done, done)
  }

  /** Brings mark `index` to filled or to a ring. */
  #fillTo(index: number, current: boolean, animate: boolean): void {
    const node = this.#marks[index]
    if (!node) return
    const target = current ? 1 : 0
    if (!animate) {
      node.filled = target
      return
    }
    this.#play(node, { filled: target }, { duration: 0.25, key: 'fill' })
    if (current) {
      // A small swell as the mark becomes the current one.
      void this.#play(
        node.transform,
        { scaleX: 1.22, scaleY: 1.22 },
        { duration: 0.14, easing: easings.outCubic, key: 'swell' },
      )
        .then(() =>
          this.#play(
            node.transform,
            { scaleX: 1, scaleY: 1 },
            { duration: 0.3, easing: easings.outBack, key: 'swell' },
          ),
        )
        .catch(ignoreAbort)
    }
  }

  /** Scales the whole row so it fits `maxWidth`. */
  #fitTo(
    marks: readonly ProgressMark[],
    maxWidth: number,
    animate: boolean,
  ): void {
    const geometry = trailGeometry(marks, maxWidth)
    const scale =
      geometry.naturalWidth > 0 ? geometry.width / geometry.naturalWidth : 1
    if (!animate) {
      this.transform.scaleX = scale
      this.transform.scaleY = scale
      return
    }
    this.#play(
      this.transform,
      { scaleX: scale, scaleY: scale },
      { duration: 0.35, easing: easings.outCubic, key: 'row-scale' },
    )
  }

  #clear(): void {
    for (const node of this.#marks) node.destroy()
    for (const link of this.#links) link.destroy()
    this.#marks = []
    this.#links = []
  }

  /** A tween on this row's scope that a newer one may replace. */
  #play<T extends object>(
    target: T,
    to: Partial<T>,
    opts: {
      duration: number
      delay?: number
      easing?: (t: number) => number
      key?: string
    },
  ): Promise<void> {
    return this.#engine
      .tween(target, to, { ...opts, signal: this.#scope.signal })
      .catch(ignoreAbort)
  }
}
