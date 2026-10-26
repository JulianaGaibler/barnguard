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
import { SHOWN, type Staging } from './staging'
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
  /**
   * Seconds since the screen arrived, which the markup reads to fade in each
   * line of text in turn. A large number means every line is showing.
   */
  reveal: number
  sign: Direction
}

/** How a screen's parts arrive. See {@link Staging}. */
export interface Plan extends Pick<Staging, 'textEnd' | 'hold'> {
  /** True to show the screen at once, with no slide or fade. */
  cut: boolean
}

const NO_PLAN: Plan = { textEnd: 0, hold: 0, cut: false }

/** A curtain of black over the whole display, 0 clear and 1 black. */
export interface Curtain {
  v: number
}

/** What the director asks of the background. */
export interface Backdrop {
  to(pose: Pose, opts?: { duration?: number; swell?: boolean }): void
  /**
   * Blends the colors and dots to the mood called `name`, or the booth's.
   * Returns the seconds the words of the next screen should wait.
   */
  setMood(
    name: string | undefined,
    opts?: { duration?: number; agitation?: number },
  ): number
  /** Swells a warm circle in the middle of the background, then lets it go. */
  touch?(seconds: number): void
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
  /** How the parts of the screen for `run` arrive. Default: all at once. */
  plan?: (run: Run) => Plan
  /** The curtain {@link StoryDirector.finish} draws. */
  curtain?: Curtain
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
  /** When the mood blend has passed the point where text can be read. */
  #moodReadyAt = 0

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
    motion.reveal = 0
    motion.sign = 1
    // The answers of a choice exist once the markup has caught up.
    await this.#d.setRun(run)
    if (signal.aborted) return
    this.#d.backdrop?.to(poseOf(run), { duration: MOTION.background })
    this.#blend(run)
    await this.#d.showPicture(run)
    if (signal.aborted) return
    await this.#d.engine.wait(MOTION.handoff, signal).catch(ignoreAbort)
    if (signal.aborted) return
    await this.#arrive(signal, 1, run)
    this.#end(signal)
  }

  /**
   * Ends the story: the display fades to black, stays black for a moment, and
   * resolves once it has. The caller then returns to the splash.
   */
  async finish(): Promise<void> {
    const signal = this.#begin()
    const { curtain } = this.#d
    if (curtain) {
      await this.#tween(curtain, { v: 1 }, signal, {
        duration: MOTION.fadeOut,
        easing: easings.inOutCubic,
      })
      if (signal.aborted) return
    }
    await this.#d.engine.wait(MOTION.linger, signal).catch(ignoreAbort)
    this.#end(signal)
  }

  /**
   * Fades the display to black, slowly, and cuts to `next` under it. The black
   * goes at once, so the new screen is there without a transition. `next` is a
   * screen that is cut, which shows whole.
   */
  async fadeThrough(next: Run): Promise<void> {
    const signal = this.#begin()
    const { curtain, motion, trail } = this.#d
    if (curtain) {
      await this.#tween(curtain, { v: 1 }, signal, {
        duration: MOTION.fadeOut,
        easing: easings.inOutCubic,
      })
      if (signal.aborted) return
    }
    await this.#d.engine.wait(MOTION.cutHold, signal).catch(ignoreAbort)
    if (signal.aborted) return
    trail.sync(next.progress(), this.#d.rowWidth())
    this.#d.backdrop?.to(poseOf(next), { duration: 0 })
    this.#d.backdrop?.setMood(next.mood, {
      duration: 0,
      agitation: next.agitation,
    })
    motion.text = 0
    motion.side = 0
    motion.nav = 0
    await this.#swap(signal, next, 1)
    if (curtain) curtain.v = 0
    this.#end(signal)
  }

  /** Takes the story out, to the right, the way the splash comes back. */
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
      this.#blend(next)
      await this.#leave(signal, -1, null)
    }
    if (signal.aborted) return
    await this.#swap(signal, next, 1)
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
    if (picked.plain) {
      // An answer that is only its text has no square: the text fades.
      this.#d.backdrop?.to(poseOf(next), {
        duration: MOTION.background,
        swell: true,
      })
      this.#blend(next)
      await this.#tween(picked.pose, { labelAlpha: 0 }, signal, {
        duration: MOTION.dismiss * 2,
        easing: easings.inCubic,
        onUpdate: () => picked.apply(),
      })
      if (signal.aborted) return
      await leaving
      return
    }
    await this.#tween(
      picked.pose,
      { radius: TILE_SIZE / 2, red: 1, labelAlpha: 0 },
      signal,
      {
        duration: MOTION.morph,
        easing: easings.outBack,
        onUpdate: () => picked.apply(),
      },
    )
    if (signal.aborted) return

    if (marks.length === 0) {
      // The progress row is gone, so the circle has nowhere to land. It grows
      // and fades where it is.
      this.#d.backdrop?.to(poseOf(next), {
        duration: MOTION.background,
        swell: true,
      })
      this.#blend(next)
      const fade = { v: 0 }
      await this.#tween(fade, { v: 1 }, signal, {
        duration: MOTION.fly * 0.8,
        easing: easings.outCubic,
        onUpdate: () => {
          picked.pose.scale = lerp(1, 1.5, fade.v)
          picked.pose.alpha = 1 - fade.v
          picked.apply()
        },
      })
      if (signal.aborted) return
      picked.pose.alpha = 0
      picked.apply()
      await leaving
      return
    }

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
    this.#blend(next)
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
    motion.reveal = 0
    await this.#d.setRun(run)
    if (signal.aborted) return
    motion.sign = side
    await this.#d.showPicture(run)
    if (signal.aborted) return
    await this.#arrive(signal, side, run)
  }

  /**
   * The new screen comes in. The text and the picture arrive together. The
   * lines of the text then show one after another, as the screen's plan says,
   * and the answers and the button arrive after the last of them and the hold.
   * A screen that is cut shows at once.
   */
  async #arrive(signal: AbortSignal, side: Direction, run: Run): Promise<void> {
    const { motion } = this.#d
    const plan = this.#d.plan?.(run) ?? NO_PLAN
    motion.sign = side
    const rows = this.#d.rows()
    const remaining = this.#moodReadyAt - performance.now()
    this.#moodReadyAt = 0
    if (remaining > 20) {
      await this.#d.engine.wait(remaining / 1000, signal).catch(ignoreAbort)
      if (signal.aborted) return
    }
    if (run.current.touch) this.#d.backdrop?.touch?.(MOTION.touch)
    if (plan.cut) {
      motion.text = 1
      motion.side = 1
      motion.reveal = SHOWN
      this.#d.movePicture(this.#pictureOffset(), 1)
    }
    const into = { duration: MOTION.enter, easing: easings.outCubic }
    const text = plan.cut
      ? Promise.resolve()
      : Promise.all([
          this.#tween(motion, { text: 1 }, signal, into),
          this.#tween(motion, { side: 1 }, signal, {
            ...into,
            onUpdate: () =>
              this.#d.movePicture(this.#pictureOffset(), motion.side),
          }),
        ])
    const lines = async (): Promise<void> => {
      if (plan.textEnd <= 0) {
        motion.reveal = SHOWN
      } else if (!plan.cut) {
        await this.#tween(motion, { reveal: plan.textEnd }, signal, {
          duration: plan.textEnd,
          easing: (t) => t,
        })
      }
      if (signal.aborted) return
      motion.reveal = SHOWN
      if (plan.hold > 0) {
        await this.#d.engine.wait(plan.hold, signal).catch(ignoreAbort)
        if (signal.aborted) return
      }
      await Promise.all([
        this.#tween(motion, { nav: 1 }, signal, into),
        ...rows.map((row, i) => this.#arriveRow(signal, row, side, i)),
      ])
    }
    await Promise.all([
      text,
      this.#tween(motion, { trail: 1 }, signal, {
        duration: MOTION.trail,
        easing: easings.outCubic,
      }),
      lines(),
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

  /** Starts the blend to the mood of `run`, and notes how long the words wait. */
  #blend(run: Run): void {
    const wait =
      this.#d.backdrop?.setMood(run.mood, {
        duration: MOTION.mood,
        agitation: run.agitation,
      }) ?? 0
    this.#moodReadyAt = wait > 0 ? performance.now() + wait * 1000 : 0
  }

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
