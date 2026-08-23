/**
 * One board's game progression: level ladder, lives, running score, and the
 * countdown/level-clear/game-over state machine. Wraps a {@link BoardController}
 * and surfaces changes through a typed emitter the UI subscribes to.
 *
 * Level advance is decoupled from level clear: on reaching the target the
 * session emits `cleared` and freezes the board. In solo play it then advances
 * itself after a hold. In versus a coordinator calls {@link advanceLevel} once
 * both boards are ready, keeping the two in lockstep.
 *
 * The countdown and auto-advance hold share one {@link AbortScope}: `reset()` /
 * `destroy()` abort it, and `#beginLevel` opens a fresh epoch per level so a
 * previous level's countdown can't resolve into the new one.
 *
 * Level time is accumulated in engine time by {@link LevelClock} rather than
 * read off the wall clock, so a paused game does not burn down its time bonus.
 */
import {
  AbortScope,
  Behavior,
  createEmitter,
  ignoreAbort,
  type EngineHost,
  type Emitter,
} from '@src/stargazer'
import { BoardController, type BoardColors } from './board'
import { eliminationPoints, fillBonus, livesBonus, timeBonus } from './scoring'
import { ANIM, RULES } from './tuning'
import type { Bounds } from './types'

export type SessionState =
  'idle' | 'countdown' | 'playing' | 'cleared' | 'gameOver'

/**
 * Accumulates engine-time seconds while its owning session is playing. Attached
 * to the board root, so the engine's pause stops it along with the physics.
 */
class LevelClock extends Behavior {
  elapsed = 0
  running = false

  override onUpdate(dt: number): void {
    if (this.running) this.elapsed += dt
  }
}

export interface BoardSessionEvents {
  stateChanged: SessionState
  /** Seconds left in the count-in (down to 1). 0 means "go". */
  countdown: number
  /** Captured percentage of the arena. */
  progress: number
  /** Running score (excludes the end-of-game lives bonus). */
  points: number
  lives: number
  level: number
  cleared: { pct: number }
  gameOver: { finalPoints: number }
  /** A wall segment was destroyed by a ball (world hit location). */
  wallLost: { x: number; y: number }
}

export interface BoardSessionOptions {
  autoAdvance?: boolean
}

export class BoardSession {
  readonly events: Emitter<BoardSessionEvents> =
    createEmitter<BoardSessionEvents>()
  readonly board: BoardController

  readonly #host: EngineHost
  readonly #autoAdvance: boolean

  #state: SessionState = 'idle'
  #level: number = 1
  #lives: number = RULES.startLives
  #points: number = 0
  readonly #clock = new LevelClock()
  readonly #scope = new AbortScope()

  constructor(
    host: EngineHost,
    board: Bounds,
    cols: number,
    rows: number,
    colors: BoardColors,
    opts: BoardSessionOptions = {},
  ) {
    this.#host = host
    this.#autoAdvance = opts.autoAdvance ?? true
    this.board = new BoardController(host, board, cols, rows, colors, {
      onCapture: (pct, cells) => this.#onCapture(pct, cells),
      onWallDestroyed: (x, y) => this.#onWallLost(x, y),
    })
    this.board.root.addBehavior(this.#clock)
  }

  get state(): SessionState {
    return this.#state
  }
  get level(): number {
    return this.#level
  }
  get lives(): number {
    return this.#lives
  }
  get points(): number {
    return this.#points
  }
  /** Time bonus the current level would pay if it cleared right now. */
  get pendingTimeBonus(): number {
    return timeBonus(this.#clock.elapsed)
  }

  /** Begin a fresh game from level 1. */
  start(): void {
    this.#level = 1
    this.#lives = RULES.startLives
    this.#points = 0
    this.events.emit('points', this.#points)
    this.#beginLevel()
  }

  /** Advance to the next level (coordinator-driven in versus). */
  advanceLevel(): void {
    if (this.#state !== 'cleared') return
    this.#lives = Math.min(
      this.#lives + RULES.livesPerLevel,
      RULES.maxLivesDisplay,
    )
    this.#level += 1
    this.events.emit('lives', this.#lives)
    this.events.emit('level', this.#level)
    this.#beginLevel()
  }

  pause(): void {
    this.#host.engine.setPaused(true)
  }
  resume(): void {
    this.#host.engine.setPaused(false)
  }

  /** Return to idle (menu), cancelling any countdown and clearing the board. */
  reset(): void {
    this.#scope.abort()
    this.#clock.running = false
    this.board.startLevel(0)
    this.#setState('idle')
  }

  destroy(): void {
    this.#scope.dispose()
    this.board.destroy()
  }

  // --- Internal flow ---

  #beginLevel(): void {
    const signal = this.#scope.reset()
    this.#clock.elapsed = 0
    this.#clock.running = false
    const ballCount = RULES.startBalls + (this.#level - 1) * RULES.ballsPerLevel
    this.board.startLevel(ballCount)
    this.board.freeze()
    this.events.emit('level', this.#level)
    this.events.emit('lives', this.#lives)
    this.events.emit('progress', 0)
    this.#setState('countdown')
    void this.#runCountdown(signal)
  }

  async #runCountdown(signal: AbortSignal): Promise<void> {
    for (let s = ANIM.countdownFrom; s >= 1; s--) {
      if (signal.aborted) return
      this.events.emit('countdown', s)
      await this.#host.engine.wait(1, signal).catch(ignoreAbort)
    }
    if (signal.aborted) return
    this.events.emit('countdown', 0)
    this.board.unfreeze()
    this.#clock.running = true
    this.#setState('playing')
  }

  #onCapture(pct: number, cells: number): void {
    if (this.#state !== 'playing') return
    if (cells > 0) {
      this.#points += eliminationPoints(cells)
      this.events.emit('points', this.#points)
    }
    this.events.emit('progress', pct)
    if (pct >= RULES.targetPct) this.#clearLevel(pct)
  }

  #clearLevel(pct: number): void {
    this.#setState('cleared')
    this.board.freeze()
    this.#clock.running = false
    this.#points +=
      fillBonus(pct) + timeBonus(this.#clock.elapsed) + livesBonus(this.#lives)
    this.events.emit('points', this.#points)
    this.events.emit('cleared', { pct })
    if (this.#autoAdvance) void this.#autoAdvanceAfterHold(this.#scope.signal)
  }

  async #autoAdvanceAfterHold(signal: AbortSignal): Promise<void> {
    await this.#host.engine.wait(ANIM.levelClearHold, signal).catch(ignoreAbort)
    if (signal.aborted || this.#state !== 'cleared') return
    this.advanceLevel()
  }

  #onWallLost(x: number, y: number): void {
    if (this.#state !== 'playing') return
    this.#lives -= 1
    this.events.emit('wallLost', { x, y })
    this.events.emit('lives', this.#lives)
    if (this.#lives <= 0) this.#gameOver()
  }

  #gameOver(): void {
    this.board.freeze()
    this.#clock.running = false
    this.#setState('gameOver')
    this.events.emit('gameOver', { finalPoints: this.#points })
  }

  #setState(state: SessionState): void {
    this.#state = state
    this.events.emit('stateChanged', state)
  }
}
