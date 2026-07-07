/**
 * DOMMatrix pool + 2D affine helpers.
 *
 * Every matrix in this engine is a 2D affine (m11..m22 + m41/m42, i.e.
 * a/b/c/d/e/f). We never touch the 3D fields, so pooled matrices stay in their
 * 2D subspace and native DOMMatrix ops (`translateSelf`, `rotateSelf`,
 * `multiplySelf`) preserve that.
 */

export class MatrixPool {
  private readonly free: DOMMatrix[] = []
  private _allocated = 0

  acquire(): DOMMatrix {
    const m = this.free.pop()
    if (m) {
      m.a = 1
      m.b = 0
      m.c = 0
      m.d = 1
      m.e = 0
      m.f = 0
      return m
    }
    this._allocated++
    return new DOMMatrix()
  }

  release(m: DOMMatrix): void {
    this.free.push(m)
  }

  get allocated(): number {
    return this._allocated
  }
  get freeCount(): number {
    return this.free.length
  }
}

/** Copy the six 2D affine components from `src` to `dst` in place. */
export function copyMatrix2D(dst: DOMMatrix, src: DOMMatrix): void {
  dst.a = src.a
  dst.b = src.b
  dst.c = src.c
  dst.d = src.d
  dst.e = src.e
  dst.f = src.f
}

/**
 * Multiply two 2D affine matrices without allocation: `dst = a × b`. Safe when
 * `dst` aliases `a` or `b` (uses locals).
 */
export function multiplyMatrix2D(
  dst: DOMMatrix,
  a: DOMMatrix,
  b: DOMMatrix,
): void {
  const aa = a.a
  const ab = a.b
  const ac = a.c
  const ad = a.d
  const ae = a.e
  const af = a.f
  const ba = b.a
  const bb = b.b
  const bc = b.c
  const bd = b.d
  const be = b.e
  const bf = b.f
  dst.a = aa * ba + ac * bb
  dst.b = ab * ba + ad * bb
  dst.c = aa * bc + ac * bd
  dst.d = ab * bc + ad * bd
  dst.e = aa * be + ac * bf + ae
  dst.f = ab * be + ad * bf + af
}
