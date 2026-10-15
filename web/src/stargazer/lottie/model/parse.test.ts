import { describe, expect, it } from 'vitest'
import { parseLottie } from './parse'

const fixtures = import.meta.glob('../../dev/fixtures/lottie/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const byName = (name: string): string =>
  fixtures[`../../dev/fixtures/lottie/${name}.json`]

describe('parseLottie', () => {
  it('parses every fixture and reports timing consistently', () => {
    const names = Object.keys(fixtures)
    expect(names.length).toBeGreaterThan(10)
    for (const path of names) {
      const a = parseLottie(fixtures[path])
      expect(a.totalFrames).toBeCloseTo(a.outPoint - a.inPoint, 9)
      expect(a.durationMs).toBeCloseTo((a.totalFrames / a.frameRate) * 1000, 6)
      expect(a.layers.length).toBeGreaterThan(0)
    }
  })

  it('reads the playback fixture: markers and slots', () => {
    const a = parseLottie(byName('playback_test'))
    expect(a.frameRate).toBe(30)
    expect(a.totalFrames).toBe(42)
    expect(a.markers).toHaveLength(4)
    expect(a.slotIds.length).toBeGreaterThan(0)
    expect(a.diagnostics).toEqual([])
  })

  it('compiles a star layer with animated properties', () => {
    const a = parseLottie(byName('polystar_anim'))
    const layer = a.layers[0]
    expect(layer.type).toBe('shape')
    if (layer.type !== 'shape') return
    const star = layer.shapes.find((s) => s.kind === 'star')
    expect(star?.kind).toBe('star')
    if (star?.kind !== 'star') return
    expect(star.outerRadius.isStatic).toBe(false)
    expect(star.outerRadius.get(0)).toBe(102)
    expect(star.outerRadius.get(90)).toBe(142)
    expect(a.diagnostics).toEqual([])
  })

  it('reads track mattes', () => {
    const a = parseLottie(byName('masking'))
    expect(a.layers.some((l) => l.matteMode !== 'none')).toBe(true)
    expect(a.layers.some((l) => l.isMatte)).toBe(true)
    expect(a.layerNames).toHaveLength(a.layers.length)
  })

  it('collects precomp assets and reports unsupported features', () => {
    const a = parseLottie(byName('focal_test'))
    expect(a.assets.size).toBeGreaterThan(0)
    expect(a.diagnostics.some((d) => d.code === 'collapse-transform')).toBe(
      true,
    )
    expect(a.diagnostics.every((d) => d.message.length > 0)).toBe(true)
  })

  it('ignores expressions with a diagnostic and keeps the keyframes', () => {
    const a = parseLottie({
      v: '5.7.0',
      fr: 30,
      ip: 0,
      op: 30,
      w: 100,
      h: 100,
      layers: [
        {
          ty: 3,
          ind: 1,
          nm: 'n',
          ip: 0,
          op: 30,
          ks: { o: { a: 0, k: 50, x: 'var $bm_rt = 1' } },
        },
      ],
    })
    expect(a.diagnostics.map((d) => d.code)).toEqual(['expression'])
    expect(a.layers[0].transform.opacity.get(0)).toBe(50)
  })

  it('upgrades 0 to 255 colors from old files and throws on a missing composition', () => {
    const old = parseLottie({
      v: '4.0.0',
      fr: 30,
      ip: 0,
      op: 30,
      w: 10,
      h: 10,
      layers: [
        {
          ty: 4,
          ind: 1,
          nm: 's',
          ip: 0,
          op: 30,
          ks: {},
          shapes: [
            { ty: 'fl', c: { a: 0, k: [255, 0, 0, 255] }, o: { a: 0, k: 100 } },
          ],
        },
      ],
    })
    const layer = old.layers[0]
    if (layer.type !== 'shape') throw new Error('expected a shape layer')
    const fill = layer.shapes[0]
    if (fill.kind !== 'fill') throw new Error('expected a fill')
    const out = new Float64Array(4)
    fill.color.sample(0, out)
    expect(out[0]).toBeCloseTo(1, 6)
    expect(() => parseLottie({ w: 10, h: 10 })).toThrow(/frame rate/)
  })
})
