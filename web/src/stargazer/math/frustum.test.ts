import { describe, expect, it } from 'vitest'
import { boxOutsideFrustum, createFrustum, frustumFromMatrix } from './frustum'
import {
  mat4,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  type ClipDepth,
} from './Mat4'
import { vec3 } from './Vec3'

function viewProj(clipDepth: ClipDepth) {
  const proj = mat4Perspective(mat4(), Math.PI / 3, 1, 1, 100, clipDepth)
  const view = mat4LookAt(mat4(), vec3(0, 0, 10), vec3(0, 0, 0), vec3(0, 1, 0))
  return mat4Multiply(mat4(), proj, view)
}

describe('frustum', () => {
  for (const clip of ['neg-one-to-one', 'zero-to-one'] as const) {
    it(`keeps what the camera sees and drops what it does not (${clip})`, () => {
      const f = frustumFromMatrix(createFrustum(), viewProj(clip), clip)
      // At the look-at point.
      expect(boxOutsideFrustum(f, -1, -1, -1, 1, 1, 1)).toBe(false)
      // Far to the side.
      expect(boxOutsideFrustum(f, 50, -1, -1, 52, 1, 1)).toBe(true)
      // Behind the camera.
      expect(boxOutsideFrustum(f, -1, -1, 20, 1, 1, 22)).toBe(true)
      // Past the far plane.
      expect(boxOutsideFrustum(f, -1, -1, -200, 1, 1, -150)).toBe(true)
      // Crossing the near plane counts as inside.
      expect(boxOutsideFrustum(f, -1, -1, 8, 1, 1, 12)).toBe(false)
      // Just closer than the near plane is outside.
      expect(boxOutsideFrustum(f, -0.1, -0.1, 9.5, 0.1, 0.1, 9.8)).toBe(true)
    })
  }

  it('can leave the near plane out of the test', () => {
    const f = frustumFromMatrix(
      createFrustum(),
      viewProj('zero-to-one'),
      'zero-to-one',
    )
    const box = [-0.1, -0.1, 9.5, 0.1, 0.1, 9.8] as const
    expect(boxOutsideFrustum(f, ...box, 0, 4)).toBe(false)
  })
})
