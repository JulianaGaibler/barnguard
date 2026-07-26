import { describe, expect, it } from 'vitest'
import { Fog } from './Fog'

describe('Fog', () => {
  it('defaults to disabled exponential fog', () => {
    const fog = new Fog()
    expect(fog.enabled).toBe(false)
    expect(fog.mode).toBe('exp')
  })

  it('applies construction options', () => {
    const fog = new Fog({
      enabled: true,
      mode: 'linear',
      color: [0.1, 0.2, 0.3],
      start: 4,
      end: 20,
    })
    expect(fog.enabled).toBe(true)
    expect(fog.mode).toBe('linear')
    expect(fog.color).toEqual([0.1, 0.2, 0.3])
    expect(fog.start).toBe(4)
    expect(fog.end).toBe(20)
  })

  it('clamps density and distances to non-negative', () => {
    const fog = new Fog({ density: -1, start: -5 })
    expect(fog.density).toBe(0)
    expect(fog.start).toBe(0)
  })

  it('keeps end strictly beyond start', () => {
    const fog = new Fog({ start: 10, end: 5 })
    expect(fog.end).toBeGreaterThan(fog.start)
  })
})
