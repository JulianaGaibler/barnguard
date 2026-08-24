/**
 * The gesture recogniser for the buffer, as a pure state machine.
 *
 * Pure because gestures fail in ways that are invisible from the outside. A
 * threshold that reads distance where it meant speed still works when you try
 * it, and only misbehaves for the player who moves slower than you do. Every
 * rule here is driven by explicit coordinates and timestamps in
 * `gestures.test.ts`, and {@link bindBufferGestures} is the thin adapter that
 * feeds it real pointers.
 *
 * The vocabulary:
 *
 * | Gesture            | Action                                                  |
 * | ------------------ | ------------------------------------------------------- |
 * | tap                | turn clockwise                                          |
 * | two-finger tap     | turn anticlockwise                                      |
 * | two-finger twist   | turn the way you twisted, repeatedly                    |
 * | drag sideways      | slide the piece, relative to where the finger went down |
 * | pull down and hold | soft drop, for as long as the finger stays low          |
 * | flick down         | hard drop                                               |
 *
 * Sliding and soft drop run at the same time on one finger, because pulling a
 * piece down into a gap you are still lining up is one motion for the player
 * and there is no reason for it to be two here.
 *
 * The drag is RELATIVE to where the finger went down, not absolute to the
 * column it is over. Absolute targeting cannot reach the walls, because a piece
 * is positioned by its box origin and a shape whose cells start partway into
 * that box needs a negative origin to touch the left wall.
 */

/** Something the player asked for. */
export type GestureIntent =
  | { kind: 'rotate'; direction: 'cw' | 'ccw' }
  | { kind: 'hardDrop' }
  | { kind: 'dragStart' }
  | { kind: 'dragBy'; columns: number }
  | { kind: 'dragEnd' }
  | { kind: 'softDrop'; held: boolean }

/** Fraction of a cell a finger travels sideways before a tap becomes a drag. */
const DRAG_SLOP_CELLS = 0.55

/**
 * Cells of downward travel that hold the piece in a soft drop.
 *
 * Well past {@link DRAG_SLOP_CELLS}, because a sideways drag across a curved
 * screen drifts down a little and must not start dropping the piece on its
 * own.
 */
export const SOFT_DROP_CELLS = 2

/** Cells of downward travel before a stroke can count as a flick. */
const FLICK_CELLS = 1.6

/** How much steeper than sideways the travel must be to read as a flick. */
const FLICK_RATIO = 1.5

/**
 * Cells per second that separate a flick from a pull.
 *
 * The distinction the gesture actually turns on. Distance alone cannot tell a
 * flick from a slow deliberate pull, and reading one as the other spends the
 * piece on the one action with no way back. A flick is a throw, in the region
 * of forty cells a second, and a pull-down is a few. The line sits nearer the
 * pull so that a hesitant flick still drops, while no speed of pull reaches
 * it.
 */
export const FLICK_SPEED_CELLS_PER_SEC = 14

/**
 * How far back the speed is measured, in milliseconds.
 *
 * Long enough to survive one stuttered frame, short enough that the speed
 * belongs to the stroke happening now rather than to the whole gesture.
 */
const FLICK_WINDOW_MS = 120

/** How long two fingers may rest before their lift stops counting as a tap. */
export const TWO_FINGER_TAP_MS = 320

/** How far either finger may stray and still count as a two-finger tap. */
const TWO_FINGER_SLOP_CELLS = 0.7

/**
 * Radians of twist that turn the piece one step.
 *
 * Twenty degrees. A twist is a slow gesture next to a tap, so this is set low
 * enough that a wrist does it in one motion rather than a regrip.
 */
export const TWIST_STEP_RAD = (20 * Math.PI) / 180

interface Finger {
  readonly startX: number
  readonly startY: number
  readonly startT: number
  x: number
  y: number
  /** Recent positions, for the speed test. Trimmed to {@link FLICK_WINDOW_MS}. */
  readonly trail: { t: number; y: number }[]
}

interface Twist {
  readonly a: number
  readonly b: number
  readonly startT: number
  /** The angle the last turn was emitted at, so twisting on keeps turning. */
  lastStepAngle: number
  /** Set once the pair does anything but rest, which rules out a tap. */
  moved: boolean
}

export interface GestureRecognizerOptions {
  /** Read fresh per event, so a resize needs no rebind. */
  cell: () => number
  emit: (intent: GestureIntent) => void
}

/**
 * Turns pointer positions into {@link GestureIntent}s.
 *
 * Feed it only the pointers that belong to this buffer. It has no opinion about
 * hit testing, and a pointer it never saw go down is ignored.
 */
export class GestureRecognizer {
  readonly #cell: () => number
  readonly #emit: (intent: GestureIntent) => void
  readonly #fingers = new Map<number, Finger>()

  #primary: number | null = null
  #dragging = false
  #softDrop = false
  #spent = false
  #twist: Twist | null = null

  /**
   * Set once a two-finger gesture resolves, and cleared when the last finger
   * lifts.
   *
   * Without it, lifting one finger of a pair leaves the other mid-screen and
   * apparently mid-drag, so the piece jumps to wherever that finger happens to
   * be and then turns again when it lifts. One two-finger gesture is one
   * action, and the hands get to settle before the next.
   */
  #locked = false

  constructor(opts: GestureRecognizerOptions) {
    this.#cell = opts.cell
    this.#emit = opts.emit
  }

  /** True while a gesture is in flight, which is when a reset has work to do. */
  get active(): boolean {
    return this.#fingers.size > 0
  }

  down(id: number, x: number, y: number, t: number): void {
    const existing = this.#fingers.size
    this.#fingers.set(id, {
      startX: x,
      startY: y,
      startT: t,
      x,
      y,
      trail: [{ t, y }],
    })

    if (existing === 0) {
      this.#primary = id
      this.#dragging = false
      this.#spent = false
      this.#locked = false
      return
    }

    // A second finger only starts a pair if the first one has not already
    // committed to something. Landing a thumb partway through a drag is a
    // fumble, so it joins nothing and the drag underneath it carries on: the
    // player gets their placement, not a dropped gesture.
    const first = this.#primary
    if (
      existing === 1 &&
      first !== null &&
      !this.#locked &&
      !this.#dragging &&
      !this.#softDrop &&
      !this.#spent
    ) {
      this.#twist = {
        a: first,
        b: id,
        startT: t,
        lastStepAngle: this.#angle(first, id),
        moved: false,
      }
    }
  }

  move(id: number, x: number, y: number, t: number): void {
    const finger = this.#fingers.get(id)
    if (!finger) return
    finger.x = x
    finger.y = y
    finger.trail.push({ t, y })
    while (finger.trail.length > 1 && t - finger.trail[0].t > FLICK_WINDOW_MS) {
      finger.trail.shift()
    }

    if (this.#twist) {
      this.#stepTwist()
      return
    }
    if (this.#locked || id !== this.#primary || this.#spent) return
    this.#stepOneFinger(finger)
  }

  up(id: number, t: number): void {
    const finger = this.#fingers.get(id)
    if (!finger) return

    if (this.#twist && (id === this.#twist.a || id === this.#twist.b)) {
      // Two fingers that rest and lift are a tap. A twist has already turned
      // the piece as it happened, so its release adds nothing.
      if (!this.#twist.moved && t - this.#twist.startT <= TWO_FINGER_TAP_MS) {
        this.#emit({ kind: 'rotate', direction: 'ccw' })
      }
      this.#twist = null
      this.#locked = true
      this.#drop(id)
      return
    }

    if (id === this.#primary && !this.#locked) {
      // Settled on release, so one gesture is always exactly one thing: a
      // finger that never travelled turns the piece, and one that did has
      // already done its work.
      if (!this.#dragging && !this.#softDrop && !this.#spent) {
        this.#emit({ kind: 'rotate', direction: 'cw' })
      }
      this.#endStroke()
    }
    this.#drop(id)
  }

  cancel(id: number): void {
    if (!this.#fingers.has(id)) return
    if (this.#twist && (id === this.#twist.a || id === this.#twist.b)) {
      this.#twist = null
      this.#locked = true
    } else if (id === this.#primary) {
      this.#endStroke()
    }
    this.#drop(id)
  }

  /**
   * Abandon everything in flight, for a pause or a game over.
   *
   * Emits the ends of anything still running, so the session is never left
   * soft-dropping a piece nobody is touching.
   */
  reset(): void {
    this.#endStroke()
    this.#fingers.clear()
    this.#twist = null
    this.#primary = null
    this.#locked = false
    this.#spent = false
  }

  #stepOneFinger(finger: Finger): void {
    const cell = this.#cell()
    const dx = finger.x - finger.startX
    const dy = finger.y - finger.startY

    if (
      dy > cell * FLICK_CELLS &&
      dy > Math.abs(dx) * FLICK_RATIO &&
      this.#speed(finger, cell) > FLICK_SPEED_CELLS_PER_SEC
    ) {
      // A throw ends the placement, so nothing that follows it in the same
      // gesture can be read as a slide or a pull.
      this.#endStroke()
      this.#spent = true
      this.#emit({ kind: 'hardDrop' })
      return
    }

    const wantsSoftDrop = dy > cell * SOFT_DROP_CELLS
    if (wantsSoftDrop !== this.#softDrop) {
      this.#softDrop = wantsSoftDrop
      this.#emit({ kind: 'softDrop', held: wantsSoftDrop })
    }

    if (!this.#dragging) {
      if (Math.abs(dx) < cell * DRAG_SLOP_CELLS) return
      this.#dragging = true
      this.#emit({ kind: 'dragStart' })
    }
    this.#emit({ kind: 'dragBy', columns: Math.round(dx / cell) })
  }

  #stepTwist(): void {
    const twist = this.#twist
    if (!twist) return
    const a = this.#fingers.get(twist.a)
    const b = this.#fingers.get(twist.b)
    if (!a || !b) return

    const slop = this.#cell() * TWO_FINGER_SLOP_CELLS
    if (moved(a, slop) || moved(b, slop)) twist.moved = true

    const angle = this.#angle(twist.a, twist.b)
    let delta = wrapAngle(angle - twist.lastStepAngle)
    while (Math.abs(delta) >= TWIST_STEP_RAD) {
      const step = Math.sign(delta) * TWIST_STEP_RAD
      twist.lastStepAngle = wrapAngle(twist.lastStepAngle + step)
      twist.moved = true
      // Screen y grows downward, so a positive angle step is clockwise on
      // screen even though it is anticlockwise in the maths.
      this.#emit({ kind: 'rotate', direction: step > 0 ? 'cw' : 'ccw' })
      delta = wrapAngle(angle - twist.lastStepAngle)
    }
  }

  #angle(a: number, b: number): number {
    const p = this.#fingers.get(a)
    const q = this.#fingers.get(b)
    if (!p || !q) return 0
    return Math.atan2(q.y - p.y, q.x - p.x)
  }

  /** Downward speed over the recent trail, in cells per second. */
  #speed(finger: Finger, cell: number): number {
    const first = finger.trail[0]
    const last = finger.trail[finger.trail.length - 1]
    const ms = last.t - first.t
    if (ms <= 0) return 0
    return ((last.y - first.y) / cell / ms) * 1000
  }

  /** Close out anything the primary finger had running. */
  #endStroke(): void {
    if (this.#softDrop) {
      this.#softDrop = false
      this.#emit({ kind: 'softDrop', held: false })
    }
    if (this.#dragging) {
      this.#dragging = false
      this.#emit({ kind: 'dragEnd' })
    }
  }

  #drop(id: number): void {
    this.#fingers.delete(id)
    if (id === this.#primary) this.#primary = null
    if (this.#fingers.size === 0) {
      this.#locked = false
      this.#spent = false
      this.#primary = null
    }
  }
}

function moved(finger: Finger, slop: number): boolean {
  return (
    Math.abs(finger.x - finger.startX) > slop ||
    Math.abs(finger.y - finger.startY) > slop
  )
}

/** Fold an angle into (-pi, pi], so a twist across the seam reads small. */
function wrapAngle(radians: number): number {
  const turn = Math.PI * 2
  const wrapped = (((radians + Math.PI) % turn) + turn) % turn
  return wrapped - Math.PI
}
