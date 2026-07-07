import { describe, expect, it } from 'vitest'
import { MatrixPool, copyMatrix2D, multiplyMatrix2D } from './matrix'

function isIdentity(m: DOMMatrix): boolean {
  return (
    m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
  )
}

describe('MatrixPool', () => {
  it('acquire returns an identity 2D matrix', () => {
    const pool = new MatrixPool()
    const m = pool.acquire()
    expect(isIdentity(m)).toBe(true)
  })

  it('reuses freed matrices without growing allocation count', () => {
    const pool = new MatrixPool()
    const a = pool.acquire()
    const b = pool.acquire()
    const c = pool.acquire()
    expect(pool.allocated).toBe(3)
    // Dirty them.
    a.translateSelf(10, 20)
    b.rotateSelf(45)
    c.scaleSelf(2, 3)
    pool.release(a)
    pool.release(b)
    pool.release(c)
    const a2 = pool.acquire()
    const b2 = pool.acquire()
    const c2 = pool.acquire()
    // Still exactly 3 allocated: same instances came back from the pool.
    expect(pool.allocated).toBe(3)
    // And they've been reset to identity.
    expect(isIdentity(a2)).toBe(true)
    expect(isIdentity(b2)).toBe(true)
    expect(isIdentity(c2)).toBe(true)
  })
})

describe('multiplyMatrix2D', () => {
  it('identity × M = M', () => {
    const dst = new DOMMatrix()
    const id = new DOMMatrix()
    const m = new DOMMatrix()
    m.a = 2
    m.d = 3
    m.e = 10
    m.f = -5
    multiplyMatrix2D(dst, id, m)
    expect(dst.a).toBe(2)
    expect(dst.d).toBe(3)
    expect(dst.e).toBe(10)
    expect(dst.f).toBe(-5)
  })

  it('translate then scale (world = T × S) transforms a point correctly', () => {
    // Point (1, 0) under S(2,3) then T(10,5) → (2, 0) → (12, 5).
    const T = new DOMMatrix()
    T.translateSelf(10, 5)
    const S = new DOMMatrix()
    S.scaleSelf(2, 3)
    const composed = new DOMMatrix()
    multiplyMatrix2D(composed, T, S)
    // Apply to point (1, 0).
    const x = composed.a * 1 + composed.c * 0 + composed.e
    const y = composed.b * 1 + composed.d * 0 + composed.f
    expect(x).toBe(12)
    expect(y).toBe(5)
  })

  it('safe when dst aliases a or b', () => {
    const a = new DOMMatrix()
    a.translateSelf(2, 3)
    const b = new DOMMatrix()
    b.scaleSelf(4, 5)
    // dst === a
    multiplyMatrix2D(a, a, b)
    // a should now equal T(2,3) × S(4,5).
    // Applied to (1, 0): (1*4, 0*5) + (2, 3) = (6, 3).
    const x = a.a * 1 + a.c * 0 + a.e
    const y = a.b * 1 + a.d * 0 + a.f
    expect(x).toBe(6)
    expect(y).toBe(3)
  })
})

describe('copyMatrix2D', () => {
  it('copies all six affine components', () => {
    const src = new DOMMatrix()
    src.a = 7
    src.b = 8
    src.c = 9
    src.d = 10
    src.e = 11
    src.f = 12
    const dst = new DOMMatrix()
    copyMatrix2D(dst, src)
    expect(dst.a).toBe(7)
    expect(dst.b).toBe(8)
    expect(dst.c).toBe(9)
    expect(dst.d).toBe(10)
    expect(dst.e).toBe(11)
    expect(dst.f).toBe(12)
  })
})

/**
 * Regression safety net for the GPU backend. `GpuGfx` composes T × R × S × O on
 * the CPU via `multiplyMatrix2D`. If the multiply order or the direction of
 * post-vs-pre-multiply ever drifts from what `Transform2D` implicitly assumes
 * (which is defined by DOMMatrix's `translateSelf`/`rotateSelf`/`scaleSelf`
 * post-multiply chain), rotated/scaled nodes render subtly wrong at zoom. These
 * tests pin the equivalence numerically.
 */
describe('multiplyMatrix2D ↔ DOMMatrix post-multiply parity', () => {
  const EPS = 1e-10

  function expectEqualMatrices(a: DOMMatrix, b: DOMMatrix): void {
    expect(a.a).toBeCloseTo(b.a, 10)
    expect(a.b).toBeCloseTo(b.b, 10)
    expect(a.c).toBeCloseTo(b.c, 10)
    expect(a.d).toBeCloseTo(b.d, 10)
    expect(a.e).toBeCloseTo(b.e, 10)
    expect(a.f).toBeCloseTo(b.f, 10)
    // Also sanity-check the tolerance explicitly, toBeCloseTo(x, 10) is
    // ~5e-11 absolute for values near 1, but we want the assertion above to
    // cover the whole 6-tuple's worst-case drift.
    expect(Math.abs(a.a - b.a)).toBeLessThan(EPS)
    expect(Math.abs(a.f - b.f)).toBeLessThan(EPS)
  }

  it('T only', () => {
    const ours = new DOMMatrix()
    const T = new DOMMatrix()
    T.translateSelf(10, 5)
    // Multiplying identity × T yields T.
    multiplyMatrix2D(ours, new DOMMatrix(), T)
    const native = new DOMMatrix().translateSelf(10, 5)
    expectEqualMatrices(ours, native)
  })

  it('T × R at 45°', () => {
    // Post-multiply chain: identity → T → T·R (i.e. rotate happens in T's
    // local frame). This is the canonical Transform2D order.
    const T = new DOMMatrix().translateSelf(10, 5)
    const R = new DOMMatrix().rotateSelf(45)
    const ours = new DOMMatrix()
    multiplyMatrix2D(ours, T, R)
    const native = new DOMMatrix().translateSelf(10, 5).rotateSelf(45)
    expectEqualMatrices(ours, native)
  })

  it('T × R × S × O (full Transform2D chain, 90° with origin offset)', () => {
    // Origin offset O uses translateSelf(-ox, -oy) at the end of the chain
    //, same as SceneNode's origin handling.
    const chain = new DOMMatrix()
      .translateSelf(100, 200)
      .rotateSelf(90)
      .scaleSelf(2, 3)
      .translateSelf(-25, -40)

    // Same chain via our multiply, accumulate step by step.
    const acc = new DOMMatrix()
    const step = new DOMMatrix()
    const scratch = new DOMMatrix()

    // acc = I × T
    step.a = 1
    step.b = 0
    step.c = 0
    step.d = 1
    step.e = 100
    step.f = 200
    multiplyMatrix2D(scratch, acc, step)
    copyMatrix2D(acc, scratch)

    // acc = acc × R(90°)
    const r90 = (90 * Math.PI) / 180
    const cos90 = Math.cos(r90)
    const sin90 = Math.sin(r90)
    step.a = cos90
    step.b = sin90
    step.c = -sin90
    step.d = cos90
    step.e = 0
    step.f = 0
    multiplyMatrix2D(scratch, acc, step)
    copyMatrix2D(acc, scratch)

    // acc = acc × S(2,3)
    step.a = 2
    step.b = 0
    step.c = 0
    step.d = 3
    step.e = 0
    step.f = 0
    multiplyMatrix2D(scratch, acc, step)
    copyMatrix2D(acc, scratch)

    // acc = acc × O(-25,-40)
    step.a = 1
    step.b = 0
    step.c = 0
    step.d = 1
    step.e = -25
    step.f = -40
    multiplyMatrix2D(scratch, acc, step)
    copyMatrix2D(acc, scratch)

    expectEqualMatrices(acc, chain)
  })

  it('negative rotation, non-uniform scale', () => {
    const T = new DOMMatrix().translateSelf(-15, 40)
    const R = new DOMMatrix().rotateSelf(-30)
    const S = new DOMMatrix().scaleSelf(0.5, 2.5)
    const TR = new DOMMatrix()
    multiplyMatrix2D(TR, T, R)
    const TRS = new DOMMatrix()
    multiplyMatrix2D(TRS, TR, S)
    const native = new DOMMatrix()
      .translateSelf(-15, 40)
      .rotateSelf(-30)
      .scaleSelf(0.5, 2.5)
    expectEqualMatrices(TRS, native)
  })

  it('tiny values (subpixel translate + fractional rotate)', () => {
    const T = new DOMMatrix().translateSelf(1e-3, 2e-3)
    const R = new DOMMatrix().rotateSelf(0.001)
    const S = new DOMMatrix().scaleSelf(1.0001, 0.9999)
    const acc = new DOMMatrix()
    multiplyMatrix2D(acc, T, R)
    const tmp = new DOMMatrix()
    multiplyMatrix2D(tmp, acc, S)
    const native = new DOMMatrix()
      .translateSelf(1e-3, 2e-3)
      .rotateSelf(0.001)
      .scaleSelf(1.0001, 0.9999)
    expectEqualMatrices(tmp, native)
  })
})
