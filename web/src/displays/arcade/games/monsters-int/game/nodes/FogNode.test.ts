import { describe, expect, it } from 'vitest'
import { Fog } from '@src/stargazer'
import { FogNode } from './FogNode'
import { FOG } from '../tuning'

// The haze is a focus device, not scenery: it comes up while the table is
// holding something out to be read and goes back down once every card is at
// rest. It is also the STAGE's fog, so leaving it up leaks into the launcher.

/** Run the fade to completion, in steps a frame apart. */
function settle(fog: FogNode): void {
  for (let i = 0; i < 200; i++) fog.onUpdate(1 / 60)
}

describe('FogNode', () => {
  it('starts clear, with the ramp parked past the table', () => {
    const fog = new Fog()
    new FogNode(fog)
    expect(fog.enabled).toBe(true)
    expect(fog.start).toBe(FOG.clear)
  })

  it('brings the haze up to where the seats sit, and takes it back down', () => {
    const fog = new Fog()
    const node = new FogNode(fog)

    node.setRaised(true)
    settle(node)
    expect(fog.start).toBeCloseTo(FOG.start, 9)
    expect(fog.end).toBeCloseTo(FOG.end, 9)

    node.setRaised(false)
    settle(node)
    expect(fog.start).toBeCloseTo(FOG.clear, 9)
  })

  it('fades rather than cutting', () => {
    const fog = new Fog()
    const node = new FogNode(fog)
    node.setRaised(true)
    node.onUpdate(1 / 60)
    expect(fog.start).toBeLessThan(FOG.clear)
    expect(fog.start).toBeGreaterThan(FOG.start)
  })

  it('keeps the ramp the same width throughout, so the falloff holds', () => {
    const fog = new Fog()
    const node = new FogNode(fog)
    node.setRaised(true)
    for (let i = 0; i < 12; i++) {
      node.onUpdate(1 / 60)
      expect(fog.end - fog.start).toBeCloseTo(FOG.end - FOG.start, 9)
    }
  })

  it('hands the fog back, so it cannot haze the launcher', () => {
    const fog = new Fog()
    const node = new FogNode(fog)
    node.destroy()
    expect(fog.enabled).toBe(false)
  })
})
