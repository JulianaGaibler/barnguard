import { describe, expect, it } from 'vitest'
import type { Node } from '../../scene/Node'
import { Node2D } from '../../scene/Node2D'
import { Transform2D } from '../../math/Transform2D'
import { parseLottie } from '../model/parse'
import { LottieRenderer } from './LottieRenderer'
import { LottieScene, setTransformFromAffine } from './LottieScene'
import type { Affine } from './affine'

const prop = (k: unknown) => ({ a: 0, k })

function all(node: Node, out: Node2D[] = []): Node2D[] {
  if (node.kind === '2d') out.push(node as Node2D)
  for (const c of node.children) all(c, out)
  return out
}

describe('LottieScene', () => {
  it('places mask paths under the layer transform', () => {
    const square = (x: number) => ({
      c: true,
      v: [
        [x, 0],
        [x + 10, 0],
        [x + 10, 10],
        [x, 10],
      ],
      i: Array(4).fill([0, 0]),
      o: Array(4).fill([0, 0]),
    })
    const anim = parseLottie({
      v: '5.7.0',
      fr: 30,
      ip: 0,
      op: 30,
      w: 200,
      h: 200,
      layers: [
        {
          ty: 1,
          ind: 1,
          nm: 's',
          ip: 0,
          op: 30,
          sc: '#fff',
          sw: 200,
          sh: 200,
          ks: { p: prop([50, 60]), a: prop([0, 0]) },
          masksProperties: [
            { mode: 'a', pt: prop(square(0)), o: prop(100) },
            { mode: 's', pt: prop(square(5)), o: prop(100) },
          ],
        },
      ],
    })
    const r = new LottieRenderer(anim)
    const scene = new LottieScene(r, 200, 200)
    r.evaluate(0)
    scene.apply(0)
    const parts = all(scene.root).filter((n) => /\/mask-\d$/.test(n.id))
    // Both mask covers sit under the layer's translation.
    expect(parts).toHaveLength(2)
    for (const n of parts) {
      n.ensureWorldTransform()
      expect([n.transform.world.e, n.transform.world.f]).toEqual([50, 60])
    }
  })

  it('leaves the content of a layer that only moves unpainted', () => {
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
          nm: 'l',
          ip: 0,
          op: 30,
          ks: {
            p: {
              a: 1,
              k: [
                {
                  t: 0,
                  s: [10, 10],
                  i: { x: [1], y: [1] },
                  o: { x: [0], y: [0] },
                },
                { t: 29, s: [90, 10] },
              ],
            },
          },
          shapes: [
            { ty: 'el', p: prop([0, 0]), s: prop([20, 20]) },
            { ty: 'fl', c: prop([1, 0, 0, 1]), o: prop(100) },
          ],
        },
      ],
    })
    const r = new LottieRenderer(anim)
    expect(r.comp.layers[0].contentStatic).toBe(true)
    const scene = new LottieScene(r, 100, 100)
    r.evaluate(0)
    scene.apply(0)
    const layer = all(scene.root).find((n) => n.id.includes('/l'))!
    layer._paintDirty = false
    r.evaluate(15)
    scene.apply(15)
    expect(layer._paintDirty).toBe(false)
    expect(layer.transform.x).toBeGreaterThan(10)
  })

  it('repaints a layer whose shape animates', () => {
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
          nm: 'l',
          ip: 0,
          op: 30,
          ks: {},
          shapes: [
            {
              ty: 'el',
              p: prop([50, 50]),
              s: {
                a: 1,
                k: [
                  {
                    t: 0,
                    s: [10, 10],
                    i: { x: [1], y: [1] },
                    o: { x: [0], y: [0] },
                  },
                  { t: 29, s: [80, 80] },
                ],
              },
            },
            { ty: 'fl', c: prop([1, 0, 0, 1]), o: prop(100) },
          ],
        },
      ],
    })
    const r = new LottieRenderer(anim)
    expect(r.comp.layers[0].contentStatic).toBe(false)
    const scene = new LottieScene(r, 100, 100)
    r.evaluate(0)
    scene.apply(0)
    const layer = all(scene.root).find((n) => n.id.includes('/l'))!
    layer._paintDirty = false
    r.evaluate(15)
    scene.apply(15)
    expect(layer._paintDirty).toBe(true)
  })

  it('treats an animated opacity as content', () => {
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
          nm: 'l',
          ip: 0,
          op: 30,
          ks: {
            o: {
              a: 1,
              k: [
                {
                  t: 0,
                  s: [100],
                  i: { x: [1], y: [1] },
                  o: { x: [0], y: [0] },
                },
                { t: 29, s: [0] },
              ],
            },
          },
          shapes: [
            { ty: 'el', p: prop([50, 50]), s: prop([20, 20]) },
            { ty: 'fl', c: prop([1, 0, 0, 1]), o: prop(100) },
          ],
        },
      ],
    })
    expect(new LottieRenderer(anim).comp.layers[0].contentStatic).toBe(false)
  })
})

describe('setTransformFromAffine', () => {
  const compose = (t: Transform2D): number[] => {
    t.updateLocal()
    const l = t.local
    return [l.a, l.b, l.c, l.d, l.e, l.f]
  }
  const cases: Array<[string, number[]]> = [
    ['translation', [1, 0, 0, 1, 12, -7]],
    ['rotation and scale', [0, 2, -3, 0, 5, 6]],
    ['a skewed matrix', [2, 0.5, 1.5, 3, 4, 9]],
    ['a mirror', [-1, 0, 0, 1, 20, 0]],
    ['a flip of the second axis', [1, 0, 0, -2, 0, 3]],
  ]
  for (const [name, m] of cases) {
    it(`reproduces ${name}`, () => {
      const t = new Transform2D()
      setTransformFromAffine(t, Float64Array.from(m) as Affine)
      const back = compose(t)
      for (let i = 0; i < 6; i++) expect(back[i]).toBeCloseTo(m[i], 9)
    })
  }

  it('keeps a collapsed axis from producing NaN', () => {
    const t = new Transform2D()
    setTransformFromAffine(t, Float64Array.from([0, 0, 1, 2, 3, 4]) as Affine)
    const back = compose(t)
    expect(back.every((v) => Number.isFinite(v))).toBe(true)
  })
})
