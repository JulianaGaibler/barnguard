/**
 * Uniform-grid spatial hash broad-phase. Each body's fat AABB is mapped to the
 * grid cells it covers; candidate pairs come from bodies sharing a cell. Fast
 * when bodies are roughly one size. For wildly mixed scales a dynamic AABB tree
 * would do better, and the {@link BroadPhase} interface leaves room to swap one
 * in without touching the step pipeline.
 */

import { rect, rectIntersects, type Rect } from '../math/Rect'
import type { Vec2 } from '../math/Vec2'
import type { Body } from './Body'
import type { BroadPhase, PairCallback } from './BroadPhase'

// Numeric cell key that is collision-free for cell indices in
// [-CELL_OFFSET, CELL_OFFSET); coordinates outside that range wrap and merely
// produce extra candidate pairs, never missed ones.
const CELL_OFFSET = 1 << 15
const CELL_STRIDE = 1 << 16
const PAIR_STRIDE = 1 << 20

/**
 * A uniform spatial hash over the world's bodies.
 *
 * @category Physics
 */
export class SpatialHashBroadPhase implements BroadPhase {
  /** Fat-AABB margin applied on update; set by the world. */
  margin = 0
  readonly cellSize: number
  readonly #invCellSize: number
  readonly #bodies: Body[] = []
  readonly #aabbs: Rect[] = []
  readonly #grid = new Map<number, number[]>()
  readonly #seen = new Set<number>()

  constructor(cellSize = 64) {
    this.cellSize = cellSize > 0 ? cellSize : 64
    this.#invCellSize = 1 / this.cellSize
  }

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
    // Empty every bucket but keep the arrays to avoid reallocation.
    for (const bucket of this.#grid.values()) bucket.length = 0
    const m = this.margin
    for (let i = 0; i < this.#bodies.length; i++) {
      const r = this.#aabbs[i]
      this.#bodies[i].computeAABB(r)
      if (m !== 0) {
        r.x -= m
        r.y -= m
        r.width += 2 * m
        r.height += 2 * m
      }
      const minX = Math.floor(r.x * this.#invCellSize)
      const minY = Math.floor(r.y * this.#invCellSize)
      const maxX = Math.floor((r.x + r.width) * this.#invCellSize)
      const maxY = Math.floor((r.y + r.height) * this.#invCellSize)
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const key = this.#cellKey(cx, cy)
          let bucket = this.#grid.get(key)
          if (!bucket) {
            bucket = []
            this.#grid.set(key, bucket)
          }
          bucket.push(i)
        }
      }
    }
  }

  queryPairs(onPair: PairCallback): void {
    const seen = this.#seen
    seen.clear()
    const bodies = this.#bodies
    for (const bucket of this.#grid.values()) {
      const n = bucket.length
      if (n < 2) continue
      for (let x = 0; x < n; x++) {
        const i = bucket[x]
        for (let y = x + 1; y < n; y++) {
          const j = bucket[y]
          const lo = i < j ? i : j
          const hi = i < j ? j : i
          const pk = lo * PAIR_STRIDE + hi
          if (seen.has(pk)) continue
          seen.add(pk)
          if (rectIntersects(this.#aabbs[i], this.#aabbs[j])) {
            onPair(bodies[i], bodies[j])
          }
        }
      }
    }
  }

  queryRegion(region: Readonly<Rect>, out: Body[]): Body[] {
    const seen = this.#seen
    seen.clear()
    const minX = Math.floor(region.x * this.#invCellSize)
    const minY = Math.floor(region.y * this.#invCellSize)
    const maxX = Math.floor((region.x + region.width) * this.#invCellSize)
    const maxY = Math.floor((region.y + region.height) * this.#invCellSize)
    for (let cy = minY; cy <= maxY; cy++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.#grid.get(this.#cellKey(cx, cy))
        if (!bucket) continue
        for (const i of bucket) {
          if (seen.has(i)) continue
          seen.add(i)
          if (rectIntersects(this.#aabbs[i], region)) out.push(this.#bodies[i])
        }
      }
    }
    return out
  }

  queryRay(
    origin: Readonly<Vec2>,
    dir: Readonly<Vec2>,
    maxDist: number,
    out: Body[],
  ): Body[] {
    const seen = this.#seen
    seen.clear()
    const collect = (cx: number, cy: number): void => {
      const bucket = this.#grid.get(this.#cellKey(cx, cy))
      if (!bucket) return
      for (const i of bucket) {
        if (seen.has(i)) continue
        seen.add(i)
        out.push(this.#bodies[i])
      }
    }
    // Grid-DDA traversal along the ray.
    const cs = this.cellSize
    let cx = Math.floor(origin.x * this.#invCellSize)
    let cy = Math.floor(origin.y * this.#invCellSize)
    collect(cx, cy)
    const len = Math.hypot(dir.x, dir.y)
    if (len === 0) return out
    const dx = dir.x / len
    const dy = dir.y / len
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
    // Distance (along the ray) to the next cell boundary in each axis.
    let tMaxX =
      stepX !== 0 ? ((stepX > 0 ? cx + 1 : cx) * cs - origin.x) / dx : Infinity
    let tMaxY =
      stepY !== 0 ? ((stepY > 0 ? cy + 1 : cy) * cs - origin.y) / dy : Infinity
    const tDeltaX = stepX !== 0 ? Math.abs(cs / dx) : Infinity
    const tDeltaY = stepY !== 0 ? Math.abs(cs / dy) : Infinity
    let guard = 0
    const maxCells = 100000
    while (Math.min(tMaxX, tMaxY) <= maxDist && guard++ < maxCells) {
      if (tMaxX < tMaxY) {
        cx += stepX
        tMaxX += tDeltaX
      } else {
        cy += stepY
        tMaxY += tDeltaY
      }
      collect(cx, cy)
    }
    return out
  }

  #cellKey(cx: number, cy: number): number {
    return (cx + CELL_OFFSET) * CELL_STRIDE + (cy + CELL_OFFSET)
  }
}
