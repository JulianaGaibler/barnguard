import { describe, it, expect } from 'vitest'
import { RenderTargetPool } from './RenderTargetPool'
import { MockGfxDevice } from './webgl2/mockGfxDevice'

describe('RenderTargetPool', () => {
  it('reuses a transient target by key after release', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const a = pool.acquireTransient(64, 64, 'linear', 'rgba8', 1)
    pool.release(a)
    const b = pool.acquireTransient(64, 64, 'linear', 'rgba8', 1)
    expect(b).toBe(a)
    expect(device.renderTargets.length).toBe(1)
  })

  it('allocates a second target for a key already claimed', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const a = pool.acquireTransient(32, 32)
    const b = pool.acquireTransient(32, 32)
    expect(a).not.toBe(b)
    expect(device.renderTargets.length).toBe(2)
  })

  it('prunes a transient target no frame since the last endFrame asked for', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const a = pool.acquireTransient(64, 64)
    pool.release(a)
    pool.endFrame() // this round did ask for the key: survives
    expect(device.deletedRenderTargetHandles).not.toContain(a)
    pool.endFrame() // nothing asked for it since: pruned
    expect(device.deletedRenderTargetHandles).toContain(a)
  })

  it('keeps a transient target alive across endFrame when reacquired', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const a = pool.acquireTransient(64, 64)
    pool.release(a)
    const b = pool.acquireTransient(64, 64)
    pool.release(b)
    pool.endFrame()
    expect(device.deletedRenderTargetHandles).not.toContain(a)
  })

  it('never reuses or prunes a retained target', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const retained = pool.acquireRetained(64, 64, 'linear', 'rg8', 1)
    pool.endFrame()
    pool.endFrame()
    expect(device.deletedRenderTargetHandles).not.toContain(retained)
    const transient = pool.acquireTransient(64, 64, 'linear', 'rg8', 1)
    expect(transient).not.toBe(retained)
  })

  it('deletes a retained target only once its refcount reaches zero', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const rt = pool.acquireRetained(64, 64)
    // A second logical holder shares the same handle without a second create.
    pool.release(rt)
    expect(device.deletedRenderTargetHandles).toContain(rt)
  })

  it('throws on a double release of a transient target', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const a = pool.acquireTransient(64, 64)
    pool.release(a)
    expect(() => pool.release(a)).toThrow()
  })

  it('throws releasing a target this pool never handed out', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const other = new RenderTargetPool(device)
    const rt = other.acquireTransient(64, 64)
    expect(() => pool.release(rt)).toThrow()
  })

  it('keys include size, color space, pixel format, and samples', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const a = pool.acquireTransient(64, 64, 'linear', 'rgba8', 1)
    pool.release(a)
    // A different pixel format at the same size must not reuse the handle.
    const b = pool.acquireTransient(64, 64, 'linear', 'r8', 1)
    expect(b).not.toBe(a)
  })

  it('destroy deletes every target, transient and retained', () => {
    const device = new MockGfxDevice()
    const pool = new RenderTargetPool(device)
    const t = pool.acquireTransient(64, 64)
    const r = pool.acquireRetained(64, 64)
    pool.release(t)
    pool.destroy()
    expect(device.deletedRenderTargetHandles).toContain(t)
    expect(device.deletedRenderTargetHandles).toContain(r)
  })
})
