import { describe, expect, it } from 'vitest'
import type { Gfx2D } from '@src/stargazer'
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
 * A stub that records the alphas a node asks for and swallows the geometry.
 *
 * `Gfx2D.setAlpha` is absolute, so a node that dims itself has to fold its
 * opacity into every alpha it sets. Nothing but a recording of those calls can
 * show that none escaped.
 */
function recordingGfx(): {
  gfx: Gfx2D
  alphas: number[]
  /** Method names in call order, so a missing pass is visible. */
  calls: string[]
  /** Colors handed to `fillRoundRect`, which is how cells are drawn. */
  fills: string[]
  /** Shapes handed to `setClip`, `null` for a clear. */
  clips: unknown[]
  draws: number
} {
  const alphas: number[] = []
  const calls: string[] = []
  const fills: string[] = []
  const clips: unknown[] = []
  const state = { draws: 0 }
  const note = (name: string) => (): void => {
    state.draws++
    calls.push(name)
  }
  const gfx = {
    setAlpha: (a: number) => alphas.push(a),
    fillRect: note('fillRect'),
    fillRoundRect: (...args: unknown[]) => {
      state.draws++
      calls.push('fillRoundRect')
      fills.push(String(args[5]))
    },
    fillCircle: note('fillCircle'),
    fillConvexPoly: note('fillConvexPoly'),
    strokeLine: note('strokeLine'),
    strokeQuadratic: note('strokeQuadratic'),
    strokePolyline: note('strokePolyline'),
    strokeRoundRect: note('strokeRoundRect'),
    fillText: note('fillText'),
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    setClip: (shape: unknown) => {
      calls.push('setClip')
      clips.push(shape)
    },
  } as unknown as Gfx2D
  return {
    gfx,
    alphas,
    calls,
    fills,
    clips,
    get draws() {
      return state.draws
    },
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
  applyMove(board, 1, (board.color[0]! + 1) % 4, createMoveResult(board))
  node.onUpdate(0.05)
  return node
}

describe('board opacity', () => {
  it('draws at full strength by default', () => {
    const node = settledNode()
    const rec = recordingGfx()
    node.draw(rec.gfx)
    expect(rec.draws).toBeGreaterThan(0)
    expect(Math.max(...rec.alphas)).toBe(1)
  })

  it('never exceeds the opacity it was given', () => {
    for (const opacity of [0.32, 0.5, 0.75]) {
      const node = settledNode({ glyphs: true })
      node.setOpacity(opacity)
      const rec = recordingGfx()
      node.draw(rec.gfx)
      expect(rec.alphas.length, `opacity ${opacity}`).toBeGreaterThan(0)
      expect(Math.max(...rec.alphas), `opacity ${opacity}`).toBeCloseTo(
        opacity,
        9,
      )
    }
  })

  it('sets an alpha before its first draw, so nothing rides in opaque', () => {
    // The layer walker installs `transform.alpha`, which an absolute `setAlpha`
    // later in the pass would discard. The node has to state its own alpha up
    // front instead.
    const node = settledNode()
    node.setOpacity(0.4)
    const calls: string[] = []
    const gfx = new Proxy(
      {},
      {
        get: (_t, prop: string) => () => calls.push(prop),
      },
    ) as unknown as Gfx2D
    node.draw(gfx)
    expect(calls[0]).toBe('setAlpha')
  })

  it('keeps the dim uniform while a flood is mid-wave', () => {
    // Mid-wave is where the cross-fade sets a partial alpha, which is exactly
    // where a stray reset to 1 would show as a bright patch.
    const node = settledNode()
    node.setOpacity(0.32)
    const rec = recordingGfx()
    node.draw(rec.gfx)
    for (const a of rec.alphas) expect(a).toBeLessThanOrEqual(0.32 + 1e-9)
  })

  it('scales the loss dim and the win sweep too', () => {
    for (const configure of [
      (n: BoardNode) => n.setDimmed(true),
      (n: BoardNode) => n.celebrate(),
    ]) {
      const node = settledNode()
      configure(node)
      node.setOpacity(0.32)
      node.onUpdate(0.1)
      const rec = recordingGfx()
      node.draw(rec.gfx)
      expect(Math.max(...rec.alphas)).toBeLessThanOrEqual(0.32 + 1e-9)
    }
  })
})

describe('board look', () => {
  const strokes = (calls: string[]): number =>
    calls.filter((c) => c === 'strokeLine' || c === 'strokeQuadratic').length

  it('traces the owned region by default', () => {
    const node = settledNode()
    const rec = recordingGfx()
    node.draw(rec.gfx)
    expect(strokes(rec.calls)).toBeGreaterThan(0)
  })

  it('draws no outline at all when it is turned off', () => {
    // The menu backdrop has to have no hard edge anywhere, so this is absence of
    // drawing rather than a fainter line.
    const node = settledNode()
    node.setLook({ outline: false })
    const rec = recordingGfx()
    node.draw(rec.gfx)
    expect(strokes(rec.calls)).toBe(0)
    expect(rec.draws).toBeGreaterThan(0)
  })

  it('draws the recess by default and not when it is null', () => {
    const withWell = recordingGfx()
    settledNode().draw(withWell.gfx)
    expect(withWell.fills).toContain(COLORS.well)

    const node = settledNode()
    node.setLook({ well: null })
    const without = recordingGfx()
    node.draw(without.gfx)
    expect(without.fills).not.toContain(COLORS.well)
  })

  it('fills cells from the palette it was given, and nothing else', () => {
    const palette = ['#000001', '#000002', '#000003', '#000004']
    const node = settledNode()
    node.setLook({ palette, outline: false, well: null })
    const rec = recordingGfx()
    node.draw(rec.gfx)
    expect(rec.fills.length).toBeGreaterThan(0)
    for (const fill of rec.fills) expect(palette).toContain(fill)
  })

  it('leaves the game palette alone on a board that overrides nothing', () => {
    const node = settledNode()
    node.setLook({ outline: false, well: null })
    const rec = recordingGfx()
    node.draw(rec.gfx)
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
    const rec = recordingGfx()
    node.draw(rec.gfx)

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
    const rec = recordingGfx()
    node.draw(rec.gfx)
    expect(rec.calls).not.toContain('setClip')
    expect(rec.calls).not.toContain('save')
  })

  it('still draws its cells inside the clip', () => {
    // Guards against the clip branch returning early and drawing nothing.
    const node = settledNode()
    node.setLook({ clip: { x: 0, y: 0, width: 600, height: 600 } })
    const rec = recordingGfx()
    node.draw(rec.gfx)
    expect(rec.calls).toContain('fillRoundRect')
    expect(rec.draws).toBeGreaterThan(30)
  })
})
