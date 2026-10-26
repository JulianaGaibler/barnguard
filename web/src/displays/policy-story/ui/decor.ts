import { Dither, ditherPreset } from '@src/core/render/dither'
import { Layer, Node2D, ShapeNode, type Rect } from 'stargazer'
import { PALETTE } from '../theme'
import { FixedCells } from './ditherLook'
import { pickFrame } from './frame'
import type { FieldLook } from './moods'

/** How many fields of dots the shapes of a mood are drawn in. */
export const DECOR_FIELDS = 3

/**
 * A shape in a mood's backdrop. It is drawn as a spot of tone in one of the
 * mood's decor fields, so the dither turns it into halftone dots like the rest
 * of the background. Positions and sizes are fractions of the visible area,
 * measured from its top left, and `x` and `y` are the shape's center.
 */
export interface DecorShape {
  /** A rect, or a circle whose diameter is `w` of the shorter side of the area. */
  shape: 'rect' | 'circle'
  /** The field of dots it is drawn in, 0 to 2. */
  field: number
  x: number
  y: number
  w: number
  /** The height of a rect. */
  h?: number
  /** How full the dots are, 0 to 1. Default 1. */
  tone?: number
  /** Degrees, default 0. */
  rotate?: number
  /**
   * True for a shape the text sits on. It is a circle in the middle of the
   * screen, and its field must keep its dots small.
   */
  underText?: boolean
  /** True to skip the slow breathing, for a shape something else animates. */
  steady?: boolean
  /** What changes when the area is taller than it is wide. */
  portrait?: Partial<Pick<DecorShape, 'x' | 'y' | 'w' | 'h'>>
}

/** The shapes of a mood and the fields of dots they are drawn in. */
export interface Decor {
  fields: readonly FieldLook[]
  shapes: readonly DecorShape[]
}

/** The shortest and longest a shape takes to fade out and back, in seconds. */
const BREATH_MIN = 9
const BREATH_SPAN = 7
/** How low a shape's tone falls at the bottom of its breath. */
const BREATH_LOW = 0.7
/** How much a shape grows and shrinks, as a fraction of its size. */
const BREATH_SCALE = 0.03
/**
 * The fraction of the radius of a circle under text inside which its tone is
 * even.
 */
const CIRCLE_CORE = 0.2
/** How often the shapes are redrawn while they breathe, in seconds. */
const BREATH_STEP = 1 / 24

const TONE_RIM = 'rgba(22, 22, 22, 0)'
/**
 * A spot of tone as a CSS color. The alpha is rounded, since a very small
 * number prints with an exponent, which is not a color, and the spot would be
 * drawn solid.
 */
const tone = (value: number): string =>
  `rgba(22, 22, 22, ${Math.min(Math.max(value, 0), 1).toFixed(4)})`

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

/** A shape as it will be in an area, with the portrait changes in. */
function resolved(shape: DecorShape, portrait: boolean): DecorShape {
  return portrait && shape.portrait ? { ...shape, ...shape.portrait } : shape
}

/**
 * The shapes `k` of the way from `a` to `b`, 0 to 1. The shapes of `a` fade out
 * where they stand while those of `b` fade in where they stand, so no shape
 * travels between screens.
 */
export function blendShapes(
  a: readonly DecorShape[],
  b: readonly DecorShape[],
  k: number,
): readonly DecorShape[] {
  if (k <= 0) return a
  if (k >= 1) return b
  return [
    ...a.map((s) => ({ ...s, tone: (s.tone ?? 1) * (1 - k) })),
    ...b.map((s) => ({ ...s, tone: (s.tone ?? 1) * k })),
  ]
}

/** Calls `onFrame` with the seconds that have passed in all, at a steady rate. */
class Clock extends Node2D {
  running = false
  readonly #onFrame: (time: number) => void
  #time = 0
  #since = 0

  constructor(onFrame: (time: number) => void) {
    super('background-decor-clock')
    this.#onFrame = onFrame
  }

  override onUpdate(dt: number): void {
    if (!this.running) return
    this.#time += dt
    this.#since += dt
    if (this.#since < BREATH_STEP) return
    this.#since = 0
    this.#onFrame(this.#time)
  }
}

/**
 * Draws a mood's shapes in fields of halftone dots, each field on a layer of
 * its own with its own dither, over the background's dots. The shapes fade out
 * and back in slowly, each at its own pace, and grow and shrink a little.
 */
export class DecorLayer {
  readonly layers: readonly Layer[]
  readonly dithers: readonly Dither[]
  readonly cells: readonly FixedCells[]
  readonly #nodes: ShapeNode[][]
  /** Add it to a layer that is always drawn, so the shapes keep breathing. */
  readonly clock: Node2D & { running: boolean }

  constructor(onFrame: (time: number) => void) {
    this.dithers = Array.from({ length: DECOR_FIELDS }, () => {
      return new Dither(
        ditherPreset('halftoneSphere', {
          cellSize: 12,
          dotScale: 0.85,
          dotMin: 0,
          paper: 'rgba(255, 255, 255, 0)',
          ink: '#000000',
        }),
      )
    })
    this.cells = this.dithers.map((fx) => new FixedCells(fx))
    this.layers = this.dithers.map(
      (fx, i) =>
        new Layer({
          id: `background-decor-${i}`,
          space: { frame: pickFrame },
          region: 'view',
          cache: 'raster',
          clearColor: PALETTE.white,
          holdUntilEffects: true,
          effects: [fx],
          persistent: true,
        }),
    )
    for (const layer of this.layers) layer.visible = false
    this.#nodes = this.layers.map(() => [])
    this.clock = new Clock(onFrame)
  }

  /**
   * Draws `shapes` into `area`, `time` seconds into the breathing, with the
   * fields' `strength` as the most tone a field's shapes reach.
   */
  draw(
    shapes: readonly DecorShape[],
    fields: readonly FieldLook[],
    area: Rect,
    time: number,
  ): void {
    const portrait = area.width < area.height
    const shorter = Math.min(area.width, area.height)
    const used = this.layers.map(() => 0)
    shapes.forEach((source, index) => {
      const slot = source.field
      const layer = this.layers[slot]
      if (!layer) return
      const s = resolved(source, portrait)
      const phase =
        (time * Math.PI * 2) / (BREATH_MIN + ((index * 3.7) % BREATH_SPAN))
      const breath = 0.5 + 0.5 * Math.sin(phase + index * 1.9)
      const level =
        (s.tone ?? 1) *
        (fields[slot]?.strength ?? 1) *
        (s.steady ? 1 : lerp(BREATH_LOW, 1, breath))
      const scale = s.steady
        ? 1
        : 1 + BREATH_SCALE * Math.sin(phase * 0.8 + index * 2.7)
      const pool = this.#nodes[slot]!
      const at = used[slot]!++
      let node = pool[at]
      if (!node) {
        node = new ShapeNode({
          geometry: { kind: 'rect', width: 1, height: 1 },
        })
        layer.add(node)
        pool.push(node)
      }
      node.visible = true
      if (s.shape === 'circle') {
        // Painted over the whole area, as the background's spots are, so the
        // gradient is in the area's own coordinates.
        const radius = (s.w * shorter * scale) / 2
        node.transform.x = area.x
        node.transform.y = area.y
        node.transform.rotation = 0
        node.geometry = {
          kind: 'rect',
          width: area.width,
          height: area.height,
          centered: false,
        }
        node.fill = {
          kind: 'radial',
          cx: s.x * area.width,
          cy: s.y * area.height,
          r: radius,
          stops: [
            { offset: 0, color: tone(level) },
            ...(s.underText
              ? [{ offset: CIRCLE_CORE, color: tone(level) }]
              : [{ offset: 0.5, color: tone(level * 0.45) }]),
            { offset: 1, color: TONE_RIM },
          ],
        }
      } else {
        node.transform.x = area.x + s.x * area.width
        node.transform.y = area.y + s.y * area.height
        node.transform.rotation = ((s.rotate ?? 0) * Math.PI) / 180
        node.geometry = {
          kind: 'rect',
          width: s.w * area.width * scale,
          height: (s.h ?? s.w) * area.height * scale,
        }
        // The tone fades from the outer end to the inner one, so the block
        // melts into the background instead of ending in four hard sides.
        const half = (s.w * area.width * scale) / 2
        const outer = s.x < 0.5 ? -half : half
        node.fill = {
          kind: 'linear',
          x0: outer,
          y0: 0,
          x1: -outer,
          y1: 0,
          stops: [
            { offset: 0, color: tone(level) },
            { offset: 1, color: TONE_RIM },
          ],
        }
      }
    })
    this.layers.forEach((layer, slot) => {
      const pool = this.#nodes[slot]!
      for (let i = used[slot]!; i < pool.length; i++) pool[i]!.visible = false
      layer.visible = used[slot]! > 0
    })
    this.clock.running = shapes.length > 0
  }

  destroy(): void {
    for (const layer of this.layers) layer.destroy()
  }
}
