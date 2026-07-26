import { Transform2D } from '../math/Transform2D'
import type { Rect } from '../math/Rect'
import type { Vec2 } from '../math/Vec2'
import { Node, type NodeEvents, type NodeKind, type PointerHandlers } from './Node'
import type { SceneTree } from './SceneTree'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { TweenOptions } from '../anim/Animator'
import { ignoreAbort } from '../anim/abortSignal'
import type { Semantics, SemanticsHandle } from '../a11y/types'

export type { NodeEvents, PointerHandlers }

// Reused across calls; hit-testing is synchronous, so there's no reentrancy.
const HIT_TEST_SCRATCH: Vec2 = { x: 0, y: 0 }

/**
 * Which pass a node draws in. `static` nodes are baked once and cached until
 * invalidated; `dynamic` nodes redraw every frame; `above-static` draws every
 * frame on top of the baked static content.
 *
 * @category Scene
 */
export type RenderLayer = 'static' | 'above-static' | 'dynamic'

/**
 * A node in the 2D scene tree: a {@link Transform2D}, a parent, a list of
 * children, and optional attached {@link Behavior}s. Position a node by mutating
 * its `transform`; nest nodes with {@link Node2D.add} so children inherit the
 * parent's transform. Shares its non-spatial machinery (behaviors, lifecycle,
 * abort, tween/wait/loop) with the 3D {@link Node3D} branch through {@link Node}.
 *
 * The built-in rendering primitives (`ShapeNode`, `Path2DNode`, `PolylineNode`,
 * `TextNode`, `ParticleEmitterNode`) subclass this and override
 * {@link Node2D.draw}. Game logic goes in a {@link Behavior} or a subclass
 * hook ({@link Node.onUpdate}, {@link Node.onFixedStep}); the engine core itself
 * is game-agnostic.
 *
 * The async helpers ({@link Node2D.tween}, {@link Node.wait}, {@link
 * Node.loop}) are scoped to {@link Node.abortSignal}, so destroying a node
 * cancels its outstanding work rather than leaving Promises hanging.
 *
 * @category Scene
 * @example
 *   const ship = new ShapeNode({
 *     geometry: { kind: 'circle', radius: 20 },
 *     fill: '#fff',
 *   })
 *   ship.transform.x = 100
 *   scene.root.add(ship)
 *   await ship.tween({ x: 400 }, { duration: 0.6, easing: easings.outCubic })
 */
export class Node2D extends Node {
  readonly kind: NodeKind = '2d'

  /** Local transform (position, rotation, scale, alpha). Mutate to move the node. */
  readonly transform = new Transform2D()

  /**
   * Snapshot of `transform` at the start of each fixed step when render
   * interpolation is on. `null` when off (default), no work done.
   */
  prevTransform: Transform2D | null = null

  /**
   * Local-space AABB used for viewport culling, hit-testing, and the debug
   * outline overlay. `null` means "never cull, always draw". The primitive
   * nodes set this from their geometry.
   */
  debugBounds: Rect | null = null
  /** Whether the debug outline overlay draws this node. Cosmetic only. */
  debugVisible = true

  #_renderLayer: RenderLayer = 'dynamic'
  /**
   * Static descendants (excluding self), maintained incrementally so
   * `subtreeHasStaticLayer` stays O(1). Cross-checked by `_verifyStaticCount`.
   */
  #_staticDescendantCount = 0
  /** Semantics accumulated before the node joins a scene; see {@link Node2D.a11y}. */
  #pendingSemantics: Partial<Semantics> | null = null
  /** Live accessibility registration once attached; see {@link Node2D.a11y}. */
  #a11yHandle: SemanticsHandle | null = null

  constructor(id?: string) {
    super(id)
    this.transform.onDirty = () => this.markWorldDirty()
  }

  /** The scene tree this node belongs to, or `null` when detached. */
  get scene(): SceneTree | null {
    return this.owner as SceneTree | null
  }

  /**
   * Nearest ancestor that is also a `Node2D`, skipping any 3D or group nodes
   * in between; `null` if none. World composition uses this, so a `Node2D`
   * nested under a 3D or group parent behaves as a top-level 2D node (its world
   * equals its local).
   */
  get spatialParent(): Node2D | null {
    let p = this.parent
    while (p && p.kind !== '2d') p = p.parent
    return p as Node2D | null
  }

  /**
   * Which render pass this node draws in. See {@link RenderLayer}. Defaults to
   * `'dynamic'` (redraws every frame). Set `'static'` for content that rarely
   * changes so it can be baked and cached.
   */
  get renderLayer(): RenderLayer {
    return this.#_renderLayer
  }
  set renderLayer(v: RenderLayer) {
    if (this.#_renderLayer === v) return
    const prev = this.#_renderLayer
    this.#_renderLayer = v
    // Propagate the static/non-static delta up the ancestor chain. This node's
    // own `_staticDescendantCount` counts descendants, so it doesn't change;
    // only ancestors do.
    const delta = (v === 'static' ? 1 : 0) - (prev === 'static' ? 1 : 0)
    if (delta !== 0) this.#_bumpAncestorsStaticCount(delta)
    const scene = this.scene
    if (scene) {
      // Painter order across layers changes when a node's layer flips;
      // invalidate the layer index so the next drawLayer / hit-test walk sees
      // the new placement.
      scene.invalidatePainterOrder()
      if (prev === 'static' || v === 'static') scene.invalidateStatic()
    }
  }

  #_bumpAncestorsStaticCount(delta: number): void {
    let p: Node2D | null = this.spatialParent
    while (p) {
      p.#_staticDescendantCount += delta
      p = p.spatialParent
    }
  }

  /**
   * Whether this node or any descendant draws on the `'static'` layer. O(1): it
   * reads the incrementally-maintained descendant count. The layout pass uses it
   * to decide whether moving a subtree must invalidate the static bake.
   */
  get subtreeHasStaticLayer(): boolean {
    return this.#_renderLayer === 'static' || this.#_staticDescendantCount > 0
  }

  protected override _onChildAttached(child: Node): void {
    // Only 2D children carry static-layer state; a 3D or group child adds no
    // static contribution and must not touch the count (it has no such field).
    if (child.kind === '2d') {
      const c = child as Node2D
      // Total static contribution of the incoming subtree: child's own
      // static-ness plus its descendants' static count.
      const childStaticTotal =
        (c.#_renderLayer === 'static' ? 1 : 0) + c.#_staticDescendantCount
      if (childStaticTotal > 0) {
        this.#_staticDescendantCount += childStaticTotal
        this.#_bumpAncestorsStaticCount(childStaticTotal)
        this.scene?.invalidateStatic()
      }
    }
    // Tree structure changed; the painter-order + layer-index caches rebuild on
    // next read.
    this.scene?.invalidatePainterOrder()
  }

  protected override _onChildDetached(child: Node): void {
    if (child.kind === '2d') {
      const c = child as Node2D
      const childStaticTotal =
        (c.#_renderLayer === 'static' ? 1 : 0) + c.#_staticDescendantCount
      if (childStaticTotal > 0) {
        this.#_staticDescendantCount -= childStaticTotal
        // `child.parent` is already null here, so walk ancestors from `this`; the
        // subtract on `this` above already accounts for this node.
        this.#_bumpAncestorsStaticCount(-childStaticTotal)
        this.scene?.invalidateStatic()
      }
    }
    this.scene?.invalidatePainterOrder()
  }

  protected override _onAttach(): void {
    // A node configured with `.a11y(...)` before it joined a scene registers now
    // that an engine is reachable.
    this.#tryRegisterA11y()
  }

  /**
   * Dev assertion: verify `_staticDescendantCount` matches a fresh DFS. Returns
   * subtree total including self, throws on drift.
   */
  _verifyStaticCount(): number {
    let actualDescendants = 0
    for (const c of this.children) {
      if (c.kind === '2d') actualDescendants += (c as Node2D)._verifyStaticCount()
    }
    if (actualDescendants !== this.#_staticDescendantCount) {
      throw new Error(
        `[stargazer] Node2D '${this.id}' _staticDescendantCount drift: ` +
          `expected ${actualDescendants}, got ${this.#_staticDescendantCount}`,
      )
    }
    return actualDescendants + (this.#_renderLayer === 'static' ? 1 : 0)
  }

  /**
   * Test/dev only: force the cached static-descendant count, used to simulate
   * drift so `_verifyStaticCount`'s regression detector can be exercised.
   */
  _forceStaticDescendantCount(n: number): void {
    this.#_staticDescendantCount = n
  }

  /**
   * Force `transform.world` up-to-date NOW without waiting for
   * `Stage.updateTransforms`. For mid-frame game code that mutates an ancestor
   * and needs the descendant's absolute position on the same tick. O(depth)
   * worst case, O(1) when the ancestor chain is already clean.
   */
  ensureWorldTransform(): void {
    if (!this.worldDirty) return
    // Build the chain from this node up to the highest dirty ancestor.
    const chain: Node2D[] = [this]
    let cur: Node2D | null = this.spatialParent
    while (cur && cur.worldDirty) {
      chain.push(cur)
      cur = cur.spatialParent
    }
    // `cur` is either null (a root-ish detached node) or the first clean
    // ancestor. Compose down the chain from the ancestor.
    let parentWorld: DOMMatrix | null = cur?.transform.world ?? null
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i]
      n.transform.updateLocal()
      const l = n.transform.local
      const w = n.transform.world
      if (parentWorld) {
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
      } else {
        // No parent, world = local.
        w.a = l.a
        w.b = l.b
        w.c = l.c
        w.d = l.d
        w.e = l.e
        w.f = l.f
      }
      n.markWorldClean()
      parentWorld = w
    }
  }

  /**
   * Map a WORLD-space point into this node's LOCAL space (the space its own
   * `transform.x/y` and children live in). Inverse of the node's world affine.
   * Syncs `transform.world` first, so it's correct mid-frame after ancestor
   * mutations. Returns `{x, y}` unchanged if the matrix is degenerate.
   */
  worldToLocal(worldX: number, worldY: number, out?: Vec2): Vec2 {
    this.ensureWorldTransform()
    const w = this.transform.world
    const det = w.a * w.d - w.b * w.c
    const r = out ?? { x: 0, y: 0 }
    if (det === 0) {
      r.x = worldX
      r.y = worldY
      return r
    }
    const invDet = 1 / det
    const dx = worldX - w.e
    const dy = worldY - w.f
    r.x = (w.d * dx - w.c * dy) * invDet
    r.y = (-w.b * dx + w.a * dy) * invDet
    return r
  }

  /** Map a LOCAL-space point into WORLD space via this node's world affine. */
  localToWorld(localX: number, localY: number, out?: Vec2): Vec2 {
    this.ensureWorldTransform()
    const w = this.transform.world
    const r = out ?? { x: 0, y: 0 }
    r.x = w.a * localX + w.c * localY + w.e
    r.y = w.b * localX + w.d * localY + w.f
    return r
  }

  /**
   * Attach or update accessibility {@link Semantics} on this node and return
   * `this` for chaining. The first call needs a `role`; later calls take a
   * partial and merge into the current semantics, patching the hidden proxy in
   * place (focus preserved). Sugar over `engine.a11y.attach` / `handle.update`:
   * if the node isn't in a scene yet, the semantics are held and registered when
   * it attaches. Zero cost until used.
   *
   * @example
   *   new ShapeNode({ geometry: { kind: 'rect', width: 240, height: 64 } })
   *     .setHitEnabled(true)
   *     .a11y({ role: 'button', label: 'Start game', onActivate: startGame })
   *   // later, toggling state — merges and patches in place:
   *   node.a11y({ label: 'Pause', states: { pressed: true } })
   */
  a11y(semantics: Semantics): this
  a11y(patch: Partial<Semantics>): this
  a11y(sem: Semantics | Partial<Semantics>): this {
    if (this.#a11yHandle) {
      this.#a11yHandle.update(sem)
      return this
    }
    this.#pendingSemantics = { ...(this.#pendingSemantics ?? {}), ...sem }
    this.#tryRegisterA11y()
    return this
  }

  /**
   * Register held semantics with the engine's accessibility tree once the node
   * is in a scene and a `role` is known. Idempotent; a no-op otherwise.
   */
  #tryRegisterA11y(): void {
    if (this.#a11yHandle) return
    const engine = this.engine
    const sem = this.#pendingSemantics
    if (engine && sem?.role) {
      this.#a11yHandle = engine.a11y.attach(this, sem as Semantics)
      this.#pendingSemantics = null
    }
  }

  /** Set {@link Node2D.renderLayer} and return `this` for chaining. */
  setRenderLayer(layer: RenderLayer): this {
    this.renderLayer = layer
    return this
  }

  /**
   * Hit-test in world coords. Default: rectangular AABB test against
   * `debugBounds` (inflated by `touchSlopWorld`), which is LOCAL-space — the
   * world point is mapped through {@link Node2D.worldToLocal} first, so this
   * works for a node anywhere in the tree, not just one at world origin with an
   * identity transform. Subclasses override for exact shapes (Path2DNode uses
   * `isPointInPath`, ShapeNode uses circle, etc.).
   */
  hitTest(worldX: number, worldY: number, touchSlopWorld: number): boolean {
    const b = this.debugBounds
    if (!b) return false
    const p = this.worldToLocal(worldX, worldY, HIT_TEST_SCRATCH)
    return (
      p.x >= b.x - touchSlopWorld &&
      p.x <= b.x + b.width + touchSlopWorld &&
      p.y >= b.y - touchSlopWorld &&
      p.y <= b.y + b.height + touchSlopWorld
    )
  }

  /**
   * Subclass hook: called by the render walker with the base transform + alpha
   * already installed on `gfx`. Draw in the node's LOCAL coordinate space.
   */
  draw?(gfx: Gfx2D, camera: Camera, dt: number): void

  /**
   * Tween properties on this node's transform. Auto-scoped to
   * `this.abortSignal`; destroying the node rejects with AbortError.
   * `opts.signal` (if provided) is combined with the node signal. Requires the
   * node to be attached to an Engine-owned Scene.
   */
  tween(to: Partial<Transform2D>, opts: TweenOptions): Promise<void> {
    return this.tweenTo(this.transform, to, opts)
  }

  /**
   * Promote to `'above-static'` for the tween, demote on completion or abort.
   * Use for tweens (like alpha) on static-layer nodes; a plain `tween` would be
   * invisible until the next bake. The demote invalidates the static cache
   * exactly once so the bake picks up the settled state.
   */
  tweenStatic(to: Partial<Transform2D>, opts: TweenOptions): Promise<void> {
    const prevLayer = this.#_renderLayer
    // Only meaningful on a static-layer node; on non-static nodes the
    // promote/demote is a no-op and this acts as a plain tween.
    if (prevLayer === 'static') this.renderLayer = 'above-static'
    return this.tween(to, opts).finally(() => {
      if (this.isDestroyed) return
      // Restore the original layer even if the tween aborted; the caller may
      // have been mid-fade and wants the static bake to pick up the settled
      // alpha.
      if (this.#_renderLayer !== prevLayer) this.renderLayer = prevLayer
    })
  }

  /**
   * Fire-and-forget {@link Node2D.tween}: animate the node's transform
   * without awaiting, swallowing the `AbortError` when the node dies mid-flight.
   * Pass `opts.key` to make it replace a prior same-key tween on this transform.
   */
  play(to: Partial<Transform2D>, opts: TweenOptions): void {
    this.tween(to, opts).catch(ignoreAbort)
  }

  /**
   * Alive particle count reported to the debug HUD. Base returns 0,
   * `ParticleEmitterNode` overrides. Duck-typed sum by `DebugController`.
   */
  get particleCount(): number {
    return 0
  }
}
