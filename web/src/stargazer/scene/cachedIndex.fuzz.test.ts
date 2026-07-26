import { describe, expect, it } from 'vitest'
import { Node2D, type RenderLayer } from './Node2D'
import { SceneTree } from './SceneTree'
import { walkTree } from './traverse'

/**
 * Property-based fuzz suite for the P1/P3/P4/P8 caches. Runs a fixed
 * pseudo-random sequence of tree mutations and, every N ops, re-derives the
 * "truth" via a fresh DFS and compares it against every cache / counter the
 * engine maintains incrementally.
 *
 * Deterministic PRNG seed so failures reproduce exactly.
 */

class Mulberry32 {
  #state: number
  constructor(seed: number) {
    this.#state = seed >>> 0
  }
  next(): number {
    let t = (this.#state += 0x6d2b79f5) >>> 0
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(max: number): number {
    return Math.floor(this.next() * max)
  }
  choice<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }
}

/** Deep DFS truth for each cached invariant. */
function truePainterOrder(root: Node2D): Node2D[] {
  const out: Node2D[] = []
  walkTree(root, (n) => out.push(n))
  return out
}

function trueLayerNodes(root: Node2D, layer: RenderLayer): Node2D[] {
  const out: Node2D[] = []
  walkTree(root, (n) => {
    if (n.renderLayer === layer) out.push(n)
  })
  return out
}

/**
 * Rebuild every node's world matrix from scratch (parent × local, DFS). Returns
 * a Map<nodeId, [a, b, c, d, e, f]> so we can assert equality against the
 * incremental transform pass.
 */
function trueWorlds(root: Node2D): Map<string, number[]> {
  const m = new Map<string, number[]>()
  function walk(n: Node2D, parent: number[] | null): void {
    n.transform.updateLocal()
    const l = n.transform.local
    let w: number[]
    if (parent) {
      const [pa, pb, pc, pd, pe, pf] = parent
      w = [
        pa * l.a + pc * l.b,
        pb * l.a + pd * l.b,
        pa * l.c + pc * l.d,
        pb * l.c + pd * l.d,
        pa * l.e + pc * l.f + pe,
        pb * l.e + pd * l.f + pf,
      ]
    } else {
      w = [l.a, l.b, l.c, l.d, l.e, l.f]
    }
    m.set(n.id, w)
    for (const c of n.children) walk(c as Node2D, w)
  }
  walk(root, null)
  return m
}

const LAYERS: readonly RenderLayer[] = ['static', 'above-static', 'dynamic']

describe('Scene cached-index invariants (P1/P3/P4/P8), fuzz', () => {
  it('holds every invariant under 500 random ops on a 50-node tree', () => {
    const rng = new Mulberry32(0xdeadbeef)
    const root = new Node2D('scene-root')
    const scene = new SceneTree(root)
    const nodes: Node2D[] = []
    // Seed 50 nodes, each attached under a randomly-chosen prior node
    // (or root).
    for (let i = 0; i < 50; i++) {
      const n = new Node2D(`fuzz-${i}`)
      n.renderLayer = LAYERS[rng.int(3)]
      const parent = nodes.length > 0 ? rng.choice(nodes) : root
      parent.add(n)
      nodes.push(n)
    }

    const OPS = 500
    for (let step = 0; step < OPS; step++) {
      const op = rng.int(5)
      // 0: add a new node; 1: reparent; 2: remove; 3: setRenderLayer;
      // 4: setPosition
      if (op === 0) {
        const n = new Node2D(`fuzz-late-${step}`)
        n.renderLayer = LAYERS[rng.int(3)]
        const parent =
          nodes.length > 0 && rng.next() < 0.9 ? rng.choice(nodes) : root
        // Skip if parent was destroyed in a prior op.
        if (!parent.isDestroyed) {
          parent.add(n)
          nodes.push(n)
        }
      } else if (op === 1) {
        // Reparent an existing (non-destroyed) node under another one.
        const live = nodes.filter((n) => !n.isDestroyed && n.parent)
        if (live.length > 1) {
          const child = rng.choice(live)
          const others = live.filter((n) => n !== child)
          const target = rng.choice(others)
          // Guard against cycles: if target is a descendant of child,
          // skip. (Add throws for self-add; this prevents the subtler
          // ancestor-loop case.)
          let cur: Node2D | null = target
          let isDescendant = false
          while (cur) {
            if (cur === child) {
              isDescendant = true
              break
            }
            cur = cur.parent as Node2D | null
          }
          if (!isDescendant) target.add(child)
        }
      } else if (op === 2) {
        const live = nodes.filter((n) => !n.isDestroyed && n.parent)
        if (live.length > 5) {
          rng.choice(live).destroy()
        }
      } else if (op === 3) {
        const live = nodes.filter((n) => !n.isDestroyed)
        if (live.length > 0) {
          rng.choice(live).renderLayer = LAYERS[rng.int(3)]
        }
      } else {
        const live = nodes.filter((n) => !n.isDestroyed)
        if (live.length > 0) {
          const n = rng.choice(live)
          n.transform.x = rng.next() * 100 - 50
          n.transform.y = rng.next() * 100 - 50
        }
      }

      // Every 10 ops, verify every invariant.
      if (step % 10 !== 9) continue

      // (P4) Painter order matches a fresh DFS.
      const painterTrue = truePainterOrder(root)
      const painterCache = scene.getPainterOrder()
      expect(painterCache.map((n) => n.id)).toEqual(
        painterTrue.map((n) => n.id),
      )

      // (P1) Per-layer index matches DFS filtered by layer.
      for (const layer of LAYERS) {
        const layerTrue = trueLayerNodes(root, layer)
        const layerCache = scene.getLayerNodes(layer)
        expect(layerCache.map((n) => n.id)).toEqual(layerTrue.map((n) => n.id))
      }

      // (P8) Static descendant count.
      root._verifyStaticCount()

      // (P3) After a fresh updateTransforms pass, every node's world
      // matrix must match a from-scratch composition.
      // Simulate what Stage.updateTransforms does: compose down.
      // Since we don't have a Stage here, do it manually.
      composeAllWorlds(root)
      const truthMap = trueWorlds(root)
      for (const n of painterCache) {
        const truth = truthMap.get(n.id)!
        const w = n.transform.world
        expect(w.a).toBeCloseTo(truth[0], 5)
        expect(w.b).toBeCloseTo(truth[1], 5)
        expect(w.c).toBeCloseTo(truth[2], 5)
        expect(w.d).toBeCloseTo(truth[3], 5)
        expect(w.e).toBeCloseTo(truth[4], 5)
        expect(w.f).toBeCloseTo(truth[5], 5)
      }
    }
  })
})

/**
 * Mimic `Stage.updateTransforms`, dirty-aware compose from root down. Uses each
 * node's cached world where clean; recomputes where dirty.
 */
function composeAllWorlds(root: Node2D): void {
  // Root: honor the dirty flag ourselves.
  if (root.worldDirty) {
    root.transform.updateLocal()
    const l = root.transform.local
    const w = root.transform.world
    w.a = l.a
    w.b = l.b
    w.c = l.c
    w.d = l.d
    w.e = l.e
    w.f = l.f
    root.markWorldClean()
  }
  const rw = root.transform.world
  for (const c of root.children) propagate(c as Node2D, rw, root.worldDirty)
}

function propagate(
  node: Node2D,
  parentWorld: DOMMatrix,
  parentDirty: boolean,
): void {
  const nodeDirty = node.worldDirty || parentDirty
  if (nodeDirty) {
    node.transform.updateLocal()
    const l = node.transform.local
    const w = node.transform.world
    const pa = parentWorld.a
    const pb = parentWorld.b
    const pc = parentWorld.c
    const pd = parentWorld.d
    const pe = parentWorld.e
    const pf = parentWorld.f
    w.a = pa * l.a + pc * l.b
    w.b = pb * l.a + pd * l.b
    w.c = pa * l.c + pc * l.d
    w.d = pb * l.c + pd * l.d
    w.e = pa * l.e + pc * l.f + pe
    w.f = pb * l.e + pd * l.f + pf
    node.markWorldClean()
  }
  for (const c of node.children)
    propagate(c as Node2D, node.transform.world, nodeDirty)
}
