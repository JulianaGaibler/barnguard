import { describe, expect, it } from 'vitest'
import type { Gfx2D } from '../../render/gfx/Gfx2D'
import type { GfxPath } from '../../render/gfx/GfxPath'
import { parseLottie } from '../model/parse'
import { LottieRenderer } from './LottieRenderer'
import { paintAll } from './paintAll.testutil'

const fixtures = import.meta.glob('../../dev/fixtures/lottie/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** Bounds of everything drawn, in composition space. */
function drawnBounds(name: string, frameFraction: number) {
  const anim = parseLottie(fixtures[`../../dev/fixtures/lottie/${name}.json`])
  const r = new LottieRenderer(anim)
  r.evaluate(anim.inPoint + anim.totalFrames * frameFraction)
  const stack: number[][] = []
  let m = [1, 0, 0, 1, 0, 0]
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const add = (p: GfxPath): void => {
    const f = p.flatten(1)
    for (let i = 0; i < f.pointCount; i++) {
      const x = f.points[i * 2]
      const y = f.points[i * 2 + 1]
      const X = m[0] * x + m[2] * y + m[4]
      const Y = m[1] * x + m[3] * y + m[5]
      b.minX = Math.min(b.minX, X)
      b.maxX = Math.max(b.maxX, X)
      b.minY = Math.min(b.minY, Y)
      b.maxY = Math.max(b.maxY, Y)
    }
  }
  // A shape drawn as an analytic instance, sampled along its outline: the
  // ellipse with radii `hx`, `hy`, or the box of that half size with corners
  // rounded by `radius`.
  const addOutline = (
    cx: number,
    cy: number,
    hx: number,
    hy: number,
    ellipse = false,
    radius = 0,
  ): void => {
    const points: number[] = []
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2
      const dx = Math.cos(t)
      const dy = Math.sin(t)
      if (ellipse) {
        points.push(cx + hx * dx, cy + hy * dy)
      } else {
        // The corner arc for this direction, around the inset corner center.
        points.push(
          cx + Math.sign(dx) * (hx - radius) + radius * dx,
          cy + Math.sign(dy) * (hy - radius) + radius * dy,
        )
      }
    }
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i]
      const y = points[i + 1]
      const X = m[0] * x + m[2] * y + m[4]
      const Y = m[1] * x + m[3] * y + m[5]
      b.minX = Math.min(b.minX, X)
      b.maxX = Math.max(b.maxX, X)
      b.minY = Math.min(b.minY, Y)
      b.maxY = Math.max(b.maxY, Y)
    }
  }
  const gfx = {
    save: () => stack.push(m.slice()),
    restore: () => {
      m = stack.pop() as number[]
    },
    transform: (
      a: number,
      bb: number,
      c: number,
      d: number,
      e: number,
      f: number,
    ) => {
      m = [
        m[0] * a + m[2] * bb,
        m[1] * a + m[3] * bb,
        m[0] * c + m[2] * d,
        m[1] * c + m[3] * d,
        m[0] * e + m[2] * f + m[4],
        m[1] * e + m[3] * f + m[5],
      ]
    },
    translate: (x: number, y: number) => gfx.transform(1, 0, 0, 1, x, y),
    scale: (x: number, y: number) => gfx.transform(x, 0, 0, y, 0, 0),
    clipPath: () => {},
    fillText: () => {},
    setAlpha: () => {},
    fillRect: () => {},
    fillPath: add,
    strokePath: add,
    fillRoundRect: (x: number, y: number, w: number, h: number, r: number) =>
      addOutline(x + w / 2, y + h / 2, w / 2, h / 2, false, r),
    strokeRoundRect: (x: number, y: number, w: number, h: number, r: number) =>
      addOutline(x + w / 2, y + h / 2, w / 2, h / 2, false, r),
    fillEllipse: (cx: number, cy: number, rx: number, ry: number) =>
      addOutline(cx, cy, rx, ry, true),
    strokeEllipse: (cx: number, cy: number, rx: number, ry: number) =>
      addOutline(cx, cy, rx, ry, true),
  } as unknown as Gfx2D & { transform: Gfx2D['transform'] }
  paintAll(r, gfx as never)
  return { anim, ...b }
}

describe('LottieRenderer placement', () => {
  it('places layer content through the layer transform', () => {
    // These fixtures keep their content inside the composition.
    for (const name of [
      'polystar_anim',
      'abstract_circle',
      'hourglass',
      'birth_stone_logo',
    ]) {
      const { anim, minX, minY, maxX, maxY } = drawnBounds(name, 0.5)
      expect(minX, name).toBeGreaterThanOrEqual(-1)
      expect(minY, name).toBeGreaterThanOrEqual(-1)
      expect(maxX, name).toBeLessThanOrEqual(anim.width + 1)
      expect(maxY, name).toBeLessThanOrEqual(anim.height + 1)
    }
    // The star is centered on the composition, not on the origin.
    const star = drawnBounds('polystar_anim', 0.5)
    expect((star.minX + star.maxX) / 2).toBeCloseTo(star.anim.width / 2, -1)
  })

  it('draws embedded glyph outlines for a text layer', () => {
    const { anim, minX, minY, maxX, maxY } = drawnBounds('text', 0.07)
    expect(anim.glyphs.length).toBeGreaterThan(0)
    expect(maxX).toBeGreaterThan(minX)
    expect(maxY).toBeGreaterThan(minY)
    // The word is centered on the composition horizontally.
    expect((minX + maxX) / 2).toBeCloseTo(anim.width / 2, -2)
  })

  it('draws text without outlines through the platform font, line by line', () => {
    const anim = parseLottie({
      v: '5.7.0',
      fr: 30,
      ip: 0,
      op: 30,
      w: 200,
      h: 100,
      fonts: { list: [{ fName: 'Foo-Bold', fFamily: 'Foo', fStyle: 'Bold' }] },
      layers: [
        {
          ty: 5,
          ind: 1,
          nm: 't',
          ip: 0,
          op: 30,
          ks: {},
          t: {
            d: {
              k: [
                {
                  t: 0,
                  s: {
                    t: 'one\rtwo',
                    f: 'Foo-Bold',
                    s: 20,
                    j: 2,
                    lh: 24,
                    fc: [1, 0, 0],
                  },
                },
              ],
            },
          },
        },
      ],
    })
    const r = new LottieRenderer(anim)
    r.evaluate(0)
    const calls: Array<{
      text: string
      y: number
      font?: string
      align?: string
      color?: string
    }> = []
    const gfx = {
      save() {},
      restore() {},
      transform() {},
      setAlpha() {},
      fillText(
        text: string,
        _x: number,
        y: number,
        style: { font?: string; align?: string; color?: string },
      ) {
        calls.push({ text, y, ...style })
      },
    } as unknown as Gfx2D
    paintAll(r, gfx as never)
    expect(calls.map((c) => [c.text, c.y])).toEqual([
      ['one', 0],
      ['two', 24],
    ])
    expect(calls[0].font).toBe('20px "Foo", sans-serif')
    expect(calls[0].align).toBe('center')
    expect(calls[0].color).toBe('rgb(255, 0, 0)')
  })

  it('draws an image layer once its picture arrives', () => {
    const anim = parseLottie({
      v: '5.7.0',
      fr: 30,
      ip: 0,
      op: 30,
      w: 100,
      h: 100,
      assets: [{ id: 'img_0', w: 16, h: 16, u: 'images/', p: 'a.png', e: 0 }],
      layers: [
        { ty: 2, ind: 1, nm: 'pic', refId: 'img_0', ip: 0, op: 30, ks: {} },
      ],
    })
    const r = new LottieRenderer(anim)
    r.evaluate(0)
    expect(r.pendingImages()).toEqual([
      { id: 'img_0', path: 'a.png', dir: 'images/', embedded: false },
    ])
    const drawn: number[][] = []
    const gfx = {
      save() {},
      restore() {},
      transform() {},
      setAlpha() {},
      drawImage(_i: unknown, x: number, y: number, w: number, h: number) {
        drawn.push([x, y, w, h])
      },
    } as unknown as Gfx2D
    paintAll(r, gfx as never)
    expect(drawn).toEqual([])
    r.setImage('img_0', {} as CanvasImageSource)
    expect(r.pendingImages()).toEqual([])
    paintAll(r, gfx as never)
    expect(drawn).toEqual([[0, 0, 16, 16]])
  })

  it('draws a layer whose parent is listed below it', () => {
    const prop = (k: unknown) => ({ a: 0, k })
    const anim = parseLottie({
      v: '5.7.0',
      fr: 30,
      ip: 0,
      op: 30,
      w: 100,
      h: 100,
      layers: [
        {
          ty: 4,
          ind: 1,
          nm: 'child',
          parent: 2,
          ip: 0,
          op: 30,
          ks: {},
          shapes: [
            { ty: 'rc', p: prop([0, 0]), s: prop([10, 10]), r: prop(0) },
            { ty: 'fl', c: prop([1, 0, 0, 1]), o: prop(100) },
          ],
        },
        {
          ty: 3,
          ind: 2,
          nm: 'parent',
          ip: 0,
          op: 30,
          ks: { p: prop([40, 40]) },
        },
      ],
    })
    const r = new LottieRenderer(anim)
    r.evaluate(0)
    let fills = 0
    const gfx = {
      save() {},
      restore() {},
      transform() {},
      setAlpha() {},
      fillRect() {},
      fillPath: () => fills++,
      fillRoundRect: () => fills++,
    } as unknown as Gfx2D
    paintAll(r, gfx as never)
    expect(fills).toBe(1)
  })
})
