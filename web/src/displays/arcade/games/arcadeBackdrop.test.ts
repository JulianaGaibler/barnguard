import { describe, expect, it } from 'vitest'
import { ArcadeBackdrop, type BackdropTarget } from './arcadeBackdrop'

// The lease exists so a 3D game can take the sky down, and the arcade can be
// sure it gets it back. Leaving the launcher without a sky is the failure worth
// guarding, since it outlives the game that caused it.

function spy(): BackdropTarget & { calls: boolean[] } {
  const calls: boolean[] = []
  return { calls, setVisible: (v) => calls.push(v) }
}

describe('ArcadeBackdrop', () => {
  it('starts visible and does not touch the target until asked', () => {
    const target = spy()
    const backdrop = new ArcadeBackdrop(target)
    expect(backdrop.visible).toBe(true)
    expect(target.calls).toEqual([])
  })

  it('hides and shows', () => {
    const target = spy()
    const backdrop = new ArcadeBackdrop(target)
    backdrop.setVisible(false)
    expect(backdrop.visible).toBe(false)
    backdrop.setVisible(true)
    expect(target.calls).toEqual([false, true])
  })

  it('ignores a redundant call, so a per-frame caller costs nothing', () => {
    const target = spy()
    const backdrop = new ArcadeBackdrop(target)
    backdrop.setVisible(false)
    backdrop.setVisible(false)
    expect(target.calls).toEqual([false])
  })

  it('restores the background on release', () => {
    const target = spy()
    const backdrop = new ArcadeBackdrop(target)
    backdrop.setVisible(false)
    backdrop.release()
    expect(target.calls).toEqual([false, true])
    expect(backdrop.visible).toBe(true)
    expect(backdrop.released).toBe(true)
  })

  it('does not touch an already-visible background on release', () => {
    const target = spy()
    const backdrop = new ArcadeBackdrop(target)
    backdrop.release()
    expect(target.calls).toEqual([])
  })

  it('is idempotent, and ignores a late toggle from a torn-down game', () => {
    const target = spy()
    const backdrop = new ArcadeBackdrop(target)
    backdrop.setVisible(false)
    backdrop.release()
    backdrop.release()
    backdrop.setVisible(false)
    expect(target.calls).toEqual([false, true])
  })
})
