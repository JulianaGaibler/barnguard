import { Transform2D } from '../math/Transform2D'
import type { Rect } from '../math/Rect'
import type { Vec2 } from '../math/Vec2'
import { createEmitter, type Emitter } from '../events/Emitter'
import type { Behavior, BehaviorCtor } from './Behavior'
import type { Scene } from './Scene'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { PointerEvent2D } from '../input/PointerState'
import type { TweenOptions } from '../anim/Animator'
import { combineAbortSignals, isAbortError } from '../anim/abortSignal'
import { Timeline } from '../anim/Timeline'

/**
 * Which pass a node draws in. `static` nodes are baked once and cached until
 * invalidated; `dynamic` nodes redraw every frame; `above-static` draws every
 * frame on top of the baked static content.
 *
 * @category Scene
 */
export type RenderLayer = 'static' | 'above-static' | 'dynamic'

/**
 * Events emitted by a {@link SceneNode}. `destroy` fires once when the node is
 * destroyed.
 *
 * @category Scene
 */
export interface NodeEvents {
  destroy: void
}

let nextNodeId = 0
function generateId(prefix = 'node'): string {
  return `${prefix}-${nextNodeId++}`
}

/**
 * A node in the scene tree: a {@link Transform2D}, a parent, a list of children,
 * and optional attached {@link Behavior}s. Position a node by mutating its
 * `transform`; nest nodes with {@link SceneNode.add} so children inherit the
 * parent's transform.
 *
 * The built-in rendering primitives (`ShapeNode`, `Path2DNode`, `PolylineNode`,
 * `TextNode`, `ParticleEmitterNode`) subclass this and override
 * {@link SceneNode.draw}. Game logic goes in a {@link Behavior} or a subclass
 * hook ({@link SceneNode.onUpdate}, {@link SceneNode.onFixedStep}), the engine
 * core itself is game-agnostic.
 *
 * The async helpers ({@link SceneNode.tween}, {@link SceneNode.wait},
 * {@link SceneNode.loop}) are scoped to {@link SceneNode.abortSignal}, so
 * destroying a node cancels its outstanding work rather than leaving Promises
 * hanging.
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
export class SceneNode {
  /**
   * Stable unique id. Auto-generated (`node-N`) unless passed to the
   * constructor.
   */
  readonly id: string
  /**
   * Parent node, or `null` when detached / at the tree root. Set by
   * {@link SceneNode.add}.
   */
  parent: SceneNode | null = null
  /**
   * Local transform (position, rotation, scale, alpha). Mutate to move the
   * node.
   */
  readonly transform = new Transform2D()

  /**
   * Snapshot of `transform` at the start of each fixed step when render
   * interpolation is on. `null` when off (default), no work done.
   */
  prevTransform: Transform2D | null = null

  /** When false, the node and its subtree are skipped by the render walk. */
  visible = true
  /**
   * When true, the node takes part in pointer hit-testing. See
   * {@link SceneNode.bindPointer}.
   */
  hitEnabled = false
  /**
   * Local-space AABB used for viewport culling, hit-testing, and the debug
   * outline overlay. `null` means "never cull, always draw". The primitive
   * nodes set this from their geometry.
   */
  debugBounds: Rect | null = null
  /** Whether the debug outline overlay draws this node. Cosmetic only. */
  debugVisible = true

  readonly events: Emitter<NodeEvents> = createEmitter<NodeEvents>()

  protected readonly _children: SceneNode[] = []
  protected readonly _behaviors: Behavior[] = []
  readonly #abortController = new AbortController()
  #_renderLayer: RenderLayer = 'dynamic'
  #_worldDirty = true
  #_scene: Scene | null = null
  #_destroyed = false
  /**
   * Static descendants (excluding self), maintained incrementally so
   * `subtreeHasStaticLayer` stays O(1). Cross-checked by `_verifyStaticCount`.
   */
  #_staticDescendantCount = 0

  /**
   * Cached "does this node or any behavior implement `onUpdate`?".
   * `Engine.walkUpdate` skips no-work nodes entirely. Kept in sync by the
   * constructor and `addBehavior` / `removeBehavior`. Subclasses that mutate
   * `this.onUpdate` at runtime must call `_recomputeHasWork()`.
   */
  _hasUpdateWork = false
  _hasFixedStepWork = false

  constructor(id?: string) {
    this.id = id ?? generateId()
    this.transform.onDirty = () => this.markWorldDirty()
    // Class-method overrides live on the prototype at construction time.
    // Behavior-brought hooks go through `addBehavior`.
    this._hasUpdateWork = typeof this.onUpdate === 'function'
    this._hasFixedStepWork = typeof this.onFixedStep === 'function'
  }

  /**
   * Recompute `_hasUpdateWork` / `_hasFixedStepWork` from scratch. Called
   * automatically on `addBehavior` / `removeBehavior`; also exposed for
   * subclasses that mutate `this.onUpdate` at runtime.
   */
  _recomputeHasWork(): void {
    let update = typeof this.onUpdate === 'function'
    let fixed = typeof this.onFixedStep === 'function'
    if (!update || !fixed) {
      for (const b of this._behaviors) {
        if (!update && typeof b.onUpdate === 'function') update = true
        if (!fixed && typeof b.onFixedStep === 'function') fixed = true
        if (update && fixed) break
      }
    }
    this._hasUpdateWork = update
    this._hasFixedStepWork = fixed
  }

  get children(): readonly SceneNode[] {
    return this._children
  }
  get behaviors(): readonly Behavior[] {
    return this._behaviors
  }
  get abortSignal(): AbortSignal {
    return this.#abortController.signal
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
    // Propagate the static/non-static delta up the ancestor chain, this
    // node's own `_staticDescendantCount` counts descendants, so it doesn't
    // change; only ancestors do.
    const delta = (v === 'static' ? 1 : 0) - (prev === 'static' ? 1 : 0)
    if (delta !== 0) this.#_bumpAncestorsStaticCount(delta)
    if (this.#_scene) {
      // Painter order across layers changes when a node's layer flips.      // invalidate the layer index so the next drawLayer / hit-test walk
      // sees the new placement. Whether or not it's static-related.
      this.#_scene.invalidatePainterOrder()
      if (prev === 'static' || v === 'static') {
        this.#_scene.invalidateStatic()
      }
    }
  }

  #_bumpAncestorsStaticCount(delta: number): void {
    let p: SceneNode | null = this.parent
    while (p) {
      p.#_staticDescendantCount += delta
      p = p.parent
    }
  }
  get worldDirty(): boolean {
    return this.#_worldDirty
  }
  get isDestroyed(): boolean {
    return this.#_destroyed
  }
  get scene(): Scene | null {
    return this.#_scene
  }

  markWorldDirty(): void {
    if (this.#_worldDirty) return
    this.#_worldDirty = true
    for (const c of this._children) c.markWorldDirty()
  }

  markWorldClean(): void {
    this.#_worldDirty = false
  }

  /**
   * Force `transform.world` up-to-date NOW without waiting for
   * `Stage.updateTransforms`. For mid-frame game code that mutates an ancestor
   * and needs the descendant's absolute position on the same tick. O(depth)
   * worst case, O(1) when the ancestor chain is already clean.
   */
  ensureWorldTransform(): void {
    if (!this.#_worldDirty) return
    // Build the chain from this node up to the highest dirty ancestor.
    const chain: SceneNode[] = [this]
    let cur: SceneNode | null = this.parent
    while (cur && cur.#_worldDirty) {
      chain.push(cur)
      cur = cur.parent
    }
    // `cur` is either null (this is a root-ish detached node) or the
    // first clean ancestor. Compose down the chain from the ancestor.
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
      n.#_worldDirty = false
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

  /** Internal: called by Scene / parent when this subtree is attached. */
  onAttachedToScene(scene: Scene): void {
    this.#_scene = scene
    // Fire `onSceneReady` for any behaviors that hadn't seen a scene yet.
    // Behaviors added AFTER the node is scene-attached fire from
    // `addBehavior` directly; this loop covers the "behavior added on a
    // detached node, node then attached" path.
    const behaviors = this._behaviors
    for (let i = 0; i < behaviors.length; i++) {
      const b = behaviors[i]
      if (!b._sceneReadyFired) {
        b._sceneReadyFired = true
        b.onSceneReady?.()
      }
    }
    for (const c of this._children) c.onAttachedToScene(scene)
  }

  /** Internal: called when this subtree is detached from its scene. */
  onDetachedFromScene(): void {
    this.#_scene = null
    for (const c of this._children) c.onDetachedFromScene()
  }

  /**
   * Add `child` to this node and return `this` for chaining. Re-parents `child`
   * if it already had a parent. Once this node belongs to a scene, the child
   * subtree attaches too and its behaviors' `onSceneReady` hooks fire.
   */
  add(child: SceneNode): this {
    if (child === this) throw new Error('Cannot add a node to itself')
    if (child.#_destroyed) throw new Error('Cannot add a destroyed node')
    if (child.parent) child.parent.remove(child)
    child.parent = this
    this._children.push(child)
    child.markWorldDirty()
    // Total static contribution of the incoming subtree: child's own
    // static-ness plus its descendants' static count.
    const childStaticTotal =
      (child.#_renderLayer === 'static' ? 1 : 0) + child.#_staticDescendantCount
    if (childStaticTotal > 0) {
      this.#_staticDescendantCount += childStaticTotal
      this.#_bumpAncestorsStaticCount(childStaticTotal)
      if (this.#_scene) this.#_scene.invalidateStatic()
    }
    if (this.#_scene) {
      // Tree structure changed, the painter-order + layer-index caches
      // must be rebuilt on next read.
      this.#_scene.invalidatePainterOrder()
      child.onAttachedToScene(this.#_scene)
    }
    return this
  }

  /** Detach `child` from this node and its scene. No-op if it isn't a child. */
  remove(child: SceneNode): void {
    const idx = this._children.indexOf(child)
    if (idx < 0) return
    this._children.splice(idx, 1)
    child.parent = null
    const childStaticTotal =
      (child.#_renderLayer === 'static' ? 1 : 0) + child.#_staticDescendantCount
    if (childStaticTotal > 0) {
      this.#_staticDescendantCount -= childStaticTotal
      // NOTE: at this point child.parent is already null, so we can't use
      // child._bumpAncestorsStaticCount, walk from `this` instead. The
      // subtract on `this` above already accounts for this node; the loop
      // updates ancestors above `this`.
      this.#_bumpAncestorsStaticCount(-childStaticTotal)
      if (this.#_scene) this.#_scene.invalidateStatic()
    }
    if (this.#_scene) {
      this.#_scene.invalidatePainterOrder()
      child.onDetachedFromScene()
    }
  }

  /**
   * Dev assertion: verify `_staticDescendantCount` matches a fresh DFS. Returns
   * subtree total including self, throws on drift.
   */
  _verifyStaticCount(): number {
    let actualDescendants = 0
    for (const c of this._children) {
      // Recursive returns child's subtree total including child itself.
      actualDescendants += c._verifyStaticCount()
    }
    if (actualDescendants !== this.#_staticDescendantCount) {
      throw new Error(
        `[stargazer] SceneNode '${this.id}' _staticDescendantCount drift: ` +
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
   * Attach a {@link Behavior} and return it (for `const b =
   * node.addBehavior(...)`). Fires the behavior's `onAttach` now, plus
   * `onSceneReady` if this node is already in a scene (otherwise that fires on
   * attach).
   */
  addBehavior<T extends Behavior>(behavior: T): T {
    if (this.#_destroyed)
      throw new Error('Cannot add behavior to destroyed node')
    ;(behavior as unknown as { node: SceneNode }).node = this
    this._behaviors.push(behavior)
    // Pick up any onUpdate / onFixedStep the behavior brings.
    if (typeof behavior.onUpdate === 'function') this._hasUpdateWork = true
    if (typeof behavior.onFixedStep === 'function')
      this._hasFixedStepWork = true
    behavior.onAttach?.()
    // If the node is already in a scene, fire `onSceneReady` synchronously
    // so the behavior can set up scene-dependent visual state without a
    // 1-frame pop. If not, `onAttachedToScene` will fire it when the node
    // gets attached later.
    if (this.#_scene && !behavior._sceneReadyFired) {
      behavior._sceneReadyFired = true
      behavior.onSceneReady?.()
    }
    return behavior
  }

  removeBehavior(behavior: Behavior): void {
    const idx = this._behaviors.indexOf(behavior)
    if (idx < 0) return
    behavior.onDetach?.()
    // Reset the flag so a subsequent addBehavior of the same instance
    // fires `onSceneReady` again on the next scene attach.
    behavior._sceneReadyFired = false
    this._behaviors.splice(idx, 1)
    // Recompute, this behavior may have been the sole source of update
    // work, or another behavior may still provide it.
    this._recomputeHasWork()
  }

  getBehavior<T extends Behavior>(ctor: BehaviorCtor<T>): T | null {
    for (const b of this._behaviors) {
      if (b instanceof ctor) return b
    }
    return null
  }

  getBehaviors<T extends Behavior>(ctor: BehaviorCtor<T>): readonly T[] {
    const out: T[] = []
    for (const b of this._behaviors) {
      if (b instanceof ctor) out.push(b)
    }
    return out
  }

  /**
   * Hit-test in world coords. Default: rectangular AABB test using
   * `debugBounds` (inflated by `touchSlopWorld`). Subclasses override for exact
   * shapes (Path2DNode uses `isPointInPath`, ShapeNode uses circle, etc.).
   */
  hitTest(worldX: number, worldY: number, touchSlopWorld: number): boolean {
    const b = this.debugBounds
    if (!b) return false
    return (
      worldX >= b.x - touchSlopWorld &&
      worldX <= b.x + b.width + touchSlopWorld &&
      worldY >= b.y - touchSlopWorld &&
      worldY <= b.y + b.height + touchSlopWorld
    )
  }

  destroy(): void {
    if (this.#_destroyed) return
    this.#_destroyed = true
    // Destroy children first (bottom-up abort).
    const snapshot = this._children.slice()
    for (const c of snapshot) c.destroy()
    this._children.length = 0
    // Detach behaviors.
    for (const b of this._behaviors) b.onDetach?.()
    this._behaviors.length = 0
    // Abort, rejects pending awaits scoped to this node.
    this.#abortController.abort()
    this.events.emit('destroy', undefined)
    // Detach from parent.
    if (this.parent) this.parent.remove(this)
    // (`remove` already detaches from scene)
    if (this.#_scene) this.onDetachedFromScene()
  }

  /**
   * Subclass hook: called by the render walker with the base transform + alpha
   * already installed on `gfx`. Draw in the node's LOCAL coordinate space.
   */
  draw?(gfx: Gfx2D, camera: Camera, dt: number): void

  /** Subclass hook: per-render-frame update (variable dt). */
  onUpdate?(dt: number): void

  /** Subclass hook: fixed-step update (deterministic). */
  onFixedStep?(fixedDt: number): void

  /**
   * Pointer callbacks. Fire on the node that captured the pointer on `down`.
   * Move/up/cancel keep firing on the captured node even after the pointer
   * leaves it (DOM `setPointerCapture`).
   */
  onPointerDown?(p: PointerEvent2D): void
  onPointerMove?(p: PointerEvent2D): void
  onPointerUp?(p: PointerEvent2D): void
  onPointerCancel?(p: PointerEvent2D): void

  /**
   * Tween properties on this node's transform. Auto-scoped to
   * `this.abortSignal`, destroying the node rejects with AbortError.
   * `opts.signal` (if provided) is combined with the node signal.
   *
   * Requires the node to be attached to an Engine-owned Scene.
   */
  tween(to: Partial<Transform2D>, opts: TweenOptions): Promise<void> {
    const engine = this.#_scene?.engine
    if (!engine) {
      return Promise.reject(
        new Error('SceneNode.tween: node is not attached to an Engine scene'),
      )
    }
    const combined = combineAbortSignals(this.abortSignal, opts.signal)
    return engine.animation
      .tween(this.transform, to, { ...opts, signal: combined.signal })
      .finally(combined.dispose)
  }

  /**
   * Tween numeric properties on any object. For custom fields (`outerAlpha`,
   * `pulseScale`, etc.) that aren't part of `Transform2D`. Auto-scoped to
   * `this.abortSignal`. Requires an Engine-owned Scene.
   */
  tweenTo<T extends object>(
    target: T,
    to: Partial<T>,
    opts: TweenOptions,
  ): Promise<void> {
    const engine = this.#_scene?.engine
    if (!engine) {
      return Promise.reject(
        new Error('SceneNode.tweenTo: node is not attached to an Engine scene'),
      )
    }
    const combined = combineAbortSignals(this.abortSignal, opts.signal)
    return engine.animation
      .tween(target, to, { ...opts, signal: combined.signal })
      .finally(combined.dispose)
  }

  /**
   * Promote to `'above-static'` for the tween, demote on completion or abort.
   * Use for tweens (like alpha) on static-layer nodes, a plain `tween` would be
   * invisible until the next bake. The demote invalidates the static cache
   * exactly once so the bake picks up the settled state.
   */
  tweenStatic(to: Partial<Transform2D>, opts: TweenOptions): Promise<void> {
    const prevLayer = this.#_renderLayer
    // Only makes sense on a static-layer node; on non-static nodes it acts
    // as a plain tween since the promote/demote is a no-op.
    if (prevLayer === 'static') {
      this.renderLayer = 'above-static'
    }
    return this.tween(to, opts).finally(() => {
      if (this.#_destroyed) return
      // Restore the original layer even if the tween was aborted, the
      // caller may have been mid-fade and wants the static bake to pick
      // up whatever alpha we settled on.
      if (this.#_renderLayer !== prevLayer) this.renderLayer = prevLayer
    })
  }

  /**
   * Destroy this node when `p` settles (resolve or reject). AbortError is
   * silent, the destroy is the cleanup. Other rejections log via `console.warn`
   * so tween-key typos don't become silent no-ops.
   */
  autoDestroy(p: Promise<void>): Promise<void> {
    return p
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        // Non-abort rejection, surface the error but STILL destroy on
        // finally. Silent swallow would obscure real bugs.
        console.warn(
          `[stargazer] SceneNode('${this.id}').autoDestroy: ` +
            `non-abort rejection, destroying anyway:`,
          err,
        )
      })
      .finally(() => {
        if (!this.#_destroyed) this.destroy()
      })
  }

  /** Cascade destroy every child. Iterates a snapshot so re-entry is safe. */
  destroyChildren(): void {
    const snapshot = this._children.slice()
    for (const c of snapshot) {
      if (!c.#_destroyed) c.destroy()
    }
  }

  /**
   * Bind pointer handlers atomically. Returns an `unbind()` that clears exactly
   * the handlers assigned. On destroy or `unbind` while a capture is live, the
   * `cancel` handler fires with a synthetic event so drag state doesn't get
   * stuck open. `hitEnabled` defaults to `true` when `down` is present, opt out
   * with `hitEnabled: false` for stage-level listeners.
   */
  bindPointer(handlers: {
    down?: (e: PointerEvent2D) => void
    move?: (e: PointerEvent2D) => void
    up?: (e: PointerEvent2D) => void
    cancel?: (e: PointerEvent2D) => void
    hitEnabled?: boolean
  }): () => void {
    if (handlers.down) this.onPointerDown = handlers.down
    if (handlers.move) this.onPointerMove = handlers.move
    if (handlers.up) this.onPointerUp = handlers.up
    if (handlers.cancel) this.onPointerCancel = handlers.cancel
    const shouldHit = handlers.hitEnabled ?? handlers.down !== undefined
    const prevHitEnabled = this.hitEnabled
    if (shouldHit) this.hitEnabled = true

    let unbound = false
    return (): void => {
      if (unbound) return
      unbound = true
      // `InputSystem.handleDown` fires `dispatchCancel` on node destroy, so
      // captures held at destroy time are already covered. Explicit unbind
      // outside destroy is rare, no synthetic cancel dispatched here.
      if (handlers.down) this.onPointerDown = undefined
      if (handlers.move) this.onPointerMove = undefined
      if (handlers.up) this.onPointerUp = undefined
      if (handlers.cancel) this.onPointerCancel = undefined
      // Only reset hitEnabled if we set it, respect any external override.
      if (shouldHit && this.hitEnabled && !prevHitEnabled) {
        this.hitEnabled = false
      }
    }
  }

  /**
   * Run `body` in a loop while the node is alive. Aborts are swallowed, other
   * errors log and terminate the loop.
   *
   * `body` receives `{node, signal, iteration, nextFrame()}`. `nextFrame()`
   * resolves AFTER the current frame renders, writes in its `.then` land on the
   * next frame. For same-frame writes use `node.tween` / `node.wait`.
   *
   * Fire-and-forget, initial invocation deferred by a microtask so callers
   * inside `Behavior.onAttach` can rely on scene attachment.
   */
  loop(
    body: (ctx: {
      node: SceneNode
      signal: AbortSignal
      iteration: number
      nextFrame(): Promise<void>
    }) => Promise<void>,
    opts?: { name?: string; deferAttach?: boolean },
  ): void {
    const deferAttach = opts?.deferAttach ?? true
    const name = opts?.name
    const signal = this.abortSignal

    const nextFrame = (): Promise<void> => {
      const engine = this.#_scene?.engine
      if (!engine) return Promise.resolve()
      return engine.animation.wait(0, signal)
    }

    const run = async (): Promise<void> => {
      try {
        let iteration = 0
        while (!this.#_destroyed && !signal.aborted) {
          await body({ node: this, signal, iteration, nextFrame })
          iteration++
        }
      } catch (err) {
        if (isAbortError(err)) return
        console.error(
          `[stargazer] SceneNode.loop '${name ?? this.id}' ` +
            `terminated with error:`,
          err,
        )
      }
    }

    if (deferAttach) {
      queueMicrotask(() => {
        if (this.#_destroyed) return
        void run()
      })
    } else {
      void run()
    }
  }

  /**
   * Async delay scoped to this node, rejects with AbortError if the node is
   * destroyed while waiting. `extraSignal` (if provided) is combined with the
   * node signal.
   */
  wait(seconds: number, extraSignal?: AbortSignal): Promise<void> {
    const engine = this.#_scene?.engine
    if (!engine) {
      return Promise.reject(
        new Error('SceneNode.wait: node is not attached to an Engine scene'),
      )
    }
    const combined = combineAbortSignals(this.abortSignal, extraSignal)
    return engine.animation
      .wait(seconds, combined.signal)
      .finally(combined.dispose)
  }

  /**
   * Convenience for `new Timeline()` builder. Users still pass a signal to
   * `.run(signal)` explicitly, usually `node.abortSignal`.
   */
  timeline(): Timeline {
    return new Timeline()
  }

  /**
   * Alive particle count reported to the debug HUD. Base returns 0,
   * `ParticleEmitterNode` overrides. Duck-typed sum by `DebugController`.
   */
  get particleCount(): number {
    return 0
  }
}
