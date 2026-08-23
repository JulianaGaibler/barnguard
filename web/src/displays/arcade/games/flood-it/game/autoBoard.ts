/**
 * A board that plays itself, used by the menu preview and by the tutorial
 * cards.
 *
 * It plays one region with the same greedy solver that measures par, and draws
 * through the real {@link BoardNode}, so a demonstration is a real game rather
 * than a scripted animation and a tutorial card cannot drift out of step with
 * the rules.
 *
 * The grid is given outright rather than chosen from the game's presets, since
 * both callers want a size no preset offers. Beyond that it takes only the
 * knobs a decoration needs: how long to hold between moves, when to stop, how
 * to restyle the board, and whether to carve its left edge away.
 */
import { ignoreAbort, Node2D, type EngineHost } from '@src/stargazer'
import { seededRandom } from '../../common/rng'
import {
  absorbGains,
  applyMove,
  createBoard,
  createMoveResult,
  fillCarvedLeft,
  fillRandom,
  isFlooded,
  seedOwners,
  type Board,
} from './board'
import { bestGain, greedySolve, type DealtBoard } from './generate'
import { computeFieldGeom } from './layout'
import { BoardNode, type BoardLook, type RegionStyle } from './nodes/BoardNode'
import { ANIM, COLORS, floodDuration } from './tuning'
import type { Bounds, PlayerId } from './types'

export interface AutoBoardOptions {
  host: EngineHost
  /** Node the board is added under. The caller owns its lifetime. */
  parent: Node2D
  /** World rect to fit the board into. */
  rect: Bounds
  /**
   * The grid to deal. Given outright rather than as one of the game's presets,
   * because a decorative board wants a size no preset offers: a tutorial card
   * has a few seconds and a small panel, and a backdrop wants finer cells than
   * anything playable.
   */
  grid: { cols: number; rows: number; colors: number }
  /** Fixed seed, so a preview or a tutorial card looks the same every time. */
  seed: number
  /** Show the shape overlay. */
  glyphs?: boolean
  /** Extra pause after a flood settles, before the next move. */
  beat?: number
  /** Hold on the finished board before dealing again. */
  hold?: number
  /** Draw the board at this opacity, to sit it behind an overlay. */
  alpha?: number
  /** Restyle the board, for one that is decoration rather than a game. */
  look?: BoardLook
  /**
   * Cut a ragged bite out of the board's left side, this deep at the bottom row
   * as a fraction of the width, tapering to nothing at the top.
   *
   * Cut cells take palette entry 0, and the run never floods to it, so the bite
   * survives the whole run. With a palette whose entry 0 is fully transparent
   * the grid has no straight left edge, which is what stops a backdrop from
   * announcing itself beside a menu.
   */
  carveLeftFrac?: number
  /**
   * Stop after this many moves and hold there, instead of playing the board out
   * and dealing another. For a backdrop that should settle rather than keep
   * moving for as long as anyone is looking at it.
   */
  stopAfter?: number
}

export interface AutoBoard {
  /** The board being played right now. Replaced on each redeal. */
  readonly board: Board
  /** Moves taken on the current deal. Resets when a new one is dealt. */
  readonly moves: number
  /** Move allowance for the current deal, so a counter can read `moves/limit`. */
  readonly limit: number
  destroy(): void
}

/** A decorative board has one region, and it is outlined in the paper tone. */
const STYLES: Record<number, RegionStyle> = {
  1: { color: COLORS.paper, dashed: false },
}

/** Allowance a demonstration board gets over its greedy par. */
const DEMO_SLACK = 1.15

/** Build a self-playing board and start it. */
export function buildAutoBoard(opts: AutoBoardOptions): AutoBoard {
  const beat = opts.beat ?? 0.35
  const hold = opts.hold ?? 1.4
  const random = seededRandom(opts.seed)

  const root = new Node2D('flood-auto-board')
  opts.parent.add(root)

  /** Deal a fresh board at the requested grid. */
  const nextDeal = (): DealtBoard => {
    const { cols, rows, colors } = opts.grid
    const board = createBoard(cols, rows, colors)
    if (opts.carveLeftFrac !== undefined) {
      fillCarvedLeft(board, random, opts.carveLeftFrac)
    } else {
      fillRandom(board, random)
    }
    seedOwners(board, 1)
    // No par band for a demonstration: any small board reads fine, and a
    // reroll loop would only make the same card take longer to appear.
    const par = greedySolve(board)
    return { board, par, maxMoves: Math.max(par, Math.ceil(par * DEMO_SLACK)) }
  }

  let deal = nextDeal()
  const node = new BoardNode(
    computeFieldGeom(opts.rect, deal.board.cols, deal.board.rows),
    deal.board,
    [1],
    STYLES,
  )
  node.setGlyphs(opts.glyphs ?? false)
  if (opts.alpha !== undefined) node.setOpacity(opts.alpha)
  if (opts.look) node.setLook(opts.look)
  root.add(node)

  const scratch = createBoard(
    deal.board.cols,
    deal.board.rows,
    deal.board.numColors,
  )
  const result = createMoveResult(deal.board)
  const gains = new Int32Array(deal.board.numColors)

  let moves = 0

  /** Take the best move available to `player`, or report there was none. */
  function step(board: Board, player: PlayerId): boolean {
    absorbGains(board, player, scratch, result, gains)
    // A carved board keeps its bite only if nothing ever floods into it.
    if (opts.carveLeftFrac !== undefined) gains[0] = 0
    const pick = bestGain(gains)
    if (pick < 0) return false
    applyMove(board, player, pick, result)
    node.applyWave(result)
    moves++
    return true
  }

  void (async () => {
    const signal = root.abortSignal
    try {
      for (;;) {
        // Let the fresh board finish arriving before playing it. Without this
        // the first move lands synchronously, before the deal-in sweep has drawn
        // a single frame, so a tutorial card would open mid-flood.
        await opts.host.engine.wait(
          Math.max(beat, ANIM.dealDurationCap),
          signal,
        )
        while (!isFlooded(deal.board, 1)) {
          if (opts.stopAfter !== undefined && moves >= opts.stopAfter) return
          if (!step(deal.board, 1)) break
          await opts.host.engine.wait(
            floodDuration(result.maxDepth) + beat,
            signal,
          )
        }
        if (opts.stopAfter !== undefined) return
        node.celebrate()
        await opts.host.engine.wait(hold, signal)
        deal = nextDeal()
        moves = 0
        node.setBoard(deal.board)
      }
    } catch (error) {
      ignoreAbort(error)
    }
  })()

  return {
    get board() {
      return deal.board
    },
    get moves() {
      return moves
    },
    get limit() {
      return deal.maxMoves
    },
    destroy() {
      if (!root.isDestroyed) root.destroy()
    },
  }
}
