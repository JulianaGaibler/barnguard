/**
 * Broad-phase acceleration: cheaply reject body pairs that cannot touch before
 * the narrow-phase runs. The interface is implementation-agnostic so a uniform
 * spatial hash, or later a dynamic AABB tree (BVH), can back it without the
 * step pipeline changing.
 */

import { rect, rectIntersects, type Rect } from '../math/Rect'
import type { Vec2 } from '../math/Vec2'
import type { Body } from './Body'

/** Called once per candidate pair emitted by {@link BroadPhase.queryPairs}. */
export type PairCallback = (a: Body, b: Body) => void

/**
 * Broad-phase index over the world's bodies.
 *
 * @category Physics
 */
export interface BroadPhase {
  insert(body: Body): void
  remove(body: Body): void
  /** Refresh stored AABBs. Call once per step before {@link queryPairs}. */
  update(): void
  /** Emit every candidate pair whose fat AABBs overlap, in a stable order. */
  queryPairs(onPair: PairCallback): void
  /** Append bodies whose AABB overlaps `region` to `out`. */
  queryRegion(region: Readonly<Rect>, out: Body[]): Body[]
  /**
   * Append bodies whose AABB the ray could reach to `out`. Coarse: exact hit
   * testing is the raycaster's job.
   */
  queryRay(
    origin: Readonly<Vec2>,
    dir: Readonly<Vec2>,
    maxDist: number,
    out: Body[],
  ): Body[]
}

/**
 * O(n²) broad-phase: every body pair is considered. Fast enough for small
 * worlds and the reference the spatial hash is fuzz-tested against.
 *
 * @category Physics
 */
export class BruteForceBroadPhase implements BroadPhase {
  /** Fat-AABB margin applied on update; set by the world. */
  margin = 0
  readonly #bodies: Body[] = []
  readonly #aabbs: Rect[] = []

  insert(body: Body): void {
    this.#bodies.push(body)
    this.#aabbs.push(rect())
  }

  remove(body: Body): void {
    const i = this.#bodies.indexOf(body)
    if (i < 0) return
    this.#bodies.splice(i, 1)
    this.#aabbs.splice(i, 1)
  }

  update(): void {
    for (let i = 0; i < this.#bodies.length; i++) {
      const r = this.#aabbs[i]
      this.#bodies[i].computeAABB(r)
      const m = this.margin
      if (m !== 0) {
        r.x -= m
        r.y -= m
        r.width += 2 * m
        r.height += 2 * m
      }
    }
  }

  queryPairs(onPair: PairCallback): void {
    const bodies = this.#bodies
    const aabbs = this.#aabbs
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (rectIntersects(aabbs[i], aabbs[j])) onPair(bodies[i], bodies[j])
      }
    }
  }

  queryRegion(region: Readonly<Rect>, out: Body[]): Body[] {
    for (let i = 0; i < this.#bodies.length; i++) {
      if (rectIntersects(this.#aabbs[i], region)) out.push(this.#bodies[i])
    }
    return out
  }

  queryRay(
    _origin: Readonly<Vec2>,
    _dir: Readonly<Vec2>,
    _maxDist: number,
    out: Body[],
  ): Body[] {
    // Coarse: hand back every body; the raycaster culls precisely.
    for (let i = 0; i < this.#bodies.length; i++) out.push(this.#bodies[i])
    return out
  }
}
