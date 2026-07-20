/**
 * Contact resolution: a sequential-impulse velocity solver plus positional
 * correction. Both are pure functions over the manifold list and the bodies it
 * references, and allocate nothing.
 *
 * The velocity solver includes the angular terms (`ω × r` in the relative
 * velocity, `r × impulse` back into angular velocity), so they vanish
 * automatically when a body has zero inverse inertia (circles with fixed
 * rotation, static, or kinematic bodies).
 */

import type { Manifold } from './types'

/**
 * Below this closing speed, restitution is suppressed so resting stacks don't
 * jitter.
 */
const REST_VELOCITY_THRESHOLD = 0.5

/**
 * One pass of the sequential-impulse velocity solver over
 * `manifolds[0..count)`. Call it `velocityIterations` times.
 */
export function solveVelocity(manifolds: Manifold[], count: number): void {
  for (let i = 0; i < count; i++) {
    const m = manifolds[i]
    const a = m.a
    const b = m.b
    const nx = m.normal.x
    const ny = m.normal.y
    const invMassSum = a.invMass + b.invMass
    if (invMassSum === 0) continue
    const restitution = Math.max(
      m.colliderA.effectiveRestitution(),
      m.colliderB.effectiveRestitution(),
    )
    const friction = Math.sqrt(
      m.colliderA.effectiveFriction() * m.colliderB.effectiveFriction(),
    )
    for (let ci = 0; ci < m.contactCount; ci++) {
      const p = m.points[ci].point
      const rax = p.x - a.position.x
      const ray = p.y - a.position.y
      const rbx = p.x - b.position.x
      const rby = p.y - b.position.y

      // Relative velocity at the contact, including ω × r.
      const rvx =
        b.velocity.x -
        b.angularVelocity * rby -
        (a.velocity.x - a.angularVelocity * ray)
      const rvy =
        b.velocity.y +
        b.angularVelocity * rbx -
        (a.velocity.y + a.angularVelocity * rax)

      const vn = rvx * nx + rvy * ny
      if (vn > 0) continue // separating

      // Effective mass along the normal.
      const rnA = rax * ny - ray * nx
      const rnB = rbx * ny - rby * nx
      const kn =
        invMassSum + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB
      if (kn === 0) continue

      const e = vn < -REST_VELOCITY_THRESHOLD ? restitution : 0
      const jn = (-(1 + e) * vn) / kn
      if (jn <= 0) continue

      const jnx = jn * nx
      const jny = jn * ny
      a.velocity.x -= jnx * a.invMass
      a.velocity.y -= jny * a.invMass
      a.angularVelocity -= (rax * jny - ray * jnx) * a.invInertia
      b.velocity.x += jnx * b.invMass
      b.velocity.y += jny * b.invMass
      b.angularVelocity += (rbx * jny - rby * jnx) * b.invInertia

      if (friction <= 0) continue

      // Tangent friction. Recompute relative velocity after the normal impulse.
      const rvx2 =
        b.velocity.x -
        b.angularVelocity * rby -
        (a.velocity.x - a.angularVelocity * ray)
      const rvy2 =
        b.velocity.y +
        b.angularVelocity * rbx -
        (a.velocity.y + a.angularVelocity * rax)
      // Tangent = normal rotated 90°.
      const tx = -ny
      const ty = nx
      const vt = rvx2 * tx + rvy2 * ty
      const rtA = rax * ty - ray * tx
      const rtB = rbx * ty - rby * tx
      const kt =
        invMassSum + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB
      if (kt === 0) continue
      let jt = -vt / kt
      // Coulomb clamp: |jt| ≤ μ · jn.
      const maxJt = friction * jn
      if (jt > maxJt) jt = maxJt
      else if (jt < -maxJt) jt = -maxJt
      const jtx = jt * tx
      const jty = jt * ty
      a.velocity.x -= jtx * a.invMass
      a.velocity.y -= jty * a.invMass
      a.angularVelocity -= (rax * jty - ray * jtx) * a.invInertia
      b.velocity.x += jtx * b.invMass
      b.velocity.y += jty * b.invMass
      b.angularVelocity += (rbx * jty - rby * jtx) * b.invInertia
    }
  }
}

/**
 * One pass of positional correction over `manifolds[0..count)`. Pushes
 * overlapping bodies apart along the contact normal, mass-weighted, leaving
 * `slop` of penetration uncorrected and clamping the per-pass push to
 * `maxCorrection`. Returns the number of manifolds that moved a body.
 */
export function correctPositions(
  manifolds: Manifold[],
  count: number,
  slop: number,
  correctionFactor: number,
  maxCorrection: number,
): number {
  let moved = 0
  for (let i = 0; i < count; i++) {
    const m = manifolds[i]
    const a = m.a
    const b = m.b
    const invSum = a.invMass + b.invMass
    if (invSum === 0) continue
    const excess = m.penetration - slop
    if (excess <= 0) continue
    let corr = excess * correctionFactor
    if (corr > maxCorrection) corr = maxCorrection
    const nx = m.normal.x
    const ny = m.normal.y
    const sepA = (corr * a.invMass) / invSum
    const sepB = (corr * b.invMass) / invSum
    a.position.x -= nx * sepA
    a.position.y -= ny * sepA
    b.position.x += nx * sepB
    b.position.y += ny * sepB
    a._aabbDirty = true
    b._aabbDirty = true
    moved++
  }
  return moved
}
