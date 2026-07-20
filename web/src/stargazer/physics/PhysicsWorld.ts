/**
 * The physics world: owns bodies, drives the fixed-step simulation, and reports
 * collisions and triggers. Create one per independent simulation (usually one
 * per stage) and advance it with {@link step} once per fixed tick.
 *
 * The world is deterministic given the same initial state and `dt`: bodies are
 * iterated in a stable order, contact pairs are keyed canonically, and nothing
 * reads the clock or a random source. Determinism holds for the same build on
 * the same machine; JS float results can differ across CPUs and engines, so
 * this is not lockstep-multiplayer determinism.
 */

import { createEmitter, type Emitter } from '../events/Emitter'
import { rect, type Rect } from '../math/Rect'
import { Body, type BodyDef } from './Body'
import { BodyType, type Manifold, type PhysicsEvents } from './types'
import { shouldCollide } from './layers'
import { collide, ManifoldPool } from './manifold'
import { correctPositions, solveVelocity } from './solver'
import { BruteForceBroadPhase, type BroadPhase } from './BroadPhase'
import { SpatialHashBroadPhase } from './SpatialHashBroadPhase'
import { type Collider } from './Collider'
import { rayVsCollider } from './raycast'
import { LAYER_ALL } from './layers'
import type { KinematicHit, RaycastHit } from './types'
import { vec2, type Vec2 } from '../math/Vec2'
import { registerPolygonCollision } from './polygonCollision'

/**
 * Tuning for a {@link PhysicsWorld}. Every field has a default; pass only what
 * you want to change.
 *
 * @category Physics
 */
export interface PhysicsWorldConfig {
  /**
   * Constant acceleration applied to dynamic bodies (world units/s²). Default
   * `(0, 0)`.
   */
  gravity?: Readonly<{ x: number; y: number }>
  /** Velocity-solver iterations per step. Default 8. */
  velocityIterations?: number
  /** Positional-correction iterations per step. Default 3. */
  positionIterations?: number
  /** Penetration left uncorrected, to stop resting jitter. Default 0.01. */
  positionalSlop?: number
  /** Max positional correction per pass (anti-explosion). Default Infinity. */
  maxCorrection?: number
  /** Fraction of penetration corrected per step (Baumgarte). Default 0.2. */
  correctionFactor?: number
  /** Linear speed under which a body may sleep. Default 0.05. */
  sleepLinearThreshold?: number
  /** Angular speed (rad/s) under which a body may sleep. Default 0.05. */
  sleepAngularThreshold?: number
  /** Seconds below the thresholds before a body sleeps. Default 0.5. */
  sleepTime?: number
  /** Global per-step linear speed clamp (anti-tunneling). Default Infinity. */
  maxLinearSpeed?: number
  /** Whether bodies may sleep at all. Default true. */
  enableSleeping?: boolean
  /** Fat-AABB margin added in the broad-phase (world units). Default 0. */
  aabbMargin?: number
  /**
   * Custom broad-phase. When omitted, the world starts on brute force and
   * upgrades itself to a spatial hash once it holds more than ~64 bodies.
   */
  broadPhase?: BroadPhase
  /** Cell size for the auto-selected spatial hash (world units). */
  broadPhaseCellSize?: number
}

/**
 * A {@link PhysicsWorldConfig} with every field resolved to its effective value.
 * Read it from {@link PhysicsWorld.config}.
 *
 * @category Physics
 */
export interface ResolvedPhysicsConfig {
  gravity: { x: number; y: number }
  velocityIterations: number
  positionIterations: number
  positionalSlop: number
  maxCorrection: number
  correctionFactor: number
  sleepLinearThreshold: number
  sleepAngularThreshold: number
  sleepTime: number
  maxLinearSpeed: number
  enableSleeping: boolean
  aabbMargin: number
}

/** Approach speed above which a moving body wakes a sleeping one it hits. */
const WAKE_APPROACH_SPEED = 0.1
/**
 * Body-index stride for canonical pair keys; supports up to this many live
 * bodies.
 */
const PAIR_STRIDE = 1 << 20
/** Body count above which the default broad-phase upgrades to a spatial hash. */
const AUTO_BROADPHASE_THRESHOLD = 64

interface SolidRecord {
  a: Body
  b: Body
}
interface SensorRecord {
  sensor: Collider
  other: Collider
  sensorBody: Body
  otherBody: Body
}

/**
 * A 2D rigid-body physics world.
 *
 * @category Physics
 * @example
 *   const world = new PhysicsWorld({ gravity: { x: 0, y: 900 } })
 *   const floor = world.createBody({
 *     type: BodyType.Static,
 *     position: { x: 0, y: 500 },
 *     colliders: [{ shape: aabbShape(400, 10) }],
 *   })
 *   const ball = world.createBody({
 *     position: { x: 0, y: 0 },
 *     restitution: 0.6,
 *     colliders: [{ shape: circleShape(20) }],
 *   })
 *   // Drive it from a fixed-step callback:
 *   world.step(1 / 120)
 */
export class PhysicsWorld {
  readonly events: Emitter<PhysicsEvents>
  readonly config: ResolvedPhysicsConfig

  readonly #_bodies: Body[] = []
  #broadPhase: BroadPhase
  /** True while the world owns broad-phase selection and may auto-upgrade. */
  #autoBroadPhase: boolean
  readonly #broadPhaseCellSize?: number
  readonly #pool = new ManifoldPool()

  // Freelist for dense body slots used in pair keys.
  readonly #freeIndices: number[] = []
  #nextIndex = 0

  // Step-local narrow-phase state.
  readonly #_solid: Manifold[] = []
  #_solidCount = 0

  // Overlap tracking for enter/exit diffing.
  #curSolid = new Set<number>()
  #prevSolid = new Set<number>()
  #curSensor = new Set<number>()
  #prevSensor = new Set<number>()
  readonly #solidRecords = new Map<number, SolidRecord>()
  readonly #sensorRecords = new Map<number, SensorRecord>()

  #settleResolvers: Array<() => void> = []

  // Pooled event payloads.
  readonly #evCollisionEnter = {
    a: null as unknown as Body,
    b: null as unknown as Body,
    manifold: null as unknown as Manifold,
  }
  readonly #evCollisionExit = {
    a: null as unknown as Body,
    b: null as unknown as Body,
  }
  readonly #evTriggerEnter = {
    sensor: null as unknown as Collider,
    other: null as unknown as Collider,
    sensorBody: null as unknown as Body,
    otherBody: null as unknown as Body,
  }
  readonly #evTriggerExit = {
    sensor: null as unknown as Collider,
    other: null as unknown as Collider,
    sensorBody: null as unknown as Body,
    otherBody: null as unknown as Body,
  }
  readonly #evSleep = { body: null as unknown as Body }
  readonly #evWake = { body: null as unknown as Body }

  constructor(config: PhysicsWorldConfig = {}) {
    this.events = createEmitter<PhysicsEvents>()
    this.config = {
      gravity: {
        x: config.gravity?.x ?? 0,
        y: config.gravity?.y ?? 0,
      },
      velocityIterations: config.velocityIterations ?? 8,
      positionIterations: config.positionIterations ?? 3,
      positionalSlop: config.positionalSlop ?? 0.01,
      maxCorrection: config.maxCorrection ?? Infinity,
      correctionFactor: config.correctionFactor ?? 0.2,
      sleepLinearThreshold: config.sleepLinearThreshold ?? 0.05,
      sleepAngularThreshold: config.sleepAngularThreshold ?? 0.05,
      sleepTime: config.sleepTime ?? 0.5,
      maxLinearSpeed: config.maxLinearSpeed ?? Infinity,
      enableSleeping: config.enableSleeping ?? true,
      aabbMargin: config.aabbMargin ?? 0,
    }
    this.#autoBroadPhase = config.broadPhase === undefined
    this.#broadPhaseCellSize = config.broadPhaseCellSize
    this.#broadPhase = config.broadPhase ?? new BruteForceBroadPhase()
    this.#setBroadPhaseMargin()
    // Ensure the polygon narrow-phase is registered with the manifold dispatch.
    registerPolygonCollision()
  }

  #setBroadPhaseMargin(): void {
    if ('margin' in this.#broadPhase) {
      ;(this.#broadPhase as { margin: number }).margin = this.config.aabbMargin
    }
  }

  /** Live bodies in insertion order. */
  get bodies(): readonly Body[] {
    return this.#_bodies
  }
  get bodyCount(): number {
    return this.#_bodies.length
  }

  /**
   * Number of solid contact manifolds produced by the last {@link step}. Useful
   * for debug visualization; sensor overlaps are not counted here.
   */
  get contactCount(): number {
    return this.#_solidCount
  }

  /**
   * A solid contact manifold by index in `[0, contactCount)`. The returned
   * object is pooled and overwritten on the next {@link step}, so read what you
   * need now rather than retaining it.
   */
  getContact(i: number): Manifold {
    return this.#_solid[i]
  }

  /** Create a body from a definition, add it, and return it. */
  createBody(def?: BodyDef): Body {
    const body = new Body(def)
    this.addBody(body)
    return body
  }

  /** Add an externally-constructed body. */
  addBody(body: Body): void {
    if (body._world === this) return
    body._world = this
    body._index = this.#freeIndices.pop() ?? this.#nextIndex++
    this.#_bodies.push(body)
    this.#broadPhase.insert(body)
    this.#maybeUpgradeBroadPhase()
  }

  /**
   * Once the world holds more than the threshold and still uses the default
   * brute-force index, migrate to a spatial hash. One-way; a custom broad-phase
   * opts out.
   */
  #maybeUpgradeBroadPhase(): void {
    if (!this.#autoBroadPhase) return
    if (this.#_bodies.length <= AUTO_BROADPHASE_THRESHOLD) return
    if (this.#broadPhase instanceof SpatialHashBroadPhase) return
    const cellSize = this.#broadPhaseCellSize ?? this.#estimateCellSize()
    const hash = new SpatialHashBroadPhase(cellSize)
    for (const b of this.#_bodies) hash.insert(b)
    this.#broadPhase = hash
    this.#setBroadPhaseMargin()
  }

  /** Cell size ≈ 2× the average body AABB extent, clamped to a sane floor. */
  #estimateCellSize(): number {
    let sum = 0
    let n = 0
    for (const b of this.#_bodies) {
      b.computeAABB(SCRATCH_AABB)
      sum += Math.max(SCRATCH_AABB.width, SCRATCH_AABB.height)
      n++
    }
    if (n === 0) return 64
    const avg = sum / n
    return Math.max(8, avg * 2)
  }

  /** Remove a body, firing exit events for any live overlaps it was part of. */
  removeBody(body: Body): void {
    const i = this.#_bodies.indexOf(body)
    if (i < 0) return
    this.#purgeOverlaps(body)
    this.#_bodies.splice(i, 1)
    this.#broadPhase.remove(body)
    this.#freeIndices.push(body._index)
    body._world = null
    body._index = -1
    if (this.isAtRest()) this.#flushSettle()
  }

  /** Remove every body and resolve any pending settle waiters. */
  clear(): void {
    for (const b of this.#_bodies) {
      this.#broadPhase.remove(b)
      b._world = null
      b._index = -1
    }
    this.#_bodies.length = 0
    this.#freeIndices.length = 0
    this.#nextIndex = 0
    this.#curSolid.clear()
    this.#prevSolid.clear()
    this.#curSensor.clear()
    this.#prevSensor.clear()
    this.#solidRecords.clear()
    this.#sensorRecords.clear()
    this.#flushSettle()
  }

  /**
   * Advance the simulation by `dt` seconds. Call once per fixed tick. This is
   * the only method that mutates simulation state.
   *
   * In order: integrate forces into velocities (semi-implicit Euler), apply
   * exponential damping (`linearDamping^(dt*60)`), clamp to `maxLinearSpeed`,
   * and start the sleep timer for slow bodies; integrate velocities into
   * positions and rotations; refresh the broad-phase and gather candidate
   * pairs; build a contact manifold per overlapping pair (SAT for polygons,
   * closest-feature for circles); run `velocityIterations` sequential-impulse
   * passes with restitution and Coulomb friction; run `positionIterations`
   * positional-correction passes, leaving `positionalSlop` uncorrected so
   * resting stacks don't jitter; sleep bodies that stayed slow past
   * `sleepTime`; diff this step's overlaps against last step's and emit
   * enter/exit events; resolve `waitForSettle` promises if the world is at
   * rest.
   *
   * Reads no clock and no random source, and iterates bodies in a stable order,
   * so the same initial state and `dt` reproduce the same result on the same
   * build. JavaScript floats can differ across CPUs and JS engines, so this is
   * not lockstep-multiplayer determinism.
   */
  step(dt: number): void {
    // Snapshot pre-step state so renderers can interpolate between the last two
    // fixed states by `ticker.fixedAlpha` (smooth motion at any display rate).
    for (const b of this.#_bodies) {
      b.prevPosition.x = b.position.x
      b.prevPosition.y = b.position.y
      b.prevRotation = b.rotation
    }
    this.#integrate(dt)
    this.#broadPhase.update()

    // Narrow-phase: collect solid manifolds and record current overlaps.
    this.#pool.begin()
    this.#_solidCount = 0
    this.#curSolid.clear()
    this.#curSensor.clear()
    this.#broadPhase.queryPairs(this.#onPair)

    // Velocity solver.
    const { velocityIterations, positionIterations } = this.config
    for (let it = 0; it < velocityIterations; it++) {
      solveVelocity(this.#_solid, this.#_solidCount)
    }
    // Positional correction.
    for (let it = 0; it < positionIterations; it++) {
      const moved = correctPositions(
        this.#_solid,
        this.#_solidCount,
        this.config.positionalSlop,
        this.config.correctionFactor,
        this.config.maxCorrection,
      )
      if (moved === 0) break
    }

    this.#updateSleep(dt)
    this.#diffAndEmit()

    if (this.isAtRest()) this.#flushSettle()
  }

  #integrate(dt: number): void {
    const {
      gravity,
      maxLinearSpeed,
      enableSleeping,
      sleepLinearThreshold,
      sleepAngularThreshold,
      sleepTime,
    } = this.config
    const maxSpeedSq = maxLinearSpeed * maxLinearSpeed
    const damp60 = dt * 60
    for (const b of this.#_bodies) {
      if (b.sleeping) continue
      if (b.type === BodyType.Static) continue
      if (b.type === BodyType.Kinematic) {
        b.position.x += b.velocity.x * dt
        b.position.y += b.velocity.y * dt
        b.rotation += b.angularVelocity * dt
        if (
          b.velocity.x !== 0 ||
          b.velocity.y !== 0 ||
          b.angularVelocity !== 0
        ) {
          b._aabbDirty = true
        }
        continue
      }
      // Dynamic: forces → velocity.
      b.velocity.x += (gravity.x + b._forceX * b.invMass) * dt
      b.velocity.y += (gravity.y + b._forceY * b.invMass) * dt
      b.angularVelocity += b._torque * b.invInertia * dt
      b._forceX = 0
      b._forceY = 0
      b._torque = 0
      if (b.linearDamping !== 1) {
        const f = Math.pow(b.linearDamping, damp60)
        b.velocity.x *= f
        b.velocity.y *= f
      }
      if (b.angularDamping !== 1) {
        b.angularVelocity *= Math.pow(b.angularDamping, damp60)
      }
      // Anti-tunneling clamp.
      let speedSq = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y
      if (maxSpeedSq !== Infinity && speedSq > maxSpeedSq) {
        const scale = maxLinearSpeed / Math.sqrt(speedSq)
        b.velocity.x *= scale
        b.velocity.y *= scale
        speedSq = maxSpeedSq
      }
      // Velocity → position.
      b.position.x += b.velocity.x * dt
      b.position.y += b.velocity.y * dt
      b.rotation += b.angularVelocity * dt
      b._aabbDirty = true
      // Sleep timer.
      if (enableSleeping && b.canSleep) {
        const thr =
          b.sleepThreshold > 0 ? b.sleepThreshold : sleepLinearThreshold
        if (
          speedSq < thr * thr &&
          Math.abs(b.angularVelocity) < sleepAngularThreshold
        ) {
          b._sleepTimer += dt
          if (b._sleepTimer >= sleepTime) b.sleep()
        } else {
          b._sleepTimer = 0
        }
      }
    }
  }

  #onPair = (a: Body, b: Body): void => {
    if (a.sleeping && b.sleeping) return
    const collidersA = a.colliders
    const collidersB = b.colliders
    for (let i = 0; i < collidersA.length; i++) {
      const ca = collidersA[i]
      for (let j = 0; j < collidersB.length; j++) {
        const cb = collidersB[j]
        if (
          !shouldCollide(
            ca.effectiveLayer(),
            ca.effectiveMask(),
            cb.effectiveLayer(),
            cb.effectiveMask(),
          )
        ) {
          continue
        }
        const isSensor = ca.sensor || cb.sensor
        const m = this.#pool.next()
        m.a = a
        m.b = b
        m.colliderA = ca
        m.colliderB = cb
        m.isSensor = isSensor
        if (!collide(ca, cb, m)) continue
        if (isSensor) {
          const key = this.#pairKey(a, b)
          if (!this.#curSensor.has(key)) {
            this.#curSensor.add(key)
            if (!this.#sensorRecords.has(key)) {
              const sensor = ca.sensor ? ca : cb
              const other = ca.sensor ? cb : ca
              this.#sensorRecords.set(key, {
                sensor,
                other,
                sensorBody: sensor.body,
                otherBody: other.body,
              })
            }
          }
          continue
        }
        // Solid contact.
        const key = this.#pairKey(a, b)
        if (!this.#curSolid.has(key)) {
          this.#curSolid.add(key)
          if (!this.#solidRecords.has(key)) {
            this.#solidRecords.set(key, { a, b })
          }
        }
        // Both immovable: nothing to solve.
        if (a.invMass === 0 && b.invMass === 0) continue
        // Waking: a resting contact with a sleeper is not solved (no perturb);
        // a real approach wakes the sleeper and solves.
        if (a.sleeping || b.sleeping) {
          const vn = this.#approachSpeed(m)
          if (vn > -WAKE_APPROACH_SPEED) continue
          if (a.sleeping) a.wake()
          if (b.sleeping) b.wake()
        }
        this.#_solid[this.#_solidCount++] = m
      }
    }
  }

  /** Closing normal velocity at the first contact (negative = approaching). */
  #approachSpeed(m: Manifold): number {
    const p = m.points[0].point
    const a = m.a
    const b = m.b
    const rax = p.x - a.position.x
    const ray = p.y - a.position.y
    const rbx = p.x - b.position.x
    const rby = p.y - b.position.y
    const rvx =
      b.velocity.x -
      b.angularVelocity * rby -
      (a.velocity.x - a.angularVelocity * ray)
    const rvy =
      b.velocity.y +
      b.angularVelocity * rbx -
      (a.velocity.y + a.angularVelocity * rax)
    return rvx * m.normal.x + rvy * m.normal.y
  }

  #updateSleep(_dt: number): void {
    // Sleep timing is handled inside integrate; nothing else needed here yet.
  }

  #diffAndEmit(): void {
    // Solid enter/exit.
    for (const key of this.#curSolid) {
      if (!this.#prevSolid.has(key)) {
        const rec = this.#solidRecords.get(key)
        if (rec) {
          this.#evCollisionEnter.a = rec.a
          this.#evCollisionEnter.b = rec.b
          this.#evCollisionEnter.manifold = this.#findManifold(rec.a, rec.b)
          this.events.emit('collisionEnter', this.#evCollisionEnter)
        }
      }
    }
    for (const key of this.#prevSolid) {
      if (!this.#curSolid.has(key)) {
        const rec = this.#solidRecords.get(key)
        if (rec) {
          this.#evCollisionExit.a = rec.a
          this.#evCollisionExit.b = rec.b
          this.events.emit('collisionExit', this.#evCollisionExit)
          this.#solidRecords.delete(key)
        }
      }
    }
    // Sensor enter/exit.
    for (const key of this.#curSensor) {
      if (!this.#prevSensor.has(key)) {
        const rec = this.#sensorRecords.get(key)
        if (rec) {
          this.#evTriggerEnter.sensor = rec.sensor
          this.#evTriggerEnter.other = rec.other
          this.#evTriggerEnter.sensorBody = rec.sensorBody
          this.#evTriggerEnter.otherBody = rec.otherBody
          this.events.emit('triggerEnter', this.#evTriggerEnter)
        }
      }
    }
    for (const key of this.#prevSensor) {
      if (!this.#curSensor.has(key)) {
        const rec = this.#sensorRecords.get(key)
        if (rec) {
          this.#evTriggerExit.sensor = rec.sensor
          this.#evTriggerExit.other = rec.other
          this.#evTriggerExit.sensorBody = rec.sensorBody
          this.#evTriggerExit.otherBody = rec.otherBody
          this.events.emit('triggerExit', this.#evTriggerExit)
          this.#sensorRecords.delete(key)
        }
      }
    }
    // Swap current → previous, reuse the emptied sets as next current.
    const s1 = this.#prevSolid
    this.#prevSolid = this.#curSolid
    this.#curSolid = s1
    const s2 = this.#prevSensor
    this.#prevSensor = this.#curSensor
    this.#curSensor = s2
  }

  /** Find the solid manifold for a body pair this step (for the enter payload). */
  #findManifold(a: Body, b: Body): Manifold {
    for (let i = 0; i < this.#_solidCount; i++) {
      const m = this.#_solid[i]
      if ((m.a === a && m.b === b) || (m.a === b && m.b === a)) return m
    }
    return this.#_solid[0]
  }

  /** Fire exit events for a removed body's live overlaps and drop the records. */
  #purgeOverlaps(body: Body): void {
    for (const [key, rec] of this.#solidRecords) {
      if (rec.a === body || rec.b === body) {
        this.#evCollisionExit.a = rec.a
        this.#evCollisionExit.b = rec.b
        this.events.emit('collisionExit', this.#evCollisionExit)
        this.#solidRecords.delete(key)
        this.#prevSolid.delete(key)
        this.#curSolid.delete(key)
      }
    }
    for (const [key, rec] of this.#sensorRecords) {
      if (rec.sensorBody === body || rec.otherBody === body) {
        this.#evTriggerExit.sensor = rec.sensor
        this.#evTriggerExit.other = rec.other
        this.#evTriggerExit.sensorBody = rec.sensorBody
        this.#evTriggerExit.otherBody = rec.otherBody
        this.events.emit('triggerExit', this.#evTriggerExit)
        this.#sensorRecords.delete(key)
        this.#prevSensor.delete(key)
        this.#curSensor.delete(key)
      }
    }
  }

  #pairKey(a: Body, b: Body): number {
    const lo = a._index < b._index ? a._index : b._index
    const hi = a._index < b._index ? b._index : a._index
    return lo * PAIR_STRIDE + hi
  }

  /** Called by a body when it wakes. @internal */
  _onWake(body: Body): void {
    this.#evWake.body = body
    this.events.emit('wake', this.#evWake)
  }

  /** Called by a body when it sleeps. @internal */
  _onSleep(body: Body): void {
    this.#evSleep.body = body
    this.events.emit('sleep', this.#evSleep)
  }

  // --- Rest detection ---

  /** True when every dynamic, awake body is below the sleep threshold. */
  isAtRest(): boolean {
    const { sleepLinearThreshold, sleepAngularThreshold } = this.config
    for (const b of this.#_bodies) {
      if (b.type !== BodyType.Dynamic || b.sleeping) continue
      const thr = b.sleepThreshold > 0 ? b.sleepThreshold : sleepLinearThreshold
      const speedSq = b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y
      if (speedSq >= thr * thr) return false
      if (Math.abs(b.angularVelocity) >= sleepAngularThreshold) return false
    }
    return true
  }

  /** Resolves when the world is at rest (immediately if it already is). */
  waitForSettle(): Promise<void> {
    if (this.isAtRest()) return Promise.resolve()
    return new Promise((resolve) => {
      this.#settleResolvers.push(resolve)
    })
  }

  /** Zero every velocity, sleep dynamic bodies, and resolve settle waiters. */
  forceSettle(): void {
    for (const b of this.#_bodies) {
      b.velocity.x = 0
      b.velocity.y = 0
      b.angularVelocity = 0
      if (b.type === BodyType.Dynamic && !b.sleeping) b.sleep()
    }
    this.#flushSettle()
  }

  #flushSettle(): void {
    if (this.#settleResolvers.length === 0) return
    const resolvers = this.#settleResolvers
    this.#settleResolvers = []
    for (const r of resolvers) r()
  }

  // --- Overlap unstuck ---

  /**
   * Push `body` out of every overlap with other solid bodies over up to
   * `passes` passes, optionally clamping it inside `bounds`. Returns false if
   * it is still overlapping afterward.
   */
  resolveOverlaps(body: Body, passes = 6, bounds?: Readonly<Rect>): boolean {
    for (let pass = 0; pass < passes; pass++) {
      let moved = false
      for (const other of this.#_bodies) {
        if (other === body) continue
        if (this.#pushApart(body, other)) moved = true
      }
      if (bounds) this.#clampInside(body, bounds)
      if (!moved) return true
    }
    // Final check.
    for (const other of this.#_bodies) {
      if (other === body) continue
      if (this.#overlaps(body, other)) return false
    }
    return true
  }

  #pushApart(body: Body, other: Body): boolean {
    let moved = false
    for (const ca of body.colliders) {
      if (ca.sensor) continue
      for (const cb of other.colliders) {
        if (cb.sensor) continue
        const m = this.#pool.next()
        if (collide(ca, cb, m)) {
          // normal points body → other; move body opposite.
          body.position.x -= m.normal.x * m.penetration
          body.position.y -= m.normal.y * m.penetration
          body._aabbDirty = true
          moved = true
        }
      }
    }
    return moved
  }

  #overlaps(body: Body, other: Body): boolean {
    for (const ca of body.colliders) {
      if (ca.sensor) continue
      for (const cb of other.colliders) {
        if (cb.sensor) continue
        const m = this.#pool.next()
        if (collide(ca, cb, m) && m.penetration > 1e-3) return true
      }
    }
    return false
  }

  #clampInside(body: Body, bounds: Readonly<Rect>): void {
    body.computeAABB(SCRATCH_AABB)
    const dxLeft = bounds.x - SCRATCH_AABB.x
    if (dxLeft > 0) body.position.x += dxLeft
    const dxRight =
      SCRATCH_AABB.x + SCRATCH_AABB.width - (bounds.x + bounds.width)
    if (dxRight > 0) body.position.x -= dxRight
    const dyTop = bounds.y - SCRATCH_AABB.y
    if (dyTop > 0) body.position.y += dyTop
    const dyBottom =
      SCRATCH_AABB.y + SCRATCH_AABB.height - (bounds.y + bounds.height)
    if (dyBottom > 0) body.position.y -= dyBottom
    body._aabbDirty = true
  }

  /** Clamp a candidate velocity to `maxLinearSpeed`. */
  clampSpeed(vx: number, vy: number): { vx: number; vy: number } {
    const max = this.config.maxLinearSpeed
    if (max === Infinity) return { vx, vy }
    const speedSq = vx * vx + vy * vy
    if (speedSq <= max * max) return { vx, vy }
    const scale = max / Math.sqrt(speedSq)
    return { vx: vx * scale, vy: vy * scale }
  }

  // --- Raycasting ---

  /**
   * Cast a ray from `origin` along `dir` (need not be normalized) up to
   * `maxDistance` world units. Returns the nearest solid collider hit whose
   * body passes `mask`, or null. Sensors are skipped. When `out` is given it is
   * reused and returned.
   *
   * @example
   *   const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500)
   *   if (hit) console.log(hit.body, hit.point, hit.normal, hit.distance)
   */
  raycast(
    origin: Readonly<Vec2>,
    dir: Readonly<Vec2>,
    maxDistance: number,
    mask: number = LAYER_ALL,
    out?: RaycastHit,
  ): RaycastHit | null {
    const len = Math.hypot(dir.x, dir.y)
    if (len === 0) return null
    const dx = dir.x / len
    const dy = dir.y / len
    const candidates = SCRATCH_BODIES
    candidates.length = 0
    this.#broadPhase.update()
    this.#broadPhase.queryRay(origin, dir, maxDistance, candidates)
    let bestT = Infinity
    let bestBody: Body | null = null
    let bestColl: Collider | null = null
    let bestNx = 0
    let bestNy = 0
    for (const b of candidates) {
      if ((b.layer & mask) === 0) continue
      for (const c of b.colliders) {
        if (c.sensor) continue
        const t = rayVsCollider(
          origin.x,
          origin.y,
          dx,
          dy,
          maxDistance,
          c,
          SCRATCH_NORMAL,
        )
        if (t >= 0 && t < bestT) {
          bestT = t
          bestBody = b
          bestColl = c
          bestNx = SCRATCH_NORMAL.x
          bestNy = SCRATCH_NORMAL.y
        }
      }
    }
    if (!bestBody || !bestColl) return null
    const hit = out ?? SCRATCH_HIT
    hit.body = bestBody
    hit.collider = bestColl
    hit.distance = bestT
    if (!hit.point) hit.point = vec2()
    hit.point.x = origin.x + dx * bestT
    hit.point.y = origin.y + dy * bestT
    if (!hit.normal) hit.normal = vec2()
    hit.normal.x = bestNx
    hit.normal.y = bestNy
    return hit
  }

  // --- Kinematic movement ---

  /**
   * Move `body` by `(dx, dy)`, then push it out of any solid overlaps, and
   * report the deepest blocking contact (or null if the move was clear). The
   * body's velocity is not changed. Use for character/kinematic movement.
   */
  moveAndCollide(
    body: Body,
    dx: number,
    dy: number,
    out?: KinematicHit,
  ): KinematicHit | null {
    const startX = body.position.x
    const startY = body.position.y
    body.wake()
    // Sub-step the sweep so a fast move can't tunnel through thin geometry.
    body.computeAABB(SCRATCH_AABB)
    const minExtent =
      0.5 * Math.max(1e-3, Math.min(SCRATCH_AABB.width, SCRATCH_AABB.height))
    const dist = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.ceil(dist / minExtent))
    const sx = dx / steps
    const sy = dy / steps

    let hitBody: Body | null = null
    let hitColl: Collider | null = null
    let hitNx = 0
    let hitNy = 0
    for (let s = 0; s < steps; s++) {
      body.position.x += sx
      body.position.y += sy
      body._aabbDirty = true
      this.#broadPhase.update()
      const contact = this.#depenetrate(body)
      if (contact) {
        hitBody = contact.other
        hitColl = contact.collider
        hitNx = contact.nx
        hitNy = contact.ny
        break
      }
    }

    if (!hitBody || !hitColl) return null
    const hit = out ?? SCRATCH_KHIT
    hit.body = hitBody
    hit.collider = hitColl
    if (!hit.normal) hit.normal = vec2()
    hit.normal.x = hitNx
    hit.normal.y = hitNy
    if (!hit.travel) hit.travel = vec2()
    hit.travel.x = body.position.x - startX
    hit.travel.y = body.position.y - startY
    if (!hit.remainder) hit.remainder = vec2()
    hit.remainder.x = dx - hit.travel.x
    hit.remainder.y = dy - hit.travel.y
    return hit
  }

  /**
   * Push `body` out of every solid overlap at its current position (up to two
   * passes) and return the deepest contact, or null if it was already clear.
   */
  #depenetrate(body: Body): {
    other: Body
    collider: Collider
    nx: number
    ny: number
  } | null {
    let hitOther: Body | null = null
    let hitColl: Collider | null = null
    let hitNx = 0
    let hitNy = 0
    let deepest = 0
    for (let pass = 0; pass < 2; pass++) {
      const candidates = SCRATCH_BODIES
      candidates.length = 0
      body.computeAABB(SCRATCH_AABB)
      this.#broadPhase.queryRegion(SCRATCH_AABB, candidates)
      let moved = false
      for (const other of candidates) {
        if (other === body) continue
        for (const ca of body.colliders) {
          if (ca.sensor) continue
          for (const cb of other.colliders) {
            if (cb.sensor) continue
            if (
              !shouldCollide(
                ca.effectiveLayer(),
                ca.effectiveMask(),
                cb.effectiveLayer(),
                cb.effectiveMask(),
              )
            ) {
              continue
            }
            const m = this.#pool.next()
            if (!collide(ca, cb, m)) continue
            body.position.x -= m.normal.x * m.penetration
            body.position.y -= m.normal.y * m.penetration
            body._aabbDirty = true
            moved = true
            if (m.penetration > deepest) {
              deepest = m.penetration
              hitOther = other
              hitColl = cb
              hitNx = -m.normal.x
              hitNy = -m.normal.y
            }
          }
        }
      }
      if (!moved) break
    }
    if (!hitOther || !hitColl) return null
    return { other: hitOther, collider: hitColl, nx: hitNx, ny: hitNy }
  }

  /**
   * Move `body` by `(dx, dy)`, sliding along the first blocking surface instead
   * of stopping. Velocity is unchanged; drive it from your own movement code.
   */
  moveAndSlide(body: Body, dx: number, dy: number): void {
    const hit = this.moveAndCollide(body, dx, dy, SCRATCH_KHIT)
    if (!hit) return
    // Project the leftover motion onto the surface tangent.
    const rx = hit.remainder.x
    const ry = hit.remainder.y
    const nx = hit.normal.x
    const ny = hit.normal.y
    const dot = rx * nx + ry * ny
    const slideX = rx - nx * dot
    const slideY = ry - ny * dot
    if (slideX !== 0 || slideY !== 0) {
      this.moveAndCollide(body, slideX, slideY)
    }
  }

  // --- Region / point queries ---

  /** Bodies whose world AABB overlaps `region` and pass `mask`, into `out`. */
  queryRegion(region: Readonly<Rect>, mask: number, out: Body[]): Body[] {
    out.length = 0
    const candidates = SCRATCH_BODIES
    candidates.length = 0
    this.#broadPhase.update()
    this.#broadPhase.queryRegion(region, candidates)
    for (const b of candidates) {
      if ((b.layer & mask) !== 0) out.push(b)
    }
    return out
  }

  /** Bodies with a collider containing the point `(x, y)` and passing `mask`. */
  queryPoint(x: number, y: number, mask: number, out: Body[]): Body[] {
    out.length = 0
    SCRATCH_RECT2.x = x
    SCRATCH_RECT2.y = y
    SCRATCH_RECT2.width = 0
    SCRATCH_RECT2.height = 0
    const candidates = SCRATCH_BODIES
    candidates.length = 0
    this.#broadPhase.update()
    this.#broadPhase.queryRegion(SCRATCH_RECT2, candidates)
    for (const b of candidates) {
      if ((b.layer & mask) === 0) continue
      if (this.#pointInBody(b, x, y)) out.push(b)
    }
    return out
  }

  #pointInBody(b: Body, x: number, y: number): boolean {
    for (const c of b.colliders) {
      c.computeWorldAABB(SCRATCH_AABB)
      if (
        x < SCRATCH_AABB.x ||
        x > SCRATCH_AABB.x + SCRATCH_AABB.width ||
        y < SCRATCH_AABB.y ||
        y > SCRATCH_AABB.y + SCRATCH_AABB.height
      ) {
        continue
      }
      // AABB pass; for circles refine by radius.
      if (c.shape.kind === 'circle') {
        const cx = SCRATCH_AABB.x + SCRATCH_AABB.width * 0.5
        const cy = SCRATCH_AABB.y + SCRATCH_AABB.height * 0.5
        const dx = x - cx
        const dy = y - cy
        if (dx * dx + dy * dy <= c.shape.radius * c.shape.radius) return true
      } else {
        return true
      }
    }
    return false
  }
}

const SCRATCH_AABB = rect()
const SCRATCH_RECT2 = rect()
const SCRATCH_BODIES: Body[] = []
const SCRATCH_NORMAL = vec2()
const SCRATCH_HIT: RaycastHit = {
  body: null as unknown as Body,
  collider: null as unknown as Collider,
  point: vec2(),
  normal: vec2(),
  distance: 0,
}
const SCRATCH_KHIT: KinematicHit = {
  body: null as unknown as Body,
  collider: null as unknown as Collider,
  normal: vec2(),
  travel: vec2(),
  remainder: vec2(),
}
