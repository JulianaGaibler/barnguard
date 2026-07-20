import { describe, expect, it } from 'vitest'
import { projectWorldToCss, type CssMatrix } from './DomTransformSync'
import type { ScreenTransform } from '../camera/Camera'

const IDENTITY: CssMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

function screen(
  scale: number,
  offsetX: number,
  offsetY: number,
): ScreenTransform {
  return { scale, offsetX, offsetY }
}

describe('projectWorldToCss', () => {
  it('is identity for an identity world and neutral camera', () => {
    expect(projectWorldToCss(screen(1, 0, 0), IDENTITY)).toEqual(IDENTITY)
  })

  it('adds the camera offset (pan) to the translation', () => {
    const m = projectWorldToCss(screen(1, 100, 50), IDENTITY)
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 100, f: 50 })
  })

  it('scales the linear part and the translation by the camera scale (zoom)', () => {
    const world: CssMatrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }
    const m = projectWorldToCss(screen(2, 0, 0), world)
    expect(m).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 20, f: 40 })
  })

  it('composes camera scale + offset over a world translation', () => {
    const world: CssMatrix = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 }
    const m = projectWorldToCss(screen(2, 5, 7), world)
    // e = 2*10 + 5, f = 2*20 + 7
    expect(m).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 25, f: 47 })
  })

  it('carries a rotated + scaled node world through the camera scale', () => {
    // A 90° rotation (a=0,b=1,c=-1,d=0) at scale 3 on the node.
    const world: CssMatrix = { a: 0, b: 3, c: -3, d: 0, e: 0, f: 0 }
    const m = projectWorldToCss(screen(2, 0, 0), world)
    expect(m).toEqual({ a: 0, b: 6, c: -6, d: 0, e: 0, f: 0 })
  })

  it('carries a baked-in pivot offset (in world e/f) through unchanged linear part', () => {
    // originX/originY bake into world.e/f; the projection just scales+offsets them.
    const world: CssMatrix = { a: 1, b: 0, c: 0, d: 1, e: -5, f: -3 }
    const m = projectWorldToCss(screen(1, 0, 0), world)
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: -5, f: -3 })
  })

  it('writes into the provided out matrix and returns it', () => {
    const out: CssMatrix = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }
    const world: CssMatrix = { a: 1, b: 0, c: 0, d: 1, e: 4, f: 8 }
    const result = projectWorldToCss(screen(2, 1, 1), world, out)
    expect(result).toBe(out)
    expect(out).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 9, f: 17 })
  })
})
