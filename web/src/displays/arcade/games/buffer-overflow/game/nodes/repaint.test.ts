/**
 * Which writes make a node paint again, and which leave its picture alone.
 *
 * A node that paints on every sync costs a repaint each frame for nothing, and
 * one that skips a real change shows stale pixels, so both directions are
 * pinned. The setters are handed fresh but equal objects each sync in the game,
 * which is the case that has to rest.
 */
import { describe, expect, it } from 'vitest'
import { paintPicture, type Node2D } from '@src/stargazer'
import { clearBuffer, createBuffer, lockPiece } from '../board'
import { BufferNode } from './BufferNode'
import { ClockNode, NextQueueNode } from './PanelNodes'
import { PieceLayerNode } from './PieceLayerNode'
import { StatusBarNode } from './BarNodes'

/** Settle `node`, run `change`, and report whether it wants a repaint. */
function repaints(node: Node2D, change: () => void): boolean {
  node._paintDirty = false
  change()
  return node._paintDirty
}

const RECT = { x: 0, y: 0, width: 400, height: 300 }

describe('StatusBarNode', () => {
  it('rests when handed equal fields in a new array', () => {
    const node = new StatusBarNode()
    node.setRect(RECT)
    node.setFields([{ label: 'pcs', value: '12' }], 4)
    expect(
      repaints(node, () => {
        node.setRect({ ...RECT })
        node.setFields([{ label: 'pcs', value: '12' }], 4)
      }),
    ).toBe(false)
  })

  it('repaints when a value changes', () => {
    const node = new StatusBarNode()
    node.setFields([{ label: 'pcs', value: '12' }], 4)
    expect(
      repaints(node, () => node.setFields([{ label: 'pcs', value: '13' }], 4)),
    ).toBe(true)
  })
})

describe('NextQueueNode', () => {
  it('repaints only when the queue changes', () => {
    const node = new NextQueueNode()
    node.set(['I', 'O'])
    expect(repaints(node, () => node.set(['I', 'O']))).toBe(false)
    expect(repaints(node, () => node.set(['O', 'I']))).toBe(true)
  })
})

describe('ClockNode', () => {
  it('rests while the digits and lit cells hold, however the seconds drain', () => {
    const node = new ClockNode()
    node.setRemaining(40.9)
    expect(repaints(node, () => node.setRemaining(40.2))).toBe(false)
  })

  it('repaints when the digits change', () => {
    const node = new ClockNode()
    node.setRemaining(40.9)
    expect(repaints(node, () => node.setRemaining(39.9))).toBe(true)
  })
})

describe('PieceLayerNode', () => {
  it('copies the piece, so a session that moves it in place still repaints', () => {
    const node = new PieceLayerNode()
    const piece = { kind: 'T' as const, rot: 0 as const, x: 3, y: 2 }
    node.setPiece(piece, null)
    expect(repaints(node, () => node.setPiece(piece, null))).toBe(false)
    piece.x = 4
    expect(repaints(node, () => node.setPiece(piece, null))).toBe(true)
  })
})

describe('BufferNode', () => {
  it('depends on the buffer version', () => {
    const buffer = createBuffer()
    const node = new BufferNode()
    node.setBuffer(buffer)
    node.setRect(
      { x: 0, y: 0, width: 200, height: 400 },
      { x: -4, y: -4, width: 208, height: 408 },
      20,
    )
    const picture = paintPicture(node)
    expect(picture.deps).toContain(buffer)
    expect(picture.depsChanged()).toBe(false)

    lockPiece(buffer, 'O', 0, 0, 20)
    expect(picture.depsChanged()).toBe(true)
  })

  it('bumps the version when the buffer is cleared', () => {
    const buffer = createBuffer()
    const before = buffer.version
    clearBuffer(buffer)
    expect(buffer.version).toBeGreaterThan(before)
  })
})
