import { describe, expect, it } from 'vitest'
import { paintCalls } from 'stargazer'
import { seededRandom } from '../../../common/rng'
import {
  applyMove,
  createBoard,
  createMoveResult,
  fillRandom,
  seedOwners,
} from '../board'
import { computeFieldGeom } from '../layout'
import { CELL_COLORS, COLORS } from '../tuning'
import { BoardNode, type RegionStyle } from './BoardNode'

const STYLES: Record<number, RegionStyle> = {
  1: { color: COLORS.paper, dashed: false },
}

/**
 * What a node's picture asks the renderer for, split into the lists these tests
 * read: the alphas it sets, the method names in call order, the colors handed
 * to `fillRoundRect` (which is how cells are drawn) and the clips it sets.
 */
function record(node: BoardNode): {
  alphas: number[]
  /** Method names in call order, so a missing pass is visible. */
  calls: string[]
  fills: string[]
  /** Shapes handed to `setClip`, `null` for a clear. */
  clips: unknown[]
  draws: number
} {
  const recorded = paintCalls(node)
  const state = new Set(['setAlpha', 'save', 'restore', 'setClip'])
  return {
    alphas: recorded
      .filter((c) => c.name === 'setAlpha')
      .map((c) => c.args[0] as number),
    calls: recorded.map((c) => c.name),
    fills: recorded
      .filter((c) => c.name === 'fillRoundRect')
      .map((c) => String(c.args[5])),
    clips: recorded.filter((c) => c.name === 'setClip').map((c) => c.args[0]),
    draws: recorded.filter((c) => !state.has(c.name)).length,
  }
}

/** A settled board mid-game, with a flood applied so every path is live. */
function settledNode(opts: { glyphs?: boolean } = {}): BoardNode {
  const board = createBoard(6, 6, 4)
  fillRandom(board, seededRandom(12))
  seedOwners(board, 1)
  const geom = computeFieldGeom({ x: 0, y: 0, width: 600, height: 600 }, 6, 6)
  const node = new BoardNode(geom, board, [1], STYLES)
  node.setGlyphs(opts.glyphs ?? false)
  // Settle the deal-in, take a move, then leave it part way through its wave so
  // the cross-fade path is exercised too.
  node.onUpdate(2)
  const result = createMoveResult(board)
  applyMove(board, 1, (board.color[0]! + 1) % 4, result)
  node.applyWave(result)
  node.onUpdate(0.05)
  return node
}

describe('board opacity', () => {
  it('paints at full strength by default', () => {
    const node = settledNode()
    const rec = record(node)
    expect(rec.draws).toBeGreaterThan(0)
    expect(Math.max(...rec.alphas)).toBe(1)
    expect(node.transform.alpha).toBe(1)
  })

  it('fades the whole board through the node alpha, not its own', () => {
    // Alpha set inside a picture multiplies the node's cascaded alpha, so the
    // fade has to ride on the transform for everything to stay uniform.
    for (const opacity of [0.32, 0.5, 0.75]) {
      const node = settledNode({ glyphs: true })
      node.setOpacity(opacity)
      expect(node.transform.alpha).toBe(opacity)
      expect(Math.max(...record(node).alphas), `opacity ${opacity}`).toBe(1)
    }
  })

  it('scales the loss dim and the win sweep with the board', () => {
    for (const configure of [
      (n: BoardNode) => n.setDimmed(true),
      (n: BoardNode) => n.celebrate(),
    ]) {
      const node = settledNode()
      configure(node)
      node.setOpacity(0.32)
      node.onUpdate(0.1)
      expect(node.transform.alpha).toBe(0.32)
      expect(Math.max(...record(node).alphas)).toBeLessThanOrEqual(1)
    }
  })
})

describe('board repaint', () => {
  /** A board that has finished every animation. */
  function resting(): BoardNode {
    const node = settledNode()
    node.onUpdate(10)
    return node
  }

  it('stays clean while nothing moves', () => {
    const node = resting()
    node._paintDirty = false
    node.onUpdate(0.016)
    expect(node._paintDirty).toBe(false)
  })

  it('repaints while a wave is moving, and not after it settles', () => {
    const node = settledNode()
    node._paintDirty = false
    node.onUpdate(0.016)
    expect(node._paintDirty).toBe(true)
    node.onUpdate(10)
    node._paintDirty = false
    node.onUpdate(0.016)
    expect(node._paintDirty).toBe(false)
  })

  it('repaints for the overlay, the dim and the win sweep', () => {
    for (const configure of [
      (n: BoardNode) => n.setGlyphs(true),
      (n: BoardNode) => n.setDimmed(true),
      (n: BoardNode) => n.celebrate(),
    ]) {
      const node = resting()
      configure(node)
      node._paintDirty = false
      node.onUpdate(0.016)
      expect(node._paintDirty).toBe(true)
    }
  })

  it('repaints for a look change', () => {
    const node = resting()
    node._paintDirty = false
    node.setLook({ outline: false })
    expect(node._paintDirty).toBe(true)
  })
})

describe('board look', () => {
  const strokes = (calls: string[]): number =>
    calls.filter((c) => c === 'strokeLine' || c === 'strokeQuadratic').length

  it('traces the owned region by default', () => {
    const node = settledNode()
    const rec = record(node)
    expect(strokes(rec.calls)).toBeGreaterThan(0)
  })

  it('draws no outline at all when it is turned off', () => {
    // The menu backdrop has to have no hard edge anywhere, so this is absence of
    // drawing rather than a fainter line.
    const node = settledNode()
    node.setLook({ outline: false })
    const rec = record(node)
    expect(strokes(rec.calls)).toBe(0)
    expect(rec.draws).toBeGreaterThan(0)
  })

  it('draws the recess by default and not when it is null', () => {
    const withWell = record(settledNode())
    expect(withWell.fills).toContain(COLORS.well)

    const node = settledNode()
    node.setLook({ well: null })
    const without = record(node)
    expect(without.fills).not.toContain(COLORS.well)
  })

  it('fills cells from the palette it was given, and nothing else', () => {
    const palette = ['#000001', '#000002', '#000003', '#000004']
    const node = settledNode()
    node.setLook({ palette, outline: false, well: null })
    const rec = record(node)
    expect(rec.fills.length).toBeGreaterThan(0)
    for (const fill of rec.fills) expect(palette).toContain(fill)
  })

  it('leaves the game palette alone on a board that overrides nothing', () => {
    const node = settledNode()
    node.setLook({ outline: false, well: null })
    const rec = record(node)
    for (const fill of rec.fills) expect(CELL_COLORS).toContain(fill)
  })
})

describe('board clip', () => {
  /**
   * The menu backdrop sizes its board past the edge of the view so no boundary
   * lands on screen. The arcade holds the launcher in the same world a band of
   * sky below, so an uncropped overhang is visible from there. Only a clip
   * around every pass keeps both.
   */
  it('wraps the whole draw when a clip is set', () => {
    const node = settledNode()
    const clip = { x: 10, y: 20, width: 300, height: 400 }
    node.setLook({ clip })
    const rec = record(node)

    expect(rec.calls[0]).toBe('save')
    expect(rec.calls[1]).toBe('setClip')
    expect(rec.calls.at(-1)).toBe('restore')
    // Nothing may be drawn outside the pair, or the overhang escapes.
    expect(rec.calls.indexOf('save')).toBe(0)
    expect(rec.calls.lastIndexOf('restore')).toBe(rec.calls.length - 1)
    expect(rec.clips[0]).toEqual({
      kind: 'roundRect',
      x: 10,
      y: 20,
      w: 300,
      h: 400,
      radius: 0,
    })
  })

  it('leaves the draw alone when no clip is set', () => {
    // The board in play fills its own rect, so it has nothing to crop and
    // should not pay for a clip.
    const node = settledNode()
    const rec = record(node)
    expect(rec.calls).not.toContain('setClip')
    expect(rec.calls).not.toContain('save')
  })

  it('still draws its cells inside the clip', () => {
    // Guards against the clip branch returning early and drawing nothing.
    const node = settledNode()
    node.setLook({ clip: { x: 0, y: 0, width: 600, height: 600 } })
    const rec = record(node)
    expect(rec.calls).toContain('fillRoundRect')
    expect(rec.draws).toBeGreaterThan(30)
  })
})
