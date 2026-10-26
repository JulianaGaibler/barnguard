import { AbortScope, easings, ignoreAbort, type Engine } from 'stargazer'
import type { Run } from '../story/run'
import type { AnswerRow } from './answerRow'
import {
  ENDING_POSE,
  MOTION,
  flightPoint,
  lerp,
  slideOffset,
  stepPose,
  type Direction,
  type Point,
  type Pose,
} from './motion'
import { markSlot } from './progressTrail'
import { TILE_SIZE } from './rowLayout'
import type { TrailView } from './trailView'

/**
 * The numbers the markup binds to. Each part of a screen has a progress from 0
 * (hidden) to 1 (in place), and `sign` says which side it comes from and goes
 * to: 1 is the right and -1 the left.
 */
export interface DirectorMotion {
  text: number
  side: number
  nav: number
  /** The progress row, which slides down from above rather than sideways. */
  trail: number
  sign: Direction
}

/** What the director asks of the background. */
export interface Backdrop {
  to(pose: Pose, opts?: { duration?: number; swell?: boolean }): void
}

export interface DirectorDeps {
  engine: Pick<Engine, 'tween' | 'wait'>
  motion: DirectorMotion
  trail: TrailView
  /** The answers of the choice showing, once they exist. */
  rows: () => readonly AnswerRow[]
  /** The progress row's top left, and the width it may fill. */
  trailOrigin: () => Point
  rowWidth: () => number
  /** Whether the screen is one column. A pick then flies across before up. */
  stacked?: () => boolean
  /** Shows `run` and settles once the markup has caught up. */
  setRun: (run: Run) => Promise<void>
  setPicked: (id: string | null) => void
  /** Draws the picture of `run`'s screen, before the screen comes in. */
  showPicture: (run: Run) => Promise<void>
  /** Slides the picture layer and sets its opacity. */
  movePicture: (offsetX: number, alpha: number) => void
  backdrop: Backdrop | null
}

/** The background pose a screen has. */
export function poseOf(run: Run): Pose {
  if (run.current.kind === 'ending') return ENDING_POSE
  return stepPose(run.history.length - 1, run.current.kind === 'moment')
}

/**
 * Plays the story's transitions. A screen leaves, the progress row and the
 * background answer, and the next screen arrives, and a picked answer turns
 * into a circle and flies to the progress row to become the next mark.
 *
 * It owns one scope. Starting a transition cancels the one before it, and
 * `stop` cancels without starting another. Every await after a tween checks the
 * scope, so a transition that was cancelled leaves nothing half done behind
 * it.
 */
export class StoryDirector {
  readonly #d: DirectorDeps
  readonly #scope = new AbortScope()
  #busy = false

  constructor(deps: DirectorDeps) {
    this.#d = deps
  }

  /** Whether a transition is running, so a second tap cannot skip a screen. */
  get busy(): boolean {
    return this.#busy
  }

  /** Brings the story in, from a screen that is hidden, going forward. */
  async enter(run: Run): Promise<void> {
    const signal = this.#begin()
    const { motion } = this.#d
    motion.text = 0
    motion.side = 0
    motion.nav = 0
    motion.trail = 0
    motion.sign = 1
    // The answers of a choice exist once the markup has caught up.
    await this.#d.setRun(run)
    if (signal.aborted) return
    this.#d.backdrop?.to(poseOf(run), { duration: MOTION.background })
    await this.#d.showPicture(run)
    if (signal.aborted) return
    await this.#d.engine.wait(MOTION.handoff, signal).catch(ignoreAbort)
    if (signal.aborted) return
    await this.#arrive(signal, 1)
    this.#end(signal)
  }

  /**
   * Takes the story out, to the right, the way a screen goes when the visitor
   * steps back. Leaving the story is always a step back, to the splash.
   */
  async exit(): Promise<void> {
    const signal = this.#begin()
    this.#d.motion.sign = 1
    await Promise.all([
      this.#leave(signal, 1, null),
      this.#tween(this.#d.motion, { trail: 0 }, signal, {
        duration: MOTION.leave,
        easing: easings.inCubic,
      }),
    ])
    this.#end(signal)
  }

  /**
   * Moves on to `next`. With a `choice`, that answer is the one chosen: it
   * turns into a circle and flies to the progress row. Without it, the screen
   * just slides away.
   */
  async forward(
    next: Run,
    choice: { index: number; id: string } | null,
  ): Promise<void> {
    const signal = this.#begin()
    const picked = choice ? this.#d.rows()[choice.index] : undefined
    const { trail } = this.#d
    if (choice && picked) await this.#pick(signal, picked, choice.id, next)
    else {
      trail.sync(next.progress(), this.#d.rowWidth())
      this.#d.backdrop?.to(poseOf(next), {
        duration: MOTION.background,
        swell: true,
      })
      await this.#leave(signal, -1, null)
    }
    if (signal.aborted) return
    await this.#swap(signal, next, 1)
    this.#end(signal)
  }

  /**
   * Goes back to `previous`: the last mark leaves and the screen slides in from
   * the left.
   */
  async back(previous: Run): Promise<void> {
    const signal = this.#begin()
    this.#d.trail.sync(previous.progress(), this.#d.rowWidth())
    this.#d.backdrop?.to(poseOf(previous), {
      duration: MOTION.background,
      swell: true,
    })
    await this.#leave(signal, 1, null)
    if (signal.aborted) return
    await this.#swap(signal, previous, -1)
    this.#end(signal)
  }

  /** Cancels whatever is running, leaving the screen where it stands. */
  stop(): void {
    this.#scope.reset()
    this.#busy = false
  }

  destroy(): void {
    this.#scope.dispose()
  }

  // --- the pick ---------------------------------------------------------------

  /**
   * The picked answer turns into a circle and goes red while the others and the
   * text leave, then the circle flies to where the next mark will be and the
   * mark takes its place.
   */
  async #pick(
    signal: AbortSignal,
    picked: AnswerRow,
    id: string,
    next: Run,
  ): Promise<void> {
    const { trail } = this.#d
    const marks = next.progress()
    const width = this.#d.rowWidth()
    this.#d.setPicked(id)
    // Everything else leaves while the square turns into a circle, and the
    // circle does not wait for it to finish.
    const leaving = this.#leave(signal, -1, picked)
    await this.#tween(
      picked.pose,
      { radius: TILE_SIZE / 2, red: 1, letterAlpha: 0, labelAlpha: 0 },
      signal,
      {
        duration: MOTION.morph,
        easing: easings.outBack,
        onUpdate: () => picked.apply(),
      },
    )
    if (signal.aborted) return

    // The mark that will be the next one, held back until the circle lands.
    const origin = this.#d.trailOrigin()
    const slot = markSlot(marks.length, marks.length - 1, width)
    const held = trail.sync(marks, width, { holdLast: true })
    const from = picked.center
    const to = { x: origin.x + slot.x, y: origin.y + slot.y }
    this.#d.backdrop?.to(poseOf(next), {
      duration: MOTION.background,
      swell: true,
    })
    const flight = { t: 0 }
    const order = this.#d.stacked?.() ? 'across-first' : 'up-first'
    await this.#tween(flight, { t: 1 }, signal, {
      duration: MOTION.fly,
      easing: easings.inOutCubic,
      onUpdate: () => {
        const at = flightPoint(from, to, flight.t, order)
        picked.pose.flightX = at.x - from.x
        picked.pose.flightY = at.y - from.y
        picked.pose.scale = lerp(1, slot.size / TILE_SIZE, flight.t)
        picked.apply()
      },
    })
    if (signal.aborted) return
    // The circle becomes the mark: one appears where the other lands.
    if (held) trail.reveal(held)
    picked.pose.alpha = 0
    picked.apply()
    await leaving
  }

  // --- the parts of a screen ----------------------------------------------------

  /**
   * Takes the text, the right column, the buttons and any answers out, toward
   * `side`. Leaves the answer `except` where it is.
   */
  async #leave(
    signal: AbortSignal,
    side: Direction,
    except: AnswerRow | null,
  ): Promise<void> {
    const { motion } = this.#d
    motion.sign = side
    const out = { duration: MOTION.leave, easing: easings.inCubic }
    const rows = this.#d.rows().filter((row) => row !== except)
    await Promise.all([
      this.#tween(motion, { text: 0 }, signal, out),
      this.#tween(motion, { side: 0 }, signal, {
        ...out,
        onUpdate: () => this.#d.movePicture(this.#pictureOffset(), motion.side),
      }),
      this.#tween(motion, { nav: 0 }, signal, {
        ...out,
      }),
      ...rows.map((row, i) => this.#dismiss(signal, row, side, i)),
    ])
  }

  /** One answer leaving. */
  #dismiss(
    signal: AbortSignal,
    row: AnswerRow,
    side: Direction,
    index: number,
  ): Promise<void> {
    const progress = { v: 1 }
    return this.#tween(progress, { v: 0 }, signal, {
      duration: MOTION.dismiss,
      delay: index * MOTION.dismissStagger,
      easing: easings.inCubic,
      onUpdate: () => {
        row.pose.alpha = progress.v
        row.pose.labelAlpha = progress.v
        row.pose.offsetX = slideOffset(side, progress.v, MOTION.dismissDistance)
        row.apply()
      },
    })
  }

  /** Shows `run` and brings it in from `side`. */
  async #swap(signal: AbortSignal, run: Run, side: Direction): Promise<void> {
    const { motion } = this.#d
    this.#d.setPicked(null)
    await this.#d.setRun(run)
    if (signal.aborted) return
    motion.sign = side
    await this.#d.showPicture(run)
    if (signal.aborted) return
    await this.#arrive(signal, side)
  }

  /**
   * The new screen comes in. The text, the right column and the buttons arrive
   * together and the answers follow one another closely.
   */
  async #arrive(signal: AbortSignal, side: Direction): Promise<void> {
    const { motion } = this.#d
    motion.sign = side
    const into = { duration: MOTION.enter, easing: easings.outCubic }
    const rows = this.#d.rows()
    await Promise.all([
      this.#tween(motion, { text: 1 }, signal, into),
      this.#tween(motion, { side: 1 }, signal, {
        ...into,
        onUpdate: () => this.#d.movePicture(this.#pictureOffset(), motion.side),
      }),
      this.#tween(motion, { nav: 1 }, signal, {
        ...into,
      }),
      this.#tween(motion, { trail: 1 }, signal, {
        duration: MOTION.trail,
        easing: easings.outCubic,
      }),
      ...rows.map((row, i) => this.#arriveRow(signal, row, side, i)),
    ])
  }

  /** One answer arriving. */
  #arriveRow(
    signal: AbortSignal,
    row: AnswerRow,
    side: Direction,
    index: number,
  ): Promise<void> {
    const progress = { v: 0 }
    const show = (): void => {
      row.pose.alpha = Math.min(progress.v, 1)
      row.pose.labelAlpha = Math.min(progress.v, 1)
      row.pose.offsetX = slideOffset(
        side,
        progress.v,
        MOTION.slideDistance * 0.5,
      )
      row.pose.scale = lerp(0.88, 1, Math.min(progress.v, 1))
      row.apply()
    }
    show()
    return this.#tween(progress, { v: 1 }, signal, {
      duration: MOTION.tile,
      delay: index * MOTION.tileStagger,
      easing: easings.outCubic,
      onUpdate: show,
    })
  }

  #pictureOffset(): number {
    const { motion } = this.#d
    return slideOffset(motion.sign, motion.side, MOTION.slideDistance)
  }

  // --- plumbing -----------------------------------------------------------------

  #begin(): AbortSignal {
    this.#busy = true
    return this.#scope.reset()
  }

  #end(signal: AbortSignal): void {
    if (!signal.aborted) this.#busy = false
  }

  #tween<T extends object>(
    target: T,
    to: Partial<T>,
    signal: AbortSignal,
    opts: {
      duration: number
      delay?: number
      easing?: (t: number) => number
      onUpdate?: () => void
    },
  ): Promise<void> {
    return this.#d.engine
      .tween(target, to, { ...opts, signal })
      .catch(ignoreAbort)
  }
}
