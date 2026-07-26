/**
 * Wall-placement input. The canonical control is a two-finger touch: the angle
 * between the fingers picks the wall axis (spread horizontally → horizontal
 * wall; stacked vertically → vertical wall; the ambiguous diagonal builds
 * nothing), and the wall spawns from the midpoint. A desktop mouse fallback
 * places a wall directly — left-click vertical, right-click horizontal.
 *
 * The gesture classifier is pure (and tested); the controller polls the engine
 * pointer set each frame, routes each touch to the board under it (so two
 * side-by-side boards disambiguate by position), and debounces so one press
 * makes one wall.
 */
import { Behavior, Node2D, type EngineHost } from '@src/stargazer'
import type { BoardController } from './board'
import { GESTURE } from './tuning'
import type { Orientation } from './types'

interface Pt {
  x: number
  y: number
}

/**
 * Classify a two-finger gesture into a wall orientation + midpoint, or null
 * when the span is out of range or the angle is in the ambiguous diagonal
 * band.
 */
export function classifyGesture(
  a: Pt,
  b: Pt,
  opts: { minSpan: number; maxSpan: number; angleTolDeg: number },
): { orientation: Orientation; mid: Pt } | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dist = Math.hypot(dx, dy)
  if (dist < opts.minSpan || dist > opts.maxSpan) return null

  // Angle to the horizontal, folded into [0, 90].
  let deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI)
  if (deg > 90) deg = 180 - deg
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }

  if (deg <= opts.angleTolDeg) return { orientation: 'horizontal', mid }
  if (deg >= 90 - opts.angleTolDeg) return { orientation: 'vertical', mid }
  return null
}

interface BoardGestureState {
  armed: boolean
  stable: number
}

export class InputController {
  readonly #host: EngineHost
  readonly #boards: BoardController[]
  readonly #states: BoardGestureState[]
  readonly #holder: Node2D
  #enabled = true
  #onPointerDown: ((e: PointerEvent) => void) | null = null

  constructor(host: EngineHost, boards: BoardController[]) {
    this.#host = host
    this.#boards = boards
    this.#states = boards.map(() => ({ armed: false, stable: 0 }))

    // Self-drive off the frame tick.
    this.#holder = new Node2D('jezzball-input')
    this.#holder.addBehavior(new PollBehavior(() => this.#pollTouch()))
    host.engine.tree.root.add(this.#holder)

    this.#attachMouse()
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled
    if (!enabled) {
      for (const s of this.#states) {
        s.armed = false
        s.stable = 0
      }
    }
  }

  destroy(): void {
    if (this.#onPointerDown) {
      this.#host.engine.canvas.removeEventListener(
        'pointerdown',
        this.#onPointerDown,
      )
      this.#onPointerDown = null
    }
    this.#holder.destroy()
  }

  #pollTouch(): void {
    if (!this.#enabled) return
    // Collect active touch points in world coordinates.
    const touches: Pt[] = []
    for (const p of this.#host.engine.input.pointers.values()) {
      if (p.kind === 'touch') touches.push({ x: p.world.x, y: p.world.y })
    }

    for (let i = 0; i < this.#boards.length; i++) {
      const board = this.#boards[i]
      const state = this.#states[i]
      const inBoard = touches.filter((t) => board.containsWorldPoint(t.x, t.y))

      if (inBoard.length < 2) {
        state.armed = false
        state.stable = 0
        continue
      }

      const cls = classifyGesture(inBoard[0], inBoard[1], {
        minSpan: GESTURE.minSpan,
        maxSpan: GESTURE.maxSpan,
        angleTolDeg: GESTURE.angleTolDeg,
      })
      if (!cls) {
        state.stable = 0
        continue
      }

      state.stable++
      if (
        !state.armed &&
        state.stable >= GESTURE.stableFrames &&
        !board.hasActiveWall
      ) {
        if (board.placeWall(cls.orientation, cls.mid.x, cls.mid.y)) {
          state.armed = true
        }
      }
    }
  }

  /**
   * Desktop fallback. The engine calls `preventDefault()` on `pointerdown`,
   * which suppresses the compatibility `mousedown`/`click` events — so read the
   * mouse button off the native `pointerdown` (which still fires and carries
   * `button`) instead. Left button places a vertical wall, right a horizontal.
   */
  #attachMouse(): void {
    const engine = this.#host.engine
    const handler = (e: PointerEvent): void => {
      if (!this.#enabled) return
      if (e.pointerType !== 'mouse') return
      if (e.button !== 0 && e.button !== 2) return
      e.preventDefault()
      const rect = engine.canvas.getBoundingClientRect()
      const world = engine.camera.screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top,
      )
      const orientation: Orientation =
        e.button === 0 ? 'vertical' : 'horizontal'
      for (const board of this.#boards) {
        if (
          board.containsWorldPoint(world.x, world.y) &&
          !board.hasActiveWall
        ) {
          board.placeWall(orientation, world.x, world.y)
          break
        }
      }
    }
    this.#onPointerDown = handler
    engine.canvas.addEventListener('pointerdown', handler)
  }
}

/** Forwards the scene frame tick into a callback. */
class PollBehavior extends Behavior {
  readonly #cb: () => void
  constructor(cb: () => void) {
    super()
    this.#cb = cb
  }
  override onUpdate(): void {
    this.#cb()
  }
}
