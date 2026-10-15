import { describe, expect, it } from 'vitest'
import type { Gfx2D } from '../../render/gfx/Gfx2D'
import type { GfxPath } from '../../render/gfx/GfxPath'
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
    w: 100,
    h: 100,
    layers: [{ ty: 4, ind: 1, nm: 'l', ip: 0, op: 30, ks: {}, shapes: items }],
  })
}

/**
 * What the renderer asked the facade to draw: paths as point counts and rules,
 * and shapes drawn as analytic instances by their call.
 */
function fills(
  a: ReturnType<typeof anim>,
): { points?: number; rule?: string; analytic?: string }[] {
  const r = new LottieRenderer(a)
  r.evaluate(0)
  const out: { points?: number; rule?: string; analytic?: string }[] = []
  const gfx = {
    save() {},
    restore() {},
    transform() {},
    setAlpha() {},
    fillRect() {},
    strokePath(p: GfxPath) {
      out.push({ points: p.flatten(1).pointCount })
    },
    fillPath(p: GfxPath, _f: unknown, rule: string) {
      out.push({ points: p.flatten(1).pointCount, rule })
    },
    strokeRoundRect: () => out.push({ analytic: 'strokeRoundRect' }),
    fillRoundRect: () => out.push({ analytic: 'fillRoundRect' }),
  } as unknown as Gfx2D
  paintAll(r, gfx as never)
  return out
}

const ring = {
  ty: 'gr',
  it: [
    { ty: 'rc', p: prop([50, 50]), s: prop([40, 40]), r: prop(0) },
    { ty: 'st', c: prop([1, 1, 1, 1]), o: prop(100), w: prop(2) },
  ],
}

describe('modifiers across groups', () => {
  it('applies a trim listed after a group to the strokes inside the group', () => {
    const plain = fills(anim([ring]))
    const trimmed = fills(
      anim([ring, { ty: 'tm', s: prop(0), e: prop(25), o: prop(0), m: 1 }]),
    )
    // The whole ring is one rect with nothing changing it, so it draws as an
    // analytic instance. The trim reaches it from outside its group and turns
    // it back into a path: a quarter of the rectangle, open.
    expect(plain).toEqual([{ analytic: 'strokeRoundRect' }])
    expect(trimmed).toHaveLength(1)
    expect(trimmed[0].points).toBeGreaterThan(0)
  })

  it('merge paths force the fill rule', () => {
    const shapes = (mm: number) => [
      { ty: 'rc', p: prop([40, 50]), s: prop([40, 40]), r: prop(0) },
      { ty: 'rc', p: prop([60, 50]), s: prop([40, 40]), r: prop(0) },
      { ty: 'mm', mm },
      { ty: 'fl', c: prop([1, 0, 0, 1]), o: prop(100), r: 1 },
    ]
    expect(fills(anim(shapes(5)))[0].rule).toBe('evenodd')
    expect(fills(anim(shapes(2)))[0].rule).toBe('nonzero')
  })
})
