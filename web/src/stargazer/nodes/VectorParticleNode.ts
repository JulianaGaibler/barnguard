import { Node2D } from '../scene/Node2D'
import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'
import type { Vec2 } from '../math/Vec2'
import { SlotPool } from '../particles/SlotPool'

/**
 * Per-particle spawn state a {@link VectorParticleNode} subclass's
 * `spawnParticle` hook fills in. `x`/`y`/`angle` are node-local. `out` is
 * reused scratch across every `spawnParticle` call — copy values out, don't
 * retain the reference.
 *
 * @category Nodes
 */
export interface VectorParticleSpawnInit {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  /**
   * Launch speed magnitude. Populate from `Math.hypot(vx, vy)` if
   * `shouldDespawn` or `drawParticle` needs a speed ratio; leave 0 if unused.
   */
  speed0: number
}

/**
 * Constructor options for {@link VectorParticleNode}.
 *
 * @category Nodes
 */
export interface VectorParticleNodeOptions {
  id?: string
  /** Fixed particle count for this node's lifetime (no freelist growth). */
  capacity: number
  /** Exponential drag coefficient per second. 0 (default) = no damping. */
  dampingPerSec?: number
  /** Constant acceleration in world units/sec² (gravity, wind, …). */
  accelerationWorld?: Vec2
}

/**
 * Base class for custom-shaped, physics-driven particle bursts: per-particle
 * rotation, arbitrary vector draw shapes (triangles, line shards, anything
 * {@link Gfx2D} can draw), and opt-in despawn rules — the cases the baked,
 * sprite-based {@link ParticleEmitterNode} structurally can't cover (mixed
 * shapes within one burst, multi-stage spin, non-speed despawn rules). Use
 * `ParticleEmitterNode` for sprite-based bursts/trails; reach for this when
 * particles need per-piece vector geometry.
 *
 * Owns `x, y, vx, vy, angle, speed0` typed arrays and integrates standard
 * damped kinematics every frame automatically (the same damp → accel →
 * integrate math as `ParticleEmitter.update`, kept as a separate inline copy
 * here rather than a shared helper — both are tight hot loops over typed arrays
 * with enough surrounding differences that a shared function would just add an
 * indirection). Subclasses add their own parallel typed arrays (spin, shape
 * kind, whatever a specific burst needs) sized to `capacity` and index them
 * with the SAME index the base class hands to `spawnParticle` / `drawParticle`
 * / `updateExtra` / `shouldDespawn`.
 *
 * Nothing auto-despawns unless a subclass's `shouldDespawn` opts in — a node
 * with no override lives until something else destroys it (matches a
 * permanent-debris burst that settles forever and is cleaned up externally,
 * e.g. via a level-reset `destroyChildren()` sweep). Pair with
 * {@link Node2D.autoDestroy} + {@link VectorParticleNode.waitUntilEmpty} for a
 * self-cleaning one-shot burst instead.
 *
 * @category Nodes
 * @example
 *   class ShrapnelBurst extends VectorParticleNode {
 *     readonly #kind: Uint8Array
 *     constructor(center: Vec2, count: number) {
 *       super({ capacity: count, dampingPerSec: 3 })
 *       this.#kind = new Uint8Array(count)
 *       this.transform.x = center.x
 *       this.transform.y = center.y
 *       this.burst(count)
 *     }
 *     protected override spawnParticle(
 *       i: number,
 *       out: VectorParticleSpawnInit,
 *     ): void {
 *       const theta = Math.random() * Math.PI * 2
 *       const speed = 100 + Math.random() * 50
 *       out.x = 0
 *       out.y = 0
 *       out.vx = Math.cos(theta) * speed
 *       out.vy = Math.sin(theta) * speed
 *       out.angle = Math.random() * Math.PI * 2
 *       out.speed0 = speed
 *       this.#kind[i] = Math.random() < 0.6 ? 0 : 1
 *     }
 *     protected override drawParticle(gfx: Gfx2D, i: number): void {
 *       if (this.#kind[i] === 0) gfx.fillConvexPoly(TRI, 3, '#fff')
 *       else
 *         gfx.strokeLine(-4, 0, 4, 0, {
 *           color: '#fff',
 *           width: 1,
 *           cap: 'round',
 *         })
 *     }
 *   }
 */
export abstract class VectorParticleNode extends Node2D {
  protected readonly capacity: number
  protected readonly x: Float32Array
  protected readonly y: Float32Array
  protected readonly vx: Float32Array
  protected readonly vy: Float32Array
  protected readonly angle: Float32Array
  protected readonly speed0: Float32Array
  protected readonly alive: Uint8Array

  readonly #slots: SlotPool
  readonly #damping: number
  readonly #accelX: number
  readonly #accelY: number
  #emptyResolvers: Array<() => void> = []
  readonly #spawnScratch: VectorParticleSpawnInit = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    speed0: 0,
  }

  constructor(opts: VectorParticleNodeOptions) {
    super(opts.id)
    this.capacity = opts.capacity
    this.#slots = new SlotPool(opts.capacity)
    this.x = new Float32Array(opts.capacity)
    this.y = new Float32Array(opts.capacity)
    this.vx = new Float32Array(opts.capacity)
    this.vy = new Float32Array(opts.capacity)
    this.angle = new Float32Array(opts.capacity)
    this.speed0 = new Float32Array(opts.capacity)
    this.alive = new Uint8Array(opts.capacity)
    this.#damping = opts.dampingPerSec ?? 0
    this.#accelX = opts.accelerationWorld?.x ?? 0
    this.#accelY = opts.accelerationWorld?.y ?? 0
    // Forces every slot empty on destroy (particles may still be alive —
    // `destroy()` doesn't run `shouldDespawn`) and drains any pending
    // `waitUntilEmpty()` resolver, so a caller `await`ing it never hangs if
    // the node is destroyed some other way before its particles naturally
    // despawn.
    this.abortSignal.addEventListener('abort', () => this.#forceEmpty())
  }

  get aliveCount(): number {
    return this.#slots.aliveCount
  }

  override get particleCount(): number {
    return this.#slots.aliveCount
  }

  /**
   * Spawn `count` particles now. For each claimed slot, calls `spawnParticle`
   * SYNCHRONOUSLY before moving to the next slot — a subclass may rely on this
   * to stage per-particle state (e.g. a manually-computed spawn angle) in a
   * scratch field immediately before a `burst(1)` call and read it back inside
   * `spawnParticle`. This ordering is a documented contract, not an
   * implementation detail — don't change it to buffer or defer spawns without
   * updating this doc comment.
   */
  protected burst(count: number): void {
    for (let i = 0; i < count; i++) {
      const idx = this.#slots.spawn()
      if (idx < 0) break
      this.alive[idx] = 1
      const out = this.#spawnScratch
      out.x = 0
      out.y = 0
      out.vx = 0
      out.vy = 0
      out.angle = 0
      out.speed0 = 0
      this.spawnParticle(idx, out)
      this.x[idx] = out.x
      this.y[idx] = out.y
      this.vx[idx] = out.vx
      this.vy[idx] = out.vy
      this.angle[idx] = out.angle
      this.speed0[idx] = out.speed0
    }
  }

  /**
   * Kill a slot now; idempotent (delegates to `SlotPool`'s self-guarding
   * `kill`). Also called automatically when `shouldDespawn` returns true.
   */
  protected kill(idx: number): void {
    if (idx < 0 || idx >= this.capacity) return
    this.alive[idx] = 0
    this.#slots.kill(idx)
  }

  /**
   * Resolves once `aliveCount` is 0 — immediately if it already is at call
   * time, else the next time it reaches 0. Same contract as
   * `ParticleEmitter.waitUntilEmpty`: call this RIGHT AFTER the `burst()` you
   * want to wait for, in the same synchronous span, and don't pair it with
   * reuse across unrelated later bursts. A subclass whose `shouldDespawn` never
   * returns `true` will never see this resolve.
   */
  waitUntilEmpty(): Promise<void> {
    if (this.#slots.aliveCount === 0) return Promise.resolve()
    return new Promise((resolve) => {
      this.#emptyResolvers.push(resolve)
    })
  }

  #drainEmptyResolvers(): void {
    if (this.#emptyResolvers.length === 0 || this.#slots.aliveCount !== 0) {
      return
    }
    const resolvers = this.#emptyResolvers
    this.#emptyResolvers = []
    for (const resolve of resolvers) resolve()
  }

  #forceEmpty(): void {
    for (let i = 0; i < this.#slots.highWaterIndex; i++) this.alive[i] = 0
    this.#slots.clear()
    this.#drainEmptyResolvers()
  }

  override onUpdate(dt: number): void {
    if (dt <= 0) return
    const damp = this.#damping === 0 ? 1 : Math.exp(-this.#damping * dt)
    const ax = this.#accelX
    const ay = this.#accelY
    const hi = this.#slots.highWaterIndex
    for (let i = 0; i < hi; i++) {
      if (this.alive[i] === 0) continue
      this.vx[i] *= damp
      this.vy[i] *= damp
      this.vx[i] += ax * dt
      this.vy[i] += ay * dt
      this.x[i] += this.vx[i] * dt
      this.y[i] += this.vy[i] * dt
      this.updateExtra(i, dt)
      if (this.shouldDespawn(i)) {
        this.kill(i)
      }
    }
    this.#drainEmptyResolvers()
  }

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    const hi = this.#slots.highWaterIndex
    if (hi === 0) return
    for (let i = 0; i < hi; i++) {
      if (this.alive[i] === 0) continue
      gfx.save()
      gfx.translate(this.x[i], this.y[i])
      gfx.rotate(this.angle[i])
      this.drawParticle(gfx, i, camera)
      gfx.restore()
    }
  }

  // --- subclass hooks -------------------------------------------------------

  /**
   * Fill `out` with this particle's spawn state (position/velocity/angle in
   * node-local space, plus `speed0` if a despawn predicate or draw hook needs
   * it). Called once per particle from `burst`. `out` is pre-zeroed reused
   * scratch — do not retain a reference to it.
   */
  protected abstract spawnParticle(
    i: number,
    out: VectorParticleSpawnInit,
  ): void

  /**
   * Draw particle `i` in LOCAL SPACE: the base class has already `save()`'d and
   * positioned/rotated the origin at `(x[i], y[i], angle[i])`, so draw as if
   * the particle were at `(0, 0)` facing angle 0 (e.g.
   * `gfx.fillConvexPoly(triPts, 3, color)`, `gfx.strokeLine(-h, 0, h, 0,
   * style)`). The base class calls `restore()` after this returns. `camera` is
   * forwarded from `Node2D.draw` for anything that needs
   * `camera.strokeSpaceScale()` (e.g. a screen-constant line width).
   */
  protected abstract drawParticle(gfx: Gfx2D, i: number, camera: Camera): void

  /**
   * Extra per-particle integration beyond the base translational kinematics
   * (additional spin fields, decaying transient state, etc). Called once per
   * live particle per frame, after position integration, before the despawn
   * check. Default no-op.
   */
  protected updateExtra(_i: number, _dt: number): void {}

  /**
   * Opt-in despawn predicate evaluated once per live particle per frame, after
   * `updateExtra`. Default ALWAYS false — a subclass that never overrides this
   * produces permanent particles, cleaned up only by an external `destroy()` /
   * `destroyChildren()`. Override to add a speed threshold, a life countdown,
   * or any custom rule.
   */
  protected shouldDespawn(_i: number): boolean {
    return false
  }
}
