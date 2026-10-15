---
title: Physics
group: Features
order: 15
---

# Physics

Stargazer has an optional 2D rigid-body physics engine. A {@link PhysicsWorld} moves {@link Body} objects under gravity and forces, resolves collisions between their {@link Collider} shapes, and reports contacts and sensor overlaps as events. It also answers raycasts and region queries.

Physics is off until you turn it on for a stage, or give part of the scene its own world. {@link RigidBodyBehavior} connects a body to a scene node, so the node follows the body.

## Basic usage

The example below turns on physics for the primary stage, adds a static floor, and drops a box onto it.

```ts
import {
  createEngineHost,
  Node2D,
  RigidBodyBehavior,
  BodyType,
  aabbShape,
} from '@src/stargazer'

const host = createEngineHost({
  canvas,
  physics: { gravity: { x: 0, y: 900 } },
})
const world = host.engine.physics! // the primary stage's world

world.createBody({
  type: BodyType.Static,
  position: { x: 400, y: 560 },
  colliders: [{ shape: aabbShape(400, 10) }],
})

await host.loadScene((scene) => {
  const crate = new Node2D('crate')
  crate.transform.x = 400
  crate.transform.y = 100
  crate.addBehavior(
    new RigidBodyBehavior({
      bodyDef: {
        mass: 2,
        restitution: 0.3,
        colliders: [{ shape: aabbShape(16, 16) }],
      },
    }),
  )
  scene.root.add(crate)
})
host.start()
```

The engine steps the world once per fixed tick. The crate falls, bounces a little, and comes to rest on the floor. `physics: true` turns physics on with the default settings. A secondary stage turns on its own world with [`StageOptions.physics`](/module/render/stageoptions#physics).

### Bodies and colliders

A body has a position, rotation, velocity, mass, and one or more colliders. Create bodies with [`createBody`](/module/physics/physicsworld#createbody), which takes a {@link BodyDef}. Every field is optional. The default is a dynamic body at the origin with mass 1 and no colliders.

```ts
const ball = world.createBody({
  position: { x: 0, y: 0 },
  restitution: 0.6,
  friction: 0.2,
  colliders: [{ shape: circleShape(20) }],
})
```

There are three shapes:

- {@link circleShape}`(radius)`: a circle
- {@link aabbShape}`(halfW, halfH)`: a box that stays axis-aligned even when its body rotates
- {@link polygonShape}`(vertices)`: a convex polygon, with vertices in counter-clockwise order

Use a polygon for a box that should turn. In development builds, `polygonShape` throws for fewer than 3 vertices or clockwise order. A collider's `offset` places it relative to the body origin. The body computes its rotational inertia from the shapes.

### Body types

{@link BodyType} has three values:

- `BodyType.Static` never moves and has infinite mass. Use it for walls and floors.
- `BodyType.Dynamic` is fully simulated: gravity, forces, and contacts move it.
- `BodyType.Kinematic` moves only by its own velocity and your code. It pushes dynamic bodies, and nothing pushes it.

The type decides which bodies a contact moves:

| Pair                                    | Result                              |
| --------------------------------------- | ----------------------------------- |
| Dynamic and dynamic                     | Solved, both move, weighted by mass |
| Dynamic and static or kinematic         | Solved, only the dynamic body moves |
| Two bodies that are static or kinematic | Reported as a contact, never solved |

`fixedRotation: true` keeps a body from rotating.

### Moving bodies

These methods change a body. Each one also wakes a sleeping body.

```ts
body.applyForce(fx, fy) // added up until the next step
body.applyForceAtPoint(fx, fy, px, py) // also adds torque
body.applyImpulse(ix, iy) // changes velocity now, by impulse / mass
body.applyImpulseAtPoint(ix, iy, px, py)
body.applyTorque(t)
body.setVelocity(vx, vy)
body.setPosition(x, y)
body.setRotation(radians)
```

Use `setPosition` and `setRotation` when you move a body by hand. They also tell the broad phase to index the body again. Writing to `body.position` directly skips that.

### Following a body with a node

{@link RigidBodyBehavior} creates a body from `bodyDef`, or binds an existing `body`. It seeds a new body's position and rotation from the node's transform. Each frame it copies the body's position and rotation to the node, interpolated between fixed steps with the ticker's `fixedAlpha`, so motion looks smooth at any display rate.

The body is the source of truth, and the node follows it. The behavior writes the node's own transform, so put the node directly in physics space: under the scene root for the stage world, or under the node that holds the world.

When the node joins a scene, the behavior adds the body to a world. It uses the `world` option if you pass one. Otherwise it looks for a {@link PhysicsWorldBehavior} on the node or its ancestors, and then falls back to the stage world. It throws when it finds none. Removing the behavior or destroying the node removes the body.

### Collision events

The world reports contacts through its [`events`](/module/physics/physicsworld#events) emitter. {@link PhysicsEvents} lists the events:

```ts
world.events.on('collisionEnter', ({ a, b, manifold }) => {
  // a and b started touching this step
})
world.events.on('collisionExit', ({ a, b }) => {})
world.events.on(
  'triggerEnter',
  ({ sensor, other, sensorBody, otherBody }) => {},
)
world.events.on('triggerExit', ({ sensor, other, sensorBody, otherBody }) => {})
world.events.on('sleep', ({ body }) => {})
world.events.on('wake', ({ body }) => {})
```

The world reuses the event objects. Read what you need inside the handler and don't keep the object. Removing a body fires the exit events for everything it was touching.

### Sensors

A collider with `sensor: true` detects overlaps but never pushes anything. Bodies pass through it, and the world fires `triggerEnter` and `triggerExit`. Use it for pickups, goal zones, and areas that start an event.

```ts
world.createBody({
  type: BodyType.Static,
  position: { x: 700, y: 300 },
  colliders: [{ shape: aabbShape(40, 40), sensor: true }],
})
```

## Advanced usage

This section covers isolated worlds, the step, queries, layers, kinematic movement, sleeping, sync control, and tuning.

### Isolated worlds

A {@link PhysicsWorldBehavior} gives a subtree its own world. The node it's attached to becomes the world's space node. Its world transform maps physics coordinates into the scene, so the subtree can sit anywhere. `RigidBodyBehavior`s below it use this world instead of the stage world.

```ts
function buildArena(): Node2D {
  const arena = new Node2D('arena')
  arena.addBehavior(
    new PhysicsWorldBehavior({ config: { gravity: { x: 0, y: 0 } } }),
  )
  arena.add(buildBall()) // its RigidBodyBehavior binds to arena's world
  return arena
}

// Two arenas, two independent worlds.
scene.root.add(buildArena())
scene.root.add(buildArena())
```

The world exists as soon as you construct the behavior, so you can add bodies through [`world`](/module/physics/physicsworldbehavior#world) before the node joins a scene. The engine starts stepping the world when the node joins a scene. Removing the behavior or destroying the node stops it, and clears the world if the behavior created it. Moving the subtree to another parent keeps the world.

{@link PhysicsWorldBehaviorOptions} takes `config`, or an existing `world` to adopt, and a `label` for the debug HUD. The behavior doesn't clear an adopted world.

### A world without the engine

You can also create a {@link PhysicsWorld} yourself. Step it from your own fixed-step callback, or register it so the engine steps it:

```ts
const world = new PhysicsWorld({ gravity: { x: 0, y: 900 } })
const unregister = host.engine.registerPhysicsWorld(world, { label: 'sim' })
```

[`registerPhysicsWorld`](/module/engine/engine#registerphysicsworld) returns a function that stops the stepping. [`engine.physicsWorlds`](/module/engine/engine#physicsworlds) lists every registered world. In tests, call `world.step(dt)` directly.

### The step

The engine calls [`step`](/module/physics/physicsworld#step) on every registered world once per fixed tick, before the scene's `onFixedStep` pass. Game code in `onFixedStep` reads the state after the step. The fixed step runs at 120 Hz unless you set `fixedStepHz` on the host.

One step does this, in order:

1. Adds gravity and forces to velocity, applies damping, and clamps to `maxLinearSpeed`.
2. Moves positions and rotations by velocity.
3. Finds candidate pairs in the broad phase and builds a contact for each overlapping pair.
4. Runs `velocityIterations` passes of the impulse solver, with restitution and friction.
5. Runs up to `positionIterations` passes that push overlapping bodies apart.
6. Puts slow bodies to sleep and fires the enter and exit events.

The same starting state and `dt` give the same result on the same build. The world reads no clock or random source and iterates bodies in a stable order. JavaScript floats can still differ across CPUs and browsers, so this isn't enough for lockstep multiplayer.

### Materials and damping

A body's `restitution` (bounciness, 0 to 1) and `friction` both default to 0. A collider can override them with `material`. For a contact, the world uses the larger restitution of the two colliders and the geometric mean of their friction.

`linearDamping` and `angularDamping` are the share of velocity a body keeps per 1/60 second, applied as `damping^(dt * 60)`. The default 1 means no damping, and 0.98 slows a body a little every frame.

### Raycasts and queries

[`raycast`](/module/physics/physicsworld#raycast) returns the nearest hit along a ray, or `null`. The direction doesn't need to be normalized.

```ts
const hit = world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 500)
if (hit) {
  hit.body // what the ray hit
  hit.collider
  hit.point // world position of the hit
  hit.normal // surface normal, pointing back toward the ray origin
  hit.distance // distance along the ray
}
```

Rays skip sensors. The world returns the same {@link RaycastHit} object each call, so copy what you need, or pass your own object as the fifth argument.

Two more queries fill an array you pass in:

```ts
const found: Body[] = []
world.queryRegion(rect, LAYER_ALL, found) // bodies whose bounds overlap rect
world.queryPoint(x, y, LAYER_ALL, found) // bodies with a collider at the point
```

`queryPoint` tests circles exactly, and boxes and polygons by their bounding box. All three queries filter by the body's `layer` against the mask.

### Layers and masks

Each body has a `layer` bitmask, the layers it's in, and a `mask`, the layers it collides with. Two bodies collide only when each one's layer is in the other's mask. The defaults are [`LAYER_DEFAULT`](/module/physics/layer-default) (bit 0) and [`LAYER_ALL`](/module/physics/layer-all).

```ts
const PLAYER = 1 << 0
const ENEMY = 1 << 1
const player = world.createBody({
  layer: PLAYER,
  mask: ENEMY,
  colliders: [{ shape: circleShape(12) }],
})
```

A collider can override its body's `layer` and `mask`. {@link shouldCollide} runs the same test on four numbers.

### Kinematic movement

For a character you move by hand, [`moveAndCollide`](/module/physics/physicsworld#moveandcollide) moves a body, pushes it out of anything solid, and returns the deepest blocking contact as a {@link KinematicHit}, or `null`. [`moveAndSlide`](/module/physics/physicsworld#moveandslide) slides the rest of the motion along the surface it hit.

```ts
world.moveAndSlide(player, dx, dy)
```

Both split a long move into steps no longer than half the body's smallest size, so a fast move doesn't pass through thin walls. Neither changes the body's velocity. `moveAndCollide` returns a reused object, like `raycast`.

To free a body stuck inside others, [`resolveOverlaps`](/module/physics/physicsworld#resolveoverlaps) pushes it out over a few passes, optionally kept inside a rectangle.

### Sleeping and rest

A dynamic body that stays below `sleepLinearThreshold` and `sleepAngularThreshold` for `sleepTime` seconds goes to sleep. Its velocity becomes 0 and the world skips it until a force, a setter, or a real hit wakes it. A body's own `sleepThreshold` overrides the linear threshold, and `canSleep: false` keeps it awake.

The world also tells you when everything has stopped:

- `world.isAtRest()` returns `true` when every awake dynamic body is below the thresholds.
- `world.waitForSettle()` resolves when the world is at rest.
- `world.forceSettle()` stops every body now and resolves the waiters.

### Taking over a node's transform

Sometimes the node needs to move apart from its body, for example while a tween slides it off screen or a finger drags it. {@link RigidBodyBehavior} has three controls for this:

- Set [`syncEnabled`](/module/physics/rigidbodybehavior#syncenabled) to `false` to stop copying the body to the node, and back to `true` to resume.
- Pass `shouldSync: () => boolean` to decide each frame.
- Set [`interpolate`](/module/physics/rigidbodybehavior#interpolate) to `false` to show the body's latest position without smoothing.

```ts
let dragging = false
const rb = new RigidBodyBehavior({
  bodyDef,
  shouldSync: () => !dragging, // the drag owns the transform
})
node.addBehavior(rb)
```

`syncRotation: false` copies only the position.

### Sync-only mode

When your code adds and removes bodies from the world itself, pass `manageBody: false` with an explicit `body`. The behavior then only copies the body to the node. It doesn't look for a world or add or remove the body.

```ts
node.addBehavior(
  new RigidBodyBehavior({
    body, // your code already added it to a world
    manageBody: false,
    syncRotation: false,
  }),
)
```

### Tuning

{@link PhysicsWorldConfig} takes these options. Every one has a default, and [`world.config`](/module/physics/physicsworld#config) holds the resolved values.

| Option                  | Default    | Meaning                                                            |
| ----------------------- | ---------- | ------------------------------------------------------------------ |
| `gravity`               | `(0, 0)`   | Acceleration on dynamic bodies, in units per second²               |
| `velocityIterations`    | 8          | Impulse solver passes per step                                     |
| `positionIterations`    | 3          | Overlap correction passes per step                                 |
| `positionalSlop`        | 0.01       | Overlap left uncorrected, so resting bodies don't jitter           |
| `correctionFactor`      | 0.2        | Share of overlap corrected per pass                                |
| `maxCorrection`         | `Infinity` | Largest correction per pass                                        |
| `maxLinearSpeed`        | `Infinity` | Speed clamp per step                                               |
| `sleepLinearThreshold`  | 0.05       | Speed below which a body may sleep                                 |
| `sleepAngularThreshold` | 0.05       | Angular speed, in radians per second, below which a body may sleep |
| `sleepTime`             | 0.5        | Seconds below the thresholds before a body sleeps                  |
| `enableSleeping`        | `true`     | Whether bodies may sleep at all                                    |
| `aabbMargin`            | 0          | Extra margin on bounds in the broad phase                          |
| `broadPhase`            | automatic  | A broad phase of your own                                          |
| `broadPhaseCellSize`    | automatic  | Cell size for the automatic spatial hash                           |

A `correctionFactor` of 0.2 keeps resting stacks calm, and 1 removes overlap in one step. `maxLinearSpeed` keeps bodies from moving too far in one step. It doesn't do continuous collision, so very fast, thin objects can still pass through thin walls.

### Broad phase

The broad phase finds pairs of bodies whose bounds overlap, before the exact shape test. The world starts with {@link BruteForceBroadPhase}, which tests every pair. When the world holds more than 64 bodies, it switches to a {@link SpatialHashBroadPhase} once, with a cell size of twice the average body size, at least 8 units.

Pass `broadPhase` to choose one yourself, which turns the switch off. Set `broadPhaseCellSize` to set the hash cell size. The spatial hash works best when bodies are about the same size. The {@link BroadPhase} interface lets you supply another structure.

### Debug overlay

The debug HUD's Physics panel draws colliders, bounds, contacts, and velocities for every registered world, and shows a stats block per world. See [Debugging](/guides/debugging).

## See also

- {@link PhysicsWorld}: bodies, the step, events, and queries
- {@link Body}: a rigid body and its forces
- {@link BodyDef}: options for a new body
- {@link ColliderDef}: shape, offset, sensor, layers, and material
- {@link RigidBodyBehavior}: makes a node follow a body
- {@link PhysicsWorldBehavior}: a world for one subtree
- {@link PhysicsWorldConfig}: world tuning options
- {@link PhysicsEvents}: collision, trigger, and sleep events
- [Scene](/guides/scene): nodes, behaviors, and the fixed step
- [Stages](/guides/stages): secondary stages with their own physics
- [Debugging](/guides/debugging): the physics overlay and panel
