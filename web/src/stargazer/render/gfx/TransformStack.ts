// The GPU backend's transform stack. Kept separate from `GpuGfx` so the batch
// programs and the facade share one definition.

/** The 6-tuple read out of the stack top. */
export interface TransformOut {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * A compact 6-tuple transform (a,b,c,d,e,f). Matches Canvas's `setTransform`
 * semantics: `x_screen = a*x + c*y + e`, `y_screen = b*x + d*y + f`. Stored as
 * a flat array with 6-element strides so save/restore is a pointer bump rather
 * than an allocation.
 */
export class TransformStack {
  readonly #buf: Float64Array
  #top = 0 // index of top-of-stack slot

  constructor(capacity: number) {
    this.#buf = new Float64Array(capacity * 6)
    // Identity at the base.
    this.#buf[0] = 1
    this.#buf[3] = 1
  }

  setBase(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.#top = 0
    const o = 0
    this.#buf[o] = a
    this.#buf[o + 1] = b
    this.#buf[o + 2] = c
    this.#buf[o + 3] = d
    this.#buf[o + 4] = e
    this.#buf[o + 5] = f
  }

  push(): void {
    const from = this.#top * 6
    const to = (this.#top + 1) * 6
    if (to + 6 > this.#buf.length) {
      console.warn(
        'GpuGfx: transform stack overflow, depth cap reached; ignoring push',
      )
      return
    }
    this.#buf[to] = this.#buf[from]
    this.#buf[to + 1] = this.#buf[from + 1]
    this.#buf[to + 2] = this.#buf[from + 2]
    this.#buf[to + 3] = this.#buf[from + 3]
    this.#buf[to + 4] = this.#buf[from + 4]
    this.#buf[to + 5] = this.#buf[from + 5]
    this.#top++
  }

  pop(): void {
    if (this.#top > 0) this.#top--
  }

  /**
   * Post-multiply: current = current × M (where M is a
   * translation/rotate/scale).
   */
  postMultiply(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    const o = this.#top * 6
    const ca = this.#buf[o]
    const cb = this.#buf[o + 1]
    const cc = this.#buf[o + 2]
    const cd = this.#buf[o + 3]
    const ce = this.#buf[o + 4]
    const cf = this.#buf[o + 5]
    this.#buf[o] = ca * a + cc * b
    this.#buf[o + 1] = cb * a + cd * b
    this.#buf[o + 2] = ca * c + cc * d
    this.#buf[o + 3] = cb * c + cd * d
    this.#buf[o + 4] = ca * e + cc * f + ce
    this.#buf[o + 5] = cb * e + cd * f + cf
  }

  translate(x: number, y: number): void {
    // Post-multiply by [[1,0,x],[0,1,y]]. Appends translation in the current frame.
    const o = this.#top * 6
    this.#buf[o + 4] += this.#buf[o] * x + this.#buf[o + 2] * y
    this.#buf[o + 5] += this.#buf[o + 1] * x + this.#buf[o + 3] * y
  }

  rotate(rad: number): void {
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    // Post-multiply by rotation.
    this.postMultiply(cos, sin, -sin, cos, 0, 0)
  }

  scale(sx: number, sy: number): void {
    // Post-multiply by scale. Scales the current basis vectors.
    const o = this.#top * 6
    this.#buf[o] *= sx
    this.#buf[o + 1] *= sx
    this.#buf[o + 2] *= sy
    this.#buf[o + 3] *= sy
  }

  /** Read the 6-tuple at the current top into scratch outputs. */
  read(out: TransformOut): void {
    const o = this.#top * 6
    out.a = this.#buf[o]
    out.b = this.#buf[o + 1]
    out.c = this.#buf[o + 2]
    out.d = this.#buf[o + 3]
    out.e = this.#buf[o + 4]
    out.f = this.#buf[o + 5]
  }
}
