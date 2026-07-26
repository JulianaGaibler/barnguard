import { Transform3D } from '../math/Transform3D'
import {
  mat4Multiply,
  mat4Copy,
  type Mat4,
} from '../math/Mat4'
import { vec3Lerp, type Vec3 } from '../math/Vec3'
import { quatSlerp, type Quat } from '../math/Quat'
import { lerp } from '../math/scalar'
import { Node, type NodeKind } from './Node'
import type { TweenOptions } from '../anim/Animator'
import { combineAbortSignals, ignoreAbort } from '../anim/abortSignal'

/**
 * Targets for {@link Node3D.tween}. Position and scale interpolate linearly;
 * rotation interpolates by quaternion slerp; alpha interpolates linearly. Omit a
 * field to leave it fixed.
 *
 * @category Scene
 */
export interface Node3DTweenTo {
  position?: Readonly<Vec3>
  rotation?: Readonly<Quat>
  scale?: Readonly<Vec3>
  alpha?: number
}

/**
 * A node in the 3D scene tree: a {@link Transform3D} (position, rotation
 * quaternion, scale), a parent, children, and optional {@link Behavior}s. It is
 * the 3D counterpart of {@link Node2D} and shares all non-spatial machinery
 * (behaviors, lifecycle, abort, wait/loop) through {@link Node}. Place a node by
 * mutating its `transform`; nest nodes with {@link Node.add} so children inherit
 * the parent's world transform.
 *
 * 3D nodes live under a {@link World3D} root, separate from the 2D
 * {@link Scene}. A drawable 3D node (e.g. a mesh) subclasses this and the 3D
 * render pass draws it; a plain `Node3D` is a transform-only group.
 *
 * @category Scene
 * @example
 *   const pivot = new Node3D()
 *   world3d.add(pivot)
 *   pivot.transform.setPosition(0, 1, -5)
 *   await pivot.tween(
 *     { rotation: quatFromAxisAngle(quat(), 0, 1, 0, Math.PI) },
 *     { duration: 1 },
 *   )
 */
export class Node3D extends Node {
  readonly kind: NodeKind = '3d'

  /** Local transform (position, rotation, scale, alpha). Mutate to move the node. */
  readonly transform = new Transform3D()

  /**
   * Snapshot of `transform` at the start of each fixed step when render
   * interpolation is on. `null` when off (default).
   */
  prevTransform: Transform3D | null = null

  constructor(id?: string) {
    super(id)
    this.transform.onDirty = () => this.markWorldDirty()
  }

  /**
   * Nearest ancestor that is also a `Node3D`, skipping any 2D or group nodes in
   * between; `null` if none. World composition uses this, so a `Node3D` nested
   * under a 2D or group parent behaves as a top-level 3D node (its world equals
   * its local).
   */
  get spatialParent(): Node3D | null {
    let p = this.parent
    while (p && p.kind !== '3d') p = p.parent
    return p as Node3D | null
  }

  /**
   * Force `transform.world` up-to-date now without waiting for the 3D transform
   * pass, e.g. to read a descendant's world position mid-frame after mutating an
   * ancestor. O(depth) worst case, O(1) when the ancestor chain is clean.
   */
  ensureWorldTransform(): void {
    if (!this.worldDirty) return
    const chain: Node3D[] = [this]
    let cur: Node3D | null = this.spatialParent
    while (cur && cur.worldDirty) {
      chain.push(cur)
      cur = cur.spatialParent
    }
    let parentWorld: Mat4 | null = cur ? cur.transform.world : null
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i]
      n.transform.updateLocal()
      if (parentWorld) {
        mat4Multiply(n.transform.world, parentWorld, n.transform.local)
      } else {
        mat4Copy(n.transform.world, n.transform.local)
      }
      n.markWorldClean()
      parentWorld = n.transform.world
    }
  }

  /** World matrix, synced first. Read-only; treat the returned matrix as const. */
  get worldMatrix(): Mat4 {
    this.ensureWorldTransform()
    return this.transform.world
  }

  /**
   * Tween the transform toward `to`, scoped to this node's lifetime: destroying
   * the node rejects with `AbortError`. Position and scale lerp, rotation
   * slerps, alpha lerps. `opts.signal` (if provided) combines with the node
   * signal. Requires the node to be attached to an engine-backed world.
   */
  tween(to: Node3DTweenTo, opts: TweenOptions): Promise<void> {
    const engine = this.engine
    if (!engine) {
      return Promise.reject(
        new Error('Node3D.tween: node is not attached to an Engine world'),
      )
    }
    const t = this.transform
    const startP = { x: t.position.x, y: t.position.y, z: t.position.z }
    const startS = { x: t.scale.x, y: t.scale.y, z: t.scale.z }
    const startR = {
      x: t.rotation.x,
      y: t.rotation.y,
      z: t.rotation.z,
      w: t.rotation.w,
    }
    const startAlpha = t.alpha
    const combined = combineAbortSignals(this.abortSignal, opts.signal)
    const userUpdate = opts.onUpdate
    const progress = { p: 0 }
    return engine.animation
      .tween(progress, { p: 1 }, {
        ...opts,
        signal: combined.signal,
        onUpdate: () => {
          const p = progress.p
          if (to.position) {
            const np = vec3Lerp({ x: 0, y: 0, z: 0 }, startP, to.position, p)
            t.setPosition(np.x, np.y, np.z)
          }
          if (to.scale) {
            const ns = vec3Lerp({ x: 0, y: 0, z: 0 }, startS, to.scale, p)
            t.setScale(ns.x, ns.y, ns.z)
          }
          if (to.rotation) {
            const nr = quatSlerp(
              { x: 0, y: 0, z: 0, w: 1 },
              startR,
              to.rotation,
              p,
            )
            t.setRotation(nr.x, nr.y, nr.z, nr.w)
          }
          if (to.alpha !== undefined) t.alpha = lerp(startAlpha, to.alpha, p)
          userUpdate?.()
        },
      })
      .finally(combined.dispose)
  }

  /**
   * Fire-and-forget {@link Node3D.tween}: animate without awaiting, swallowing
   * the `AbortError` when the node dies mid-flight.
   */
  play(to: Node3DTweenTo, opts: TweenOptions): void {
    this.tween(to, opts).catch(ignoreAbort)
  }
}
