/**
 * One board's run: the model, the scene subtree that shows it, and the state
 * machine between them.
 *
 * A session owns everything for a single board and knows nothing about how many
 * players there are. Solo builds one, {@link Match} builds two. The only
 * gameplay entry point is {@link BoardSession.input}, so both the swipe handlers
 * and the arrow bars go through the same door.
 */
import {
  AbortScope,
  createEmitter,
  type Emitter,
  type EngineHost,
  ignoreAbort,
  Node2D,
} from '@src/stargazer'
import { type BoardGeom, cellCenter, computeBoardGeom } from './layout'
import { ArrowBarNode } from './nodes/ArrowBarNode'
import { BoardFrameNode } from './nodes/BoardFrameNode'
import { FloatingScoreNode } from './nodes/FloatingScoreNode'
import { MergeBurstNode } from './nodes/MergeBurstNode'
import { GoalRainNode } from './nodes/GoalRainNode'
import { MilestoneNode } from './nodes/MilestoneNode'
import { StatusVeilNode } from './nodes/StatusVeilNode'
import { TileLayerNode } from './nodes/TileLayerNode'
import {
  createStartState,
  createEmptyState,
  move,
  movesAvailable,
  spawnTile,
} from './rules'
import { createSpawnStream, type SpawnStream } from './spawn'
import { TWENTY48_STRINGS as S } from '../strings'
import { ANIM, RULES } from './tuning'
import type { BoardState, Bounds, Direction, MoveResult } from './types'

/** Where a board is in its run. */
export type SessionState = 'idle' | 'playing' | 'gameOver'

export interface BoardSessionEvents {
  stateChanged: SessionState
  score: number
  /** After the model has moved, before the follow-up tile is placed. */
  moved: MoveResult
  /** A new largest value below the goal, worth a moment. */
  milestone: { value: number }
  /**
   * A merge landed on the goal. Fires for every one, not only the first and not
   * only for a new record, so a long run keeps paying out.
   */
  goal: { value: number }
  gameOver: { finalScore: number }
}

export interface BoardSessionOptions {
  /** Shown on the veil when this board finishes while another plays on. */
  outLabel?: string
  /** Draw the four arrow bars. */
  arrows?: boolean
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export class BoardSession {
  readonly events: Emitter<BoardSessionEvents> =
    createEmitter<BoardSessionEvents>()
  /** The whole board subtree. The caller parents this where it wants it. */
  readonly root = new Node2D('t48-board')

  readonly #host: EngineHost
  readonly #stream: SpawnStream
  readonly #accent: string
  readonly #opts: BoardSessionOptions
  /** Aborted on reset and destroy, so a settling move cannot land in a new run. */
  readonly #scope: AbortScope

  #geom: BoardGeom
  #state: BoardState = createEmptyState()
  #status: SessionState = 'idle'
  /** A move is animating. The next input waits rather than being thrown away. */
  #busy = false
  /** At most one held input, so a held direction cannot run ahead of the board. */
  #queued: Direction | null = null

  readonly #frame: BoardFrameNode
  readonly #tiles: TileLayerNode
  readonly #veil: StatusVeilNode
  readonly #burst: MergeBurstNode
  readonly #rain: GoalRainNode
  readonly #milestone: MilestoneNode
  readonly #arrows: ArrowBarNode[] = []

  constructor(
    host: EngineHost,
    slot: Bounds,
    stream: SpawnStream,
    accent: string,
    opts: BoardSessionOptions = {},
  ) {
    this.#host = host
    this.#stream = stream
    this.#accent = accent
    this.#opts = opts
    this.#geom = computeBoardGeom(slot)
    this.#scope = new AbortScope(this.root.abortSignal)

    this.#frame = new BoardFrameNode(this.#geom, accent)
    this.#tiles = new TileLayerNode(this.#geom)
    this.#burst = new MergeBurstNode()
    this.#rain = new GoalRainNode()
    this.#milestone = new MilestoneNode()
    this.#veil = new StatusVeilNode(this.#geom)
    this.root.add(
      this.#frame,
      this.#tiles,
      this.#burst,
      this.#rain,
      this.#milestone,
      this.#veil,
    )

    if (opts.arrows !== false) {
      for (const dir of DIRECTIONS) {
        const bar = new ArrowBarNode(dir, this.#geom.arrows[dir], {
          onPress: (d) => this.input(d),
          enabled: () => this.#status === 'playing',
        })
        this.#arrows.push(bar)
        this.root.add(bar)
      }
    }
  }

  get state(): SessionState {
    return this.#status
  }

  get score(): number {
    return this.#state.score
  }

  get highest(): number {
    return this.#state.highest
  }

  get board(): BoardState {
    return this.#state
  }

  get geom(): BoardGeom {
    return this.#geom
  }

  get accent(): string {
    return this.#accent
  }

  /** Deal a board and start accepting input. */
  start(): void {
    this.#scope.reset()
    this.#busy = false
    this.#queued = null
    this.#state = createStartState(this.#stream)
    this.#tiles.reset(this.#state)
    this.#veil.setLabel(null)
    this.#setStatus('playing')
    this.events.emit('score', this.#state.score)
  }

  /**
   * Try to move. Returns false only when the board is not accepting input at
   * all. A swipe arriving mid-slide is held rather than dropped, because 2048
   * is played in fast muscle-memory bursts and a swallowed input reads as the
   * game ignoring you. The slot is one deep, so holding a direction can never
   * run the model further ahead than a single move.
   */
  input(dir: Direction): boolean {
    if (this.#status !== 'playing') return false
    if (this.#busy) {
      this.#queued = dir
      return true
    }
    void this.#run(dir)
    return true
  }

  async #run(dir: Direction): Promise<void> {
    const signal = this.#scope.signal
    this.#busy = true
    try {
      const result = move(this.#state, dir)
      if (!result.moved) return

      this.#state = result.state
      this.#tiles.applyMove(result)
      this.events.emit('moved', result)
      this.events.emit('score', this.#state.score)
      this.#celebrate(result)

      await this.#host.engine.wait(ANIM.slide, signal).catch(ignoreAbort)
      if (signal.aborted) return

      const { state, tile } = spawnTile(this.#state, this.#stream)
      this.#state = state
      if (tile) this.#tiles.spawn(tile)

      if (!movesAvailable(this.#state)) {
        this.#veil.setLabel(this.#opts.outLabel ?? S.noMoves)
        this.#setStatus('gameOver')
        this.events.emit('gameOver', { finalScore: this.#state.score })
      }
    } finally {
      this.#busy = false
      const next = this.#queued
      this.#queued = null
      if (next && !signal.aborted && this.#status === 'playing') {
        void this.#run(next)
      }
    }
  }

  /** The reactions a move earns: bursts, floating points, the milestone. */
  #celebrate(result: MoveResult): void {
    const cell = this.#geom.cell
    for (const m of result.merges) {
      const c = cellCenter(this.#geom, m.at)
      if (m.value >= RULES.burstFrom) {
        this.#burst.fire(c.x, c.y, m.value, cell)
        this.#frame.shake(Math.min(7, Math.log2(m.value)))
      }
    }
    if (result.gained > 0) {
      const at = result.merges[0]
      const c = cellCenter(this.#geom, at.at)
      this.root.add(
        new FloatingScoreNode(
          result.gained,
          c.x,
          c.y - cell * 0.4,
          cell * 0.32,
        ),
      )
    }
    // Any merge that lands on the goal celebrates, whether or not it sets a
    // record. Gating on a new highest would mean the board celebrated once and
    // then fell silent for the rest of the run: tiles past 2048 are vanishingly
    // rare, with the best human runs reaching 32768 and the board itself
    // topping out at 131072.
    const goalMerges = result.merges.filter((m) => m.value >= RULES.winValue)
    if (goalMerges.length > 0) {
      // Three bursts staggered around the tile, an oversized ring, and a knock
      // the whole board feels. Play carries on behind it, so this is a moment
      // rather than a screen.
      let best = 0
      let at = goalMerges[0].at
      for (const m of goalMerges) {
        const c = cellCenter(this.#geom, m.at)
        for (let i = 0; i < 3; i++) {
          this.#burst.fire(c.x, c.y, m.value, cell * (1 + i * 0.35))
        }
        this.#milestone.fire(c.x, c.y, m.value, cell * 1.4)
        if (m.value > best) {
          best = m.value
          at = m.at
        }
      }
      // What separates the goal from a milestone: the board itself reacts, and
      // it keeps going after the burst has died.
      this.#tiles.cascade(this.#state, at)
      this.#rain.fire(this.#geom.plate, cell)
      this.#frame.shake(12)
      this.events.emit('goal', { value: best })
      return
    }

    // Below the goal, only a new biggest tile is worth a ring, or the board
    // would flash on every ordinary merge.
    const highest = result.newHighest
    if (highest !== null && highest >= RULES.milestoneFrom) {
      const at = this.#state.tiles.find((t) => t.value === highest)?.index
      if (at !== undefined) {
        const c = cellCenter(this.#geom, at)
        this.#milestone.fire(c.x, c.y, highest, cell)
      }
      this.events.emit('milestone', { value: highest })
    }
  }

  /** Refit to new bounds after a resize. */
  setSlot(slot: Bounds): void {
    this.#geom = computeBoardGeom(slot)
    this.#frame.setGeom(this.#geom)
    this.#tiles.setGeom(this.#geom, this.#state)
    this.#veil.setGeom(this.#geom)
    for (const bar of this.#arrows)
      bar.setRect(this.#geom.arrows[bar.direction])
  }

  #setStatus(next: SessionState): void {
    if (next === this.#status) return
    this.#status = next
    this.events.emit('stateChanged', next)
  }

  destroy(): void {
    this.#scope.dispose()
    if (!this.root.isDestroyed) this.root.destroy()
  }
}

/** A session over its own fresh stream, for solo play. */
export function createSoloSession(
  host: EngineHost,
  slot: Bounds,
  seed: number,
  accent: string,
): BoardSession {
  return new BoardSession(host, slot, createSpawnStream(seed), accent)
}
