/**
 * One of the two big table buttons, HIT and STAY.
 *
 * @remarks
 *   Built the way the art draws it: stacked flat fills, one color per surface,
 *   with no lighting anywhere. The mockup shades nothing, so neither does this.
 *   A side band and its cap are separate meshes precisely so each can take its
 *   own painted color rather than relying on a light to tell them apart.
 *
 *   The height is not a drawn number, it is derived from how far the art offsets
 *   the cap above the base, see `project.test.ts`.
 *
 *   Only the body takes pointer input. Picking is bounds-level, and the two
 *   buttons sit a clear 31 design pixels apart, so a box around each is exact
 *   here in a way it would not be for overlapping cards.
 */
import {
  MeshNode,
  Node3D,
  createDiscGeometry,
  createPrismGeometry,
  easings,
  type Node,
  type PointerEvent2D,
} from '@src/stargazer'
import { ELEVATION, PX_TO_M, groundFromLayout } from '../project'
import { ANIM, BLINK, BUTTONS, COLORS, material } from '../tuning'

/**
 * Blinks a set of buttons together.
 *
 * Together because they are one face. Two eyes on the same head blinking out of
 * step reads as two objects that happen to be near each other, which is exactly
 * what the composition is trying not to look like.
 */
export class BlinkNode extends Node3D {
  readonly #eyes: readonly ButtonNode[]
  /** What is left of the current blink: alternating shut and open holds. */
  readonly #steps: { shut: boolean; hold: number }[] = []
  #timer = 0
  #double = false

  constructor(eyes: readonly ButtonNode[]) {
    super('monsters-int-blink')
    this.#eyes = eyes
    this.#timer = this.#gap()
  }

  override onUpdate(dt: number): void {
    this.#timer -= dt
    if (this.#timer > 0) return
    if (this.#steps.length === 0) this.#schedule()
    const step = this.#steps.shift()!
    for (const eye of this.#eyes) eye.setBlinking(step.shut)
    this.#timer = step.hold
  }

  /** One blink and the wait after it. Every other blink is a double. */
  #schedule(): void {
    this.#double = !this.#double
    this.#steps.push({ shut: true, hold: BLINK.shut })
    if (this.#double) {
      this.#steps.push({ shut: false, hold: BLINK.between })
      this.#steps.push({ shut: true, hold: BLINK.shut })
    }
    this.#steps.push({ shut: false, hold: this.#gap() })
  }

  #gap(): number {
    return BLINK.minGap + Math.random() * (BLINK.maxGap - BLINK.minGap)
  }
}

/** Total rise in metres, from the cap offset the art draws. */
const HEIGHT = (BUTTONS.capRiseOnScreen * PX_TO_M) / Math.cos(ELEVATION)
const BASE_HEIGHT = HEIGHT * BUTTONS.baseHeightFrac
const BODY_HEIGHT = HEIGHT - BASE_HEIGHT

/**
 * A flat-shaded disc: a side band in one color with a cap in another.
 *
 * Two meshes rather than one, because a single capped cylinder would need a
 * light to separate its top from its side, and the art separates them by
 * painting them differently.
 */
function flatDisc(
  radiusPx: number,
  height: number,
  sideColor: string,
  capColor: string,
  paint: (mesh: MeshNode, hex: string) => void,
): MeshNode {
  const radius = radiusPx * PX_TO_M
  const side = new MeshNode(
    createPrismGeometry({
      sides: BUTTONS.sides,
      radius,
      height,
      caps: false,
    }),
    { lit: false, color: material(sideColor), doubleSided: true },
  )
  const cap = new MeshNode(
    createDiscGeometry({ radius, segments: BUTTONS.sides }),
    { lit: false, color: material(capColor) },
  )
  cap.transform.setPosition(0, height, 0)
  side.add(cap)
  paint(side, sideColor)
  paint(cap, capColor)
  return side
}

/**
 * The shut eye: a downward arc where the open one is a filled circle.
 *
 * Drawn as the near half of a thin ring, so it reads as a lid rather than as a
 * smaller pupil. The button is a face, and a face says whether it is listening
 * more plainly than any amount of grey does.
 */
function closedEye(): MeshNode {
  const radius = BUTTONS.holeRadius * PX_TO_M
  return new MeshNode(
    createDiscGeometry({
      radius,
      innerRadius: radius * (1 - BUTTONS.lidThickness),
      segments: 32,
      // From -X, sweeping over the half nearest the camera, which is the half
      // that reads as the bottom of the eye.
      startAngle: Math.PI,
      sweepAngle: Math.PI,
    }),
    { lit: false, color: material(COLORS.ink) },
  )
}

export class ButtonNode extends Node3D {
  readonly body: MeshNode
  /**
   * The parts that travel on a press. The plate stays put, so the button sinks
   * INTO its own lip rather than the whole assembly pushing through the table.
   */
  readonly #moving = new Node3D('button-moving')
  /** Every painted surface with the color it is painted, for the dimming. */
  readonly #painted: { mesh: MeshNode; hex: string }[] = []
  readonly #openEye: MeshNode
  readonly #shutEye: MeshNode
  #enabled = true
  #blinking = false
  #pressed = false
  #onPress: () => void

  constructor(layoutX: number, onPress: () => void, id: string) {
    super(id)
    this.#onPress = onPress
    const paint = (mesh: MeshNode, hex: string): void => {
      this.#painted.push({ mesh, hex })
    }

    const plate = flatDisc(
      BUTTONS.baseRadius,
      BASE_HEIGHT,
      COLORS.buttonShade,
      COLORS.buttonSide,
      paint,
    )
    this.add(plate)

    this.body = flatDisc(
      BUTTONS.radius,
      BODY_HEIGHT,
      COLORS.buttonBody,
      COLORS.buttonCap,
      paint,
    )
    this.body.transform.setPosition(0, BASE_HEIGHT, 0)
    this.add(this.#moving)
    this.#moving.add(this.body)

    // Both eyes are built and one is hidden, so opening and shutting is a flag
    // rather than a rebuild. A mesh swapped in later would upload on the frame
    // it appears, which is the frame a player is waiting on.
    this.#openEye = new MeshNode(
      createDiscGeometry({
        radius: BUTTONS.holeRadius * PX_TO_M,
        segments: 48,
      }),
      { lit: false, color: material(COLORS.ink) },
    )
    this.#shutEye = closedEye()
    for (const eye of [this.#openEye, this.#shutEye]) {
      eye.transform.setPosition(0, HEIGHT + 0.0002, 0)
      this.#moving.add(eye)
    }
    this.#showEye()

    const ground = groundFromLayout(layoutX, BUTTONS.groundY)
    this.transform.setPosition(ground.x, 0, ground.z)

    // Both parts take taps. The plate is the wider target and reads as part of
    // the button, so a finger landing on the lip should press it.
    for (const part of [plate, this.body]) {
      part.hitEnabled = true
      part.onPointerDown = () => this.#down()
      part.onPointerUp = (e) => this.#up(e)
      part.onPointerCancel = () => this.#release()
    }
  }

  /**
   * Whether the button takes taps, and says so.
   *
   * A disabled button rests pressed into its plate with its eye shut and its
   * colors down. Three signals rather than one, because the table is looked at
   * from a metre away and standing up.
   */
  setEnabled(enabled: boolean): void {
    if (this.#enabled === enabled) return
    this.#enabled = enabled
    this.#pressed = false
    this.#showEye()
    for (const { mesh, hex } of this.#painted) {
      mesh.material.color = material(hex, 1, enabled ? 1 : BUTTONS.shade)
    }
    this.#sink(this.#restY())
  }

  /**
   * Shut the eye for a moment. Ignored by a button that takes no taps, since
   * its eye is shut already.
   */
  setBlinking(shut: boolean): void {
    if (this.#blinking === shut) return
    this.#blinking = shut
    this.#showEye()
  }

  /**
   * Which eye is showing, from all three reasons it could be shut: the button
   * takes no taps, it is mid-blink, or a finger is on it.
   *
   * One place, because they overlap freely. A button disabled mid-blink, one
   * re-enabled mid-blink, one released after the blink that started under it:
   * every ordering has to land on the right eye.
   */
  #showEye(): void {
    const open = this.#enabled && !this.#blinking && !this.#pressed
    this.#openEye.visible = open
    this.#shutEye.visible = !open
  }

  get enabled(): boolean {
    return this.#enabled
  }

  /**
   * Hold the button down, or let it up.
   *
   * Public because the tutorial presses it with nothing to press it: a demo
   * that drew its own button instead would be a second copy of this one, free
   * to drift out of step with the real control it is teaching.
   */
  setPressed(pressed: boolean): void {
    if (this.#pressed === pressed) return
    if (pressed && !this.#enabled) return
    this.#pressed = pressed
    // Pressed, you are poking it in the eye.
    this.#showEye()
    this.#sink(pressed ? -BUTTONS.pressDepth * PX_TO_M : this.#restY())
  }

  #down(): void {
    this.setPressed(true)
  }

  /**
   * A release only counts where the press landed.
   *
   * The pointer is captured by whatever it went down on, so this fires wherever
   * the finger ends up. Asking the input system what is under it again is what
   * lets someone press, think better of it, slide off and let go.
   */
  #up(e: PointerEvent2D): void {
    if (!this.#pressed) return
    const onTarget = this.#owns(
      e.stage.input?.pick3D(e.pointer.screen.x, e.pointer.screen.y) ?? null,
    )
    this.#release()
    if (this.#enabled && onTarget) this.#onPress()
  }

  /** Whether a node is one of this button's own parts. */
  #owns(node: Node | null): boolean {
    for (let n = node; n; n = n.parent) if (n === this) return true
    return false
  }

  /** Where the button sits when nobody is touching it. */
  #restY(): number {
    return this.#enabled ? 0 : -BUTTONS.restDepth * PX_TO_M
  }

  #release(): void {
    this.setPressed(false)
  }

  /** Keyed, so a fast double tap restarts the dip instead of queueing two. */
  #sink(y: number): void {
    // A tween needs an engine to run on, and `play` rethrows that as an
    // unhandled rejection rather than a no-op. Snapping keeps the pose right
    // for a button built but not yet added, which is what a test does.
    if (!this.#moving.engine) {
      this.#moving.transform.setPosition(0, y, 0)
      return
    }
    this.#moving.play(
      { position: { x: 0, y, z: 0 } },
      { duration: ANIM.buttonPress, easing: easings.outCubic, key: 'press' },
    )
  }
}
