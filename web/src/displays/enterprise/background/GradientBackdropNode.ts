import {
  Node2D,
  definePaintProps,
  type Canvas,
  type GfxGradientStop,
  type GfxLinearGradient,
} from 'stargazer'

/** CSS angle, degrees clockwise from straight up. */
const ANGLE_DEG = 114

/** The `linear-gradient(114deg, ...)` stops, as CSS positions along the line. */
const STOPS = [
  { offset: 0.0385, color: '#F5F4F9' },
  { offset: 0.4345, color: '#D1C3F4' },
  { offset: 0.8305, color: '#8268DA' },
] as const

/**
 * The picker's backdrop: an elliptical radial gradient lit from the top left,
 * drawn here as a circle. Its stops sit at the fractions of the brand design's
 * 2300 px reach, and the circle is larger than that so a window wider than the
 * frame still has colour at its far edge.
 */
const RADIAL_CENTER = { x: 66, y: -49.5 }
const RADIAL_DESIGN_REACH = 2300
const RADIAL_RADIUS = 3600
const RADIAL_STOPS = [
  { offset: 0, color: '#F5F4F9' },
  { offset: 0.5, color: '#D1C3F4' },
  { offset: 0.75, color: '#A996E7' },
  { offset: 1, color: '#8268DA' },
] as const

/**
 * How far past the frame the fill reaches, in frames, so a canvas whose aspect
 * differs from the frame's still has no uncovered edge.
 */
const OVERSCAN = 1

/**
 * Fills a frame with the brand's diagonal gradient, laid out the way CSS lays
 * out `linear-gradient(114deg, ...)` on a box of the same size: the gradient
 * line runs through the centre at the angle, and is long enough that the
 * corners land exactly on its first and last position. Before the first stop
 * and after the last the end colours hold.
 *
 * `radialMix` blends in the picker's radial gradient over it, from 0 (the
 * diagonal alone) to 1 (the radial alone), so a screen change can fade between
 * the two.
 *
 * @example
 *   stage.tree.root.add(new GradientBackdropNode(1920, 1080))
 */
export class GradientBackdropNode extends Node2D {
  readonly #width: number
  readonly #height: number
  readonly #paint: GfxLinearGradient
  readonly #radialStops: GfxGradientStop[]

  /** How much of the radial gradient shows, from 0 to 1. */
  declare radialMix: number

  constructor(width: number, height: number) {
    super('gradient-backdrop')
    definePaintProps(this, { radialMix: 0 })
    this.#width = width
    this.#height = height
    const reach = RADIAL_DESIGN_REACH / RADIAL_RADIUS
    this.#radialStops = [
      ...RADIAL_STOPS.map((stop) => ({
        offset: stop.offset * reach,
        color: stop.color,
      })),
      { offset: 1, color: RADIAL_STOPS[RADIAL_STOPS.length - 1].color },
    ]

    const rad = (ANGLE_DEG * Math.PI) / 180
    const dx = Math.sin(rad)
    const dy = -Math.cos(rad)
    const length = Math.abs(width * dx) + Math.abs(height * dy)
    const cx = width / 2
    const cy = height / 2
    this.#paint = {
      kind: 'linear',
      x0: cx - (dx * length) / 2,
      y0: cy - (dy * length) / 2,
      x1: cx + (dx * length) / 2,
      y1: cy + (dy * length) / 2,
      stops: [
        { offset: 0, color: STOPS[0].color },
        ...STOPS,
        { offset: 1, color: STOPS[STOPS.length - 1].color },
      ],
    }
  }

  override paint(gfx: Canvas): void {
    gfx.fillRect(
      -this.#width * OVERSCAN,
      -this.#height * OVERSCAN,
      this.#width * (1 + 2 * OVERSCAN),
      this.#height * (1 + 2 * OVERSCAN),
      this.#paint,
    )
    if (this.radialMix <= 0) return
    gfx.save()
    gfx.setAlpha(this.radialMix)
    gfx.fillCircleRadialGradient(
      RADIAL_CENTER.x,
      RADIAL_CENTER.y,
      RADIAL_RADIUS,
      this.#radialStops,
    )
    gfx.restore()
  }
}
