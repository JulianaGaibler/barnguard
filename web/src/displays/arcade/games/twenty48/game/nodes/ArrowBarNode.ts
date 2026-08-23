/**
 * One of the four bars hugging a board's edges. Tapping it moves that way,
 * which is the discoverable alternative to a swipe for anyone who does not
 * think to try one.
 *
 * Deliberately flat, unlike everything else here: the bars are an affordance
 * rather than part of the board, and giving them the same extruded treatment
 * made them compete with the tiles for attention. A faint wash and a chevron is
 * enough to read as a target on a touchscreen.
 */
import {
  ButtonBehavior,
  mixColor,
  Node2D,
  withAlpha,
  type Gfx2D,
} from '@src/stargazer'
import type { Bounds, Direction } from '../types'
import { COLORS } from '../tuning'

/** Background wash, and the slightly stronger one while held. */
const REST_TINT = 0.05
const PRESSED_TINT = 0.12
/** Chevron arm length as a fraction of the bar's short side. */
const CHEVRON_FRAC = 0.3
/** How far the chevron reads toward full ink. */
const CHEVRON_INK = 0.4

/**
 * The chevron is drawn OPAQUE, at the colour a translucent one would composite
 * to over the bar. Its two arms necessarily overlap at the elbow, and any
 * overlap of translucent geometry composites twice there. Opaque geometry has
 * no such problem, so the colour is resolved up front instead.
 */
function chevronColor(tint: number): string {
  const backdrop = mixColor(COLORS.background, '#000000', tint)
  return mixColor(backdrop, COLORS.ink, CHEVRON_INK)
}
const CHEVRON_REST = chevronColor(REST_TINT)
const CHEVRON_PRESSED = chevronColor(PRESSED_TINT)

export class ArrowBarNode extends Node2D {
  #rect: Bounds
  #pressed = false
  readonly #dir: Direction
  /** Reused chevron points: arm, elbow, arm. */
  readonly #chevron = new Float32Array(6)

  constructor(
    dir: Direction,
    rect: Bounds,
    opts: { onPress: (dir: Direction) => void; enabled: () => boolean },
  ) {
    super(`t48-arrow-${dir}`)
    this.renderLayer = 'dynamic'
    this.#dir = dir
    this.#rect = rect
    this.setRect(rect)
    this.addBehavior(
      new ButtonBehavior({
        onClick: () => opts.onPress(dir),
        enabled: opts.enabled,
        onPressedChange: (p) => (this.#pressed = p),
      }),
    )
  }

  /** Which way this bar moves the board. */
  get direction(): Direction {
    return this.#dir
  }

  setRect(rect: Bounds): void {
    this.#rect = rect
    this.transform.x = rect.x
    this.transform.y = rect.y
    // Local space, as `hitTest` expects.
    this.debugBounds = { x: 0, y: 0, width: rect.width, height: rect.height }
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#rect.width
    const h = this.#rect.height
    const short = Math.min(w, h)
    gfx.fillRoundRect(
      0,
      0,
      w,
      h,
      short * 0.42,
      withAlpha('#000000', this.#pressed ? PRESSED_TINT : REST_TINT),
    )
    this.#drawChevron(gfx, w / 2, h / 2, short * CHEVRON_FRAC)
  }

  /**
   * A fat rounded chevron: arm, elbow, arm as ONE polyline rather than two
   * lines. Two separate strokes would overlap at the elbow, and at this alpha
   * that composites twice into a visibly darker notch. As a single stroke the
   * renderer deduplicates the overlap for us.
   */
  #drawChevron(gfx: Gfx2D, cx: number, cy: number, size: number): void {
    const arm = size
    const d = this.#dir
    // The elbow leads and the arms trail, so the chevron points the way it
    // moves.
    const ex =
      d === 'left' ? cx - arm * 0.5 : d === 'right' ? cx + arm * 0.5 : cx
    const ey = d === 'up' ? cy - arm * 0.5 : d === 'down' ? cy + arm * 0.5 : cy
    const p = this.#chevron
    if (d === 'up' || d === 'down') {
      const back = d === 'up' ? ey + arm : ey - arm
      p[0] = ex - arm
      p[1] = back
      p[4] = ex + arm
      p[5] = back
    } else {
      const back = d === 'left' ? ex + arm : ex - arm
      p[0] = back
      p[1] = ey - arm
      p[4] = back
      p[5] = ey + arm
    }
    p[2] = ex
    p[3] = ey
    gfx.strokePolyline(p, 3, {
      color: this.#pressed ? CHEVRON_PRESSED : CHEVRON_REST,
      width: arm * 0.42,
      cap: 'round',
      join: 'round',
    })
  }
}
