/**
 * A 2D affine as six numbers in row order `a c e / b d f`: `x' = a·x + c·y +
 * e`, `y' = b·x + d·y + f`. Node world matrices, camera affines and the
 * `matrix` helpers all take this shape, so any object with these six fields can
 * be read or written through it.
 */
export interface Affine2x3 {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * A mutable {@link Affine2x3}, the identity until set. `Transform2D.local` and
 * `Transform2D.world` are instances.
 */
export class Affine2D implements Affine2x3 {
  a = 1
  b = 0
  c = 0
  d = 1
  e = 0
  f = 0

  /** Set all six components. Returns `this`. */
  set(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.a = a
    this.b = b
    this.c = c
    this.d = d
    this.e = e
    this.f = f
    return this
  }

  /** Reset to the identity. Returns `this`. */
  identity(): this {
    return this.set(1, 0, 0, 1, 0, 0)
  }

  /** Copy the six components of `m`. Returns `this`. */
  copyFrom(m: Affine2x3): this {
    return this.set(m.a, m.b, m.c, m.d, m.e, m.f)
  }
}
