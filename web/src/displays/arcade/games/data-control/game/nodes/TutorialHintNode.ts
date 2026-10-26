import {
  Node2D,
  easings,
  flattenCubic,
  lerp,
  registerPathTessellation,
  type Canvas,
  type Vec2,
} from 'stargazer'

// -----------------------------------------------------------------------------
// Tuning, kept module-local. Promote to `TUNING.tutorial.hint` if the demo
// grows more knobs or we need per-context overrides.
// -----------------------------------------------------------------------------

/**
 * How long to sit idle after `setGeometry` fires before the very first cycle
 * begins. Gives the card its own moment on screen before the hint animation
 * kicks in, reads less "loud".
 */
const INITIAL_DELAY_SEC = 3.0
/** Total cycle length (seconds). Enter + trace + exit + gap must sum to this. */
const CYCLE_SEC = 9.2
/** Hand slides up from below + fades in. */
const ENTER_SEC = 0.8
/** Fingertip tracks the bezier from packet to epicenter. */
const TRACE_SEC = 2.5
/** Hand slides down + fades out. */
const EXIT_SEC = 0.8
/** Gap = CYCLE_SEC - (enter + trace + exit) = 5.1 s of alpha 0. */

/**
 * Bezier arch height as a fraction of the viewport height. Larger = taller
 * arch. The two control points sit at the same negative Y offset (canvas Y
 * increases DOWN, so subtracting Y = "higher on screen"), one near the start
 * and one near the end.
 */
const ARCH_FRAC = 0.4
/**
 * How far below the viewport (in the same world-Y units) the hand parks during
 * the `gap` phase, as a fraction of viewport height. The hand tweens from
 * `packet.y + viewportHeight × HAND_OFFSCREEN_FRAC` up to the packet's Y during
 * `enter`, and back down during `exit`.
 */
const HAND_OFFSCREEN_FRAC = 0.6

/**
 * Uniform scale applied to the hand SVG when rendering. The SVG's viewBox is
 * 238 × 277. At scale 1 that's much wider than the 200 wu tutorial viewport.
 * `0.5` shrinks it to ~119 × 139 wu, big enough to read as a hand, small enough
 * to leave room for the arch.
 */
const HAND_SCALE = 0.5

const CURVE_COLOR = 'rgba(253, 246, 227, 0.55)'
const CURVE_WIDTH_CSS_PX = 2
const CURVE_DASH_CSS_PX: readonly [number, number] = [10, 8]

/** Alpha threshold below which we skip the draw pass entirely. */
const MIN_DRAW_ALPHA = 0.01

/**
 * Fingertip position inside the hand SVG's viewBox (see `hand.svg`). The
 * constructor pre-translates both hand paths by `(-x, -y)` so that after
 * translation, `ctx.translate(handX, handY)` places the fingertip at `(handX,
 * handY)` in world space.
 */
export const HAND_FINGERTIP_OFFSET: Readonly<Vec2> = { x: 22, y: 10 }

type Phase = 'enter' | 'trace' | 'exit' | 'gap'

function resolvePhase(elapsed: number): {
  phase: Phase
  t: number
} {
  if (elapsed < ENTER_SEC) return { phase: 'enter', t: elapsed / ENTER_SEC }
  const afterEnter = elapsed - ENTER_SEC
  if (afterEnter < TRACE_SEC)
    return { phase: 'trace', t: afterEnter / TRACE_SEC }
  const afterTrace = afterEnter - TRACE_SEC
  if (afterTrace < EXIT_SEC) return { phase: 'exit', t: afterTrace / EXIT_SEC }
  return { phase: 'gap', t: 0 }
}

/**
 * The dashed arch. Its alpha is the parent's envelope, written on the
 * transform.
 */
class HintArchNode extends Node2D {
  #path: Path2D | null = null

  constructor() {
    super('tutorial-hint-arch')
    this.visible = false
  }

  setPath(path: Path2D): void {
    this.#path = path
    this.markNeedsPaint()
  }

  override paint(canvas: Canvas): void {
    const path = this.#path
    if (!path) return
    const strokeScale = canvas.screenScale()
    canvas.strokePath2D(path, {
      color: CURVE_COLOR,
      width: CURVE_WIDTH_CSS_PX * strokeScale,
      cap: 'round',
      dash: [
        CURVE_DASH_CSS_PX[0] * strokeScale,
        CURVE_DASH_CSS_PX[1] * strokeScale,
      ],
    })
  }
}

/**
 * The hand, drawn with its fingertip at the node origin. The parent moves it
 * and fades it through the transform.
 */
class HintHandNode extends Node2D {
  readonly #pathBlack: Path2D
  readonly #pathWhite: Path2D

  constructor(pathBlack: Path2D, pathWhite: Path2D) {
    super('tutorial-hint-hand')
    this.#pathBlack = pathBlack
    this.#pathWhite = pathWhite
    this.transform.scaleX = HAND_SCALE
    this.transform.scaleY = HAND_SCALE
    this.visible = false
  }

  override paint(canvas: Canvas): void {
    canvas.translate(-HAND_FINGERTIP_OFFSET.x, -HAND_FINGERTIP_OFFSET.y)
    canvas.fillPath2D(this.#pathBlack, '#000000')
    canvas.fillPath2D(this.#pathWhite, '#ffffff')
  }
}

/**
 * Looping demo overlay for the tutorial mini-stage. Shows a dashed bezier arch
 * between the packet spawn point and the epicenter centre, then animates a hand
 * SVG whose fingertip enters from below the packet, traces the arch, and exits
 * below the epicenter. Cycles every `CYCLE_SEC` until `stop()` is called (on
 * first pointerdown inside the tutorial canvas).
 *
 * `setGeometry` is called by `TutorialSession` on construction AND on every
 * canvas resize so the arch keeps tracking the packet + epicenter positions
 * even if the world viewport reshapes.
 */
export class TutorialHintNode extends Node2D {
  readonly #arch = new HintArchNode()
  readonly #hand: HintHandNode
  /** Dashed bezier arch, rebuilt whenever `setGeometry` runs. */
  #archReady = false

  readonly #p0: Vec2 = { x: 0, y: 0 }
  readonly #p1: Vec2 = { x: 0, y: 0 }
  readonly #p2: Vec2 = { x: 0, y: 0 }
  readonly #p3: Vec2 = { x: 0, y: 0 }
  #handOffscreenY = 0
  #geometryReady = false

  #elapsed = 0
  /**
   * Countdown before the first cycle starts (seconds). Decrements in `onUpdate`
   * until it hits zero, then the phase clock advances. `alpha` stays 0 during
   * this window so nothing renders.
   */
  #preDelay = INITIAL_DELAY_SEC
  #stopped = false
  #handX = 0
  #handY = 0
  #alpha = 0

  readonly #scratch: Vec2 = { x: 0, y: 0 }

  /**
   * @param rawBlack, The SVG's first `<path>` (fill=black, hand shape).
   * @param rawWhite, The SVG's second `<path>` (fill=white, outline). The hand
   *   node shifts both so the fingertip sits at the node origin.
   */
  constructor(rawBlack: Path2D, rawWhite: Path2D) {
    super('tutorial-hint')
    this.#hand = new HintHandNode(rawBlack, rawWhite)
    this.add(this.#arch)
    this.add(this.#hand)
  }

  /**
   * Reshape the arch to fit new packet / epicenter positions. Called once at
   * construction and again from `TutorialSession.handleResize`.
   */
  setGeometry(packet: Vec2, epicenter: Vec2, viewportHeight: number): void {
    this.#p0.x = packet.x
    this.#p0.y = packet.y
    this.#p3.x = epicenter.x
    this.#p3.y = epicenter.y
    const dx = epicenter.x - packet.x
    const arch = viewportHeight * ARCH_FRAC
    this.#p1.x = packet.x + 0.25 * dx
    this.#p1.y = packet.y - arch
    this.#p2.x = packet.x + 0.75 * dx
    this.#p2.y = packet.y - arch
    this.#handOffscreenY = viewportHeight * HAND_OFFSCREEN_FRAC
    // Pre-build the (now fixed) dashed arch so paint only sets the dash scale.
    const archPath = new Path2D()
    archPath.moveTo(this.#p0.x, this.#p0.y)
    archPath.bezierCurveTo(
      this.#p1.x,
      this.#p1.y,
      this.#p2.x,
      this.#p2.y,
      this.#p3.x,
      this.#p3.y,
    )
    this.#arch.setPath(archPath)
    this.#archReady = true
    // Also register a flattened polyline so the GPU backend's
    // `strokePath2D(archPath, …)` finds contours to stroke. Empty
    // geometry (triangles), the arch is stroke-only, never filled.
    const flat = new Float32Array(1024)
    flat[0] = this.#p0.x
    flat[1] = this.#p0.y
    const cursor = flattenCubic(
      this.#p0.x,
      this.#p0.y,
      this.#p1.x,
      this.#p1.y,
      this.#p2.x,
      this.#p2.y,
      this.#p3.x,
      this.#p3.y,
      0.5,
      flat,
      2,
    )
    const contour = flat.slice(0, cursor)
    // The arch is an open bezier, stroke must NOT loop the last segment
    // back to the first point. Register with `closed: false` so the GPU
    // `strokePath2D` doesn't emit the spurious closing join that made the
    // arch read as a triangle in the preview.
    registerPathTessellation(
      archPath,
      { vertices: new Float32Array(0), indices: new Uint16Array(0) },
      [contour],
      [false],
    )
    this.#geometryReady = true
  }

  /** Halt the loop and hide the node permanently. */
  stop(): void {
    this.#stopped = true
    this.#alpha = 0
    this.#applyVisuals()
  }

  override onUpdate(dt: number): void {
    if (this.#stopped || !this.#geometryReady || dt <= 0) return
    if (this.#preDelay > 0) {
      this.#preDelay -= dt
      return
    }
    this.#elapsed = (this.#elapsed + dt) % CYCLE_SEC
    const { phase, t } = resolvePhase(this.#elapsed)

    switch (phase) {
      case 'enter': {
        const e = easings.outCubic(t)
        this.#alpha = e
        this.#handX = this.#p0.x
        this.#handY = lerp(this.#p0.y + this.#handOffscreenY, this.#p0.y, e)
        break
      }
      case 'trace': {
        this.#alpha = 1
        cubicBezier(t, this.#p0, this.#p1, this.#p2, this.#p3, this.#scratch)
        this.#handX = this.#scratch.x
        this.#handY = this.#scratch.y
        break
      }
      case 'exit': {
        const e = easings.inCubic(t)
        this.#alpha = 1 - e
        this.#handX = this.#p3.x
        this.#handY = lerp(this.#p3.y, this.#p3.y + this.#handOffscreenY, e)
        break
      }
      case 'gap':
        this.#alpha = 0
        break
    }
    this.#applyVisuals()
  }

  /** Writes the envelope and hand position onto the children's transforms. */
  #applyVisuals(): void {
    const show =
      !this.#stopped &&
      this.#geometryReady &&
      this.#archReady &&
      this.#alpha >= MIN_DRAW_ALPHA
    this.#arch.visible = show
    this.#hand.visible = show
    if (!show) return
    this.#arch.transform.alpha = this.#alpha
    const hand = this.#hand.transform
    hand.alpha = this.#alpha
    hand.x = this.#handX
    hand.y = this.#handY
  }
}

function cubicBezier(
  t: number,
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  out: Vec2,
): void {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  const uuu = uu * u
  const ttt = tt * t
  out.x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x
  out.y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
}
