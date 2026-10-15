import { GroupNode } from './GroupNode'
import type { Node, NodeOwner } from './Node'
import type { Node2D } from './Node2D'
import type { Node3D } from './Node3D'
import type { Engine } from '../engine/Engine'
import type { CameraHost } from '../camera/CameraHost'
import { walkTree } from './traverse'

/**
 * Owns the one tree (rooted at {@link SceneTree.root}) holding both 2D
 * ({@link Node2D}) and 3D ({@link Node3D}) content. It is the sole
 * {@link NodeOwner}, so every node reaches the engine through it, and it holds
 * the derived caches the renderer reads each frame, bucketed by node kind:
 *
 * - **2D:** painter order, collected by walking the tree and keeping the
 *   {@link Node2D}s in DFS order.
 * - **3D:** the transform pass that composes each {@link Node3D}'s world matrix.
 *
 * The two render pipelines stay separate (2D painter order, 3D depth-tested),
 * but they read from this one tree.
 *
 * Each `Stage` owns one `SceneTree`, rooted at a plain {@link GroupNode} unless
 * the constructor is handed another root.
 */
export class SceneTree implements NodeOwner {
  /** Tree root. Add top-level nodes here (2D, 3D, or {@link GroupNode}s). */
  readonly root: Node
  /**
   * Back-reference to the owning Engine, set immediately after construction.
   * Null when used standalone (unit tests). Nodes reach `engine.animation`
   * through it for `node.tween` / `node.wait`.
   */
  engine: Engine | null = null

  /**
   * The camera registry this tree's cameras attach to, the owning `Stage`. Set
   * by the Stage right after construction, null for standalone trees (unit
   * tests). A camera node whose tree has no `stage` cannot register, so
   * attaching one hard-errors.
   */
  stage: CameraHost | null = null

  /** Cached DFS pre-order (painter order) of the {@link Node2D}s in the tree. */
  #_painterOrder: Node2D[] | null = null
  /** Nodes with update work, in pre-order, or `null` when stale. */
  #updateNodes: Node[] | null = null
  /** Nodes with fixed-step work, in pre-order, or `null` when stale. */
  #fixedNodes: Node[] | null = null
  /** Attached {@link Node3D}s, intrinsic ones included. */
  #all3D = 0
  /** Attached {@link Node3D}s that are not intrinsic. */
  #content3D = 0

  constructor(root: Node = new GroupNode('scene-root')) {
    this.root = root
    root.onAttachedToScene(this)
  }

  /**
   * Mark the painter-order index dirty. Cheap (flags only), the next
   * `getPainterOrder()` read rebuilds it in one DFS.
   *
   * Called by `Node.add`, `Node.remove` and the reorder methods for every
   * structural change in the tree. A change that skipped this leaves a node out
   * of the index, which means it neither hit-tests nor reads in order while
   * sitting correctly in the tree.
   */
  invalidatePainterOrder(): void {
    this.#_painterOrder = null
    this.#updateNodes = null
    this.#fixedNodes = null
  }

  invalidateWork(): void {
    this.#updateNodes = null
    this.#fixedNodes = null
  }

  /**
   * The nodes that have `onUpdate` work (their own or a behaviour's), in tree
   * pre-order, any kind. Cached until the tree or a node's work changes, so a
   * frame with no change visits only these. Each rebuild makes a new array, so
   * a pass iterating the old one is not disturbed by changes it causes.
   */
  getUpdateNodes(): readonly Node[] {
    if (!this.#updateNodes) this.#rebuildWork()
    return this.#updateNodes!
  }

  /** The nodes that have `onFixedStep` work, like {@link getUpdateNodes}. */
  getFixedStepNodes(): readonly Node[] {
    if (!this.#fixedNodes) this.#rebuildWork()
    return this.#fixedNodes!
  }

  #rebuildWork(): void {
    const update: Node[] = []
    const fixed: Node[] = []
    walkTree(this.root, (n) => {
      if (n._hasUpdateWork) update.push(n)
      if (n._hasFixedStepWork) fixed.push(n)
    })
    this.#updateNodes = update
    this.#fixedNodes = fixed
  }

  /**
   * The {@link Node2D}s in the tree in DFS painter order (non-2D nodes are
   * skipped, order preserved). Cached until the tree mutates. Read-only.
   */
  getPainterOrder(): readonly Node2D[] {
    if (this.#_painterOrder) return this.#_painterOrder
    const out: Node2D[] = []
    walkTree(this.root, (n) => {
      // Intrinsic nodes (camera nodes) are not content: they never draw, so
      // they stay out of painter order, and thus out of hit-testing and the
      // reading order (which read this list).
      if (n.kind === '2d' && !n.intrinsic) out.push(n as Node2D)
    })
    this.#_painterOrder = out
    return out
  }

  /**
   * Whether the tree contains any {@link Node3D} that is not intrinsic (drives
   * the 3D render pass). Kept as a count when nodes attach and detach, so a
   * frame in a pure-2D scene does not walk the tree to find out.
   */
  get has3D(): boolean {
    return this.#content3D > 0
  }

  count3D(all: number, content: number): void {
    this.#all3D += all
    this.#content3D += content
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
    if (this.#all3D === 0) return
    walkTree(this.root, (n) => {
      if (n.kind === '3d' && n.worldDirty) (n as Node3D).ensureWorldTransform()
    })
  }

  /** Add one or more nodes under the root. Shorthand for `tree.root.add(...)`. */
  add(...nodes: Node[]): this {
    this.root.add(...nodes)
    return this
  }

  /**
   * Remove one or more nodes from the root. Shorthand for
   * `tree.root.remove(...)`.
   */
  remove(...nodes: Node[]): this {
    this.root.remove(...nodes)
    return this
  }

  /** Destroy the whole tree (root included) and release its resources. */
  destroy(): void {
    this.root.destroy()
  }
}
