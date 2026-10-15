/**
 * Turns pointer events into keyboard actions. It holds no geometry and touches
 * no DOM: the host answers what is under a point, and the state it reports back
 * is everything the view draws (pressed keys, the accent strip).
 *
 * Each pointer is tracked on its own, in one of three phases:
 *
 * - `press`: a key is down. Lifting on a key acts on that key, sliding moves the
 *   press to the key under the finger, and lifting off the keys does nothing. A
 *   letter with accents opens the strip after `HOLD_MS`.
 * - `popup`: the accent strip is open. The plain letter stays highlighted until
 *   the finger moves `SLOP_PX`, then the cell under it is. Lifting types the
 *   highlighted cell, and no highlighted cell types nothing. Other pointers are
 *   ignored meanwhile.
 * - `repeat`: backspace is down. It deletes on press, then repeats.
 *
 * A pointer lands while another is still in `press`: the first one types right
 * away if it is on a letter and is dropped otherwise. That keeps fast
 * two-finger typing from losing letters, and a stray touch from firing a close
 * or enter key.
 *
 * Every way a release can go missing ends in `cancel` or `reset`, which type
 * nothing. A pointer that is down must never outlive its finger.
 */
import type { KeyAction, KeyboardPage } from './layout'

export const HOLD_MS = 350
export const REPEAT_DELAY_MS = 500
export const REPEAT_INTERVAL_MS = 80
export const WATCHDOG_MS = 8000
/** How far a finger must travel after the strip opens before it picks a cell. */
export const SLOP_PX = 12

export type TargetAction = KeyAction | { type: 'suggest'; word: string }

export interface Target {
  id: string
  action: TargetAction
  /** Accented forms to offer on hold, most likely first. Empty for none. */
  accents?: readonly string[]
}

export interface PopupState {
  keyId: string
  /** Cell 0 is the plain letter, the rest are its accents. */
  cells: readonly string[]
  /** The highlighted cell, or null while the finger is outside the strip. */
  index: number | null
}

export interface GestureView {
  pressedIds: readonly string[]
  popup: PopupState | null
}

export interface GestureHost {
  hitTest(x: number, y: number): Target | null
  /** The strip cell under a point, or null when the point is outside it. */
  accentIndexAt(popup: PopupState, x: number, y: number): number | null
  type(char: string): void
  /** Returns false when there was nothing to delete. */
  backspace(): boolean
  submit(): void
  close(): void
  setPage(page: KeyboardPage): void
  suggest(word: string): void
  onChange(view: GestureView): void
}

type Phase = 'press' | 'popup' | 'repeat'

interface Pointer {
  x: number
  y: number
  /** Where the finger was when the strip opened. */
  anchor: { x: number; y: number } | null
  /** Whether the finger has travelled past `SLOP_PX` from the anchor. */
  slopped: boolean
  target: Target | null
  phase: Phase
  popup: PopupState | null
  holdTimer: ReturnType<typeof setTimeout> | null
  repeatTimer: ReturnType<typeof setTimeout> | null
  watchdog: ReturnType<typeof setTimeout> | null
}

export class KeyboardGesture {
  readonly #host: GestureHost
  readonly #pointers = new Map<number, Pointer>()

  constructor(host: GestureHost) {
    this.#host = host
  }

  /** Whether the pointer is now tracked, so the view can capture it. */
  down(pointerId: number, x: number, y: number): boolean {
    if (this.#pointers.has(pointerId)) this.#drop(pointerId)
    for (const pointer of this.#pointers.values()) {
      if (pointer.phase === 'popup') return false
    }
    const target = this.#host.hitTest(x, y)
    if (!target) return false

    this.#settleOthers()
    const pointer: Pointer = {
      x,
      y,
      anchor: null,
      slopped: false,
      target,
      phase: 'press',
      popup: null,
      holdTimer: null,
      repeatTimer: null,
      watchdog: null,
    }
    this.#pointers.set(pointerId, pointer)
    this.#armWatchdog(pointerId, pointer)
    if (target.action.type === 'backspace') {
      pointer.phase = 'repeat'
      if (this.#host.backspace()) {
        this.#scheduleRepeat(pointerId, pointer, REPEAT_DELAY_MS)
      }
    } else {
      this.#armHold(pointerId, pointer)
    }
    this.#notify()
    return true
  }

  move(pointerId: number, x: number, y: number, buttons: number): void {
    const pointer = this.#pointers.get(pointerId)
    if (!pointer) return
    // A moving pointer with no button held lost its release.
    if (buttons === 0) {
      this.cancel(pointerId)
      return
    }
    pointer.x = x
    pointer.y = y
    this.#armWatchdog(pointerId, pointer)
    if (pointer.phase === 'popup' && pointer.popup) {
      if (!pointer.slopped) {
        const { anchor } = pointer
        if (anchor && Math.hypot(x - anchor.x, y - anchor.y) < SLOP_PX) return
        pointer.slopped = true
      }
      const index = this.#host.accentIndexAt(pointer.popup, x, y)
      if (index !== pointer.popup.index) {
        pointer.popup = { ...pointer.popup, index }
        this.#notify()
      }
    } else if (pointer.phase === 'press') {
      const target = this.#host.hitTest(x, y)
      if (target?.id !== pointer.target?.id) {
        pointer.target = target
        this.#armHold(pointerId, pointer)
        this.#notify()
      }
    }
  }

  up(pointerId: number, x: number, y: number): void {
    const pointer = this.#pointers.get(pointerId)
    if (!pointer) return
    this.#drop(pointerId)
    if (pointer.phase === 'popup' && pointer.popup) {
      const { cells, index } = pointer.popup
      if (index !== null) this.#host.type(cells[index])
    } else if (pointer.phase === 'press') {
      const target = this.#host.hitTest(x, y)
      if (target) this.#commit(target.action)
    }
    this.#notify()
  }

  /** Stops tracking a pointer without acting on it. */
  cancel(pointerId: number): void {
    if (!this.#pointers.has(pointerId)) return
    this.#drop(pointerId)
    this.#notify()
  }

  /** Stops tracking every pointer without acting on any of them. */
  reset(): void {
    if (this.#pointers.size === 0) return
    for (const id of [...this.#pointers.keys()]) this.#drop(id)
    this.#notify()
  }

  get active(): boolean {
    return this.#pointers.size > 0
  }

  #settleOthers(): void {
    for (const [id, pointer] of [...this.#pointers]) {
      if (pointer.phase !== 'press') continue
      this.#drop(id)
      const action = pointer.target?.action
      if (action && isTyping(action)) this.#commit(action)
    }
  }

  #commit(action: TargetAction): void {
    switch (action.type) {
      case 'char':
        this.#host.type(action.char)
        break
      case 'space':
        this.#host.type(' ')
        break
      case 'backspace':
        this.#host.backspace()
        break
      case 'enter':
        this.#host.submit()
        break
      case 'close':
        this.#host.close()
        break
      case 'page':
        this.#host.setPage(action.page)
        break
      case 'suggest':
        this.#host.suggest(action.word)
        break
    }
  }

  #armHold(pointerId: number, pointer: Pointer): void {
    this.#clear(pointer, 'holdTimer')
    const accents = pointer.target?.accents
    const action = pointer.target?.action
    if (!accents?.length || action?.type !== 'char') return
    pointer.holdTimer = setTimeout(() => {
      pointer.holdTimer = null
      if (this.#pointers.get(pointerId) !== pointer) return
      pointer.phase = 'popup'
      pointer.anchor = { x: pointer.x, y: pointer.y }
      pointer.slopped = false
      pointer.popup = {
        keyId: pointer.target!.id,
        cells: [action.char, ...accents],
        index: 0,
      }
      this.#notify()
    }, HOLD_MS)
  }

  #scheduleRepeat(pointerId: number, pointer: Pointer, delay: number): void {
    pointer.repeatTimer = setTimeout(() => {
      pointer.repeatTimer = null
      if (this.#pointers.get(pointerId) !== pointer) return
      if (!this.#host.backspace()) return
      this.#scheduleRepeat(pointerId, pointer, REPEAT_INTERVAL_MS)
    }, delay)
  }

  #armWatchdog(pointerId: number, pointer: Pointer): void {
    this.#clear(pointer, 'watchdog')
    pointer.watchdog = setTimeout(() => {
      pointer.watchdog = null
      this.cancel(pointerId)
    }, WATCHDOG_MS)
  }

  #clear(
    pointer: Pointer,
    timer: 'holdTimer' | 'repeatTimer' | 'watchdog',
  ): void {
    if (pointer[timer] === null) return
    clearTimeout(pointer[timer])
    pointer[timer] = null
  }

  #drop(pointerId: number): void {
    const pointer = this.#pointers.get(pointerId)
    if (!pointer) return
    this.#clear(pointer, 'holdTimer')
    this.#clear(pointer, 'repeatTimer')
    this.#clear(pointer, 'watchdog')
    this.#pointers.delete(pointerId)
  }

  #notify(): void {
    const pressedIds: string[] = []
    let popup: PopupState | null = null
    for (const pointer of this.#pointers.values()) {
      if (pointer.target) pressedIds.push(pointer.target.id)
      if (pointer.popup) popup = pointer.popup
    }
    this.#host.onChange({ pressedIds, popup })
  }
}

function isTyping(action: TargetAction): boolean {
  return (
    action.type === 'char' ||
    action.type === 'space' ||
    action.type === 'suggest'
  )
}
