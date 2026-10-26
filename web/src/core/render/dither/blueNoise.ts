import { DataTexture } from 'stargazer'
import { BLUE_NOISE_BASE64 } from './blueNoise64.gen'
import { BLUE_NOISE_SIZE } from './blueNoiseGenerator'

let tile: DataTexture | null = null

/**
 * The shared blue-noise tile as a texture. The value sits in the red channel,
 * and the tile wraps. It is built on first use.
 */
export function blueNoiseTexture(): DataTexture {
  if (tile) return tile
  const bytes = Uint8Array.from(atob(BLUE_NOISE_BASE64), (c) => c.charCodeAt(0))
  tile = new DataTexture(BLUE_NOISE_SIZE, BLUE_NOISE_SIZE)
  for (let i = 0; i < bytes.length; i++) {
    tile.data[i * 4] = bytes[i]
    tile.data[i * 4 + 1] = bytes[i]
    tile.data[i * 4 + 2] = bytes[i]
    tile.data[i * 4 + 3] = 255
  }
  tile.markDirty()
  return tile
}
