import { Transform2D } from '../math/Transform2D'
import type { Rect } from '../math/Rect'
import type { Affine2x3 } from '../math/Affine2D'
import type { Vec2 } from '../math/Vec2'
import {
  Node,
  type NodeEvents,
  type NodeKind,
  type PointerHandlers,
} from './Node'
import type { SceneTree } from './SceneTree'
import type { CameraView2D } from '../camera/CameraView2D'
import type { Gfx2D, GfxBlend, GfxMatteMode } from '../render/gfx/Gfx2D'
import type { GfxPath } from '../render/gfx/GfxPath'
import type { Canvas } from '../render/picture/Canvas'
import type { Picture } from '../render/picture/Picture'
import { paintingNode } from '../render/picture/paintState'
import { checkWorldToLocal } from './worldSpaceGuard'
import type { TweenOptions } from '../anim/Animator'
import { ignoreAbort } from '../anim/abortSignal'
import type { Semantics, SemanticsHandle } from '../a11y/types'

export type { NodeEvents, PointerHandlers }

// Reused across calls, hit-testing is synchronous, so there's no reentrancy.
const HIT_TEST_SCRATCH: Vec2 = { x: 0, y: 0 }
/** Nodes `ensureWorldTransform` composes, shared so no call allocates one. */
const WORLD_CHAIN: Node2D[] = []

/**
 * A node in the 2D scene tree: a {@link Transform2D}, a parent, a list of
 * children, and optional attached {@link Behavior}s. Position a node by mutating
 * its `transform`, nest nodes with {@link Node2D.add} so children inherit the
 * parent's transform. Shares its non-spatial machinery (behaviors, lifecycle,
 * abort, tween/wait/loop) with the 3D {@link Node3D} branch through
 * {@link Node}.
 *
 * The built-in rendering primitives (`ShapeNode`, `Path2DNode`, `PolylineNode`,
 * `TextNode`, `ParticleEmitterNode`) subclass this and override
 * {@link Node2D.draw}. Game logic goes in a {@link Behavior} or a subclass hook
 * ({@link Node.onUpdate}, {@link Node.onFixedStep}). The engine core itself is
 * game-agnostic.
 *
 * The async helpers ({@link Node2D.tween}, {@link Node.wait}, {@link Node.loop})
 * are scoped to {@link Node.abortSignal}, so destroying a node cancels its
 * outstanding work rather than leaving Promises hanging.
 *
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

  /**
   * Local transform (position, rotation, scale, alpha). Mutate to move the
   * node.
   */
  readonly transform = new Transform2D()

  /**
   * Replaces the bounds taken from the picture, for hit testing and the debug
   * outline. A container that has no picture of its own sets it to take taps as
   * a region. Culling uses it together with the picture's bounds, so a node
   * never disappears while some of what it paints is still in view.
   */
  boundsOverride: Rect | null = null

  /**
   * Local-space bounds of what the node paints, or `null` when it has no
   * picture or drew something whose extent is unknown.
   * {@link Node2D.boundsOverride} wins when set. Screen-space strokes and
   * shadows reach a little past them.
   */
  get bounds(): Rect | null {
    return this.boundsOverride ?? this._picture?.bounds ?? null
  }

  /**
   * Draw this node and everything under it into an offscreen surface and
   * composite that once with the node's cascaded `alpha`, so a translucent
   * group looks like one flat image and its parts do not show through each
   * other. Without it, `alpha` multiplies into every drawing separately.
   *
   * @remarks
   *   A group costs a surface for the frame, rendered in a pass of its own before
   *   the main pass, so turn it on only for content that overlaps itself while
   *   translucent. A group that contains an `InsetViewNode` falls back to
   *   per-drawing alpha. It never changes what a picture records, so toggling
   *   it does not repaint anything.
   */
  compositeGroup = false

  /**
   * How the node composites into what is under it. Anything but `'source-over'`
   * makes the node a group, drawn into a surface and composited once with this
   * blend, so every drawing in it blends as one image. The modes a composite
   * supports are `'source-over'`, `'lighter'`, `'screen'`, `'multiply'`,
   * `'destination-out'`, `'destination-in'` and `'xor'`.
   */
  compositeBlend: GfxBlend = 'source-over'

  /**
   * A node whose drawing scales this node's, as a track matte. The node and its
   * subtree are drawn into a surface, the matte node and its subtree into
   * another over the same area, and the first is composited through the second
   * according to `matteMode`. The matte node is not drawn on its own. It can
   * sit anywhere in the tree, usually next to this node so the two share a
   * parent's transform.
   *
   * @remarks
   *   A node serves as the matte of one node. A matte node that is hidden is an
   *   empty matte, which hides this node, or shows it all for an inverted mode.
   *   A group that contains an `InsetViewNode` is drawn without the matte.
   */
  get matte(): Node2D | null {
    return this.#matte
  }
  set matte(node: Node2D | null) {
    if (node === this.#matte) return
    if (this.#matte && this.#matte._matteOf === this)
      this.#matte._matteOf = null
    this.#matte = node
    if (node) node._matteOf = this
  }
  #matte: Node2D | null = null

  /**
   * How the matte scales the node: by its alpha or its luminance, or the
   * inverse.
   */
  matteMode: GfxMatteMode = 'alpha'

  /** @internal The node this one is the matte of, which keeps it out of the normal walk. */
  _matteOf: Node2D | null = null

  /**
   * Round the node's origin to a whole device pixel when it is drawn, so sharp
   * edges and nearest-filtered images land on pixel boundaries at rest. It only
   * moves the node by under half a pixel at compose time and never repaints.
   */
  pixelSnap = false

  /** @internal The recorded picture, `null` before the first paint. */
  _picture: Picture | null = null
  /** @internal The node needs to paint before it is next drawn. */
  _paintDirty = true
  /** @internal The compose walk's frame in which the picture was last checked. */
  _walkStamp = -1
  /** @internal The device scale it was drawn at last frame. */
  _lastScale = NaN
  /** Whether the debug outline overlay draws this node. Cosmetic only. */
  debugVisible = true

  #_clip: GfxPath | Rect | null = null

  /**
   * A region, in this node's local space, that limits this node and everything
   * under it. A {@link Rect} clips to a rectangle and a `GfxPath` to any shape.
   * `null` (the default) clips nothing. Clips on nested nodes narrow each
   * other, up to 7 deep.
   *
   * @remarks
   *   Engine developers: the compose walk pushes the stencil clip on entering the
   *   node and pops it on leaving its subtree, so everything under it pays for
   *   the clip once. A clip costs two stencil draws plus one to undo it, and a
   *   rect is built into a cached path.
   * @example
   *   // A scroll panel: content below this node never paints outside it.
   *   panel.clip = { x: 0, y: 0, width: 320, height: 200 }
   */
  get clip(): GfxPath | Rect | null {
    return this.#_clip
  }
  set clip(v: GfxPath | Rect | null) {
    this.#_clip = v
  }

  /**
   * Semantics accumulated before the node joins a scene, see
   * {@link Node2D.a11y}.
   */
  #pendingSemantics: Partial<Semantics> | null = null
  /** Live accessibility registration once attached, see {@link Node2D.a11y}. */
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
   * Nearest ancestor that is also a `Node2D`, skipping any 3D or group nodes in
   * between, or `null` if none. World composition uses this, so a `Node2D`
   * nested under a 3D or group parent behaves as a top-level 2D node (its world
   * equals its local).
   */
  get spatialParent(): Node2D | null {
    let p = this.parent
    while (p && p.kind !== '2d') p = p.parent
    return p as Node2D | null
  }

  protected override _onAttach(): void {
    // A node configured with `.a11y(...)` before it joined a scene registers now
    // that an engine is reachable.
    this.#tryRegisterA11y()
  }

  /**
   * Force `transform.world` up-to-date NOW without waiting for
   * `Stage.updateTransforms`. For mid-frame game code that mutates an ancestor
   * and needs the descendant's absolute position on the same tick. O(depth)
   * worst case, O(1) when the ancestor chain is already clean.
   */
  ensureWorldTransform(): void {
    if (!this.worldDirty) return
    // Collect this node and its dirty ancestors on a shared stack, from `base`
    // so a call made while another is composing keeps its entries apart.
    const chain = WORLD_CHAIN
    const base = chain.length
    chain.push(this)
    let cur: Node2D | null = this.spatialParent
    while (cur && cur.worldDirty) {
      chain.push(cur)
      cur = cur.spatialParent
    }
    // `cur` is either null (a root-ish detached node) or the first clean
    // ancestor. Compose down the chain from the ancestor.
    let parentWorld: Affine2x3 | null = cur?.transform.world ?? null
    for (let i = chain.length - 1; i >= base; i--) {
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
    chain.length = base
  }

  /**
   * Map a WORLD-space point into this node's LOCAL space (the space its own
   * `transform.x/y` and children live in). Inverse of the node's world affine.
   * Syncs `transform.world` first, so it's correct mid-frame after ancestor
   * mutations. Returns `{x, y}` unchanged if the matrix is degenerate.
   */
  worldToLocal(worldX: number, worldY: number, out?: Vec2): Vec2 {
    if (import.meta.env.DEV) checkWorldToLocal(this, worldX, worldY)
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
   * `this` for chaining. The first call needs a `role`, later calls take a
   * partial and merge into the current semantics, patching the hidden proxy in
   * place (focus preserved). Sugar over `engine.a11y.attach` / `handle.update`:
   * if the node isn't in a scene yet, the semantics are held and registered
   * when it attaches. Zero cost until used.
   *
   * @example
   *   new ShapeNode({ geometry: { kind: 'rect', width: 240, height: 64 } })
   *     .setHitEnabled(true)
   *     .a11y({ role: 'button', label: 'Start game', onActivate: startGame })
   *   // later, toggling state, merges and patches in place:
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
   * is in a scene and a `role` is known. Idempotent, a no-op otherwise.
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

  /**
   * Hit-test in world coords. Default: rectangular AABB test against
   * {@link Node2D.bounds} (inflated by `touchSlopWorld`), which is LOCAL-space.
   * The world point is mapped through {@link Node2D.worldToLocal} first, so this
   * works for a node anywhere in the tree, not just one at world origin with an
   * identity transform. Subclasses override for exact shapes (Path2DNode uses
   * `isPointInPath`, ShapeNode uses circle, etc.).
   */
  hitTest(worldX: number, worldY: number, touchSlopWorld: number): boolean {
    const b = this.bounds
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
   * already installed on `gfx`. Draw in the node's LOCAL coordinate space. The
   * `camera` is the current {@link CameraView2D} (query stroke scale / world
   * mapping through it).
   */
  draw?(gfx: Gfx2D, camera: CameraView2D, dt: number): void

  /**
   * Record what this node looks like into `canvas`, in local space. It runs
   * when the node is first drawn and then only after the node is marked for
   * repaint, and the recorded calls are replayed every frame in between. It has
   * to depend only on the node's own state: declared paint properties,
   * versioned resources it declared with `canvas.use`, and what
   * `markNeedsPaint` was called for. It must not read the camera, the clock or
   * the node's transform, and must not mark any node for repaint.
   */
  paint?(canvas: Canvas): void

  /**
   * Mark the node's picture stale, so it paints again before it is next drawn.
   * Paint properties and versioned resources do this on their own. Call it for
   * state the node owns and changes without them.
   */
  markNeedsPaint(): void {
    if (import.meta.env.DEV && paintingNode() !== null) {
      throw new Error(
        `markNeedsPaint() on ${this.id} while ${(paintingNode() as Node2D).id} paints. paint must not dirty a node.`,
      )
    }
    this._paintDirty = true
  }

  /**
   * Tween properties on this node's transform. Auto-scoped to
   * `this.abortSignal`, destroying the node rejects with AbortError.
   * `opts.signal` (if provided) is combined with the node signal. Requires the
   * node to be attached to an Engine-owned Scene.
   */
  tween(to: Partial<Transform2D>, opts: TweenOptions): Promise<void> {
    return this.tweenTo(this.transform, to, opts)
  }

  /**
   * Fire-and-forget {@link Node2D.tween}: animate the node's transform without
   * awaiting, swallowing the `AbortError` when the node dies mid-flight. Pass
   * `opts.key` to make it replace a prior same-key tween on this transform.
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
