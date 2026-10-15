import { describe, expect, it } from 'vitest'
import type { Gfx2D } from '../../render/gfx/Gfx2D'
import { parseLottie } from '../model/parse'
import { LottieRenderer } from './LottieRenderer'
import { paintAll } from './paintAll.testutil'

const prop = (k: unknown) => ({ a: 0, k })

function anim(items: unknown[]) {
  return parseLottie({
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 30,
    w: 200,
    h: 200,
    layers: [{ ty: 4, ind: 1, nm: 'l', ip: 0, op: 30, ks: {}, shapes: items }],
  })
}

/** The facade calls a frame of `items` makes, with their arguments. */
function calls(items: unknown[]): { name: string; args: unknown[] }[] {
  const r = new LottieRenderer(anim(items))
  r.evaluate(0)
  const out: { name: string; args: unknown[] }[] = []
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      out.push({ name, args })
  const gfx = {
    save() {},
    restore() {},
    transform() {},
    setAlpha() {},
    fillRect: record('fillRect'),
    fillPath: record('fillPath'),
    strokePath: record('strokePath'),
    fillRoundRect: record('fillRoundRect'),
    strokeRoundRect: record('strokeRoundRect'),
    fillEllipse: record('fillEllipse'),
    strokeEllipse: record('strokeEllipse'),
  } as unknown as Gfx2D
  paintAll(r, gfx as never)
  return out
}

const fill = { ty: 'fl', c: prop([1, 0, 0, 1]), o: prop(100) }
const evenOddFill = { ...fill, r: 2 }
const rect = (x: number, roundness = 0) => ({
  ty: 'rc',
  p: prop([x, 100]),
  s: prop([60, 40]),
  r: prop(roundness),
})
const ellipse = { ty: 'el', p: prop([100, 100]), s: prop([80, 40]) }

describe('LottieRenderer analytic shapes', () => {
  it('draws a lone rect as one rounded rect, with its roundness as the radius', () => {
    expect(calls([rect(100, 8), fill])).toEqual([
      { name: 'fillRoundRect', args: [70, 80, 60, 40, 8, 'rgb(255, 0, 0)'] },
    ])
  })

  it('draws a lone ellipse as one ellipse', () => {
    expect(calls([ellipse, fill])).toEqual([
      { name: 'fillEllipse', args: [100, 100, 40, 20, 'rgb(255, 0, 0)'] },
    ])
  })

  it('caps a roundness past half the shorter side, as the path does', () => {
    const [call] = calls([rect(100, 50), fill])
    expect(call.args[4]).toBe(20)
  })

  for (const [name, style] of [
    ['nonzero', fill],
    ['evenodd', evenOddFill],
  ] as const) {
    it(`keeps two overlapping shapes under one ${name} fill on the path route`, () => {
      // One fill over both shapes is one path under one winding rule. Drawn
      // apart, even-odd would lose the hole where they overlap.
      const drawn = calls([rect(90), rect(110), style])
      expect(drawn.map((c) => c.name)).toEqual(['fillPath'])
    })
  }

  it('keeps a trimmed rect on the path route', () => {
    const trim = { ty: 'tm', s: prop(0), e: prop(50), o: prop(0), m: 1 }
    const stroke = { ty: 'st', c: prop([1, 1, 1, 1]), o: prop(100), w: prop(2) }
    expect(calls([rect(100, 8), trim, stroke]).map((c) => c.name)).toEqual([
      'strokePath',
    ])
  })

  it('keeps a radial gradient on the path route', () => {
    const radial = {
      ty: 'gf',
      o: prop(100),
      t: 2,
      s: prop([100, 100]),
      e: prop([140, 100]),
      g: { p: 2, k: prop([0, 1, 0, 0, 1, 0, 0, 1]) },
    }
    expect(calls([ellipse, radial]).map((c) => c.name)).toEqual(['fillPath'])
  })

  it('keeps a dashed stroke on the path route', () => {
    const dashed = {
      ty: 'st',
      c: prop([1, 1, 1, 1]),
      o: prop(100),
      w: prop(2),
      d: [
        { n: 'd', v: prop(4) },
        { n: 'g', v: prop(4) },
      ],
    }
    expect(calls([ellipse, dashed]).map((c) => c.name)).toEqual(['strokePath'])
  })

  it('keeps a sharp rect stroked with a miter join on the path route', () => {
    // A band around a sharp corner comes out round, which only a round join
    // matches.
    const mitered = {
      ty: 'st',
      c: prop([1, 1, 1, 1]),
      o: prop(100),
      w: prop(4),
      lj: 1,
    }
    expect(calls([rect(100), mitered]).map((c) => c.name)).toEqual([
      'strokePath',
    ])
    expect(calls([rect(100, 8), mitered]).map((c) => c.name)).toEqual([
      'strokeRoundRect',
    ])
  })
})
