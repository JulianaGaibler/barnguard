import { describe, it, expect } from 'vitest'
import { RenderQuality } from './RenderQuality'

describe('RenderQuality', () => {
  it('defaults to sensible values', () => {
    const q = new RenderQuality()
    expect(q.shadowMapSize).toBe(1024)
    expect(q.shadowsEnabled).toBe(true)
    expect(q.anisotropy).toBe(8)
    expect(q.shadowSoftness).toBe(4)
    expect(q.revision).toBe(0)
  })

  it('snaps shadow map size to a supported value', () => {
    const q = new RenderQuality()
    q.shadowMapSize = 1800
    expect(q.shadowMapSize).toBe(2048)
    q.shadowMapSize = 300
    expect(q.shadowMapSize).toBe(256)
  })

  it('clamps anisotropy and snaps softness', () => {
    const q = new RenderQuality()
    q.anisotropy = 99
    expect(q.anisotropy).toBe(16)
    q.anisotropy = 0
    expect(q.anisotropy).toBe(1)
    q.shadowSoftness = 7
    expect(q.shadowSoftness).toBe(9) // nearest of 1/4/9/16
  })

  it('bumps revision on a real change but not on a no-op', () => {
    const q = new RenderQuality()
    q.shadowMapSize = 2048
    const r = q.revision
    expect(r).toBeGreaterThan(0)
    q.shadowMapSize = 2048 // same
    expect(q.revision).toBe(r)
    q.shadowsEnabled = false
    expect(q.revision).toBe(r + 1)
  })

  it('applies construction options', () => {
    const q = new RenderQuality({
      shadowMapSize: 4096,
      shadowsEnabled: false,
      anisotropy: 4,
    })
    expect(q.shadowMapSize).toBe(4096)
    expect(q.shadowsEnabled).toBe(false)
    expect(q.anisotropy).toBe(4)
    expect(q.revision).toBe(0)
  })
})
