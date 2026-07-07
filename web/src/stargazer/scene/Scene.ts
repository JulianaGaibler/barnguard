import { SceneNode, type RenderLayer } from './SceneNode'
import type { Engine } from '../engine/Engine'
import { walkTree } from './traverse'

export class Scene {
  readonly root: SceneNode
  private _staticInvalid = true
  /**
   * Back-reference to the Engine that owns this Scene. Set by `Engine`
   * immediately after construction. Null when the Scene is used standalone
   * (unit tests). SceneNode uses this to reach `engine.animation` for
   * `node.tween`, `node.wait`, and future node-scoped helpers.
   */
  engine: Engine | null = null

  /**
   * Cached DFS pre-order (painter order) flat list of every node in the tree.
   * Rebuilt lazily via `getPainterOrder()` when null. Any tree mutation, add /
   * remove / renderLayer change, must call `invalidatePainterOrder()`.
   */
  private _painterOrder: SceneNode[] | null = null
  /**
   * Per-layer cached node list. Each entry may contain `null` tombstones (see
   * `SceneNode.remove`, set slot to null instead of splicing). The per-layer
   * array is compacted + rebuilt from `_painterOrder` on the next read via
   * `getLayerNodes(layer)`.
   */
  private _layerCache: Map<RenderLayer, SceneNode[]> = new Map()
  private _layerDirty = true

  constructor(root: SceneNode = new SceneNode('scene-root')) {
    this.root = root
    root.onAttachedToScene(this)
  }

  get staticInvalid(): boolean {
    return this._staticInvalid
  }

  invalidateStatic(): void {
    this._staticInvalid = true
  }

  markStaticClean(): void {
    this._staticInvalid = false
  }

  /**
   * Mark the painter-order cache and per-layer indices as dirty. Cheap. * only
   * sets flags. The next read via `getPainterOrder()` / `getLayerNodes()`
   * rebuilds via a single DFS. Called from SceneNode mutations
   * (add/remove/renderLayer change).
   */
  invalidatePainterOrder(): void {
    this._painterOrder = null
    this._layerDirty = true
  }

  /**
   * DFS pre-order flat list of every node in the tree (including the root).
   * Cached until the tree mutates. Read-only, callers must not mutate.
   */
  getPainterOrder(): readonly SceneNode[] {
    if (this._painterOrder) return this._painterOrder
    const out: SceneNode[] = []
    walkTree(this.root, (n) => out.push(n))
    this._painterOrder = out
    return out
  }

  /**
   * Nodes in the given layer, in painter order. Read-only. Compacts the cache
   * from `getPainterOrder()` when the layer index is dirty.
   */
  getLayerNodes(layer: RenderLayer): readonly SceneNode[] {
    if (this._layerDirty) {
      const painter = this.getPainterOrder()
      this._layerCache.clear()
      for (let i = 0; i < painter.length; i++) {
        const n = painter[i]
        let arr = this._layerCache.get(n.renderLayer)
        if (!arr) {
          arr = []
          this._layerCache.set(n.renderLayer, arr)
        }
        arr.push(n)
      }
      this._layerDirty = false
    }
    return this._layerCache.get(layer) ?? EMPTY_LAYER
  }
}

const EMPTY_LAYER: readonly SceneNode[] = Object.freeze(
  [],
) as readonly SceneNode[]
