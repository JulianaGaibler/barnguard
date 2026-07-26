import { createEmitter, type Emitter } from '../events/Emitter'
import type { Behavior, BehaviorCtor } from './Behavior'
import type { Engine } from '../engine/Engine'
import type { PointerEvent2D } from '../input/PointerState'
import type { TweenOptions } from '../anim/Animator'
import { combineAbortSignals, ignoreAbort, isAbortError } from '../anim/abortSignal'
import { AbortScope } from '../anim/AbortScope'
import { Timeline } from '../anim/Timeline'

/**
 * Non-spatial scene-tree base shared by the 2D {@link Node2D} and 3D
 * {@link Node3D} branches. It owns everything that has no coordinate system:
 * tree structure (parent/children), attached {@link Behavior}s, the abort +
 * event lifecycle, per-frame/fixed-step update hooks, the world-dirty flag, and
 * the async tween/wait/loop helpers. Each spatial branch adds its own transform,
 * world composition, and draw path on top.
 *
 * `Node` is not generic: `parent`, `children`, and `add(...)` are typed as the
 * base `Node`, so one tree can hold both 2D ({@link Node2D}) and 3D
 * ({@link Node3D}) nodes, mirroring Godot's single-tree model. A node's
 * dimension is its {@link Node.kind} (`'group' | '2d' | '3d'`); the consumers
 * that care (render passes, hit-testing) filter on it. Each spatial branch
 * composes its world transform from the nearest same-`kind` ancestor, so
 * cross-kind nesting is allowed and simply doesn't inherit a transform.
 *
 * Engine access flows through the owner: the async helpers reach `owner.engine`.
 * A node not yet attached to an owner has no engine, so those helpers reject.
 *
 * Game code uses {@link Node2D} / {@link Node3D}; this class is not
 * instantiated directly.
 *
 * @category Scene
 */
export interface NodeOwner {
  /** The engine the owned tree animates through, or `null` when standalone. */
  readonly engine: Engine | null
}

/**
 * A node's dimension. `'group'` is a transform-less logical/grouping node (the
 * tree root); `'2d'` is a {@link Node2D}; `'3d'` is a {@link Node3D}. Hot
 * walks branch on this cheap field instead of `instanceof`.
 *
 * @category Scene
 */
export type NodeKind = 'group' | '2d' | '3d'

/**
 * Events emitted by a node. `destroy` fires once when the node is destroyed.
 *
 * @category Scene
 */
export interface NodeEvents {
  destroy: void
}

/**
 * Pointer callbacks for {@link Node.bindPointer} (and reused by
 * {@link PointerBehavior}). Shared by 2D and 3D nodes; the input system
 * hit-tests the 2D scene (bounds) or the 3D world (ray) and dispatches to the
 * node that captured the pointer.
 *
 * @category Input
 */
export interface PointerHandlers {
  down?: (e: PointerEvent2D) => void
  move?: (e: PointerEvent2D) => void
  up?: (e: PointerEvent2D) => void
  cancel?: (e: PointerEvent2D) => void
  /** Force hit-testing on/off. Defaults to `true` when `down` is present. */
  hitEnabled?: boolean
  /**
   * Track only the first pointer to press: while it's held, other pointers'
   * down/move/up/cancel are ignored, and the slot frees on its up/cancel. Turns
   * a multi-touch-capable node into a single-drag target without the caller
   * tracking an active pointer id.
   */
  singlePointer?: boolean
}

let nextNodeId = 0
function generateId(prefix = 'node'): string {
  return `${prefix}-${nextNodeId++}`
}

export abstract class Node {
  /** Stable unique id. Auto-generated (`node-N`) unless passed to the constructor. */
  readonly id: string
  /** This node's dimension; see {@link NodeKind}. Fixed per subclass. */
  abstract readonly kind: NodeKind
  /** Parent node, or `null` when detached / at a tree root. Set by {@link Node.add}. */
  parent: Node | null = null

  /** When false, the node and its subtree are skipped by the render walk. */
  visible = true
  /**
   * When true, the node takes part in pointer hit-testing (2D bounds test for
   * `Node2D`, ray pick for `Node3D`). See {@link Node.bindPointer}.
   */
  hitEnabled = false

  readonly events: Emitter<NodeEvents> = createEmitter<NodeEvents>()

  protected readonly _children: Node[] = []
  protected readonly _behaviors: Behavior<Node>[] = []
  readonly #abortController = new AbortController()
  #_owner: NodeOwner | null = null
  #_destroyed = false
  #_worldDirty = true

  /**
   * Cached "does this node or any behavior implement `onUpdate`/`onFixedStep`?".
   * The engine's update walk skips no-work nodes. Kept in sync by the
   * constructor and `addBehavior`/`removeBehavior`; a subclass that mutates
   * `this.onUpdate` at runtime calls {@link Node._recomputeHasWork}.
   */
  _hasUpdateWork = false
  _hasFixedStepWork = false

  constructor(id?: string) {
    this.id = id ?? generateId()
    this._hasUpdateWork = typeof this.onUpdate === 'function'
    this._hasFixedStepWork = typeof this.onFixedStep === 'function'
  }

  /**
   * Recompute the update/fixed-step work flags from scratch. Runs on
   * `addBehavior`/`removeBehavior`; also for a subclass that swaps `this.onUpdate`
   * at runtime.
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

  get children(): readonly Node[] {
    return this._children
  }
  get behaviors(): readonly Behavior<Node>[] {
    return this._behaviors
  }
  get abortSignal(): AbortSignal {
    return this.#abortController.signal
  }
  get worldDirty(): boolean {
    return this.#_worldDirty
  }
  get isDestroyed(): boolean {
    return this.#_destroyed
  }
  /** Owner once attached, else `null`. */
  get owner(): NodeOwner | null {
    return this.#_owner
  }
  /** Engine reached through the owner, or `null` when detached. */
  get engine(): Engine | null {
    return this.#_owner?.engine ?? null
  }

  // --- tree structure --------------------------------------------------------

  /**
   * Add one or more `children` and return `this` for chaining. Re-parents a
   * child that already had a parent. Once this node has an owner, each added
   * subtree attaches too and its behaviors' `onSceneReady` hooks fire. Children
   * are added in argument order.
   */
  add(...children: Node[]): this {
    for (const child of children) this.#addOne(child)
    return this
  }

  #addOne(child: Node): void {
    if (child === this) throw new Error('Cannot add a node to itself')
    if (child.#_destroyed) throw new Error('Cannot add a destroyed node')
    if (child.parent) child.parent.remove(child)
    child.parent = this
    this._children.push(child)
    child.#markSubtreeWorldDirty()
    this._onChildAttached(child)
    if (this.#_owner) child.onAttachedToScene(this.#_owner)
  }

  /**
   * Detach one or more `children` from this node and their owner, and return
   * `this`. A node that isn't a child here is skipped.
   */
  remove(...children: Node[]): this {
    for (const child of children) this.#removeOne(child)
    return this
  }

  #removeOne(child: Node): void {
    const idx = this._children.indexOf(child)
    if (idx < 0) return
    this._children.splice(idx, 1)
    child.parent = null
    this._onChildDetached(child)
    if (this.#_owner) child.onDetachedFromScene()
  }

  /**
   * Hook: a child subtree was just linked under this node (before its owner
   * attach). A branch overrides it for structural bookkeeping (e.g. the 2D
   * static-layer counts). Runs whether or not an owner is present.
   */
  protected _onChildAttached(_child: Node): void {}
  /** Hook: a child subtree was just unlinked from this node. */
  protected _onChildDetached(_child: Node): void {}
  /** Hook: this node was attached to an owner (after owner is set, before children recurse). */
  protected _onAttach(): void {}
  /** Hook: this node was detached from its owner. */
  protected _onDetach(): void {}

  /** Internal: attach this subtree to `owner`, firing behaviors' `onSceneReady`. */
  onAttachedToScene(owner: NodeOwner): void {
    this.#_owner = owner
    this._onAttach()
    const behaviors = this._behaviors
    for (let i = 0; i < behaviors.length; i++) {
      const b = behaviors[i]
      if (!b._sceneReadyFired) {
        b._sceneReadyFired = true
        b.onSceneReady?.()
      }
    }
    for (const c of this._children) c.onAttachedToScene(owner)
  }

  /** Internal: detach this subtree from its owner. */
  onDetachedFromScene(): void {
    this.#_owner = null
    this._onDetach()
    for (const c of this._children) c.onDetachedFromScene()
  }

  // --- world-dirty flag ------------------------------------------------------

  /**
   * Mark this node's cached world transform stale and cascade to descendants,
   * so the next transform pass recomputes them. Fires when the local transform
   * changes or the node is re-parented.
   */
  markWorldDirty(): void {
    if (this.#_worldDirty) return
    this.#_worldDirty = true
    // A transform change moves only same-kind descendants: each composes its
    // world from the nearest same-kind ancestor (this node), while a
    // different-kind descendant anchors to its own kind and is unaffected (a 2D
    // move must not dirty a nested 3D node, and vice versa). Traverse through
    // intervening different-kind nodes to reach deeper same-kind ones.
    this.#cascadeSameKind(this.kind)
  }

  #cascadeSameKind(kind: NodeKind): void {
    for (const c of this._children) {
      if (c.kind === kind) c.markWorldDirty()
      else c.#cascadeSameKind(kind)
    }
  }

  /**
   * Mark this whole subtree's world stale regardless of kind. Used on reparent,
   * where every descendant's nearest-same-kind-ancestor chain may have changed,
   * so all kinds must recompose against their new location.
   */
  #markSubtreeWorldDirty(): void {
    this.#_worldDirty = true
    for (const c of this._children) c.#markSubtreeWorldDirty()
  }

  /** Internal: clear the world-dirty flag after the transform pass writes the world matrix. */
  markWorldClean(): void {
    this.#_worldDirty = false
  }

  // --- behaviors -------------------------------------------------------------

  /**
   * Attach a {@link Behavior} and return it. Fires the behavior's `onAttach`
   * now, plus `onSceneReady` if this node already has an owner (otherwise that
   * fires on attach).
   */
  addBehavior<B extends Behavior<Node>>(behavior: B): B {
    if (this.#_destroyed) throw new Error('Cannot add behavior to destroyed node')
    ;(behavior as unknown as { node: Node }).node = this
    this._behaviors.push(behavior)
    if (typeof behavior.onUpdate === 'function') this._hasUpdateWork = true
    if (typeof behavior.onFixedStep === 'function') this._hasFixedStepWork = true
    behavior.onAttach?.()
    if (this.#_owner && !behavior._sceneReadyFired) {
      behavior._sceneReadyFired = true
      behavior.onSceneReady?.()
    }
    return behavior
  }

  /**
   * Detach `behavior` (firing its `onDetach`) and return `this`. A no-op if not
   * attached. Recomputes the update/fixed-step work flags.
   */
  removeBehavior(behavior: Behavior<Node>): this {
    const idx = this._behaviors.indexOf(behavior)
    if (idx < 0) return this
    behavior.onDetach?.()
    behavior._sceneReadyFired = false
    this._behaviors.splice(idx, 1)
    this._recomputeHasWork()
    return this
  }

  getBehavior<B extends Behavior<Node>>(ctor: BehaviorCtor<B>): B | null {
    for (const b of this._behaviors) {
      if (b instanceof ctor) return b
    }
    return null
  }

  getBehaviors<B extends Behavior<Node>>(ctor: BehaviorCtor<B>): readonly B[] {
    const out: B[] = []
    for (const b of this._behaviors) {
      if (b instanceof ctor) out.push(b)
    }
    return out
  }

  /** Set {@link Node.visible} and return `this` for chaining. */
  setVisible(visible: boolean): this {
    this.visible = visible
    return this
  }

  /** Set {@link Node.hitEnabled} and return `this` for chaining. */
  setHitEnabled(hitEnabled: boolean): this {
    this.hitEnabled = hitEnabled
    return this
  }

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
   * Bind pointer handlers atomically. Returns an `unbind()` that clears exactly
   * the handlers assigned. `hitEnabled` defaults to `true` when `down` is
   * present; opt out with `hitEnabled: false` for stage-level listeners. Set
   * `singlePointer` to track only the first press and ignore concurrent
   * pointers.
   */
  bindPointer(handlers: PointerHandlers): () => void {
    // With `singlePointer`, wrap the callbacks to track the first pressed
    // pointer and drop events from any other until it releases.
    if (handlers.singlePointer) {
      let activeId: number | null = null
      const { down, move, up, cancel } = handlers
      handlers = {
        ...handlers,
        singlePointer: false,
        down: (e) => {
          if (activeId !== null) return
          activeId = e.pointer.id
          down?.(e)
        },
        move: (e) => {
          if (e.pointer.id !== activeId) return
          move?.(e)
        },
        up: (e) => {
          if (e.pointer.id !== activeId) return
          activeId = null
          up?.(e)
        },
        cancel: (e) => {
          if (e.pointer.id !== activeId) return
          activeId = null
          cancel?.(e)
        },
      }
    }
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
      if (handlers.down) this.onPointerDown = undefined
      if (handlers.move) this.onPointerMove = undefined
      if (handlers.up) this.onPointerUp = undefined
      if (handlers.cancel) this.onPointerCancel = undefined
      if (shouldHit && this.hitEnabled && !prevHitEnabled) this.hitEnabled = false
    }
  }

  // --- lifecycle -------------------------------------------------------------

  destroy(): void {
    if (this.#_destroyed) return
    this.#_destroyed = true
    const snapshot = this._children.slice()
    for (const c of snapshot) c.destroy()
    this._children.length = 0
    for (const b of this._behaviors) b.onDetach?.()
    this._behaviors.length = 0
    this.#abortController.abort()
    this.events.emit('destroy', undefined)
    if (this.parent) this.parent.remove(this)
    if (this.#_owner) this.onDetachedFromScene()
  }

  /**
   * Destroy every child (recursively), leaving this node alive and empty, and
   * return `this`. Iterates a snapshot so a child that re-enters and mutates the
   * list is handled safely.
   */
  destroyChildren(): this {
    const snapshot = this._children.slice()
    for (const c of snapshot) {
      if (!c.isDestroyed) c.destroy()
    }
    return this
  }

  // --- subclass hooks --------------------------------------------------------

  /** Subclass hook: per-render-frame update (variable dt). */
  onUpdate?(dt: number): void
  /** Subclass hook: fixed-step update (deterministic). */
  onFixedStep?(fixedDt: number): void

  // --- async helpers ---------------------------------------------------------

  /**
   * Tween numeric properties on any object, scoped to this node's lifetime:
   * destroying the node rejects with `AbortError`. For a node's own transform,
   * the spatial branches expose a typed `tween`. Requires an owner with an
   * engine.
   */
  tweenTo<Obj extends object>(
    target: Obj,
    to: Partial<Obj>,
    opts: TweenOptions,
  ): Promise<void> {
    const engine = this.engine
    if (!engine) {
      return Promise.reject(
        new Error('Node.tweenTo: node is not attached to an Engine scene'),
      )
    }
    const combined = combineAbortSignals(this.abortSignal, opts.signal)
    return engine.animation
      .tween(target, to, { ...opts, signal: combined.signal })
      .finally(combined.dispose)
  }

  /**
   * Fire-and-forget {@link Node.tweenTo}: animate arbitrary numeric fields
   * without awaiting, swallowing the abort on node death. Pair with `opts.key`
   * for self-cancelling restarts.
   */
  playTo<Obj extends object>(
    target: Obj,
    to: Partial<Obj>,
    opts: TweenOptions,
  ): void {
    this.tweenTo(target, to, opts).catch(ignoreAbort)
  }

  /**
   * Create a re-abortable {@link AbortScope} tied to this node's lifetime.
   * Destroying the node aborts the scope's current epoch.
   */
  scope(): AbortScope {
    return new AbortScope(this.abortSignal)
  }

  /**
   * Destroy this node when `p` settles. `AbortError` is silent (the destroy is
   * the cleanup); other rejections log via `console.warn` then still destroy.
   */
  autoDestroy(p: Promise<void>): Promise<void> {
    return p
      .catch((err: unknown) => {
        if (isAbortError(err)) return
        console.warn(
          `[stargazer] Node('${this.id}').autoDestroy: ` +
            `non-abort rejection, destroying anyway:`,
          err,
        )
      })
      .finally(() => {
        if (!this.#_destroyed) this.destroy()
      })
  }

  /**
   * Run `body` in a loop while the node is alive. Aborts are swallowed; other
   * errors log and terminate the loop. `body` receives `{node, signal,
   * iteration, nextFrame()}`; `nextFrame()` resolves after the current frame
   * renders. Fire-and-forget; the first invocation defers a microtask so callers
   * inside `Behavior.onAttach` can rely on attachment.
   */
  loop(
    body: (ctx: {
      node: Node
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
      const engine = this.engine
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
          `[stargazer] Node.loop '${name ?? this.id}' terminated with error:`,
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
   * Async delay scoped to this node; rejects with `AbortError` if the node is
   * destroyed while waiting. `extraSignal` (if provided) combines with the node
   * signal.
   */
  wait(seconds: number, extraSignal?: AbortSignal): Promise<void> {
    const engine = this.engine
    if (!engine) {
      return Promise.reject(
        new Error('Node.wait: node is not attached to an Engine scene'),
      )
    }
    const combined = combineAbortSignals(this.abortSignal, extraSignal)
    return engine.animation.wait(seconds, combined.signal).finally(combined.dispose)
  }

  /** Convenience for `new Timeline()`. Pass a signal to `.run(signal)`, usually `node.abortSignal`. */
  timeline(): Timeline {
    return new Timeline()
  }
}
