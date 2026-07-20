# Physics

An opt-in 2D rigid-body world: circle, box, and convex-polygon collision, an
impulse solver with rotation and friction, raycasting, sensors, and a
broad-phase that scales from a handful of bodies to thousands. Physics is off
until you enable it on a stage.

## Layout

- `PhysicsWorld`, the simulation. Owns bodies, runs the `step`, reports
  collisions and triggers, and answers raycast and region queries.
- `Body`, a rigid body: position, rotation, velocity, mass, and its colliders.
- `Collider` plus the `Shape` union (`circleShape`, `aabbShape`, `polygonShape`).
- `RigidBodyBehavior`, the scene-graph binding: mirrors a body onto a
  `SceneNode` transform each frame with interpolation.
- `PhysicsWorldBehavior`, which gives a subtree its own world so a self-contained
  simulation can sit anywhere in the tree (see Isolated sub-worlds).
- `BroadPhase` with two implementations, `BruteForceBroadPhase` and
  `SpatialHashBroadPhase`. The world picks one for you.

## Enabling it

Physics is a per-stage subsystem the fixed-step loop drives automatically, the
same way input is per-stage. Turn it on with the `physics` option:

```ts
const host = createEngineHost(canvas, {
  physics: { gravity: { x: 0, y: 900 } },
})
const world = host.engine.physics! // the primary stage's world
```

`physics: true` uses the defaults; pass a config to tune it. Secondary stages
enable their own world through `StageOptions.physics`.

To give one part of the scene its own world instead of the whole stage, attach a
`PhysicsWorldBehavior` to a subtree (see Isolated sub-worlds). The world is also
usable on its own, without the engine, when you want to drive the clock yourself:

```ts
const world = new PhysicsWorld({ gravity: { x: 0, y: 900 } })
host.engine.ticker.onFixedStep((fdt) => world.step(fdt))
```

## Isolated sub-worlds

A scene is a tree of nodes, and any subtree can be reused by writing a function
that builds it. Give such a subtree its own physics by attaching a
`PhysicsWorldBehavior` to its root. The node it's attached to becomes a
simulation boundary: `RigidBodyBehavior`s below it bind to that world instead of
the stage world, the engine steps it each fixed tick, and the debug HUD lists it.

```ts
function buildArena(): SceneNode {
  const arena = new SceneNode('arena')
  arena.addBehavior(
    new PhysicsWorldBehavior({ config: { gravity: { x: 0, y: 0 } } }),
  )
  arena.add(buildOrb()) // a RigidBodyBehavior inside buildOrb resolves to arena's world
  return arena
}

// Two arenas, two independent worlds. Nothing else to wire up.
scene.root.add(buildArena())
scene.root.add(buildArena())
```

The world exists as soon as the behavior is constructed, so a builder can add
bodies before the subtree is attached; grab it with `behavior.world`. The node's
world transform maps physics coordinates into scene coordinates, so the subtree
can sit anywhere and the overlay still draws the world in place. Registration
starts when the node enters a scene; removing the behavior or destroying the
node unregisters the world (and clears it, if the behavior created it).
Reparenting the subtree keeps the world intact.

The debug HUD draws every world at once, each in its own color with a boundary
and label, and the Physics panel shows a stats block per world.

## Bodies and colliders

A body holds one or more colliders. Create bodies through the world:

```ts
const floor = world.createBody({
  type: BodyType.Static,
  position: { x: 0, y: 500 },
  colliders: [{ shape: aabbShape(400, 10) }],
})

const ball = world.createBody({
  position: { x: 0, y: 0 },
  restitution: 0.6,
  colliders: [{ shape: circleShape(20) }],
})
```

The three shapes:

- `circleShape(radius)`.
- `aabbShape(halfW, halfH)`, an axis-aligned box. It stays axis-aligned even on
  a rotating body; use a polygon for a box that should turn.
- `polygonShape(vertices)`, a convex polygon wound counter-clockwise. Winding is
  checked in dev builds and edge normals are precomputed.

Mass, restitution, friction, and damping default from the body; a collider can
override restitution and friction through its `material`. A collider marked
`sensor: true` is detected and reported but never resolved (see Triggers).

## Body types

```
BodyType.Static     never moves; infinite mass. Walls and ground.
BodyType.Dynamic    fully simulated: integrated, collided, resolved.
BodyType.Kinematic  moved only by your code; pushes dynamics, unmoved by them.
```

The collision matrix follows from those masses:

| Pair                                | Result                            |
| ----------------------------------- | --------------------------------- |
| Dynamic ↔ Dynamic                   | solved, both move (mass-weighted) |
| Dynamic ↔ Static                    | solved, only the dynamic moves    |
| Dynamic ↔ Kinematic                 | solved, only the dynamic moves    |
| Static/Kinematic ↔ Static/Kinematic | skipped, no solver work           |

Static has `invMass = invInertia = 0`, so the impulse math leaves it fixed. A
circle body with `fixedRotation: true` gets `invInertia = 0` too, and the
angular terms drop out through the same solver, no separate code path.

## The step

The engine calls `world.step(fdt)` once per fixed tick, before the scene's
`onFixedStep` pass, so behaviors and game code read post-step state that
tick. `velocityIterations`, `positionIterations`, and `positionalSlop` (see
Tuning) control the solver passes inside a step; the full sequence is on
`PhysicsWorld.step`'s reference entry.

Same initial state and `dt` reproduce the same result on the same build (no
clock or random source is read, and bodies iterate in a stable order), but
JavaScript floats can differ across CPUs and JS engines, so this is not
lockstep-multiplayer determinism.

## Forces, impulses, and velocity

```ts
body.applyForce(fx, fy) // accumulates until the next step
body.applyImpulse(ix, iy) // instant Δv = impulse * invMass
body.applyTorque(t)
body.applyForceAtPoint(fx, fy, px, py) // adds the resulting torque
body.setVelocity(vx, vy)
body.setPosition(x, y) // wakes the body and re-indexes it
```

All of them wake a sleeping body. Write straight to `body.position` /
`body.velocity` when you are managing dirtiness yourself, but prefer
`setPosition` when you move a body by hand.

## Attaching physics to a node

`RigidBodyBehavior` binds a body to a node's transform and interpolates the
rendered position between fixed steps using the ticker's `fixedAlpha`, so motion
stays smooth at any display rate.

```ts
const node = new SceneNode('crate')
node.transform.x = 100
node.transform.y = 50
node.addBehavior(
  new RigidBodyBehavior({
    bodyDef: {
      mass: 2,
      restitution: 0.3,
      colliders: [{ shape: aabbShape(16, 16) }],
    },
  }),
)
scene.root.add(node)
```

With no `world` option the behavior resolves the nearest world at or above the
node: it walks up the ancestors for a `PhysicsWorldBehavior` (see Isolated
sub-worlds) and, finding none, falls back to the stage world. Pass `world`
explicitly to override. The body is the source of truth; the node follows it.

## Raycasting and queries

```ts
const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500, mask)
if (hit) {
  hit.body // what was hit
  hit.point // world position
  hit.normal // surface normal, back toward the ray origin
  hit.distance // along the ray
}

world.queryRegion(rect, mask, outArray) // bodies overlapping a rect
world.queryPoint(x, y, mask, outArray) // bodies containing a point
```

Rays are broad-phase culled and return the nearest solid hit; sensors are
skipped. The `mask` filters against each body's `layer`.

## Layers and masks

Each body has a `layer` bitmask (which layers it is in) and a `mask` (which
layers it scans). Two bodies collide only when each is in a layer the other
scans:

```ts
const PLAYER = 1 << 0
const ENEMY = 1 << 1
const player = world.createBody({ layer: PLAYER, mask: ENEMY, colliders: [...] })
```

A collider can override its body's layer and mask.

## Triggers

A sensor collider reports overlaps without a physical response. Listen on the
world's event bus:

```ts
world.events.on('triggerEnter', (e) => {
  // e.sensor, e.other, e.sensorBody, e.otherBody
})
world.events.on('triggerExit', (e) => {
  /* ... */
})
```

Solid contacts fire `collisionEnter` and `collisionExit` the same way, and
`sleep` / `wake` fire on body sleep transitions. Event payloads are pooled: read
what you need inside the handler rather than keeping the object.

## Kinematic movement

For a character you move by hand, `moveAndCollide` sweeps a kinematic body and
stops at the first blocking contact; `moveAndSlide` slides the leftover motion
along the surface instead:

```ts
world.moveAndSlide(player, dx, dy)
```

The sweep sub-steps so a fast move does not tunnel through thin walls. Neither
call changes the body's velocity, you drive that from your own movement code.

## Sleeping and rest

A body that stays below `sleepLinearThreshold` (and the angular threshold) for
`sleepTime` seconds sleeps: its velocity zeroes and it drops out of the
simulation until something wakes it. `world.isAtRest()` reports whether every
awake dynamic body is below the threshold, `world.waitForSettle()` resolves when
that happens, and `world.forceSettle()` zeroes everything and resolves waiters
now.

## Tuning

The world config, with defaults:

```ts
interface PhysicsWorldConfig {
  gravity?: { x: number; y: number } // (0, 0)
  velocityIterations?: number // 8
  positionIterations?: number // 3
  positionalSlop?: number // 0.01
  maxCorrection?: number // Infinity
  correctionFactor?: number // 0.2
  sleepLinearThreshold?: number // 0.05
  sleepAngularThreshold?: number // 0.05
  sleepTime?: number // 0.5
  maxLinearSpeed?: number // Infinity
  enableSleeping?: boolean // true
  aabbMargin?: number // 0
  broadPhase?: BroadPhase // auto
  broadPhaseCellSize?: number // auto
}
```

`correctionFactor` trades softness for firmness: 0.2 keeps resting stacks calm,
1.0 separates overlaps in one step. `maxLinearSpeed` caps per-step speed so
nothing outruns a discrete step; it is a cheap guard rather than continuous
collision, so very fast, thin projectiles can still pass through thin walls.

## Broad-phase

The world starts on `BruteForceBroadPhase` (every pair, fine for small worlds)
and upgrades itself to `SpatialHashBroadPhase` once it holds more than ~64
bodies. Pass a `broadPhase` to choose one yourself, or `broadPhaseCellSize` to
tune the grid. The spatial hash is fast when bodies are roughly one size; for
wildly mixed scales the `BroadPhase` interface leaves room for a dynamic AABB
tree without changing the step.
