/**
 * The six steering controls, as a four-column grid.
 *
 * Each button is its own node so it carries its own behavior and hit rect,
 * which is what a large touchscreen needs: the targets are as big as the band
 * allows and nothing has to work out which one a finger landed on.
 *
 * Two things here are deliberate and easy to undo by accident.
 *
 * The buttons hit-test with no touch slop. The engine inflates every hit rect
 * by thirty CSS pixels on all four sides, and the hit walk returns the last
 * node in paint order, so adjacent inflated rects overlap and a near-miss
 * resolves one direction every time. That is harmless where a mis-tap costs a
 * color. Here it ends a run.
 *
 * Movement and soft drop fire on the press and repeat while held. Rotation and
 * hard drop fire once. A repeating rotate would feed the lock-down limit, and a
 * repeating hard drop would end runs on its own.
 *
 * Banking a piece is not here. It lives beside the pocket it fills, where its
 * effect is visible, and it is a verb rather than a direction.
 */
import {
  HoldButtonBehavior,
  Node2D,
  type CameraView2D,
  type Gfx2D,
} from '@src/stargazer'
import { computeControlRects, type ControlId } from '../layout'
import { accentForLevel, COLORS, DAS, FRAME } from '../tuning'
import type { Action, Bounds } from '../types'
import { drawCap, ruleWidth } from './tui'

/** Which action each control sends, and whether holding it repeats. */
interface ControlSpec {
  id: ControlId
  action: Action | null
  repeat: boolean
}

const SPECS: readonly ControlSpec[] = [
  { id: 'left', action: 'left', repeat: true },
  { id: 'rotateCCW', action: 'rotateCCW', repeat: false },
  // Soft drop sends no action: it scores per cell descended, which only the
  // session can count, so it reports the held state instead.
  { id: 'softDrop', action: null, repeat: false },
  { id: 'hardDrop', action: 'hardDrop', repeat: false },
  { id: 'right', action: 'right', repeat: true },
  { id: 'rotateCW', action: 'rotateCW', repeat: false },
]

export interface ControlCallbacks {
  onAction: (action: Action) => void
  onSoftDrop: (held: boolean) => void
  enabled: () => boolean
}

class ControlButtonNode extends Node2D {
  #rect: Bounds = { x: 0, y: 0, width: 0, height: 0 }
  #pressed = false
  #accent = accentForLevel(1)
  readonly id: ControlId

  constructor(spec: ControlSpec, cb: ControlCallbacks) {
    super(`bo-control-${spec.id}`)
    this.id = spec.id
    this.renderLayer = 'dynamic'
    this.addBehavior(
      new HoldButtonBehavior({
        onPress: () => {
          if (spec.action) cb.onAction(spec.action)
        },
        repeat: spec.repeat
          ? { delay: DAS.delay, interval: DAS.interval }
          : undefined,
        enabled: cb.enabled,
        onPressedChange: (pressed) => {
          this.#pressed = pressed
          if (spec.id === 'softDrop') cb.onSoftDrop(pressed)
        },
      }),
    )
  }

  setRect(rect: Bounds): void {
    this.#rect = rect
    this.transform.x = rect.x
    this.transform.y = rect.y
    this.debugBounds = { x: 0, y: 0, width: rect.width, height: rect.height }
  }

  setLevel(level: number): void {
    this.#accent = accentForLevel(level)
  }

  /**
   * No touch slop, unlike the engine default.
   *
   * These targets are several fingertips wide, so slop buys nothing and costs a
   * mis-routed press between neighbours.
   */
  override hitTest(worldX: number, worldY: number): boolean {
    return super.hitTest(worldX, worldY, 0)
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const w = this.#rect.width
    const h = this.#rect.height
    if (w <= 0 || h <= 0) return

    // Pressing inverts the cap rather than sinking it. At arm's length a solid
    // block appearing is a far faster read than a face travelling two pixels,
    // and it is what a terminal does with a key.
    const ink = drawCap(
      gfx,
      { x: 0, y: 0, width: w, height: h },
      {
        rule: this.#accent,
        width: ruleWidth(gfx, FRAME.capRulePx, camera.strokeSpaceScale()),
        pressed: this.#pressed,
        // The one action that cannot be undone takes a doubled rule rather than
        // a filled face, so it reads as the heaviest control without becoming a
        // second pressed state.
        heavy: this.id === 'hardDrop',
        ink: COLORS.ink,
        pressedInk: COLORS.inkDark,
        fill: COLORS.pane,
      },
    )
    drawGlyph(
      gfx,
      this.id,
      w / 2,
      h / 2,
      Math.min(w, h),
      camera.strokeSpaceScale(),
      ink,
    )
  }
}

/**
 * The mark on each button.
 *
 * Drawn rather than set as text or loaded as an asset. These are six short
 * polylines. A font glyph would render at whatever weight and optical size the
 * family happens to ship, and an SVG would be a texture upload and a batch
 * break for something that is four line segments.
 *
 * The paths are the authored icons transcribed exactly, in their own thirty-two
 * unit box, and drawn through a scale so the box lands at a fixed size on
 * screen. Every mark is therefore the same size on every cap, however big the
 * cap is, which is what stops the drops looking like a different set of
 * controls from the turns beside them.
 */

/** The box the icons were drawn in. */
const GLYPH_BOX = 32
/** What that box measures on screen, in CSS pixels, on any cap. */
const GLYPH_CSS_PX = 26
/** The authored stroke, in the same box units. */
const GLYPH_STROKE = 2

/**
 * Each icon as polylines in the source box.
 *
 * Transcribed from the authored SVGs and deliberately not tidied. The two
 * movement arrows have shafts of the same length reaching different distances
 * from centre, and the two turn arrows are mirrored rather than rotated, both
 * of which are how they were drawn.
 */
const GLYPH_PATHS: Record<ControlId, readonly (readonly number[])[]> = {
  left: [
    [16, 23, 7, 16, 16, 9],
    [7, 16, 24, 16],
  ],
  right: [
    [16, 23, 25, 16, 16, 9],
    [25, 16, 8, 16],
  ],
  softDrop: [[7, 10, 16, 23, 25, 10]],
  hardDrop: [
    [7, 7, 16, 20, 25, 7],
    [8, 26, 24, 26],
  ],
  rotateCCW: [
    [9, 23, 23, 23, 23, 9, 9, 9, 9, 16.875],
    [5, 14, 9, 18, 13, 14],
  ],
  rotateCW: [
    [23, 23, 9, 23, 9, 9, 23, 9, 23, 16.875],
    [27, 14, 23, 18, 19, 14],
  ],
}

function drawGlyph(
  gfx: Gfx2D,
  id: ControlId,
  cx: number,
  cy: number,
  cap: number,
  scale: number,
  ink: string,
): void {
  // Clamped only so a cap smaller than the mark does not have the mark hanging
  // out of it. At every size the game actually draws, the constant wins.
  const box = Math.min(GLYPH_CSS_PX * scale, cap * 0.8)
  const unit = box / GLYPH_BOX
  const style = {
    color: ink,
    width: GLYPH_STROKE,
    cap: 'square' as const,
    join: 'bevel' as const,
  }

  gfx.save()
  gfx.translate(cx - box / 2, cy - box / 2)
  gfx.scale(unit, unit)
  for (const path of GLYPH_PATHS[id]) {
    gfx.strokePolyline(scratch(path), path.length / 2, style)
  }
  gfx.restore()
}

/** One reused buffer, so a frame of six marks allocates nothing. */
const points = new Float32Array(16)

function scratch(path: readonly number[]): Float32Array {
  for (let i = 0; i < path.length; i++) points[i] = path[i]
  return points
}

/**
 * The six caps, placed from one band.
 *
 * Each button is its own child so it carries its own behavior and its own hit
 * rect. Placing them from a single `computeControlRects` call keeps the grid's
 * arithmetic in the layout module, where it is tested, rather than in a node.
 */
export class ControlClusterNode extends Node2D {
  readonly #buttons: readonly ControlButtonNode[]

  constructor(cb: ControlCallbacks) {
    super('bo-controls')
    this.#buttons = SPECS.map((spec) => new ControlButtonNode(spec, cb))
    this.add(...this.#buttons)
  }

  /** `band` is the inside of the input frame, not the frame itself. */
  setRect(band: Bounds): void {
    const rects = computeControlRects(band)
    for (const button of this.#buttons) button.setRect(rects[button.id])
  }

  setLevel(level: number): void {
    for (const button of this.#buttons) button.setLevel(level)
  }
}
