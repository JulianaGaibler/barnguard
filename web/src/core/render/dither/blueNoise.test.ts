import { describe, expect, it } from 'vitest'
import { BLUE_NOISE_BASE64 } from './blueNoise64.gen'
import { BLUE_NOISE_SIZE, generateBlueNoise } from './blueNoiseGenerator'
import { blueNoiseTexture } from './blueNoise'

const shipped = Uint8Array.from(atob(BLUE_NOISE_BASE64), (c) => c.charCodeAt(0))

describe('blue noise', () => {
  it('ships the tile the generator builds', () => {
    expect(shipped.length).toBe(BLUE_NOISE_SIZE * BLUE_NOISE_SIZE)
    expect(Array.from(generateBlueNoise(BLUE_NOISE_SIZE))).toEqual(
      Array.from(shipped),
    )
  })

  it('is deterministic', () => {
    expect(Array.from(generateBlueNoise(16))).toEqual(
      Array.from(generateBlueNoise(16)),
    )
  })

  it('spreads every level evenly, so any threshold lights its share of cells', () => {
    const counts = new Array<number>(256).fill(0)
    for (const value of shipped) counts[value]++
    const share = shipped.length / 255
    for (let level = 1; level < 255; level++) {
      expect(Math.abs(counts[level] - share)).toBeLessThanOrEqual(1.5)
    }
  })

  it('keeps neighbors far apart in value, wrapping at the edges', () => {
    const size = BLUE_NOISE_SIZE
    let sum = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const here = shipped[y * size + x]
        sum += Math.abs(here - shipped[y * size + ((x + 1) % size)])
        sum += Math.abs(here - shipped[((y + 1) % size) * size + x])
      }
    }
    // White noise averages about 85. Blue noise pushes close values apart.
    expect(sum / (2 * size * size)).toBeGreaterThan(90)
  })

  it('becomes one shared texture with the value in every color channel', () => {
    const texture = blueNoiseTexture()
    expect(blueNoiseTexture()).toBe(texture)
    expect(texture.width).toBe(BLUE_NOISE_SIZE)
    expect(texture.data[40]).toBe(shipped[10])
    expect(texture.data[41]).toBe(shipped[10])
    expect(texture.data[43]).toBe(255)
  })
})
