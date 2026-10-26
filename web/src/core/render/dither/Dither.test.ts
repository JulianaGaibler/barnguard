import { describe, expect, it } from 'vitest'
import { MockGfxDevice, createPostChain } from 'stargazer/testing'
import { Dither } from './Dither'
import { gridFor } from './params'
import { ditherPreset } from './presets'

async function chainFor(device: MockGfxDevice, dither: Dither) {
  const chain = createPostChain(device)
  for (let i = 0; i < 80; i++) {
    if (chain.prepare([dither], 'linear')) return chain
    await Promise.resolve()
  }
  throw new Error('pipelines never became ready')
}

function sourceOf(device: MockGfxDevice, width: number, height: number) {
  const target = device.createRenderTarget({
    width,
    height,
    samples: 1,
    colorSpace: 'linear',
  })
  return {
    texture: device.colorTexture(target),
    width,
    height,
    placement: {
      originX: 0,
      originY: 0,
      pxPerUnit: 1,
      unitOriginX: 0,
      unitOriginY: 0,
    },
  }
}

describe('Dither', () => {
  it('averages the surface into cells, then draws the dots from them', async () => {
    const device = new MockGfxDevice()
    const dither = new Dither(ditherPreset('stageMountain', { cellSize: 8 }))
    const chain = await chainFor(device, dither)
    chain.release(
      chain.run(sourceOf(device, 200, 100), [dither], 'linear', null)!,
    )

    expect(device.draws).toHaveLength(2)
    // The cells target holds one texel per cell.
    const cellsTarget = device.passes[0].desc.color!.target
    expect([cellsTarget.width, cellsTarget.height]).toEqual([25, 13])
    // The dots pass reads the cells at u_tex, then the noise tile, then the mask.
    expect(
      device.layoutEntries.map((entries) => entries.map((e) => e.binding)),
    ).toEqual([
      [0, 6],
      [0, 1, 2, 6],
    ])
  })

  it('uploads the blue-noise tile once however often it runs', async () => {
    const device = new MockGfxDevice()
    const dither = new Dither(ditherPreset('stippleCloud'))
    const chain = await chainFor(device, dither)
    const source = sourceOf(device, 64, 64)
    for (let i = 0; i < 3; i++)
      chain.release(chain.run(source, [dither], 'linear', null)!)
    expect(device.dataUploads.length).toBeGreaterThan(0)
    const tiles = device.dataUploads.filter(
      (u) => u.data.byteLength === 64 * 64 * 4,
    )
    expect(tiles).toHaveLength(1)
  })

  it('sizes its cell grid in the owner units', async () => {
    const device = new MockGfxDevice()
    const dither = new Dither({ cellSize: 10, snap: false })
    const chain = await chainFor(device, dither)
    const source = sourceOf(device, 300, 200)
    source.placement.pxPerUnit = 2
    chain.release(chain.run(source, [dither], 'linear', null)!)
    const grid = gridFor(dither.settings, { ...source, ...source.placement })
    expect(grid.cellPx).toBe(20)
    const cellsTarget = device.passes[0].desc.color!.target
    expect([cellsTarget.width, cellsTarget.height]).toEqual([15, 10])
  })

  it('reads settings changed after it was built', async () => {
    const device = new MockGfxDevice()
    const dither = new Dither({ cellSize: 10 })
    const chain = await chainFor(device, dither)
    const source = sourceOf(device, 100, 100)
    chain.paramsChanged(source, [dither])
    expect(chain.paramsChanged(source, [dither])).toBe(false)
    dither.settings.pattern = 'bayer2'
    expect(chain.paramsChanged(source, [dither])).toBe(true)
    dither.settings.cellSize = 20
    expect(chain.paramsChanged(source, [dither])).toBe(true)
  })

  it('draws again when a layer anchored grid moves under a cached surface', async () => {
    const device = new MockGfxDevice()
    const dither = new Dither({ cellSize: 10, anchor: 'layer' })
    const chain = await chainFor(device, dither)
    const source = sourceOf(device, 100, 100)
    chain.paramsChanged(source, [dither])
    source.placement.unitOriginX = 3
    expect(chain.paramsChanged(source, [dither])).toBe(true)
  })

  describe('error diffusion', () => {
    const diffused = () =>
      new Dither(ditherPreset('errorDiffusionGlobe', { cellSize: 8 }))

    it('swaps its passes when the pattern changes', () => {
      const dither = new Dither(ditherPreset('stageMountain'))
      const plain = dither.passes
      expect(plain).toHaveLength(2)
      dither.settings.pattern = 'diffusion'
      expect(dither.passes).toHaveLength(3)
      expect(dither.passes[1]).toMatchObject({ kind: 'data' })
      dither.settings.pattern = 'bayer8'
      expect(dither.passes).toBe(plain)
    })

    it('runs a compute pass between the cells and the dots on a device with compute', async () => {
      const device = new MockGfxDevice('webgpu')
      const dither = diffused()
      const chain = await chainFor(device, dither)
      chain.release(
        chain.run(sourceOf(device, 200, 100), [dither], 'linear', null)!,
      )
      expect(device.draws).toHaveLength(2)
      expect(device.computeDispatches).toHaveLength(1)
      // One workgroup does the whole sweep.
      expect(device.computeDispatches[0]).toMatchObject({ x: 1, y: 1, z: 1 })
      // The mask is a storage texture of the cell grid.
      expect(device.textureOpts.find((o) => o.storage)).toMatchObject({
        width: 25,
        height: 13,
      })
      expect(device.readbacks).toHaveLength(0)
    })

    it('reads the cells back and diffuses them on the CPU on a device without compute', async () => {
      const device = new MockGfxDevice('webgl2')
      const dither = diffused()
      const chain = await chainFor(device, dither)
      // Rows from the bottom, as WebGL2 stores them. Every cell is white.
      device.readbackSource = (target) =>
        new Uint8Array(target.width * target.height * 4).fill(255)
      chain.advance(0.016)
      chain.release(
        chain.run(sourceOf(device, 200, 100), [dither], 'linear', null)!,
      )
      expect(device.computeDispatches).toHaveLength(0)
      expect(device.readbacks).toHaveLength(1)
      expect([
        device.readbacks[0].target.width,
        device.readbacks[0].target.height,
      ]).toEqual([25, 13])

      chain.advance(0.016)
      chain.advance(0.016)
      const mask = device.dataUploads.find(
        (u) => u.data.byteLength === 25 * 13 * 4,
      )
      expect(mask).toBeDefined()
      const red = Array.from(mask!.data as Uint8ClampedArray).filter(
        (_, i) => i % 4 === 0,
      )
      // White diffuses to all ink.
      expect(red.every((v) => v === 255)).toBe(true)
    })
  })
})
