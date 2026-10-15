import { describe, expect, it } from 'vitest'
import { QualityControl, type QualityHost } from './QualityControl'
import { RenderQuality } from './RenderQuality'
import type { Stage } from './Stage'

interface FakeAo {
  enabled: boolean
  preset: 'low' | 'medium' | 'high'
  resolution: 'full' | 'half'
}

function makeHost(): {
  host: QualityHost
  stage: { msaa: number; renderScale: number; ao: FakeAo | null }
  ticker: { maxFps: number }
} {
  const stage = {
    msaa: 4,
    renderScale: 1,
    ao: null as FakeAo | null,
    setMsaaSamples(n: number) {
      this.msaa = n
    },
    getMsaaSamples() {
      return this.msaa
    },
    peekAmbientOcclusion() {
      return this.ao
    },
  }
  const ticker = {
    maxFps: 0,
    setMaxFps(fps: number) {
      this.maxFps = fps
    },
  }
  const host: QualityHost = {
    quality: new RenderQuality(),
    primaryStage: stage as unknown as Stage,
    ticker,
  }
  return { host, stage, ticker }
}

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    },
  }
}

const make = (storage: Storage | null = null, host = makeHost()) => ({
  ...host,
  control: new QualityControl(host.host, { storage, key: 'test' }),
})

describe('QualityControl', () => {
  it('starts with every group on auto', () => {
    const { control } = make()
    expect(control.pinned()).toEqual([])
    expect(control.mode('msaa')).toBe('auto')
  })

  it('applies a fixed value now, and enforces it when something else changes it', () => {
    const { control, stage } = make()
    control.setFixed('msaa', 2)
    expect(stage.msaa).toBe(2)
    expect(control.mode('msaa')).toBe('fixed')
    // A game, or the engine, writes it again.
    stage.msaa = 4
    control.enforce()
    expect(stage.msaa).toBe(2)
  })

  it('does not fight a driver that clamps the value', () => {
    const { control, stage } = make()
    let writes = 0
    const set = stage as unknown as { setMsaaSamples(n: number): void }
    set.setMsaaSamples = (n) => {
      writes++
      stage.msaa = Math.min(n, 4)
    }
    control.setFixed('msaa', 8)
    expect(stage.msaa).toBe(4)
    for (let i = 0; i < 5; i++) control.enforce()
    expect(writes).toBe(1)
  })

  it('returns a group to the value it had before it was pinned when set back to auto', () => {
    const { control, stage } = make()
    control.setFixed('scale', 0.6)
    expect(stage.renderScale).toBe(0.6)
    control.setAuto('scale')
    expect(stage.renderScale).toBe(1)
    expect(control.mode('scale')).toBe('auto')
  })

  it('records what the engine lowered a group from, and restores it on auto', () => {
    const { control, stage } = make()
    control.noteLowered('msaa')
    stage.msaa = 2
    expect(control.loweredFrom('msaa')).toBe(4)
    control.noteLowered('msaa')
    expect(control.loweredFrom('msaa')).toBe(4)
    control.setAuto('msaa')
    expect(stage.msaa).toBe(4)
    expect(control.loweredFrom('msaa')).toBeUndefined()
  })

  it('holds an AO pin until the scene creates ambient occlusion', () => {
    const { control, stage } = make()
    control.setFixed('aoPreset', 'low')
    expect(control.read('aoPreset')).toBeNull()
    stage.ao = { enabled: true, preset: 'high', resolution: 'full' }
    control.enforce()
    expect(stage.ao).toMatchObject({ enabled: true, preset: 'low' })
  })

  it('turns AO off for a pin of off', () => {
    const { control, stage } = make()
    stage.ao = { enabled: true, preset: 'medium', resolution: 'full' }
    control.setFixed('aoPreset', 'off')
    expect(stage.ao.enabled).toBe(false)
    expect(control.read('aoPreset')).toBe('off')
  })

  it('writes shadows as an enable and a tap count', () => {
    const { control, host } = make()
    control.setFixed('shadows', 0)
    expect(host.quality.meshShadowsEnabled).toBe(false)
    control.setFixed('shadows', 16)
    expect(host.quality.meshShadowsEnabled).toBe(true)
    expect(host.quality.shadowSoftness).toBe(16)
  })

  it('applies a preset, pinning what it names, and recognises it again', () => {
    const { control, stage, host } = make()
    control.applyPreset('minimal')
    expect(stage.msaa).toBe(1)
    expect(stage.renderScale).toBe(0.75)
    expect(host.quality.shadowSoftness).toBe(1)
    expect(host.quality.shadowMapSize).toBe(512)
    expect(control.matchingPreset()).toBe('minimal')
    control.setFixed('msaa', 4)
    expect(control.matchingPreset()).toBeNull()
    control.applyPreset('auto')
    expect(control.pinned()).toEqual([])
  })

  it('sets the manual settings, including the frame cap', () => {
    const { control, ticker, host } = make()
    control.setManual({ maxFps: 30, anisotropy: 2, dither: false })
    expect(ticker.maxFps).toBe(30)
    expect(host.quality.anisotropy).toBe(2)
    expect(host.quality.vector.dither).toBe(false)
    expect(control.readManual().maxFps).toBe(30)
  })

  describe('saving', () => {
    it('puts the pinned groups and manual settings back in a new session', () => {
      const storage = memoryStorage()
      const first = make(storage)
      first.control.restore()
      first.control.setFixed('msaa', 2)
      first.control.setFixed('scale', 0.85)
      first.control.setManual({ maxFps: 60, shadowMapSize: 2048 })

      const second = make(storage)
      expect(second.control.restore()).toBe(true)
      expect(second.stage.msaa).toBe(2)
      expect(second.stage.renderScale).toBe(0.85)
      expect([...second.control.pinned()].sort()).toEqual(['msaa', 'scale'])
      expect(second.ticker.maxFps).toBe(60)
      expect(second.host.quality.shadowMapSize).toBe(2048)
      expect(second.control.saved).toBe(true)
    })

    it('saves nothing until restore has been called', () => {
      const storage = memoryStorage()
      const { control } = make(storage)
      control.setFixed('msaa', 1)
      expect(storage.getItem('test')).toBeNull()
    })

    it('forgets everything on reset, in this session and the next', () => {
      const storage = memoryStorage()
      const first = make(storage)
      first.control.restore()
      first.control.setFixed('msaa', 1)
      first.control.setManual({ maxFps: 30 })
      first.control.reset()
      expect(first.stage.msaa).toBe(4)
      expect(first.ticker.maxFps).toBe(0)
      expect(first.control.pinned()).toEqual([])

      const second = make(storage)
      expect(second.control.restore()).toBe(false)
      expect(second.stage.msaa).toBe(4)
    })

    it('ignores a saved profile it does not understand', () => {
      const storage = memoryStorage()
      storage.setItem('test', '{"version":9}')
      const { control, stage } = make(storage)
      expect(control.restore()).toBe(false)
      expect(stage.msaa).toBe(4)
    })

    it('stops saving when persistence is disabled', () => {
      const storage = memoryStorage()
      const { control } = make(storage)
      control.restore()
      control.disablePersistence()
      control.setFixed('msaa', 1)
      expect(storage.getItem('test')).toBeNull()
    })
  })
})
