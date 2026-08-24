/**
 * One seat's run: the buffer, the piece in play, the score, and the state
 * machine around spawning, locking and clearing.
 *
 * Owns no scene nodes. Everything it does is published through a typed emitter,
 * and the component wires those events to whatever is drawn. That keeps the
 * whole of the game's behaviour testable with nothing but a fake clock, and it
 * is why the two-player match can run two of these without either knowing the
 * other exists.
 *
 * Timing runs on the fixed step, never on the render frame and never on
 * `performance.now()`. Three things follow, all wanted: gravity, the lock delay
 * and Countdown's clock stay in step with each other under load, they all
 * freeze and resume cleanly with `engine.setPaused`, and the fall rate is the
 * same on a 60 Hz panel and a 144 Hz one.
 */
import {
  AbortScope,
  Behavior,
  createEmitter,
  ignoreAbort,
  Node2D,
  type Emitter,
  type EngineHost,
} from '@src/stargazer'
import { createPieceStream, type PieceStream } from './bag'
import {
  clearBuffer,
  clearRows,
  createBuffer,
  fullRows,
  type Buffer,
} from './board'
import {
  createCountdown,
  extend,
  START_SECONDS,
  tick as tickClock,
  type Countdown,
} from './countdown'
import { levelForLines, secondsPerRow, softDropSecondsPerRow } from './gravity'
import {
  canSpawn,
  classifyTwist,
  commit,
  createLockTimer,
  dropDistance,
  hardDropTarget,
  isGrounded,
  lockedOutOfView,
  noteMove,
  resetLockTimer,
  spawnPiece,
  tickLockTimer,
  tryRotate,
  tryShift,
  type ActivePiece,
} from './rules'
import {
  clearPoints,
  hardDropPoints,
  isStreakEligible,
  softDropPoints,
} from './scoring'
import { ANIM, RULES } from './tuning'
import type {
  Action,
  EndReason,
  ModeKind,
  PieceKind,
  PlayerId,
  TwistKind,
} from './types'

/** Where a run is in its short life. */
export type SessionState = 'idle' | 'playing' | 'clearing' | 'over'

/** What a lock produced, for the scene to celebrate and the HUD to read. */
export interface LockResult {
  /** Rows that came out, top to bottom. Empty when nothing cleared. */
  rows: number[]
  twist: TwistKind
  points: number
  /** Whether this clear kept a streak going. */
  streak: boolean
  combo: number
  level: number
}

export interface SessionEvents {
  stateChanged: SessionState
  /** A new piece entered play, with the queue behind it. */
  spawned: { piece: ActivePiece; next: PieceKind[]; hold: PieceKind | null }
  /** The piece moved, turned or fell. Redraw it where it now is. */
  pieceMoved: ActivePiece
  /** The piece was written into the buffer. Fires before any clear. */
  locked: { piece: ActivePiece; hardDropped: boolean }
  /** A lock resolved. `rows` is empty when nothing cleared. */
  resolved: LockResult
  /** The hold slot changed. */
  held: { hold: PieceKind; next: PieceKind[] }
  score: number
  /** Lines and the level they imply. */
  progress: { lines: number; level: number }
  /** Countdown only, every step, so the readout can tick. */
  clock: number
  /** Countdown only. `granted` is what fitted under the ceiling. */
  clockExtended: { granted: number; remaining: number }
  /** The run is over. Fires once. */
  over: { reason: EndReason; score: number; lines: number; level: number }
}

export interface SessionOptions {
  host: EngineHost
  mode: ModeKind
  /** Shared between both seats in a race, which is what makes it one. */
  seed: number
  /** Which seat this is. Solo is always 1. */
  player?: PlayerId
}

/** Forwards the engine's fixed step into the session. */
class StepBehavior extends Behavior {
  readonly #step: (dt: number) => void
  constructor(step: (dt: number) => void) {
    super()
    this.#step = step
  }
  override onFixedStep(fixedDt: number): void {
    this.#step(fixedDt)
  }
}

export class Session {
  readonly events: Emitter<SessionEvents> = createEmitter<SessionEvents>()
  /** The caller parents this. Carries the step behavior and nothing else. */
  readonly root = new Node2D('buffer-overflow-session')

  readonly #host: EngineHost
  readonly #mode: ModeKind
  readonly #player: PlayerId
  readonly #stream: PieceStream
  readonly #buffer: Buffer = createBuffer()
  readonly #clock: Countdown | null
  readonly #lock = createLockTimer()
  /** Scopes the clear animation, so a quit mid-clear cannot land after it. */
  readonly #scope: AbortScope

  #state: SessionState = 'idle'
  #piece: ActivePiece | null = null
  #ordinal = 0
  #hold: PieceKind | null = null
  /** A hold may be used once per piece, which stops it being a free shuffle. */
  #holdUsed = false
  #score = 0
  #lines = 0
  #combo = -1
  #streak = false
  #softDropHeld = false
  /** Seconds of fall owed, so a slow frame still advances the right distance. */
  #fallDebt = 0
  /** Whether the last thing that moved the piece was a turn, for twists. */
  #lastWasRotation = false
  #lastKickIndex = 0
  /** Box origin the current drag started from, or null when none is running. */
  #dragAnchorX: number | null = null

  constructor(opts: SessionOptions) {
    this.#host = opts.host
    this.#mode = opts.mode
    this.#player = opts.player ?? 1
    this.#stream = createPieceStream(opts.seed)
    this.#clock = opts.mode === 'countdown' ? createCountdown() : null
    this.#scope = new AbortScope(this.root.abortSignal)
    this.root.addBehavior(new StepBehavior((dt) => this.step(dt)))
  }

  get state(): SessionState {
    return this.#state
  }
  get score(): number {
    return this.#score
  }
  get lines(): number {
    return this.#lines
  }
  get level(): number {
    return levelForLines(this.#lines)
  }
  get buffer(): Readonly<Buffer> {
    return this.#buffer
  }
  get piece(): Readonly<ActivePiece> | null {
    return this.#piece
  }
  get hold(): PieceKind | null {
    return this.#hold
  }
  /**
   * Whether banking is available right now.
   *
   * Once per piece, which is what stops it being a free shuffle. The bank
   * button reads this so it can show itself spent rather than silently
   * swallowing a press.
   */
  get canHold(): boolean {
    return this.#state === 'playing' && this.#piece !== null && !this.#holdUsed
  }
  get player(): PlayerId {
    return this.#player
  }
  get mode(): ModeKind {
    return this.#mode
  }
  get remaining(): number {
    return this.#clock?.remaining ?? 0
  }
  /** The pieces waiting behind the one in play. */
  get next(): PieceKind[] {
    return this.#queue()
  }
  /** The piece's resting place, for drawing the ghost. */
  get ghost(): ActivePiece | null {
    return this.#piece ? hardDropTarget(this.#buffer, this.#piece) : null
  }

  start(): void {
    clearBuffer(this.#buffer)
    this.#scope.reset()
    this.#ordinal = 0
    this.#hold = null
    this.#holdUsed = false
    this.#score = 0
    this.#lines = 0
    this.#combo = -1
    this.#streak = false
    this.#softDropHeld = false
    this.#dragAnchorX = null
    this.#fallDebt = 0
    if (this.#clock) this.#clock.remaining = START_SECONDS
    this.#setState('playing')
    this.events.emit('score', 0)
    this.events.emit('progress', { lines: 0, level: 1 })
    this.#spawn()
  }

  /** Route one button press or gesture. Ignored unless a piece is in play. */
  input(action: Action): void {
    if (this.#state !== 'playing' || !this.#piece) return
    switch (action) {
      case 'left':
        this.#shift(-1)
        break
      case 'right':
        this.#shift(1)
        break
      case 'rotateCW':
        this.#rotate(1)
        break
      case 'rotateCCW':
        this.#rotate(-1)
        break
      case 'hardDrop':
        this.#hardDrop()
        break
      case 'hold':
        this.#swapHold()
        break
    }
  }

  /**
   * Advance gravity, the lock delay and Countdown's clock by `dt` seconds.
   *
   * The seam the session's clock comes in through. In a game the attached
   * behavior calls this from the engine's fixed step. A test calls it directly
   * and needs no engine at all.
   */
  step(dt: number): void {
    if (this.#state !== 'playing' || !this.#piece) return

    if (this.#clock) {
      const expired = tickClock(this.#clock, dt)
      this.events.emit('clock', this.#clock.remaining)
      if (expired) {
        this.#end('timeUp')
        return
      }
    }

    const level = this.level
    const perRow = this.#softDropHeld
      ? softDropSecondsPerRow(level)
      : secondsPerRow(level)
    this.#fallDebt += dt
    // A loop, not a single test: at the top of the curve a piece owes several
    // rows per step, and dropping the remainder would make gravity level off.
    let guard = this.#buffer.rows
    while (this.#fallDebt >= perRow && guard-- > 0) {
      this.#fallDebt -= perRow
      const fallen = tryShift(this.#buffer, this.#piece, 0, 1)
      if (!fallen) break
      this.#piece = fallen
      this.#lastWasRotation = false
      if (this.#softDropHeld) this.#addScore(softDropPoints(1))
      this.events.emit('pieceMoved', fallen)
    }

    const grounded = isGrounded(this.#buffer, this.#piece)
    if (!grounded) {
      if (this.#lock.grounded) noteMove(this.#lock, false)
      return
    }
    if (!this.#lock.grounded) noteMove(this.#lock, true)
    if (tickLockTimer(this.#lock, dt, RULES.lockDelay)) this.#lockPiece(false)
  }

  /** Soft drop is a hold, not a press: it scores per cell descended. */
  setSoftDrop(held: boolean): void {
    this.#softDropHeld = held
  }

  /**
   * Anchor the piece where it stands, for a drag across the buffer.
   *
   * A drag moves the piece RELATIVE to where it was when the finger went down,
   * rather than to whatever column the finger is over. Absolute targeting
   * cannot reach the walls: a piece is positioned by its box origin, and a
   * shape whose cells start partway into its box (an upright bar sits in the
   * box's third column) would need a negative origin to touch the left wall,
   * which no column index can express.
   */
  beginDrag(): void {
    this.#dragAnchorX = this.#piece?.x ?? null
  }

  /** Move the dragged piece `columns` from where its drag began. */
  dragBy(columns: number): void {
    if (this.#state !== 'playing' || !this.#piece) return
    if (this.#dragAnchorX === null) return
    const target = this.#dragAnchorX + columns
    // Stepped rather than teleported, so the piece stops against an overhang
    // instead of passing through it.
    const dir = Math.sign(target - this.#piece.x)
    if (dir === 0) return
    while (this.#piece.x !== target) {
      if (!this.#shift(dir)) break
    }
  }

  endDrag(): void {
    this.#dragAnchorX = null
  }

  destroy(): void {
    this.#scope.dispose()
    if (!this.root.isDestroyed) this.root.destroy()
  }

  // --- Internals ---------------------------------------------------------

  #setState(next: SessionState): void {
    if (next === this.#state) return
    this.#state = next
    this.events.emit('stateChanged', next)
  }

  #queue(): PieceKind[] {
    const out: PieceKind[] = []
    for (let i = 1; i <= RULES.nextCount; i++) {
      out.push(this.#stream.at(this.#ordinal + i))
    }
    return out
  }

  #spawn(kind?: PieceKind): void {
    const next = kind ?? this.#stream.at(this.#ordinal)
    if (!canSpawn(this.#buffer, next)) {
      this.#end('overflow')
      return
    }
    const piece = spawnPiece(next, this.#buffer.cols)
    // Nudged down so it enters the visible buffer at once rather than looking
    // like it hangs above the rim.
    const dropped = tryShift(this.#buffer, piece, 0, RULES.spawnDrop)
    this.#piece = dropped ?? piece
    resetLockTimer(this.#lock)
    this.#dragAnchorX = null
    this.#fallDebt = 0
    this.#lastWasRotation = false
    this.#lastKickIndex = 0
    this.events.emit('spawned', {
      piece: this.#piece,
      next: this.#queue(),
      hold: this.#hold,
    })
  }

  #shift(dx: number): boolean {
    if (!this.#piece) return false
    const moved = tryShift(this.#buffer, this.#piece, dx, 0)
    if (!moved) return false
    this.#piece = moved
    this.#lastWasRotation = false
    noteMove(this.#lock, isGrounded(this.#buffer, moved))
    this.events.emit('pieceMoved', moved)
    return true
  }

  #rotate(dir: 1 | -1): void {
    if (!this.#piece) return
    const turned = tryRotate(this.#buffer, this.#piece, dir)
    if (!turned) return
    this.#piece = turned.piece
    this.#lastWasRotation = true
    this.#lastKickIndex = turned.kickIndex
    noteMove(this.#lock, isGrounded(this.#buffer, turned.piece))
    this.events.emit('pieceMoved', turned.piece)
  }

  #hardDrop(): void {
    if (!this.#piece) return
    const cells = dropDistance(this.#buffer, this.#piece)
    this.#piece = hardDropTarget(this.#buffer, this.#piece)
    if (cells > 0) {
      this.#lastWasRotation = false
      this.#addScore(hardDropPoints(cells))
    }
    this.events.emit('pieceMoved', this.#piece)
    this.#lockPiece(true)
  }

  #swapHold(): void {
    if (!this.#piece || this.#holdUsed) return
    const current = this.#piece.kind
    const incoming = this.#hold
    this.#hold = current
    this.#holdUsed = true
    if (incoming) {
      this.#spawn(incoming)
    } else {
      // Nothing banked yet, so this piece is set aside and the queue advances.
      this.#ordinal++
      this.#spawn()
    }
    // The swap can overflow the buffer, in which case the run is already over
    // and the hold slot is no longer something to announce.
    if (this.#state === 'playing') {
      this.events.emit('held', { hold: current, next: this.#queue() })
    }
  }

  #lockPiece(hardDropped: boolean): void {
    const piece = this.#piece
    if (!piece) return

    const twist = classifyTwist(
      this.#buffer,
      piece,
      this.#lastWasRotation,
      this.#lastKickIndex,
    )
    commit(this.#buffer, piece)
    this.#piece = null
    this.events.emit('locked', { piece, hardDropped })

    const rows = fullRows(this.#buffer)
    const level = this.level

    if (rows.length === 0) {
      // A lock that clears nothing ends the combo but leaves the streak, which
      // survives until the next scoring clear fails to qualify.
      this.#combo = -1
      const bare = clearPoints({
        lines: 0,
        twist,
        level,
        combo: 0,
        streak: false,
      })
      if (bare > 0) this.#addScore(bare)
      this.events.emit('resolved', {
        rows: [],
        twist,
        points: bare,
        streak: false,
        combo: 0,
        level,
      })
      // A piece that came to rest entirely above the rim means the stack has
      // reached the ceiling, which is the other way a run ends.
      if (lockedOutOfView(piece)) {
        this.#end('overflow')
        return
      }
      this.#advance()
      return
    }

    this.#combo++
    const kept = this.#streak && isStreakEligible(rows.length, twist)
    const points = clearPoints({
      lines: rows.length,
      twist,
      level,
      combo: this.#combo,
      streak: this.#streak,
    })
    this.#addScore(points)
    this.#streak = isStreakEligible(rows.length, twist)

    this.events.emit('resolved', {
      rows,
      twist,
      points,
      streak: kept,
      combo: this.#combo,
      level,
    })
    void this.#resolveClear(rows)
  }

  /**
   * Hold the flash, then collapse the stack and bring the next piece in.
   *
   * Scoped to `#scope`, so quitting mid-clear cannot land a collapse on a
   * buffer that has already been reset.
   */
  async #resolveClear(rows: number[]): Promise<void> {
    const signal = this.#scope.signal
    this.#setState('clearing')
    await this.#host.engine.wait(ANIM.clearFlash, signal).catch(ignoreAbort)
    if (signal.aborted || this.#state !== 'clearing') return

    clearRows(this.#buffer, rows)
    this.#lines += rows.length
    const level = levelForLines(this.#lines)
    this.events.emit('progress', { lines: this.#lines, level })

    if (this.#clock) {
      const granted = extend(this.#clock, rows.length)
      this.events.emit('clockExtended', {
        granted,
        remaining: this.#clock.remaining,
      })
    }

    await this.#host.engine.wait(ANIM.clearCollapse, signal).catch(ignoreAbort)
    if (signal.aborted || this.#state !== 'clearing') return
    this.#setState('playing')
    this.#advance()
  }

  #advance(): void {
    this.#ordinal++
    this.#holdUsed = false
    this.#spawn()
  }

  #addScore(points: number): void {
    if (points <= 0) return
    this.#score += points
    this.events.emit('score', this.#score)
  }

  #end(reason: EndReason): void {
    if (this.#state === 'over') return
    this.#piece = null
    this.#scope.abort()
    this.#setState('over')
    this.events.emit('over', {
      reason,
      score: this.#score,
      lines: this.#lines,
      level: this.level,
    })
  }
}
