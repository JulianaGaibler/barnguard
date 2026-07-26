import { GroupNode } from './GroupNode'
import type { Node, NodeOwner } from './Node'
import type { Node2D, RenderLayer } from './Node2D'
import type { Node3D } from './Node3D'
import type { Engine } from '../engine/Engine'
import { walkTree } from './traverse'

/**
 * Owns the one scene tree (rooted at {@link SceneTree.root}) that holds both 2D
 * ({@link Node2D}) and 3D ({@link Node3D}) content, mirroring Godot's single
 * `SceneTree`. It is the sole {@link NodeOwner}: every node reaches the engine
 * through it. It also holds the derived caches the renderer reads each frame,
 * bucketed by node kind:
 *
 * - **2D:** painter order + per-layer node lists + the static-layer dirty flag,
 *   collected by walking the tree and keeping only {@link Node2D}s in DFS order.
 * - **3D:** the transform pass that composes each {@link Node3D}'s world matrix.
 *
 * The two render pipelines stay separate (2D painter order, 3D depth-tested),
 * but they read from this one tree. Bridge dimensions with a `Viewport2DNode`.
 *
 * Each `Stage` owns one `SceneTree`. {@link Scene} and {@link World3D} are thin
 * subclasses that default the root to a 2D or 3D node for standalone use.
 *
 * @category Scene
 */
export class SceneTree implements NodeOwner {
  /** Tree root. Add top-level nodes here (2D, 3D, or {@link GroupNode}s). */
  readonly root: Node
  #_staticInvalid = true
  /**
   * Back-reference to the owning Engine, set immediately after construction.
   * Null when used standalone (unit tests). Nodes reach `engine.animation`
   * through it for `node.tween` / `node.wait`.
   */
  engine: Engine | null = null

  /** Cached DFS pre-order (painter order) of the {@link Node2D}s in the tree. */
  #_painterOrder: Node2D[] | null = null
  /** Per-layer cached 2D node lists, rebuilt from the painter order when dirty. */
  #_layerCache: Map<RenderLayer, Node2D[]> = new Map()
  #_layerDirty = true

  constructor(root: Node = new GroupNode('scene-root')) {
    this.root = root
    root.onAttachedToScene(this)
  }

  get staticInvalid(): boolean {
    return this.#_staticInvalid
  }

  invalidateStatic(): void {
    this.#_staticInvalid = true
  }

  markStaticClean(): void {
    this.#_staticInvalid = false
  }

  /**
   * Mark the painter-order + per-layer indices dirty. Cheap (flags only); the
   * next `getPainterOrder()` / `getLayerNodes()` read rebuilds them in one DFS.
   * Called from {@link Node2D} mutations (add/remove/renderLayer change).
   */
  invalidatePainterOrder(): void {
    this.#_painterOrder = null
    this.#_layerDirty = true
  }

  /**
   * The {@link Node2D}s in the tree in DFS painter order (non-2D nodes are
   * skipped, order preserved). Cached until the tree mutates. Read-only.
   */
  getPainterOrder(): readonly Node2D[] {
    if (this.#_painterOrder) return this.#_painterOrder
    const out: Node2D[] = []
    walkTree(this.root, (n) => {
      if (n.kind === '2d') out.push(n as Node2D)
    })
    this.#_painterOrder = out
    return out
  }

  /** {@link Node2D}s in the given layer, in painter order. Read-only. */
  getLayerNodes(layer: RenderLayer): readonly Node2D[] {
    if (this.#_layerDirty) {
      const painter = this.getPainterOrder()
      this.#_layerCache.clear()
      for (let i = 0; i < painter.length; i++) {
        const n = painter[i]
        let arr = this.#_layerCache.get(n.renderLayer)
        if (!arr) {
          arr = []
          this.#_layerCache.set(n.renderLayer, arr)
        }
        arr.push(n)
      }
      this.#_layerDirty = false
    }
    return this.#_layerCache.get(layer) ?? EMPTY_LAYER
  }

  /** Whether the tree contains any {@link Node3D} (drives the 3D render pass). */
  get has3D(): boolean {
    return hasKind(this.root, '3d')
  }

  /**
   * Compose transforms for the whole tree: the 2D nodes in painter order, then
   * every 3D node. Each node recomposes only if dirty, from its nearest
   * same-kind ancestor, so clean subtrees cost nothing. Runs once per frame.
   */
  updateTransforms(): void {
    const painter = this.getPainterOrder()
    for (let i = 0; i < painter.length; i++) {
      const n = painter[i]
      if (n.worldDirty) n.ensureWorldTransform()
    }
    walkTree(this.root, (n) => {
      if (n.kind === '3d' && n.worldDirty) (n as Node3D).ensureWorldTransform()
    })
  }

  /**
   * Snapshot every 3D node's transform into its `prevTransform` for render
   * interpolation. The fixed-step loop calls this on worlds that opt in.
   */
  snapshotPrevTransforms(): void {
    walkTree(this.root, (n) => {
      if (n.kind !== '3d') return
      const node = n as Node3D
      if (!node.prevTransform) return
      const t = node.transform
      const p = node.prevTransform
      p.setPosition(t.position.x, t.position.y, t.position.z)
      p.setRotation(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w)
      p.setScale(t.scale.x, t.scale.y, t.scale.z)
      p.alpha = t.alpha
    })
  }

  /** Add one or more nodes under the root. Shorthand for `tree.root.add(...)`. */
  add(...nodes: Node[]): this {
    this.root.add(...nodes)
    return this
  }

  /** Remove one or more nodes from the root. Shorthand for `tree.root.remove(...)`. */
  remove(...nodes: Node[]): this {
    this.root.remove(...nodes)
    return this
  }

  /** Destroy the whole tree (root included) and release its resources. */
  destroy(): void {
    this.root.destroy()
  }
}

const EMPTY_LAYER: readonly Node2D[] = Object.freeze([]) as readonly Node2D[]

/** Depth-first search with early exit: does the subtree hold a node of `kind`? */
function hasKind(node: Node, kind: string): boolean {
  if (node.kind === kind) return true
  const children = node.children
  for (let i = 0; i < children.length; i++) {
    if (hasKind(children[i], kind)) return true
  }
  return false
}
