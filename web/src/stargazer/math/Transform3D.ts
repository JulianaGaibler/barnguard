import { mat4, mat4Compose, type Mat4 } from './Mat4'
import type { Vec3 } from './Vec3'
import type { Quat } from './Quat'

/**
 * A `Node3D`'s local transform: a position, a rotation quaternion, and a
 * per-axis scale in the right-handed y-up world. It is the 3D counterpart of
 * {@link Transform2D} and follows the same lazy-rebuild contract: mutate the
 * fields (`transform.position.x = 1`, `transform.setRotation(...)`) and each
 * mutation marks the node dirty so the scene walk rebuilds `local` and
 * propagates `world` to descendants.
 *
 * `position`, `rotation`, and `scale` are plain mutable objects. Mutating them
 * in place is allowed, but the transform can't observe that, so call
 * {@link Transform3D.markDirty} (or go through {@link Transform3D.setPosition}
 * /{@link Transform3D.setRotation}/{@link Transform3D.setScale}) after an
 * in-place edit. `local` is the composed matrix rebuilt lazily from the fields;
 * `world` is `local` pre-multiplied by the parent chain, filled by the scene
 * walk. Treat both matrices as read-only.
 *
 * Composition order (applied to a point right-to-left): scale → rotate →
 * translate. Matches {@link mat4Compose} and glTF's TRS convention.
 *
 * @category Math
 * @example
 *   const t = new Transform3D()
 *   t.setPosition(0, 1, -5)
 *   t.setScale(2, 2, 2)
 *   // Face 90° about the y axis.
 *   const q = quatFromAxisAngle(quat(), 0, 1, 0, Math.PI / 2)
 *   t.setRotation(q.x, q.y, q.z, q.w)
 */
export class Transform3D {
  /** Composed local matrix, rebuilt lazily from the fields. Treat as read-only. */
  readonly local: Mat4 = mat4()
  /** World matrix (`local` × parent chain), filled by the scene walk. Read-only. */
  readonly world: Mat4 = mat4()

  /** Internal, the owning `Node3D` hooks this to mark itself dirty. */
  onDirty: (() => void) | null = null

  /** Position in the parent's local space. Mutating in place needs `markDirty`. */
  readonly position: Vec3 = { x: 0, y: 0, z: 0 }
  /** Rotation quaternion. Mutating in place needs `markDirty`. */
  readonly rotation: Quat = { x: 0, y: 0, z: 0, w: 1 }
  /** Per-axis scale (1 = unscaled). Mutating in place needs `markDirty`. */
  readonly scale: Vec3 = { x: 1, y: 1, z: 1 }

  /** Opacity in `[0, 1]`. Multiplied down into descendants by the render walk. */
  alpha = 1

  #_dirty = true

  /** Set the position and mark dirty. */
  setPosition(x: number, y: number, z: number): void {
    this.position.x = x
    this.position.y = y
    this.position.z = z
    this.markDirty()
  }

  /** Set the rotation quaternion and mark dirty. */
  setRotation(x: number, y: number, z: number, w: number): void {
    this.rotation.x = x
    this.rotation.y = y
    this.rotation.z = z
    this.rotation.w = w
    this.markDirty()
  }

  /** Set the per-axis scale and mark dirty. */
  setScale(x: number, y: number, z: number): void {
    this.scale.x = x
    this.scale.y = y
    this.scale.z = z
    this.markDirty()
  }

  get dirty(): boolean {
    return this.#_dirty
  }

  markDirty(): void {
    if (!this.#_dirty) {
      this.#_dirty = true
      this.onDirty?.()
    }
  }

  /** Rebuild `local` from the decomposed fields. Cheap no-op when clean. */
  updateLocal(): void {
    if (!this.#_dirty) return
    mat4Compose(this.local, this.position, this.rotation, this.scale)
    this.#_dirty = false
  }
}
