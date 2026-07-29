import { describe, expect, it } from 'vitest'
import { Camera3D } from './Camera3D'

/** `A · B` for two column-major 4×4 matrices. */
function mul(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = s
    }
  return out
}

describe('Camera3D.invProjection', () => {
  it('inverts the projection across the ortho↔perspective blend', () => {
    for (const projectionness of [0, 0.5, 1] as const) {
      const cam = new Camera3D()
      cam.setAspect(16 / 9)
      cam.projectionness = projectionness
      const id = mul(cam.invProjection, cam.projection)
      for (let i = 0; i < 16; i++) {
        const expected = i % 5 === 0 ? 1 : 0
        expect(id[i]).toBeCloseTo(expected, 4)
      }
    }
  })

  it('recomputes after a projection parameter changes', () => {
    const cam = new Camera3D()
    const before = Array.from(cam.invProjection)
    cam.fovY = cam.fovY + 20
    const after = Array.from(cam.invProjection)
    expect(after).not.toEqual(before)
  })
})
