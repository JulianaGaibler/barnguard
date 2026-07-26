import { describe, expect, it } from 'vitest'
import { mat3, mat3NormalMatrix, type Mat3 } from './Mat3'
import { mat4, mat4Compose, mat4Identity, type Mat4 } from './Mat4'
import { quat, quatFromAxisAngle } from './Quat'
import { vec3 } from './Vec3'

function expectMat3Close(a: Mat3, b: readonly number[]): void {
  for (let i = 0; i < 9; i++) expect(a[i]).toBeCloseTo(b[i], 4)
}

describe('mat3', () => {
  it('creates an identity matrix', () => {
    expectMat3Close(mat3(), [1, 0, 0, 0, 1, 0, 0, 0, 1])
  })
})

describe('mat3NormalMatrix', () => {
  it('is identity for an identity model', () => {
    expectMat3Close(
      mat3NormalMatrix(mat3(), mat4Identity(mat4())),
      [1, 0, 0, 0, 1, 0, 0, 0, 1],
    )
  })

  it('inverts each axis under non-uniform scale', () => {
    // Plain mat3(model) would give diag(1,2,4) and skew normals; the normal
    // matrix must be diag(1, 1/2, 1/4).
    const model = mat4Compose(mat4(), vec3(5, -3, 2), quat(), vec3(1, 2, 4))
    expectMat3Close(
      mat3NormalMatrix(mat3(), model),
      [1, 0, 0, 0, 0.5, 0, 0, 0, 0.25],
    )
  })

  it('equals the rotation for a pure rotation (orthonormal ⇒ inverse-transpose is itself)', () => {
    const q = quatFromAxisAngle(quat(), 0, 1, 0, Math.PI / 3)
    const model = mat4Compose(mat4(), vec3(0, 0, 0), q, vec3(1, 1, 1))
    const n = mat3NormalMatrix(mat3(), model)
    // Upper 3×3 of the model, column-major, should match the normal matrix.
    expectMat3Close(n, [
      model[0],
      model[1],
      model[2],
      model[4],
      model[5],
      model[6],
      model[8],
      model[9],
      model[10],
    ])
  })

  it('preserves normal direction under uniform scale (up to a uniform factor)', () => {
    const model = mat4Compose(mat4(), vec3(0, 0, 0), quat(), vec3(3, 3, 3))
    const n = mat3NormalMatrix(mat3(), model)
    // Uniform scale s ⇒ normal matrix is (1/s)·I; direction preserved.
    expectMat3Close(n, [1 / 3, 0, 0, 0, 1 / 3, 0, 0, 0, 1 / 3])
  })

  it('falls back to the plain upper 3×3 when the linear part is singular', () => {
    // Zero Z scale ⇒ determinant 0; no inverse exists.
    const model: Mat4 = mat4Compose(
      mat4(),
      vec3(0, 0, 0),
      quat(),
      vec3(2, 2, 0),
    )
    expectMat3Close(
      mat3NormalMatrix(mat3(), model),
      [2, 0, 0, 0, 2, 0, 0, 0, 0],
    )
  })
})
